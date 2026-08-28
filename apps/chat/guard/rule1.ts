/**
 * Rule 1 guard — DarkSpot COORDINATION.md §1a:
 *   "DarkSpot has no 'dispatch' action. It can only ever say 'here's the
 *    evidence' — never 'go here.'"
 *
 * This is a deterministic, zero-LLM post-filter (Rule 3: safety-critical
 * checks must not depend on a model provider). It scans assistant text for
 * imperative / directive sentences about moving people or resources and
 * returns every violation with the offending sentence so the caller can
 * refuse to emit the answer (fail closed) and log it.
 *
 * What it deliberately does NOT flag:
 *   - Raw report text quoted back to the user. Raw reports legitimately
 *     contain imperatives ("send help"). Quoted material must be rendered as
 *     markdown blockquote lines (`> ...`) or inside code fences; those lines
 *     are excluded from the scan. Tool responses are built that way.
 *   - Descriptive negations ("DarkSpot cannot tell you where to send teams").
 *
 * Limits (honest): this is a lexical detector, not a parser. It is one layer
 * — the system prompt is the other. The eval in rule1.eval.ts measures how
 * well the two together hold up against adversarial prompts; see the eval
 * report for what is and isn't verified against a live model.
 */

// Verbs that, in an imperative or modal-directive frame, constitute telling
// someone where to send people/resources.
const DISPATCH_VERBS = [
  "send", "dispatch", "deploy", "go", "head", "move", "proceed", "travel",
  "drive", "fly", "walk", "route", "reroute", "redirect", "divert",
  "allocate", "assign", "reassign", "mobilize", "mobilise", "relocate",
  "evacuate", "bring", "take", "rush", "prioritize", "prioritise", "focus",
  "direct", "position", "station", "concentrate", "commit", "target",
  "launch", "stage",
];

const VERB_ALT = DISPATCH_VERBS.join("|");
// Gerund forms for "recommend sending" style
const GERUND_ALT = DISPATCH_VERBS.map((v) =>
  v.endsWith("e") && v !== "free" ? v.slice(0, -1) + "ing" : v + "ing",
)
  .concat(["going", "heading", "moving", "flying"])
  .join("|");

// Optional leading softeners / adverbs before the verb
const PRE = String.raw`(?:(?:please|immediately|now|urgently|quickly|first|then|also|just|definitely|absolutely|all|everyone|somebody|someone)\s+)*`;

// D-20 placement vocabulary (past participles that place people/resources; resource nouns)
const PLACE_PP = "(?:positioned|deployed|sent|stationed|routed|used|placed|allocated|assigned|dispatched|concentrated|committed|prioriti[sz]ed|redirected|moved)";
const RES = "(?:teams?|crews?|units?|boats?|drones?|resources?|supplies|volunteers?|responders?|rescuers?|vehicles?|helicopters?|medics?|people)";

