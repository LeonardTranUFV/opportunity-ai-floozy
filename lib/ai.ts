// gemini-3.5-flash's free-tier quota for this project is a separate,
// much smaller daily bucket (20 req/day, confirmed via the API's own
// quotaId "GenerateRequestsPerDayPerProjectPerModel-FreeTier") than
// standard Flash models get — exhausted almost immediately under real
// use. Each model has its own independent quota bucket, so gemini-3.6-flash
// (confirmed working, clean JSON output) has real headroom. Still a
// free-tier cap either way — enabling billing on the Cloud project is the
// actual long-term fix, this just unblocks things until then.
const GEMINI_MODEL = "gemini-3.6-flash";

export interface AgentProfile {
  id: string;
  name: string;
  goal: string;
  location: string | null;
  keywords: string | null;
  negative_keywords: string | null;
}

export interface RawPostInput {
  post_id: string;
  platform: string;
  author_name: string;
  raw_text: string;
  post_url: string | null;
  author_profile_url: string | null;
}

export interface OpportunityEvaluation {
  post_id: string;
  relevant: boolean;
  intent_score: number;
  urgency: "low" | "medium" | "high" | "asap";
  estimated_value: string;
  ai_summary: string;
  category: string;
  location_mentioned: string | null;
  phone_number: string | null;
}

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set in .env — add it from https://aistudio.google.com/apikey"
    );
  }
  return apiKey;
}

const RETRYABLE_STATUS_CODES = new Set([503, 500]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Every caller sets responseMimeType: "application/json" and immediately
// JSON.parses the result, so a response that fails to parse is just as
// useless as an HTTP-level failure. Observed empirically: this model
// sometimes reports finishReason "STOP" while still cutting the JSON off
// mid-string (no closing brace) — roughly 1 in 2 calls in one test batch —
// unrelated to hitting maxOutputTokens. Previously every caller had its own
// try/catch around JSON.parse with a silent fallback (e.g. dumping the raw
// broken text into both the "comment" and "dm" fields), which meant a
// customer could see garbled JSON presented as a real, sendable draft and
// actually post it publicly. Retrying here — once, centrally — turns that
// silent corruption into either a clean parse or a clear thrown error.
function isParseableJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

async function callGemini(systemInstruction: string, userText: string): Promise<string> {
  const apiKey = getApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userText }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        // maxOutputTokens set explicitly — some clients silently default well
        // below the model's real 65,536-token cap when this is omitted, which
        // would truncate the JSON array on large batches (see scan/route.ts).
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 65536 },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = new Error("Gemini API returned no content");
      } else if (!isParseableJson(text)) {
        lastError = new Error(`Gemini API returned malformed JSON: ${text.slice(0, 200)}`);
      } else {
        return text;
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      throw lastError;
    }

    const errText = await response.text();
    lastError = new Error(`Gemini API error (${response.status}): ${errText}`);

    // Only retry on transient overload — not on quota exhaustion (429) or bad requests.
    const shouldRetry = RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_ATTEMPTS;
    if (!shouldRetry) {
      throw lastError;
    }
    await sleep(RETRY_DELAY_MS * attempt);
  }

  throw lastError ?? new Error("Gemini API request failed");
}

/**
 * Evaluate a batch of raw posts against one agent's goal/keywords using AI reasoning
 * (not keyword matching) — mirrors the PRD's "AI Understanding" requirement.
 */
