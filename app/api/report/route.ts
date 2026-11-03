import { NextResponse } from "next/server";
import { completeJSON, LLMError } from "@/lib/llm";
import { reportPrompt } from "@/lib/prompts";
import { parseConfig, sanitizeReport } from "@/lib/validate";
import type { Analysis, CommStats, PlannedQuestion, Turn } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const config = parseConfig(body.config);
    if (typeof config === "string") return NextResponse.json({ error: config }, { status: 400 });
    const questions = (body.questions ?? []) as PlannedQuestion[];
    const transcript = (body.transcript ?? []) as Turn[];
    if (!Array.isArray(questions) || !questions.length) return NextResponse.json({ error: "Missing plan." }, { status: 400 });
    if (!Array.isArray(transcript) || !transcript.some((t) => t.speaker === "candidate")) {
      return NextResponse.json({ error: "No answers recorded yet." }, { status: 400 });
    }
    const { system, user } = reportPrompt({
      config,
      resume: String(body.resume ?? "").slice(0, 30000),
      jd: String(body.jd ?? "").slice(0, 20000),
      analysis: body.analysis as Analysis,
      questions,
      transcript,
      stats: body.stats as CommStats,
    });
    const raw = await completeJSON<unknown>({
      system,
      messages: [{ role: "user", content: user }],
      mode: "deep",
      task: "report",
      maxTokens: 20000,
    });
    return NextResponse.json(sanitizeReport(raw, questions.length));
  } catch (e) {
    console.error("report failed", e);
    const status = e instanceof LLMError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message || "Report generation failed." }, { status });
  }
}
