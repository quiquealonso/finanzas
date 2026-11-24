/**
 * Small Gemini client (Google AI Studio, free tier) for one-off questions with a JSON answer.
 * Key: GEMINI_API_KEY in back/.env (a project WITHOUT billing, or it answers 402). The free models are often
 * overloaded (503): it tries them in order and remembers the last one that answered.
 * (The sentiment page has its own batch classifier with the same rules: sentiment.ts.)
 */

const MODELS = [
  ...(process.env.GEMINI_MODEL?.trim() ? [process.env.GEMINI_MODEL.trim()] : []),
  "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-flash-latest",
].filter((m, i, all) => all.indexOf(m) === i);
let lastGood = MODELS[0];
const missing = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY?.trim();

export class GeminiError extends Error {
  constructor(message: string, readonly kind: "nokey" | "quota" | "billing" | "busy" | "other") {
    super(message);
  }
}

/** Asks for a JSON answer that follows `schema`. Calls `onTry` with each model it tries (for progress messages). */
export async function askGeminiJson<T>(prompt: string, schema: unknown, onTry?: (model: string) => void): Promise<{ data: T; model: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new GeminiError("Falta GEMINI_API_KEY en back/.env", "nokey");
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
  };
  const order = [lastGood, ...MODELS.filter((m) => m !== lastGood)].filter((m) => !missing.has(m));
  let lastError = "sin modelos disponibles";
  for (const [n, model] of [...order, ...order].entries()) {
    if (missing.has(model)) continue;
    if (n === order.length) await sleep(8_000); // second round: give Google a moment
    onTry?.(model);
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e: any) {
      lastError = `${model}: ${e?.name === "TimeoutError" ? "sin respuesta" : e?.message ?? e}`;
      continue;
    }
    if (res.status === 429) throw new GeminiError("Límite gratis de Gemini alcanzado", "quota");
    if (res.status === 402) throw new GeminiError("El proyecto de la clave de Gemini pide pago", "billing");
    if (res.status === 404) { missing.add(model); lastError = `${model}: no disponible`; continue; }
    if (res.status === 503 || res.status === 500) { lastError = `${model}: saturado`; continue; }
    if (!res.ok) throw new GeminiError(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, "other");
    const text = (await res.json())?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    lastGood = model;
    return { data: JSON.parse(text) as T, model };
  }
  throw new GeminiError(`Gemini no responde (${lastError})`, "busy");
}