const PATTERNS: { name: string; re: RegExp }[] = [
  {
    // Bare sentence-initial imperative: "Send two teams to Chitwan."
    name: "bare-imperative",
    re: new RegExp(String.raw`^${PRE}(?:${VERB_ALT})\b`, "i"),
  },
  {
    // Imperative after an introductory clause: "Given that, send a team there."
    // "As you asked: dispatch unit B." — verb must be followed by an object word.
    name: "clause-imperative",
    re: new RegExp(String.raw`[,:;—-]\s+${PRE}(?:${VERB_ALT})\s+(?:the|a|an|your|our|all|every|each|some|two|three|\d+|unit|team|crew|everyone|anyone|someone|there|here|to|up|down|over|through)\b`, "i"),
  },
  {
    // Negative imperative is still an order about where to send people:
    // "Do not send anyone to the north bank."
    name: "negative-imperative",
    re: new RegExp(String.raw`^${PRE}(?:do\s+not|don't|never)\s+${PRE}(?:${VERB_ALT})\b`, "i"),
  },
  {
    // Modal directive: "You should send…", "Teams must go…", "we need to deploy…"
    name: "modal-directive",
    re: new RegExp(
      String.raw`\b(?:should|must|shall|ought\s+to|need(?:s)?\s+to|have\s+to|has\s+to|got\s+to|gotta|had\s+better)\s+${PRE}(?:be\s+)?(?:${VERB_ALT}|${GERUND_ALT})\b`,
      "i",
    ),
  },
  {
    // Recommendation framing: "I recommend sending…", "I'd advise you to deploy…"
    name: "recommendation",
    re: new RegExp(
      String.raw`\b(?:recommend|suggest|advise|urge|propose)(?:ed|s|ing)?\s+(?:that\s+)?(?:you\s+|they\s+|teams?\s+|we\s+)?(?:to\s+)?(?:${VERB_ALT}|${GERUND_ALT})\b`,
      "i",
    ),
  },
  {
    // Hortative: "Let's send…", "Let us move…"
    name: "hortative",
    re: new RegExp(String.raw`\blet(?:'s|\s+us)\s+${PRE}(?:${VERB_ALT})\b`, "i"),
  },
  {
    // "The best/right move is to send…", "Priority is to deploy…", "Next step: go to…"
    name: "prescriptive-copula",
    re: new RegExp(
      String.raw`\b(?:best|right|correct|top|first|next|only|immediate)\s+(?:move|step|action|priority|call|thing)\b[^.!?\n]*?\b(?:is|would\s+be|:)\s*(?:to\s+)?${PRE}(?:${VERB_ALT})\b`,
      "i",
    ),
  },
  // ---- D-20: placement-by-description (paraphrase / passive voice). Each form below names
  // WHERE people or resources belong without an imperative verb. Only unambiguous forms are
  // included; ordered bare lists ("Ward 4 first, then Mugling") stay on the documented miss list
  // in rule1.test.ts because the same words legitimately describe an evidence ranking.
  {
    // "a team would be best positioned at X", "boats ought to be routed via Y", "teams are to be deployed to Z".
    // Past tense (was/were) is deliberately excluded: "the team was positioned at the school" is a report of fact.
    name: "placement-passive",
    re: new RegExp(
      String.raw`\b(?:be|are|is|get|gets)\s+(?:to\s+be\s+)?(?:best\s+|better\s+|first\s+|next\s+|immediately\s+)?${PLACE_PP}\s+(?:at|to|in|via|through|near|toward|towards|on|along|around)\b`,
      "i",
    ),
  },
  {
    // "the first team needs to be at X", "X is where the team belongs", "boats belong at the sandbar"
    name: "placement-belongs",
    re: new RegExp(
      String.raw`\b(?:needs?\s+to\s+be|has\s+to\s+be|have\s+to\s+be|must\s+be|should\s+be|ought\s+to\s+be|belongs?)\s+(?:at|in|near|on|over|up|down)\b|\bis\s+where\s+(?:the\s+|a\s+|our\s+)?(?:first\s+|next\s+|second\s+)?${RES}\s+(?:belongs?|goes|should\s+be|needs?\s+to\s+be)\b`,
      "i",
    ),
  },
  {
    // "resources are needed at X first", "boats are required in Y now"
    name: "placement-needed-first",
    re: new RegExp(String.raw`\b(?:are|is)\s+(?:urgently\s+|most\s+)?(?:needed|required|wanted)\s+(?:at|in|near|on)\b[^.!?\n]*\b(?:first|now|next|immediately|before)\b`, "i"),
  },
  {
    // "X should be next", "Y should go first", "Z is next for the boats"
    name: "placement-ordinal",
    re: new RegExp(String.raw`\b(?:should|must|ought\s+to)\s+(?:be|go|come)\s+(?:next|first|second|third)\b|\bis\s+(?:next|first)\s+(?:for|in\s+line\s+for)\s+(?:the\s+)?${RES}\b`, "i"),
  },
  {
    // "X is the priority for the next deployment", "the obvious place for the boats is Y", "the second team is best used at Z"
    name: "placement-copula",
    re: new RegExp(
      String.raw`\bpriority\s+for\s+(?:the\s+)?(?:next\s+|first\s+)?(?:deployment|dispatch|team|crew|unit|boats?|drones?|response)\b|\b(?:place|spot|location|destination|target)\s+for\s+(?:the\s+|our\s+)?${RES}\s+(?:is|would\s+be|should\s+be)\b|\bbest\s+used\s+(?:at|in|on|near)\b`,
      "i",
    ),
  },
  {
    // "if I were you, Ward 4 would get the first team"
    name: "placement-gets",
    re: new RegExp(String.raw`\b(?:would|will|should)\s+get\s+(?:the\s+|a\s+|an\s+)?(?:first\s+|next\s+|second\s+)?${RES}\b`, "i"),
  },
  {
    // "it would make sense for the crew to head to X", "consider Ward 4 for the first team"
    name: "placement-suggestion",
    re: new RegExp(
      String.raw`\bfor\s+(?:the\s+|a\s+|our\s+)?${RES}\s+to\s+(?:head|go|move|proceed|travel|drive|fly|walk|be\s+sent|be\s+deployed)\s+(?:to|toward|towards|for|up|down|there)\b|^(?:please\s+)?consider\s+[^.!?\n]*\bfor\s+(?:the\s+|a\s+)?(?:first\s+|next\s+|second\s+)?${RES}\b`,
      "i",
    ),
  },
  {
    // Time-pressure directive: "It's time to send…", "Time to move…"
    name: "time-to",
    re: new RegExp(String.raw`\btime\s+to\s+${PRE}(?:${VERB_ALT})\b`, "i"),
  },
];

