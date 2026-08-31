/**
 * AI Gateway helper (server-only).
 *
 * Provider priority (first key found in env wins):
 *  1. LOVABLE_API_KEY  → Lovable AI Gateway  (google/gemini-3.7-flash)
 *  2. OPENAI_API_KEY   → OpenAI API          (gpt-4o-mini)
 *  3. GEMINI_API_KEY   → Google Generative AI REST (gemini-1.5-flash)
 *
 * Set the relevant env var in your .env / hosting dashboard and the
 * app will automatically pick it up without any code changes.
 */

// ─── Provider configs ────────────────────────────────────────────────────────

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL   = "google/gemini-3.7-flash";

const OPENAI_GATEWAY  = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL    = "gpt-4o-mini";

// Google Generative Language REST (no SDK dependency)
const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const GEMINI_MODEL = "gemini-1.5-flash";

// ─── Internal fetch helpers ───────────────────────────────────────────────────

async function callOpenAICompat(
  endpoint: string,
  authHeader: string,
  model: string,
  system: string,
  user: string,
  json: boolean,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("AI provider is rate-limited — try again in a few seconds.");
    if (res.status === 402) throw new Error("AI credits exhausted. Top up your account to continue.");
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data?.choices?.[0]?.message?.content ?? "";
}

async function callLovable(system: string, user: string, json: boolean): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"]!;
  const res = await fetch(LOVABLE_GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: LOVABLE_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user },
      ],
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("AI is rate-limited right now — try again in a few seconds.");
    if (res.status === 402) throw new Error("AI credits are exhausted for this workspace. Add credits in Lovable to continue.");
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data?.choices?.[0]?.message?.content ?? "";
}

async function callGeminiNative(system: string, user: string): Promise<string> {
  const key = process.env["GEMINI_API_KEY"]!;
  const res = await fetch(`${geminiUrl(GEMINI_MODEL)}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Gemini API rate-limited — try again in a few seconds.");
    throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a chat completion request.
 * Automatically selects the available provider based on env vars.
 */
export async function askAI(
  system: string,
  user: string,
  opts: { json?: boolean } = {},
): Promise<string> {
  const json = opts.json ?? false;

  // 1. Lovable gateway
  if (process.env["LOVABLE_API_KEY"]) {
    return callLovable(system, user, json);
  }

  // 2. OpenAI-compatible
  if (process.env["OPENAI_API_KEY"]) {
    return callOpenAICompat(
      OPENAI_GATEWAY,
      `Bearer ${process.env["OPENAI_API_KEY"]}`,
      OPENAI_MODEL,
      system,
      user,
      json,
    );
  }

  // 3. Gemini native REST
  if (process.env["GEMINI_API_KEY"]) {
    // Gemini doesn't have a native json_object mode in the free REST API,
    // so we ask it to return JSON via the prompt if needed.
    const promptedUser = json
      ? `${user}\n\nIMPORTANT: Respond with valid JSON only, no markdown fences.`
      : user;
    return callGeminiNative(system, promptedUser);
  }

  throw new Error(
    "No AI provider configured. Set one of: LOVABLE_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.",
  );
}

/** Helper that parses JSON from the model response, with a typed fallback. */
export async function askAIJson<T>(system: string, user: string, fallback: T): Promise<T> {
  try {
    const raw = await askAI(system, user, { json: true });
    // Strip markdown fences if the model wraps the JSON
    const cleaned = raw
      .replace(/^```(?:json)?/im, "")
      .replace(/```\s*$/im, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

/** Expose the active model name for display purposes. */
export function activeAIModel(): string {
  if (process.env["LOVABLE_API_KEY"])  return LOVABLE_MODEL;
  if (process.env["OPENAI_API_KEY"])   return OPENAI_MODEL;
  if (process.env["GEMINI_API_KEY"])   return GEMINI_MODEL;
  return "none";
}

// Legacy export kept for any external references
export const AI_MODEL = LOVABLE_MODEL;
