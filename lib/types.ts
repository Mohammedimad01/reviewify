export type Seniority = "Fresher" | "Junior" | "Mid";
export type Round =
  | "HR screen"
  | "Behavioral"
  | "Case/Business"
  | "Technical: SQL"
  | "Technical: Excel"
  | "Technical: Python"
  | "Technical: Power BI"
  | "Mixed";
export type Persona = "friendly" | "neutral" | "tough";

export const SENIORITIES: Seniority[] = ["Fresher", "Junior", "Mid"];
export const ROUNDS: Round[] = [
  "HR screen",
  "Behavioral",
  "Case/Business",
  "Technical: SQL",
  "Technical: Excel",
  "Technical: Python",
  "Technical: Power BI",
  "Mixed",
];
export const LENGTHS = [5, 10, 15] as const;
export const PERSONAS: Persona[] = ["friendly", "neutral", "tough"];

export interface InterviewConfig {
  role: string;
  seniority: Seniority;
  round: Round;
  length: number;
  persona: Persona;
}

export interface Analysis {
  candidateName: string;
  summary: string;
  matchedSkills: string[];
  gaps: string[];
  claimsToProbe: { claim: string; why: string }[];
}

export interface PlannedQuestion {
  id: number;
  type: string; // e.g. behavioral, technical-sql, case, hr, resume-probe
  question: string;
  targets: string; // the JD requirement or resume line this question targets
  strongAnswer: string[]; // what a strong answer contains
}

export interface PlanResponse {
  analysis: Analysis;
  questions: PlannedQuestion[];
}

export type Speaker = "interviewer" | "candidate";

export interface Turn {
  speaker: Speaker;
  text: string;
  questionIndex: number; // planned question this turn belongs to
  isFollowUp?: boolean;
  durationSec?: number; // candidate answer duration
  at: number;
}

export interface QuestionFeedback {
  questionIndex: number;
  question: string;
  score: number; // 0-10
  good: string[];
  missing: string[];
  improvedAnswer: {
    situation: string;
    task: string;
    action: string;
    result: string;
  };
}

export interface Report {
  overallScore: number; // 0-100
  verdict: "hire" | "borderline" | "no-hire";
  verdictReason: string;
  perQuestion: QuestionFeedback[];
  communication: {
    notes: string[];
    rambling: string;
  };
  topGaps: { gap: string; prepare: string }[];
}

export interface CommStats {
  fillerCount: number;
  fillerBreakdown: Record<string, number>;
  totalWords: number;
  avgWordsPerAnswer: number;
  longestAnswerWords: number;
  avgAnswerSeconds: number | null;
  answers: number;
}

export interface Session {
  id: string;
  createdAt: number;
  config: InterviewConfig;
  resume: string;
  jd: string;
  plan: PlanResponse;
  transcript: Turn[];
  startedAt?: number;
  endedAt?: number;
  status: "planned" | "in-progress" | "completed";
  report?: Report;
  stats?: CommStats;
}
