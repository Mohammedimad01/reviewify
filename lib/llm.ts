import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Provider-agnostic LLM layer. Server-only: API keys never reach the client.
 *
 * Supported providers:
 *   - anthropic : Claude via the official SDK (default model claude-sonnet-5-5)
 *   - gemini    : Google AI Studio (Generative Language REST API)
 *   - openai    : any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, Together,
 *                 local Ollama / LM Studio for open-source models)
 *   - mock      : canned offline responses, for UI testing without any key
 */

export type ProviderName = "anthropic" | "gemini" | "openai" | "mock";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Ask for a JSON object response (used where the provider supports a JSON mode). */
  json?: boolean;
  /** "fast" = latency-sensitive (live interviewer turns); "deep" = planning / grading. */
  mode?: "fast" | "deep";
  /** Used by the mock provider to pick a canned response. */
  task?: "plan" | "turn" | "report";
}

export class LLMError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

export function resolveProvider(): ProviderName {
  const explicit = (process.env.LLM_PROVIDER || "").trim().toLowerCase();
  if (explicit) {
    if (["anthropic", "gemini", "openai", "mock"].includes(explicit)) return explicit as ProviderName;
    throw new LLMError(`Unknown LLM_PROVIDER "${explicit}". Use anthropic | gemini | openai | mock.`, 500);
  }
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return "openai";
  throw new LLMError(
    "No LLM provider configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_BASE_URL/OPENAI_API_KEY (or LLM_PROVIDER=mock) in your environment.",
    500,
  );
}

export function providerInfo() {
  try {
    const p = resolveProvider();
    const model =
      p === "anthropic"
        ? anthropicModel()
        : p === "gemini"
          ? geminiModel()
          : p === "openai"
            ? process.env.OPENAI_MODEL || "(unset)"
            : "mock";
    return { provider: p, model, configured: true };
  } catch (e) {
    return { provider: null, model: null, configured: false, error: (e as Error).message };
  }
}

/** Full (non-streaming) completion. */
export async function complete(req: LLMRequest): Promise<string> {
  const p = resolveProvider();
  switch (p) {
    case "anthropic":
      return anthropicComplete(req);
    case "gemini":
      return collect(geminiStream(req, false));
    case "openai":
      return collect(openaiStream(req, false));
    case "mock":
      return collect(mockStream(req));
  }
}

/** Streaming completion as an async iterable of text deltas. */
export function stream(req: LLMRequest): AsyncIterable<string> {
  const p = resolveProvider();
  switch (p) {
    case "anthropic":
      return anthropicStream(req);
    case "gemini":
      return geminiStream(req, true);
    case "openai":
      return openaiStream(req, true);
    case "mock":
      return mockStream(req);
  }
}

/** Complete and parse JSON, retrying once with a corrective nudge if parsing fails. */
export async function completeJSON<T>(req: LLMRequest): Promise<T> {
  const first = await complete({ ...req, json: true });
  try {
    return parseJSONLoose<T>(first);
  } catch {
    const retry = await complete({
      ...req,
      json: true,
      messages: [
        ...req.messages,
        { role: "assistant", content: first.slice(0, 4000) },
        {
          role: "user",
          content:
            "That response was not valid JSON. Reply again with ONLY the complete JSON object, no prose, no code fences.",
        },
      ],
    });
    return parseJSONLoose<T>(retry);
  }
}

export function parseJSONLoose<T>(text: string): T {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found");
  return JSON.parse(t.slice(start, end + 1)) as T;
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of it) out += chunk;
  return out;
}

/* ------------------------------------------------------------------ */
/* Anthropic                                                           */
/* ------------------------------------------------------------------ */

function anthropicModel() {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
}

let _anthropic: Anthropic | null = null;
function anthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new LLMError("ANTHROPIC_API_KEY is not set.", 500);
  // Pin the official endpoint so a stray ANTHROPIC_BASE_URL in the shell can't redirect it.
  _anthropic ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_API_BASE || "https://api.anthropic.com",
  });
  return _anthropic;
}

