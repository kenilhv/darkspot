/**
 * Structured extraction for field reports (§2 "field-adjacent interface"),
 * aligned to CORE's mesh_events columns:
 *   extracted_status      'safe' | 'needs_help' | 'casualties' | 'unknown'   (else 'unextracted')
 *   extracted_people      Nullable(UInt32) — only if the reporter states a number
 *   extraction_model      which model produced it ('' when none)
 *   extraction_confidence Nullable(Float32)
 *
 * inference.net executes the extraction (OpenAI-compatible chat completions with
 * a strict JSON schema). When no key is configured the report is NOT dropped and
 * NOT guessed: status stays 'unextracted', raw text is the record. Extraction
 * never gates anything safety-critical (Rule 3 / D-4).
 *
 * 'casualties' and extracted_people are restricted downstream (tools/contract.ts):
 * stored, never echoed back to the reporter or an unauthorized viewer.
 */
import { RESTRICTED_COLUMNS, RESTRICTED_STATUS, RESTRICTED_STATUS_LABEL } from "../tools/contract.ts";
import { getTracer } from "../trace/honeyhive.ts";

export const STATUS_VALUES = ["safe", "needs_help", "casualties", "unknown"] as const;
export type ExtractedStatus = (typeof STATUS_VALUES)[number];

export interface ExtractedFields {
  extracted_status: ExtractedStatus;
  extracted_people: number | null;
  settlement_mentioned: string | null;
  language: string | null;
  confidence: number | null;
}

export type ExtractionStatus = "extracted" | "unverified-no-extraction" | "failed-closed";

export interface ExtractionResult {
  status: ExtractionStatus;
  model: string; // '' when none — matches mesh_events.extraction_model default
  fields: ExtractedFields | null;
  note: string;
}

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    extracted_status: {
      type: "string",
      enum: STATUS_VALUES,
      description: "safe = reporter says people are fine; needs_help = reporter asks for help or describes need; casualties = reporter explicitly states deaths or injuries; unknown = cannot tell from the text",
    },
    extracted_people: { type: ["integer", "null"], description: "Number of people the reporter explicitly states; null if no number is written. Never estimate." },
    settlement_mentioned: { type: ["string", "null"], description: "Settlement / ward / village named in the report, spelled as written; null if none" },
    language: { type: ["string", "null"], description: "ISO 639-1 code of the report language" },
    confidence: { type: ["number", "null"], description: "0-1 confidence that extracted_status is what the reporter meant" },
  },
  required: ["extracted_status", "extracted_people", "settlement_mentioned", "language", "confidence"],
} as const;

const EXTRACTION_PROMPT =
  "Classify a disaster field report. Copy values as written; do not infer, estimate, or normalize. " +
  "If the report does not state a number of people, extracted_people is null. If you cannot tell the status, use 'unknown'. Return JSON only.";

export interface ExtractOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export function extractOptionsFromEnv(): ExtractOptions {
  return {
    baseUrl: process.env.INFERENCE_BASE_URL ?? "https://api.inference.net/v1",
    apiKey: process.env.INFERENCE_API_KEY,
    model: process.env.INFERENCE_MODEL,
  };
}

function validate(x: any): ExtractedFields | null {
  if (!x || typeof x !== "object") return null;
  if (!STATUS_VALUES.includes(x.extracted_status)) return null;
  const people = x.extracted_people;
  if (!(people === null || (Number.isInteger(people) && people >= 0))) return null;
  return {
    extracted_status: x.extracted_status,
    extracted_people: people,
    settlement_mentioned: typeof x.settlement_mentioned === "string" ? x.settlement_mentioned : null,
    language: typeof x.language === "string" ? x.language : null,
    confidence: typeof x.confidence === "number" ? Math.max(0, Math.min(1, x.confidence)) : null,
  };
}

export async function extractReport(rawText: string, opts: ExtractOptions): Promise<ExtractionResult> {
  if (!opts.apiKey || !opts.model) {
    return { status: "unverified-no-extraction", model: "", fields: null, note: "No INFERENCE_API_KEY/INFERENCE_MODEL configured; stored as extracted_status='unextracted', nothing inferred." };
  }
  const model = `inference.net/${opts.model}`;
  const f0 = opts.fetchImpl ?? fetch;
  // model span on the extraction call (HoneyHive when keyed, local log otherwise); never alters the result
  const f = (await getTracer()).wrap("model", "extract_field_report", f0, { model, chars: rawText.length });
  try {
    const r = await f(`${opts.baseUrl!.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "field_report", strict: true, schema: EXTRACTION_SCHEMA } },
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: rawText },
        ],
      }),
    });
    if (!r.ok) return { status: "failed-closed", model, fields: null, note: `upstream ${r.status}; stored as 'unextracted'.` };
    const j: any = await r.json();
    const content = j.choices?.[0]?.message?.content;
    const fields = validate(JSON.parse(typeof content === "string" ? content : JSON.stringify(content)));
    if (!fields) return { status: "failed-closed", model, fields: null, note: "model output did not match the schema; stored as 'unextracted'." };
    return { status: "extracted", model, fields, note: "Extracted by model; field-level accuracy unverified against a golden set until the HoneyHive eval exists." };
  } catch (e) {
    return { status: "failed-closed", model, fields: null, note: `extraction error (${(e as Error).message}); stored as 'unextracted'.` };
  }
}

/** What may be echoed back to the reporter / an unauthorized viewer. */
export function publicFields(fields: ExtractedFields | null): Record<string, unknown> | null {
  if (!fields) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if ((RESTRICTED_COLUMNS as readonly string[]).includes(k)) continue;
    out[k] = k === "extracted_status" && v === RESTRICTED_STATUS ? RESTRICTED_STATUS_LABEL : v;
  }
  return out;
}
