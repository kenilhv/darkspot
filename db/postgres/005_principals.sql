-- D-14 (+ D-3 follow-up): one identity table for every "named human" in the schema.
-- A principal is a person registered under an authorized org by another named human. The opaque
-- external_subject is what CHAT derives from LibreChat's authenticated user id — never from free text a user types.
CREATE TABLE principals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject   text NOT NULL,                    -- opaque auth-provider subject (e.g. LibreChat user id)
  display_name       text NOT NULL,
  authorized_org_id  uuid NOT NULL REFERENCES authorized_orgs(id),
  role               text NOT NULL,                    -- 'coordinator' | 'reviewer' | 'responder' | 'observer'
  issued_by          text NOT NULL,                    -- named human who registered this principal
  issued_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  UNIQUE (external_subject),
  CONSTRAINT principals_role_known CHECK (role IN ('coordinator', 'reviewer', 'responder', 'observer'))
);

-- access_roles now keys on a principal, not a free-text name.
ALTER TABLE access_roles
  DROP CONSTRAINT access_roles_disaster_event_id_principal_key,
  DROP COLUMN principal,
  ADD COLUMN principal_id uuid NOT NULL REFERENCES principals(id),
  ADD CONSTRAINT access_roles_event_principal_key UNIQUE (disaster_event_id, principal_id);

-- D-3 follow-up: FK versions of the "named human" columns, alongside the text ones for now (CHAT still writes text).
-- Tightening plan: once CHAT passes principal ids, the text columns become derived and these go NOT NULL.
ALTER TABLE escalations          ADD COLUMN authorized_by_principal_id uuid REFERENCES principals(id);
ALTER TABLE reports_human_review ADD COLUMN reviewer_principal_id      uuid REFERENCES principals(id);
ALTER TABLE devices              ADD COLUMN trust_set_by_principal_id  uuid REFERENCES principals(id);

-- A principal can only be granted individual-level PII within their own org's deployment.
CREATE OR REPLACE FUNCTION access_roles_principal_org_matches() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.level = 'individual_pii' AND NOT EXISTS (
       SELECT 1 FROM principals p JOIN authorized_orgs o ON o.id = p.authorized_org_id
       WHERE p.id = NEW.principal_id AND o.id = NEW.granted_org_id AND o.disaster_event_id = NEW.disaster_event_id
         AND p.revoked_at IS NULL AND o.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'individual_pii requires an active principal of the granting authorized org for this event';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER access_roles_principal_org_check
  BEFORE INSERT OR UPDATE ON access_roles FOR EACH ROW EXECUTE FUNCTION access_roles_principal_org_matches();