function anthropicParams(req: LLMRequest) {
  const model = anthropicModel();
  const isSonnet55 = model.startsWith("claude-sonnet-5-5");
  // Live interviewer turns: low effort for low latency. Planning/grading: medium.
  const effort = req.mode === "fast" ? "low" : "medium";
  const params: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens ?? (req.mode === "fast" ? 1024 : 16000),
    system: req.system,
    messages: req.messages,
    output_config: { effort },
  };
  // Server-side refusal fallback (Claude API). The "default" form routes by refusal category.
  if (isSonnet55 || /^claude-(opus-5|fable-5)/.test(model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

function anthropicError(e: unknown): never {
  if (e instanceof Anthropic.AuthenticationError) throw new LLMError("Anthropic: invalid API key.", 401);
  if (e instanceof Anthropic.RateLimitError) throw new LLMError("Anthropic: rate limited, try again shortly.", 429);
  if (e instanceof Anthropic.APIError) throw new LLMError(`Anthropic API error ${e.status}: ${e.message}`, e.status || 500);
  throw e;
}

async function anthropicComplete(req: LLMRequest): Promise<string> {
  try {
    // Streaming under the hood avoids HTTP timeouts on large max_tokens.
    const s = anthropicClient().beta.messages.stream(anthropicParams(req) as never);
    const msg = await s.finalMessage();
    if (msg.stop_reason === "refusal") throw new LLMError("The model declined this request.", 422);
    return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  } catch (e) {
    if (e instanceof LLMError) throw e;
    anthropicError(e);
  }
}

async function* anthropicStream(req: LLMRequest): AsyncIterable<string> {
  try {
    const s = anthropicClient().beta.messages.stream(anthropicParams(req) as never);
    for await (const ev of s) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
    }
  } catch (e) {
    anthropicError(e);
  }
}

/* ------------------------------------------------------------------ */
/* Gemini (Google AI Studio)                                           */
/* ------------------------------------------------------------------ */

function geminiModel() {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

async function* geminiStream(req: LLMRequest, streaming: boolean): AsyncIterable<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new LLMError("GEMINI_API_KEY is not set.", 500);
  const model = geminiModel();
  const base = "https://generativelanguage.googleapis.com/v1beta/models";
  const url = streaming
    ? `${base}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
    : `${base}/${encodeURIComponent(model)}:generateContent`;

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: req.maxTokens ?? (req.mode === "fast" ? 1024 : 16000),
    temperature: req.mode === "fast" ? 0.7 : 0.4,
  };
  if (req.json) generationConfig.responseMimeType = "application/json";
  // Keep live turns snappy on 2.5 "thinking" models.
  if (req.mode === "fast" && /2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new LLMError(`Gemini API error ${res.status}: ${body.slice(0, 500)}`, res.status);
  }

  const partsText = (j: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }) =>
    (j.candidates?.[0]?.content?.parts || [])
      .filter((p) => !p.thought)
      .map((p) => p.text || "")
      .join("");

  if (!streaming) {
    yield partsText(await res.json());
    return;
  }
  for await (const data of sseData(res)) {
    try {
      yield partsText(JSON.parse(data));
    } catch {
      /* ignore keep-alives */
    }
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible (OpenAI, Groq, OpenRouter, Ollama, LM Studio...)  */
/* ------------------------------------------------------------------ */

async function* openaiStream(req: LLMRequest, streaming: boolean): AsyncIterable<string> {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL;
  if (!model) throw new LLMError("OPENAI_MODEL is not set.", 500);
  const body: Record<string, unknown> = {
    model,
    stream: streaming,
    max_tokens: req.maxTokens ?? (req.mode === "fast" ? 1024 : 8000),
    temperature: req.mode === "fast" ? 0.7 : 0.4,
    messages: [{ role: "system", content: req.system }, ...req.messages],
  };
  if (req.json) body.response_format = { type: "json_object" };

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || "none"}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new LLMError(`OpenAI-compatible API error ${res.status}: ${text.slice(0, 500)}`, res.status);
  }
  if (!streaming) {
    const j = await res.json();
    yield j.choices?.[0]?.message?.content ?? "";
    return;
  }
  for await (const data of sseData(res)) {
    if (data === "[DONE]") return;
    try {
      const j = JSON.parse(data);
      const d = j.choices?.[0]?.delta?.content;
      if (d) yield d;
    } catch {
      /* ignore */
    }
  }
}

/** Parse an SSE body into its `data:` payloads. */
async function* sseData(res: Response): AsyncIterable<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith("data:")) yield buf.slice(5).trim();
}

/* ------------------------------------------------------------------ */
/* Mock (offline)                                                      */
/* ------------------------------------------------------------------ */

async function* mockStream(req: LLMRequest): AsyncIterable<string> {
  const { mockResponse } = await import("./mock");
  const text = mockResponse(req);
  for (const piece of text.match(/[\s\S]{1,24}/g) || []) {
    await new Promise((r) => setTimeout(r, 15));
    yield piece;
  }
}
