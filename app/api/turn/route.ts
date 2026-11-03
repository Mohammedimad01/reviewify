import { LLMError, stream } from "@/lib/llm";
import { interviewerSystemPrompt, interviewerTurnPrompt, MAX_FOLLOWUPS_PER_QUESTION } from "@/lib/prompts";
import { parseConfig } from "@/lib/validate";
import type { Analysis, PlannedQuestion, Turn } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Action = "followup" | "next" | "end";

/**
 * Streams the interviewer's next utterance.
 * Response body: first line is a JSON header {"action": "..."}; everything after is
 * the spoken text, streamed as it is generated so speech can start immediately.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const config = parseConfig(body.config);
  if (typeof config === "string") return Response.json({ error: config }, { status: 400 });
  const questions = (body.questions ?? []) as PlannedQuestion[];
  const analysis = (body.analysis ?? { matchedSkills: [], gaps: [], claimsToProbe: [] }) as Analysis;
  const transcript = ((body.transcript ?? []) as Turn[]).slice(-80);
  const phase = body.phase === "start" ? "start" : "answer";
  const currentIndex = Math.max(0, Math.min(Number(body.currentIndex) || 0, questions.length - 1));
  const followUpsUsed = Math.max(0, Number(body.followUpsUsed) || 0);
  if (!Array.isArray(questions) || !questions.length) return Response.json({ error: "Missing plan." }, { status: 400 });

  const isLast = currentIndex >= questions.length - 1;
  const moveOn: Action = phase === "start" ? "next" : isLast ? "end" : "next";
  const canFollowUp = phase === "answer" && followUpsUsed < MAX_FOLLOWUPS_PER_QUESTION;

  const system = interviewerSystemPrompt(config, analysis, questions, String(body.resume ?? ""));
  const user = interviewerTurnPrompt({
    phase,
    candidateName: analysis.candidateName || "",
    transcript,
    currentIndex,
    followUpsUsed,
    totalQuestions: questions.length,
    persona: config.persona,
  });

  let iter: AsyncIterator<string>;
  try {
    iter = stream({ system, messages: [{ role: "user", content: user }], mode: "fast", task: "turn", maxTokens: 1024 })[
      Symbol.asyncIterator
    ]();
  } catch (e) {
    const status = e instanceof LLMError ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }

  const encoder = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      let head = "";
      let headerSent = false;
      const sendHeader = (action: Action) => {
        controller.enqueue(encoder.encode(JSON.stringify({ action }) + "\n"));
        headerSent = true;
      };
      const resolveTag = (tag: string | undefined): Action => {
        const t = (tag || "").toUpperCase();
        let a: Action = t === "FOLLOWUP" ? "followup" : t === "END" ? "end" : t === "NEXT" ? "next" : moveOn;
        if (a === "followup" && !canFollowUp) a = moveOn; // server enforces the follow-up cap
        if (a === "end" && phase === "start") a = "next";
        return a;
      };
      try {
        while (true) {
          const { value, done } = await iter.next();
          if (done) break;
          if (headerSent) {
            controller.enqueue(encoder.encode(clean(value)));
            continue;
          }
          head += value;
          const m = head.match(/^\s*\[\s*(FOLLOW[\s_-]?UP|NEXT|END)\s*\]\s*/i);
          if (m) {
            sendHeader(resolveTag(m[1].replace(/[\s_-]/g, "")));
            const rest = clean(head.slice(m[0].length));
            if (rest) controller.enqueue(encoder.encode(rest));
          } else if (head.trim().length > 24 && !/^\s*\[/.test(head)) {
            // Model skipped the tag: fall back to the default action.
            sendHeader(resolveTag(undefined));
            controller.enqueue(encoder.encode(clean(head)));
          }
        }
        if (!headerSent) {
          sendHeader(resolveTag(undefined));
          const rest = clean(head.replace(/^\s*\[[^\]]*\]\s*/, ""));
          if (rest) controller.enqueue(encoder.encode(rest));
        }
      } catch (e) {
        console.error("turn stream failed", e);
        if (!headerSent) sendHeader(moveOn);
        controller.enqueue(encoder.encode(`\n[[ERROR]] ${(e as Error).message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(out, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Strip markdown and stray tags so the text is safe to speak. */
function clean(s: string) {
  return s.replace(/\[(FOLLOWUP|NEXT|END)\]/gi, "").replace(/[*_#`]/g, "");
}
