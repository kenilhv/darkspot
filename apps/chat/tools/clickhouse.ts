/** Minimal ClickHouse HTTP client (no SDK). Reads CLICKHOUSE_URL/USER/PASSWORD/DB. */
export interface ChConfig { url: string; user: string; password: string; db: string }

export function chConfigFromEnv(): ChConfig | null {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  return {
    url,
    user: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
    db: process.env.CLICKHOUSE_DB ?? "default",
  };
}

export async function chQuery<T = Record<string, unknown>>(cfg: ChConfig, sql: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const u = new URL(cfg.url);
  u.searchParams.set("database", cfg.db);
  u.searchParams.set("default_format", "JSONEachRow");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(`param_${k}`, String(v));
  const r = await fetch(u, {
    method: "POST",
    headers: { "X-ClickHouse-User": cfg.user, "X-ClickHouse-Key": cfg.password },
    body: sql,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ClickHouse ${r.status}: ${text.slice(0, 300)}`);
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
}

/** Returns the column names of a table/view, or null if it doesn't exist. */
export async function chColumns(cfg: ChConfig, table: string): Promise<string[] | null> {
  const rows = await chQuery<{ name: string }>(
    cfg,
    "SELECT name FROM system.columns WHERE database = {db:String} AND table = {t:String} ORDER BY position",
    { db: cfg.db, t: table },
  );
  return rows.length ? rows.map((r) => r.name) : null;
}
