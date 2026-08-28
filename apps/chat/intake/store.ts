/**
 * Where a filed report goes.
 *
 *   1. Always: appended to a local JSONL outbox (raw text intact) — the
 *      offline-first pattern; a bridge node with no backhaul still keeps the record.
 *   2. If ClickHouse `mesh_events` exists with the contract columns: inserted
 *      there too, and the outbox line is marked synced.
 *
 * Never: silently dropped, or reported as "stored in mesh_events" when it only
 * reached the outbox.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CONTRACT } from "../tools/contract.ts";
import { chColumns, chQuery, type ChConfig } from "../tools/clickhouse.ts";
import type { ExtractionResult } from "./extract.ts";

export interface FiledReport {
  id: string;
  disaster_event_id: string;
  device_pubkey: string;
  raw_text: string;
  received_at: string;
  settlement_geohash: string | null;
  extraction: ExtractionResult;
}

export interface StoreOutcome {
  outbox: string; // path
  mesh_events: "inserted" | "not-available";
  detail: string;
}

export function newReport(input: { disaster_event_id: string; device_pubkey: string; raw_text: string; settlement_geohash?: string | null }, extraction: ExtractionResult): FiledReport {
  return {
    id: randomUUID(),
    disaster_event_id: input.disaster_event_id,
    device_pubkey: input.device_pubkey,
    raw_text: input.raw_text,
    received_at: new Date().toISOString(),
    settlement_geohash: input.settlement_geohash ?? null,
    extraction,
  };
}

export async function storeReport(report: FiledReport, outboxPath: string, ch: ChConfig | null): Promise<StoreOutcome> {
  mkdirSync(dirname(outboxPath), { recursive: true });
  let meshStatus: StoreOutcome["mesh_events"] = "not-available";
  let detail: string;

  if (!ch) {
    detail = "CLICKHOUSE_URL not set; kept in local outbox only.";
  } else {
    try {
      const cols = await chColumns(ch, "mesh_events");
      const missing = cols ? CONTRACT.clickhouse.mesh_events.filter((c) => !cols.includes(c)) : null;
      if (!cols) detail = `mesh_events does not exist yet (CORE, §5); kept in local outbox only.`;
      else if (missing!.length) detail = `mesh_events lacks contract columns [${missing!.join(", ")}]; kept in local outbox only.`;
      else {
        await chQuery(
          ch,
          `INSERT INTO mesh_events (id, disaster_event_id, device_pubkey, raw_text, received_at, settlement_geohash)
           VALUES ({id:String}, {d:String}, {p:String}, {t:String}, parseDateTimeBestEffort({r:String}), {g:String})`,
          { id: report.id, d: report.disaster_event_id, p: report.device_pubkey, t: report.raw_text, r: report.received_at, g: report.settlement_geohash ?? "" },
        );
        meshStatus = "inserted";
        detail = `inserted into ${ch.db}.mesh_events id=${report.id} (raw text intact).`;
      }
    } catch (e) {
      detail = `ClickHouse error (${(e as Error).message}); kept in local outbox only.`;
    }
  }
  appendFileSync(outboxPath, JSON.stringify({ ...report, synced: meshStatus === "inserted" }) + "\n");
  return { outbox: outboxPath, mesh_events: meshStatus, detail };
}
