import "server-only";
import type { LLMRequest } from "./llm";

/**
 * Offline mock provider (LLM_PROVIDER=mock). Produces plausible, deterministic
 * responses so the whole flow can be exercised without an API key.
 */
export function mockResponse(req: LLMRequest): string {
  const user = req.messages[req.messages.length - 1]?.content ?? "";
  if (req.task === "plan") return mockPlan(user);
  if (req.task === "report") return mockReport(user);
  return mockTurn(req.system, user);
}

function mockPlan(user: string) {
  const n = Number(user.match(/NUMBER OF QUESTIONS: (\d+)/)?.[1] ?? 5);
  const role = user.match(/TARGET ROLE: (.+)/)?.[1]?.trim() ?? "Analyst";
  const bank = [
    ["hr", `To start, could you walk me through your background and why you're interested in this ${role} role?`],
    ["resume-probe", "Your resume mentions a dashboard project. What problem did it solve, and how did you measure its impact?"],
    ["technical-sql", "How would you write a SQL query to find the top three customers by revenue in each region?"],
    ["behavioral", "Tell me about a time you had to explain a complex analysis to a non-technical stakeholder."],
    ["case", "Weekly active users dropped fifteen percent last week. How would you investigate the cause?"],
    ["technical-excel", "How would you reconcile two Excel sheets of transactions that don't match?"],
    ["behavioral", "Describe a situation where you had to deliver under a tight deadline. What did you prioritise?"],
    ["technical-python", "In pandas, how would you handle missing values in a sales dataset before analysis?"],
    ["technical-powerbi", "Explain how filter context works with CALCULATE in Power BI."],
    ["case", "How would you decide which KPIs belong on an executive dashboard for an e-commerce business?"],
  ];
  const questions = Array.from({ length: n }, (_, i) => {
    const [type, question] = bank[i % bank.length];
    return {
      id: i + 1,
      type,
      question,
      targets: i % 2 ? "Resume: project/metric claim" : "JD: core requirement",
      strongAnswer: ["Clear structure", "Specific personal contribution", "Quantified result", "Tools named correctly"],
    };
  });
  return JSON.stringify({
    analysis: {
      candidateName: "Alex",
      summary: `Mock analysis: solid foundation for a ${role} role with some gaps in advanced tooling.`,
      matchedSkills: ["SQL", "Excel", "Stakeholder communication"],
      gaps: ["Power BI DAX depth", "A/B testing", "Python automation"],
      claimsToProbe: [{ claim: "Built a dashboard that reduced reporting time by 40%", why: "Verify ownership and how 40% was measured" }],
    },
    questions,
  });
}

function mockTurn(system: string, user: string) {
  const qs = [...system.matchAll(/^Q(\d+): (.+)$/gm)].map((m) => m[2]);
  if (user.includes("PHASE: start")) {
    return `[NEXT]\nHi, thanks for joining today. I'm Sam, and I'll be your interviewer. ${qs[0] ?? "Tell me about yourself."}`;
  }
  const nextNum = user.match(/NEXT_QUESTION_NUMBER: (\d+|none)/)?.[1];
  const forced = user.includes("You MUST");
  const lastAnswer = [...user.matchAll(/^CANDIDATE: (.*)$/gm)].pop()?.[1] ?? "";
  const words = lastAnswer.split(/\s+/).filter(Boolean).length;
  if (!forced && words < 12) {
    return "[FOLLOWUP]\nCould you make that more concrete? What exactly did you do, and what was the measurable result?";
  }
  if (!nextNum || nextNum === "none") {
    return "[END]\nThat's all the questions I have. Thank you for your time today, your feedback report will be ready in a moment.";
  }
  return `[NEXT]\nThanks, that's helpful. ${qs[Number(nextNum) - 1] ?? "Let's move on."}`;
}

function mockReport(user: string) {
  const blocks = [...user.matchAll(/--- Q(\d+) ---\n([\s\S]*?)(?=\n\n--- Q|\n\nMEASURED)/g)];
  const perQuestion = blocks
    .filter((b) => !b[2].includes("(not reached)"))
    .map((b) => {
      const i = Number(b[1]) - 1;
      const q = b[2].match(/INTERVIEWER: (.+)/)?.[1] ?? `Question ${i + 1}`;
      return {
        questionIndex: i,
        question: q,
        score: 6,
        good: ["Answered the question directly"],
        missing: ["No quantified result", "Personal contribution unclear"],
        improvedAnswer: {
          situation: "In my role described on my resume, we had [context from your resume].",
          task: "I was responsible for [your specific responsibility].",
          action: "I analysed the data using the tools listed on my resume and presented findings to stakeholders.",
          result: "This improved [metric] by [your % improvement].",
        },
      };
    });
  return JSON.stringify({
    overallScore: 62,
    verdict: "borderline",
    verdictReason: "Mock report: reasonable fundamentals, but answers lacked metrics and structure.",
    perQuestion,
    communication: {
      notes: ["Answers were understandable", "Use STAR structure more consistently", "Reduce filler words"],
      rambling: "Mostly on point; the case question wandered before reaching a hypothesis.",
    },
    topGaps: [
      { gap: "Quantifying impact", prepare: "Write 3 resume stories with concrete numbers." },
      { gap: "Advanced SQL", prepare: "Practice 10 window-function problems." },
      { gap: "Structured case thinking", prepare: "Practice metric-drop cases with a hypothesis tree." },
    ],
  });
}
