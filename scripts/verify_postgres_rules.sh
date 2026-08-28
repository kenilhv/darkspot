#!/usr/bin/env sh
# Verifies the §1a product-rule constraints in Postgres reject bad rows. Exit 0 only if every expected failure fails.
# Usage: sh scripts/verify_postgres_rules.sh   (stack must be up: docker compose up -d --wait)
set -e
out=$(docker compose exec -T postgres psql -U darkspot -d darkspot -v ON_ERROR_STOP=0 2>&1 <<'SQL'
BEGIN;
INSERT INTO disaster_events (id,type,country_iso3,region,activation_date) VALUES ('00000000-0000-0000-0000-000000000001','glof','NPL','test','2026-08-26');
INSERT INTO authorized_orgs (id,disaster_event_id,org_name,org_type,contact_name,contact_channel,registered_by) VALUES ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000001','Test Org','eoc','x','y','z');
SAVEPOINT a; INSERT INTO escalations (disaster_event_id,kind,evidence_mesh_event_ids,summary,authorized_by,authorized_org_id) VALUES ('00000000-0000-0000-0000-000000000001','urgency_tier',ARRAY[gen_random_uuid()],'s',NULL,'00000000-0000-0000-0000-00000000000a'); ROLLBACK TO a;
SAVEPOINT b; INSERT INTO escalations (disaster_event_id,kind,evidence_mesh_event_ids,summary,authorized_by,authorized_org_id) VALUES ('00000000-0000-0000-0000-000000000001','urgency_tier',ARRAY[gen_random_uuid()],'s','  ','00000000-0000-0000-0000-00000000000a'); ROLLBACK TO b;
SAVEPOINT c; INSERT INTO drone_routes_simulated (disaster_event_id,is_simulation,algorithm,fleet_size,waypoints) VALUES ('00000000-0000-0000-0000-000000000001',false,'x',1,'[]'); ROLLBACK TO c;
INSERT INTO principals (id,external_subject,display_name,authorized_org_id,role,issued_by) VALUES ('00000000-0000-0000-0000-0000000000a1','verify:subject','P','00000000-0000-0000-0000-00000000000a','coordinator','z');
SAVEPOINT d; INSERT INTO access_roles (disaster_event_id,principal_id,level) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','individual_pii'); ROLLBACK TO d;
SAVEPOINT d2; INSERT INTO access_roles (disaster_event_id,principal_id,level,granted_by,granted_org_id) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000ff','aggregate_only','z','00000000-0000-0000-0000-00000000000a'); ROLLBACK TO d2;
SAVEPOINT e; INSERT INTO devices (pubkey) VALUES ('\x00'); ROLLBACK TO e;
INSERT INTO escalations (disaster_event_id,kind,evidence_mesh_event_ids,summary,authorized_by,authorized_org_id) VALUES ('00000000-0000-0000-0000-000000000001','urgency_tier',ARRAY[gen_random_uuid()],'s','A. Human','00000000-0000-0000-0000-00000000000a');
ROLLBACK;
SQL
)
for c in 'not-null constraint' escalations_authorized_by_nonblank drone_routes_are_simulated 'access_roles_pii_needs_grant|individual_pii requires an active principal' access_roles_principal_id_fkey devices_pubkey_len; do
  echo "$out" | grep -qE "$c" && echo "OK  rejected: $c" || { echo "FAIL not rejected: $c"; exit 1; }
done
echo "$out" | grep -q "INSERT 0 1" && echo "OK  valid escalation accepted"