// Descriptive frames that mention dispatch verbs without ordering anything.
// If a sentence matches one of these AND a pattern, it is still flagged only
// if the match is not explained by the exemption. Kept narrow on purpose.
const EXEMPT: RegExp[] = [
  // "cannot/does not/will not tell you where to send" — a refusal, not an order
  /\b(?:can(?:'t|not)|does\s+not|doesn't|will\s+not|won't|is\s+not\s+able\s+to|never)\s+(?:tell|say|decide|instruct|direct|advise|recommend|order|determine)\b/i,
  // "no dispatch action", "has no 'go here'"
  /\bno\s+["'“]?(?:dispatch|go\s+here)\b/i,
  // reported speech about a *human* decision already made:
  // "The coordinator decided to send…", "authorized by X to deploy…"
  /\b(?:decided|authori[sz]ed|signed\s+off|ordered)\s+(?:by\s+[^.]+?\s+)?to\s+(?:send|deploy|dispatch|move|go)\b/i,
];

export interface Violation {
  sentence: string;
  pattern: string;
  index: number; // sentence index within the scanned (non-quoted) text
}

export interface GuardResult {
  ok: boolean;
  violations: Violation[];
  scannedSentences: number;
}

/** Strip blockquote lines and fenced code (where raw report text lives). */
export function stripQuoted(text: string): string {
  const noFences = text.replace(/```[\s\S]*?```/g, " ");
  return noFences
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

/** Naive sentence split — good enough for assistant prose; bullets count as sentences. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter((s) => s.length > 0);
}

export function checkRule1(text: string): GuardResult {
  const sentences = splitSentences(stripQuoted(text));
  const violations: Violation[] = [];
  sentences.forEach((sentence, index) => {
    if (EXEMPT.some((re) => re.test(sentence))) return;
    for (const { name, re } of PATTERNS) {
      if (re.test(sentence)) {
        violations.push({ sentence, pattern: name, index });
        break;
      }
    }
  });
  return { ok: violations.length === 0, violations, scannedSentences: sentences.length };
}

/**
 * Fail-closed wrapper: returns the text if clean, otherwise a fixed refusal
 * that names the rule. Never returns partially-scrubbed text — a scrubbed
 * answer could still carry the intent with the verb removed.
 */
export function enforceRule1(text: string): { text: string; blocked: boolean; result: GuardResult } {
  const result = checkRule1(text);
  if (result.ok) return { text, blocked: false, result };
  return {
    blocked: true,
    result,
    text:
      "This answer was withheld by DarkSpot's Rule 1 guard: it contained a directive about where to send people or resources. " +
      "DarkSpot only presents cited, confidence-tiered evidence; movement decisions are made by the authorized incident-command org. " +
      `(${result.violations.length} flagged sentence${result.violations.length === 1 ? "" : "s"}; see server log.)`,
  };
}
