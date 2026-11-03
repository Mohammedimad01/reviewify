import type { Analysis, InterviewConfig, PlanResponse, PlannedQuestion, Report } from "./types";
import { LENGTHS, PERSONAS, ROUNDS, SENIORITIES } from "./types";

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strArr = (v: unknown, maxItems = 20) =>
  Array.isArray(v) ? v.map((x) => str(typeof x === "string" ? x : JSON.stringify(x), 600)).filter(Boolean).slice(0, maxItems) : [];
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export function parseConfig(v: unknown): InterviewConfig | string {
  const c = (v ?? {}) as Record<string, unknown>;
  const role = str(c.role, 120);
  if (!role) return "Target role is required.";
  if (!SENIORITIES.includes(c.seniority as never)) return "Invalid seniority.";
  if (!ROUNDS.includes(c.round as never)) return "Invalid interview round.";
  if (!LENGTHS.includes(Number(c.length) as never)) return "Invalid length.";
  if (!PERSONAS.includes(c.persona as never)) return "Invalid persona.";
  return {
    role,
    seniority: c.seniority as InterviewConfig["seniority"],
    round: c.round as InterviewConfig["round"],
    length: Number(c.length),
    persona: c.persona as InterviewConfig["persona"],
  };
}

export function sanitizePlan(raw: unknown, length: number): PlanResponse {
  const r = (raw ?? {}) as Record<string, unknown>;
  const a = (r.analysis ?? {}) as Record<string, unknown>;
  const analysis: Analysis = {
    candidateName: str(a.candidateName, 60),
    summary: str(a.summary, 1500),
    matchedSkills: strArr(a.matchedSkills),
    gaps: strArr(a.gaps),
    claimsToProbe: Array.isArray(a.claimsToProbe)
      ? a.claimsToProbe
          .map((c) => {
            const o = (c ?? {}) as Record<string, unknown>;
            return { claim: str(o.claim, 400), why: str(o.why, 400) };
          })
          .filter((c) => c.claim)
          .slice(0, 10)
      : [],
  };
  const qs = Array.isArray(r.questions) ? r.questions : [];
  const questions: PlannedQuestion[] = qs
    .map((q, i) => {
      const o = (q ?? {}) as Record<string, unknown>;
      return {
        id: i + 1,
        type: str(o.type, 40) || "general",
        question: str(o.question, 800),
        targets: str(o.targets, 400),
        strongAnswer: strArr(o.strongAnswer, 8),
      };
    })
    .filter((q) => q.question)
    .slice(0, length);
  if (!questions.length) throw new Error("The model returned no questions.");
  return { analysis, questions };
}

export function sanitizeReport(raw: unknown, questionCount: number): Report {
  const r = (raw ?? {}) as Record<string, unknown>;
  const overallScore = clampInt(r.overallScore, 0, 100, 0);
  let verdict = str(r.verdict, 20).toLowerCase().replace(/\s+/g, "-") as Report["verdict"];
  if (!["hire", "borderline", "no-hire"].includes(verdict)) {
    verdict = overallScore >= 75 ? "hire" : overallScore >= 55 ? "borderline" : "no-hire";
  }
  const comm = (r.communication ?? {}) as Record<string, unknown>;
  return {
    overallScore,
    verdict,
    verdictReason: str(r.verdictReason, 1500),
    perQuestion: (Array.isArray(r.perQuestion) ? r.perQuestion : [])
      .map((q) => {
        const o = (q ?? {}) as Record<string, unknown>;
        const ia = (o.improvedAnswer ?? {}) as Record<string, unknown>;
        return {
          questionIndex: clampInt(o.questionIndex, 0, Math.max(0, questionCount - 1), 0),
          question: str(o.question, 800),
          score: clampInt(o.score, 0, 10, 0),
          good: strArr(o.good, 8),
          missing: strArr(o.missing, 8),
          improvedAnswer: {
            situation: str(ia.situation, 1500),
            task: str(ia.task, 1500),
            action: str(ia.action, 2500),
            result: str(ia.result, 1500),
          },
        };
      })
      .sort((a, b) => a.questionIndex - b.questionIndex),
    communication: { notes: strArr(comm.notes, 8), rambling: str(comm.rambling, 800) },
    topGaps: (Array.isArray(r.topGaps) ? r.topGaps : [])
      .map((g) => {
        const o = (g ?? {}) as Record<string, unknown>;
        return { gap: str(o.gap, 400), prepare: str(o.prepare, 800) };
      })
      .filter((g) => g.gap)
      .slice(0, 3),
  };
}
