const GEMINI_MODEL = "gemini-3.5-flash";

export interface AgentProfile {
  id: number;
  name: string;
  goal: string;
  location: string | null;
  keywords: string | null;
  negative_keywords: string | null;
}

export interface RawPostInput {
  post_id: number;
  platform: string;
  author_name: string;
  raw_text: string;
  post_url: string | null;
  author_profile_url: string | null;
}

export interface OpportunityEvaluation {
  post_id: number;
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

async function callGemini(systemInstruction: string, userText: string): Promise<string> {
  const apiKey = getApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userText }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API returned no content");
  }
  return text;
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
  "post_id": number (must match the input post_id),
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

/**
 * Generate a personalized outreach reply referencing the specific post content.
 */
export async function generateReply(
  agent: AgentProfile,
  post: { author_name: string; raw_text: string; platform: string },
  tone: "professional" | "casual" | "sales" | "educational" = "professional"
): Promise<string> {
  const systemInstruction = `
You write short, personalized outreach replies for "${agent.name}", whose goal is: ${agent.goal}.
Tone: ${tone}. Never generic — always reference specifics from the original post.
Keep it under 300 characters, friendly, and not salesy. Do not use markdown.
Respond with a JSON object: { "reply": string }
`;
  const userText = `Original post by ${post.author_name} on ${post.platform}:\n"""${post.raw_text}"""`;
  const text = await callGemini(systemInstruction, userText);

  try {
    const parsed = JSON.parse(text);
    return parsed.reply || "";
  } catch {
    return text;
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
