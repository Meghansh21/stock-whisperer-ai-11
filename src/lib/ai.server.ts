// Lovable AI Gateway helper (server-only).

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const AI_MODEL = "google/gemini-3.7-flash";

export async function askAI(
  system: string,
  user: string,
  opts: { json?: boolean } = {},
): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured (missing LOVABLE_API_KEY).");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("AI is rate limited right now — try again in a few seconds.");
    if (res.status === 402) throw new Error("AI credits are exhausted for this workspace. Add credits in Lovable to continue.");
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as any;
  return data?.choices?.[0]?.message?.content ?? "";
}

export async function askAIJson<T>(system: string, user: string, fallback: T): Promise<T> {
  try {
    const raw = await askAI(system, user, { json: true });
    const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}
