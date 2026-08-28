/**
 * Where a filed report goes.
 *
 *   1. Always: appended to a local JSONL outbox (raw text intact) — the
 *      offline-first pattern; a bridge node with no backhaul still keeps the record.
 *   2. If ClickHouse `mesh_events` exists with CORE's columns AND this server has a
 *      bridge identity (BRIDGE_PUBKEY_HEX, 32 bytes hex — CORE's schema requires it):
 *      inserted there too, and the outbox line is marked synced.
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
  device_pubkey_hex: string; // 64 hex chars = 32-byte Noise static key
  raw_text: string;
  received_at: string;
  settlement_pcode: string; // '' when unknown — CORE's views key on pcode, so an unknown pcode won't rank
  settlement_geohash: string;
  extraction: ExtractionResult;
}

export interface StoreOutcome {
  outbox: string;
  mesh_events: "inserted" | "not-available";
  detail: string;
}

const HEX32 = /^[0-9a-fA-F]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newReport(
  input: { disaster_event_id: string; device_pubkey_hex: string; raw_text: string; settlement_pcode?: string | null; settlement_geohash?: string | null },
  extraction: ExtractionResult,
): FiledReport {
  return {
    id: randomUUID(),
    disaster_event_id: input.disaster_event_id,
    device_pubkey_hex: input.device_pubkey_hex,
    raw_text: input.raw_text,
    received_at: new Date().toISOString(),
    settlement_pcode: input.settlement_pcode ?? "",
    settlement_geohash: input.settlement_geohash ?? "",
    extraction,
  };
}

export async function storeReport(report: FiledReport, outboxPath: string, ch: ChConfig | null, bridgePubkeyHex: string | undefined): Promise<StoreOutcome> {
  mkdirSync(dirname(outboxPath), { recursive: true });
  let meshStatus: StoreOutcome["mesh_events"] = "not-available";
  let detail: string;

  if (!ch) detail = "CLICKHOUSE_URL not set; kept in local outbox only.";
  else if (!bridgePubkeyHex || !HEX32.test(bridgePubkeyHex)) detail = "BRIDGE_PUBKEY_HEX (this node's 32-byte identity, required by mesh_events.bridge_pubkey) not configured; kept in local outbox only.";
  else if (!HEX32.test(report.device_pubkey_hex)) detail = "device_pubkey must be 64 hex chars (32-byte Noise key) for mesh_events; kept in local outbox only.";
  else if (!UUID.test(report.disaster_event_id)) detail = "disaster_event_id must be a UUID (disaster_events.id); kept in local outbox only.";
  else {
    try {
      const cols = await chColumns(ch, "mesh_events");
      const missing = cols ? CONTRACT.clickhouse.mesh_events.filter((c) => !cols.includes(c)) : null;
      if (!cols) detail = "mesh_events does not exist yet (CORE, §5); kept in local outbox only.";
      else if (missing!.length) detail = `mesh_events lacks contract columns [${missing!.join(", ")}]; kept in local outbox only.`;
      else {
        const f = report.extraction.fields;
        await chQuery(
          ch,
          `INSERT INTO mesh_events (id, disaster_event_id, device_pubkey, bridge_pubkey, hop_count, reported_at, received_at, settlement_pcode, settlement_geohash, raw_text, extracted_status, extracted_people, extraction_model, extraction_confidence)
           VALUES (toUUID({id:String}), toUUID({d:String}), unhex({p:String}), unhex({b:String}), 0, parseDateTime64BestEffort({r:String}, 3, 'UTC'), parseDateTime64BestEffort({r:String}, 3, 'UTC'), {pc:String}, {g:String}, {t:String}, {st:String}, {pp:Nullable(UInt32)}, {m:String}, {c:Nullable(Float32)})`,
          {
            id: report.id,
            d: report.disaster_event_id,
            p: report.device_pubkey_hex,
            b: bridgePubkeyHex,
            r: report.received_at,
            pc: report.settlement_pcode,
            g: report.settlement_geohash,
            t: report.raw_text,
            st: f?.extracted_status ?? "unextracted",
            pp: f?.extracted_people == null ? "\\N" : String(f.extracted_people),
            m: report.extraction.model,
            c: f?.confidence == null ? "\\N" : String(f.confidence),
          },
        );
        meshStatus = "inserted";
        detail = `inserted into ${ch.db}.mesh_events id=${report.id} (raw text intact, extracted_status='${f?.extracted_status ?? "unextracted"}').`;
      }
    } catch (e) {
      detail = `ClickHouse error (${(e as Error).message}); kept in local outbox only.`;
    }
  }
  appendFileSync(outboxPath, JSON.stringify({ ...report, synced: meshStatus === "inserted" }) + "\n");
  return { outbox: outboxPath, mesh_events: meshStatus, detail };
}
