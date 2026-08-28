/**
 * Caller identity → access level (D-14, CHAT half; §1a Rule 2).
 *
 * LibreChat sets `X-DarkSpot-Subject: {{LIBRECHAT_USER_ID}}` server-side on every
 * MCP request (librechat.yaml headers). The tool server maps that opaque subject
 * to CORE's `principals.external_subject`, then to `access_roles.level` for the
 * disaster event in question. Only `individual_pii` on an active, unrevoked
 * principal of an unrevoked org unlocks restricted data; everything else — no
 * header, unknown subject, revoked, wrong event, DB unreachable — is
 * `aggregate_only`. Fail closed on every branch.
 *
 * Spoofing: the header is trustworthy only because LibreChat is the only thing
 * that should reach this server. TOOLS_SHARED_SECRET (X-DarkSpot-Tools-Token)
 * makes that explicit: when set, a request without the matching token is
 * treated as anonymous even if it carries a subject.
 */
import { timingSafeEqual } from "node:crypto";

export type AccessLevel = "aggregate_only" | "individual_pii";

export interface Viewer {
  subject: string | null; // LibreChat user id, or null when absent/untrusted
  trusted: boolean; // token check passed (or no token configured)
}

export interface Authorization {
  level: AccessLevel;
  authorized: boolean; // level === individual_pii
  principal_id: string | null;
  role: string | null;
  reason: string; // always human-readable; shown in tool output so gating is auditable
}

export type PgQuery = (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;

function first(h: string | string[] | undefined): string | undefined {
  return Array.isArray(h) ? h[0] : h;
}

/** Extract the viewer from request headers. */
export function viewerFromHeaders(headers: Record<string, string | string[] | undefined>, sharedSecret: string | undefined): Viewer {
  const token = first(headers["x-darkspot-tools-token"]) ?? "";
  let trusted = true;
  if (sharedSecret) {
    const a = Buffer.from(token), b = Buffer.from(sharedSecret);
    trusted = a.length === b.length && timingSafeEqual(a, b);
  }
  const subject = (first(headers["x-darkspot-subject"]) ?? "").trim();
  // LibreChat leaves the placeholder literal if it cannot resolve the user; never treat that as an identity.
  const valid = trusted && subject.length > 0 && !subject.includes("{{");
  return { subject: valid ? subject : null, trusted };
}

export const ANON: Authorization = { level: "aggregate_only", authorized: false, principal_id: null, role: null, reason: "no authenticated caller identity — aggregate_only" };

/**
 * Resolve the access level for a subject on an event. `query` is injected so
 * this is testable without Postgres; the server passes a pg client's query.
 */
export async function resolveAccess(viewer: Viewer, disasterEventId: string | null, query: PgQuery | null): Promise<Authorization> {
  if (!viewer.trusted) return { ...ANON, reason: "tools token missing/invalid — caller treated as anonymous, aggregate_only" };
  if (!viewer.subject) return ANON;
  if (!query) return { ...ANON, reason: `subject ${viewer.subject} present but DATABASE_URL unset — cannot check principals, aggregate_only` };
  if (!disasterEventId) return { ...ANON, reason: `subject ${viewer.subject} present but no disaster_event_id in scope — access_roles is per event, aggregate_only` };
  try {
    const r = await query(
      `SELECT p.id AS principal_id, p.role, a.level
         FROM principals p
         JOIN authorized_orgs o ON o.id = p.authorized_org_id
         LEFT JOIN access_roles a ON a.principal_id = p.id AND a.disaster_event_id = $2
              AND (a.expires_at IS NULL OR a.expires_at > now())
        WHERE p.external_subject = $1 AND p.revoked_at IS NULL AND o.revoked_at IS NULL
        LIMIT 1`,
      [viewer.subject, disasterEventId],
    );
    const row = r.rows[0];
    if (!row) return { ...ANON, reason: `subject ${viewer.subject} is not a registered, unrevoked principal — aggregate_only` };
    if (row.level === "individual_pii") {
      return { level: "individual_pii", authorized: true, principal_id: row.principal_id, role: row.role, reason: `principal ${row.principal_id} (${row.role}) holds individual_pii on this event` };
    }
    return { level: "aggregate_only", authorized: false, principal_id: row.principal_id, role: row.role, reason: `principal ${row.principal_id} (${row.role}) has no individual_pii grant on this event — aggregate_only` };
  } catch (e) {
    return { ...ANON, reason: `principals lookup failed (${(e as Error).message}) — aggregate_only` };
  }
}