export async function evaluatePostsForAgent(
  agent: AgentProfile,
  posts: RawPostInput[]
): Promise<OpportunityEvaluation[]> {
  if (posts.length === 0) return [];

  const systemInstruction = `
You are an AI Opportunity Intelligence analyst. You read raw social posts and decide whether
they represent a real opportunity for a specific agent, based on understanding context, intent,
sentiment, and urgency — never just keyword matching.

### Agent Profile
Name: ${agent.name}
Goal: ${agent.goal}
Location focus: ${agent.location || "Any"}
Priority keywords (signals of relevance, not required exact matches): ${agent.keywords || "(none specified)"}
Negative keywords — if a post is clearly about one of these, mark it not relevant: ${agent.negative_keywords || "(none)"}

### Reasoning examples
"My roof is leaking after the storm" -> high intent, urgent.
"I painted my house last year" -> not relevant, past/completed.
"Anyone recommend a flooring company?" -> high intent.
"Selling my old couch" -> only relevant if the agent's goal is about buying used furniture.

### Output
Respond with a JSON array with exactly one object per input post, in the same order, matching
this schema exactly:
{
  "post_id": string (must match the input post_id exactly),
  "relevant": boolean,
  "intent_score": number (0-100, how strongly this matches the agent's goal),
  "urgency": "low" | "medium" | "high" | "asap",
  "estimated_value": string (short human-readable estimate like "$2,000-5,000", or "Unknown"),
  "ai_summary": string (one sentence, written for a busy business owner deciding whether to act),
  "category": string (short category label, e.g. "roofing", "flooring", "used car"),
  "location_mentioned": string or null (city/neighborhood extracted from the post text, or null),
  "phone_number": string or null (ONLY if a phone number is explicitly written in the post text, else null — never invent one)
}
Always include every post_id from the input, even if relevant is false.
`;

  const userText = `Evaluate these posts:\n\n${JSON.stringify(posts, null, 2)}`;
  const text = await callGemini(systemInstruction, userText);

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`Gemini returned unparseable JSON: ${text.slice(0, 200)}`);
  }
}

export interface AgentEnhancement {
  goal: string;
  keywords: string;
  negative_keywords: string;
  location: string | null;
  suggested_name: string;
}

/**
 * Turns a plain-language description ("I'm a roofer in Vancouver looking for
 * people who need roof repairs") into the structured fields the scoring
 * pipeline actually needs — most people can describe their business in a
 * sentence but can't reliably brainstorm a full keyword list themselves.
 */
