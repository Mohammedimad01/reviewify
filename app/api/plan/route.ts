import { NextResponse } from "next/server";
import { completeJSON, LLMError } from "@/lib/llm";
import { planPrompt } from "@/lib/prompts";
import { parseConfig, sanitizePlan } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const config = parseConfig(body.config);
    if (typeof config === "string") return NextResponse.json({ error: config }, { status: 400 });
    const resume = typeof body.resume === "string" ? body.resume.trim() : "";
    const jd = typeof body.jd === "string" ? body.jd.trim() : "";
    if (resume.length < 50) return NextResponse.json({ error: "Please provide your resume (at least a few lines)." }, { status: 400 });
    if (jd.length < 50) return NextResponse.json({ error: "Please paste the job description (at least a few lines)." }, { status: 400 });

    const { system, user } = planPrompt(config, resume.slice(0, 30000), jd.slice(0, 20000));
    const raw = await completeJSON<unknown>({
      system,
      messages: [{ role: "user", content: user }],
      mode: "deep",
      task: "plan",
      maxTokens: 16000,
    });
    return NextResponse.json(sanitizePlan(raw, config.length));
  } catch (e) {
    console.error("plan failed", e);
    const status = e instanceof LLMError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message || "Planning failed." }, { status });
  }
}
