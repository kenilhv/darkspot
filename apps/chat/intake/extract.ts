/**
 * Structured extraction for field reports (§2 "field-adjacent interface").
 *
 * inference.net executes the extraction (OpenAI-compatible chat completions with
 * a JSON schema). When no key is configured the report is NOT dropped and NOT
 * guessed: extraction status is "unverified-no-extraction" and only the raw
 * text is kept. Extraction never gates anything safety-critical (Rule 3 / D-4):
 * the raw text is the record; extracted fields are a convenience layer.
 *
 * Restricted fields (casualty_count, exact_location, urgency_tier) may be
 * extracted for storage, but they are never echoed back to the reporter or to
 * an unauthorized viewer — see tools/contract.ts RESTRICTED_FIELDS.
 */
import { RESTRICTED_FIELDS } from "../tools/contract.ts";

export interface ExtractedFields {
  settlement?: string | null;
  hazard?: string | null;
  needs?: string[] | null;
  access_status?: string | null; // e.g. "road blocked", "bridge collapsed"
  people_mentioned?: number | null; // count of people referenced, NOT casualties
  casualty_count?: number | null; // restricted
  exact_location?: string | null; // restricted
  urgency_tier?: string | null; // restricted
  language?: string | null;
}

export type ExtractionStatus = "extracted" | "unverified-no-extraction" | "failed-closed";

export interface ExtractionResult {
  status: ExtractionStatus;
  provider: string | null;
  fields: ExtractedFields | null;
  note: string;
}

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    settlement: { type: ["string", "null"], description: "Settlement / ward / village named in the report, verbatim spelling" },
    hazard: { type: ["string", "null"], description: "Hazard described (flood, landslide, fire, collapse...)" },
    needs: { type: ["array", "null"], items: { type: "string" }, description: "Needs stated by the reporter (water, medical, boats...)" },
    access_status: { type: ["string", "null"], description: "Road/bridge/access condition if stated" },
    people_mentioned: { type: ["integer", "null"], description: "Number of people referenced, if stated; not a casualty count" },
    casualty_count: { type: ["integer", "null"], description: "Only if explicitly stated by the reporter; else null" },
    exact_location: { type: ["string", "null"], description: "Coordinates or precise landmark only if explicitly stated; else null" },
    urgency_tier: { type: ["string", "null"], description: "Only if the reporter states an urgency; else null. Never inferred." },
    language: { type: ["string", "null"], description: "ISO 639-1 code of the report language" },
  },
  required: ["settlement", "hazard", "needs", "access_status", "people_mentioned", "casualty_count", "exact_location", "urgency_tier", "language"],
} as const;

const EXTRACTION_PROMPT =
  "Extract fields from a disaster field report. Copy values as written; do not infer, estimate, or normalize. " +
  "If the report does not state a field, return null for it. Never guess casualty counts, locations, or urgency. Return JSON only.";

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

export async function extractReport(rawText: string, opts: ExtractOptions): Promise<ExtractionResult> {
  if (!opts.apiKey || !opts.model) {
    return {
      status: "unverified-no-extraction",
      provider: null,
      fields: null,
      note: "No INFERENCE_API_KEY/INFERENCE_MODEL configured; raw text kept, no fields extracted, nothing inferred.",
    };
  }
  const f = opts.fetchImpl ?? fetch;
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
    if (!r.ok) return { status: "failed-closed", provider: `inference.net/${opts.model}`, fields: null, note: `upstream ${r.status}; raw text kept, no fields.` };
    const j: any = await r.json();
    const content = j.choices?.[0]?.message?.content;
    const parsed = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
    return { status: "extracted", provider: `inference.net/${opts.model}`, fields: parsed, note: "Extracted by model; unverified against a golden set until HoneyHive eval exists." };
  } catch (e) {
    return { status: "failed-closed", provider: `inference.net/${opts.model}`, fields: null, note: `extraction error (${(e as Error).message}); raw text kept, no fields.` };
  }
}

/** Fields safe to echo back to the reporter / an unauthorized viewer. */
export function publicFields(fields: ExtractedFields | null): Partial<ExtractedFields> | null {
  if (!fields) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (!(RESTRICTED_FIELDS as readonly string[]).includes(k)) out[k] = v;
  return out as Partial<ExtractedFields>;
}