export async function enhanceAgentProfile(
  description: string,
  businessProfile: BusinessProfile = {}
): Promise<AgentEnhancement> {
  const profileLines = [
    businessProfile.businessName ? `Business name: ${businessProfile.businessName}` : null,
    businessProfile.pitch ? `Pitch / specialty: ${businessProfile.pitch}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemInstruction = `
You help small business owners set up an AI lead-monitoring agent. They describe their business and
what they're looking for in plain, casual language — often just a sentence or two, sometimes with typos
or filler words. Turn that into a precise, structured profile for the scoring AI to use.

${profileLines ? `### Also known about this business\n${profileLines}\n` : ""}

### Output
Respond with a JSON object matching this schema exactly:
{
  "goal": string (a clear 1-2 sentence restatement of what kind of opportunity this agent should find, written for another AI to use as scoring instructions — specific, not generic),
  "keywords": string (8-15 comma-separated keywords/phrases a real person would actually post, covering synonyms, misspellings, and related pain points — e.g. for a roofer: "roof leak, need roofer, roof repair, shingles falling, water damage ceiling, storm damage roof, roof replacement, roofing quote, roof estimate"),
  "negative_keywords": string (3-6 comma-separated terms that would cause false positives to exclude — e.g. for a roofer: "hiring roofer, roofing job, DIY roof, roofing course"),
  "location": string or null (comma-separated city names explicitly mentioned or clearly implied in the description, or null if none mentioned),
  "suggested_name": string (a short 2-4 word name for this agent, e.g. "Roofing Scout")
}
`;
  const userText = `Business owner's description:\n"""${description}"""`;
  const text = await callGemini(systemInstruction, userText);

  try {
    const parsed = JSON.parse(text);
    return {
      goal: parsed.goal || description,
      keywords: parsed.keywords || "",
      negative_keywords: parsed.negative_keywords || "",
      location: parsed.location || null,
      suggested_name: parsed.suggested_name || "",
    };
  } catch {
    throw new Error("AI couldn't process that description — try rephrasing it.");
  }
}

export interface BusinessProfile {
  ownerName?: string;
  businessName?: string;
  phone?: string;
  pitch?: string;
}

export interface OutreachDrafts {
  comment: string;
  dm: string;
}

/**
 * Generate two personalized outreach drafts for the same lead — a short
 * public comment and a more personal DM — since they serve different jobs:
 * the comment is a low-key public acknowledgment that points to the DM,
 * while the DM asks about their specific problem and can carry more detail.
 */
export async function generateOutreachDrafts(
  agent: AgentProfile,
  post: { author_name: string; raw_text: string; platform: string },
  businessProfile: BusinessProfile = {},
  previousDraft?: OutreachDrafts
): Promise<OutreachDrafts> {
  const profileLines = [
    businessProfile.ownerName ? `Your name: ${businessProfile.ownerName}` : null,
    businessProfile.businessName ? `Your business: ${businessProfile.businessName}` : null,
    businessProfile.phone ? `Your phone number: ${businessProfile.phone}` : null,
    businessProfile.pitch ? `Your pitch / what makes you stand out: ${businessProfile.pitch}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemInstruction = `
You write short, personalized outreach messages for "${agent.name}", whose goal is: ${agent.goal}.
${profileLines ? `\n### Who you are\n${profileLines}\n` : "\n(No business profile was provided — write in a friendly, personal voice without inventing a name, company, or phone number.)\n"}
Never generic — always reference specifics from the original post. Sign with your real name when you have one.

You are writing TWO different messages for the same lead:
1. "comment" — a short, public reply posted directly under their post. Keep it brief and low-key:
   acknowledge you can help, then point them to check their DM or ask for their phone number. Do not
   go into detail publicly.
2. "dm" — a private, more personal direct message. Reference the specific problem they mentioned,
   ask a clarifying follow-up question about it, and if you have pitch/experience info, weave it in
   naturally rather than reading like a sales pitch. This can be warmer and more detailed than the
   comment.

Keep each under 300 characters, friendly, never salesy or generic, no markdown, no hashtags.
${
  previousDraft
    ? `\n### Try a different approach this time\nThe person asking already saw this earlier draft and wants a genuinely different take, not a reworded copy — vary the angle (e.g. lead with a question instead of an offer, or a different hook/tone), not just the wording:\nPrevious comment: "${previousDraft.comment}"\nPrevious dm: "${previousDraft.dm}"\n`
    : ""
}
Respond with a JSON object: { "comment": string, "dm": string }
`;
  const userText = `Original post by ${post.author_name} on ${post.platform}:\n"""${post.raw_text}"""`;
  const text = await callGemini(systemInstruction, userText);

  try {
    const parsed = JSON.parse(text);
    return { comment: parsed.comment || "", dm: parsed.dm || "" };
  } catch {
    return { comment: text, dm: text };
  }
}

export interface WebsiteCheck {
  label: string;
  pass: boolean;
  detail: string;
}

/**
 * Turn a rule-based website audit into a short, readable improvement report.
 */
export async function generateWebsiteReport(url: string, checks: WebsiteCheck[]): Promise<string> {
  const systemInstruction = `
You are a website improvement consultant writing a short report for a small business owner who
is not technical. Given a list of automated checks, write 2-4 sentences summarizing what's good,
what's missing, and the single highest-impact fix to prioritize first. Plain language, no jargon,
no markdown formatting. Respond with a JSON object: { "report": string }
`;
  const userText = `Website: ${url}\n\nChecks:\n${JSON.stringify(checks, null, 2)}`;
  const text = await callGemini(systemInstruction, userText);

  try {
    const parsed = JSON.parse(text);
    return parsed.report || "";
  } catch {
    return text;
  }
}
