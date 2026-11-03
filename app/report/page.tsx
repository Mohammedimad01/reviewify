"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSession, saveSession } from "@/lib/storage";
import { computeStats } from "@/lib/stats";
import { downloadReportPDF } from "@/lib/pdf";
import { Spinner, verdictClass } from "@/components/ui";
import type { Session } from "@/lib/types";

export default function ReportPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <ReportView />
    </Suspense>
  );
}

function ReportView() {
  const id = useSearchParams().get("id") || "";
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const generate = useCallback(async (s: Session) => {
    setGenerating(true);
    setError(null);
    try {
      const stats = s.stats ?? computeStats(s.transcript);
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: s.config,
          resume: s.resume,
          jd: s.jd,
          analysis: s.plan.analysis,
          questions: s.plan.questions,
          transcript: s.transcript,
          stats,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Report generation failed");
      const next: Session = { ...s, stats, report: j, status: "completed", endedAt: s.endedAt ?? Date.now() };
      saveSession(next);
      setSession(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, []);

  useEffect(() => {
    const s = getSession(id) ?? null;
    setSession(s);
    setLoaded(true);
    if (s && !s.report && !started.current && s.transcript.some((t) => t.speaker === "candidate")) {
      started.current = true;
      generate(s);
    }
  }, [id, generate]);

  if (!loaded) return <p className="text-muted">Loading…</p>;
  if (!session)
    return (
      <div className="card text-sm">
        Report not found. <a className="text-accent hover:underline" href="/">Start a new interview</a>.
      </div>
    );

  const r = session.report;
  const stats = session.stats ?? computeStats(session.transcript);
  const hasAnswers = session.transcript.some((t) => t.speaker === "candidate");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Interview feedback</h1>
          <p className="mt-1 text-sm text-muted">
            {session.config.role} · {session.config.seniority} · {session.config.round} · {session.config.persona} interviewer ·{" "}
            {new Date(session.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => downloadReportPDF(session)} disabled={generating}>
            ⬇ Download PDF
          </button>
          <a className="btn-primary" href="/">
            New interview
          </a>
        </div>
      </div>

      {!hasAnswers && <div className="card text-sm text-muted">No answers were recorded in this session, so there’s nothing to grade.</div>}

      {generating && (
        <div className="card flex items-center gap-3 text-sm text-muted">
          <Spinner /> Grading your interview… this can take up to a minute.
        </div>
      )}
      {error && (
        <div className="card space-y-3 text-sm">
          <p className="text-bad">{error}</p>
          <button className="btn-primary" onClick={() => generate(session)}>
            Retry
          </button>
        </div>
      )}

      {r && (
        <>
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="card flex flex-col items-center justify-center px-8">
              <div className="text-5xl font-semibold tabular-nums">{r.overallScore}</div>
              <div className="text-xs text-muted">out of 100</div>
              <span className={`mt-3 rounded-md px-2.5 py-1 text-sm font-medium capitalize ${verdictClass(r.verdict)}`}>{r.verdict}</span>
            </div>
            <div className="card">
              <h2 className="mb-1 font-semibold">Verdict</h2>
              <p className="text-sm leading-relaxed text-muted">{r.verdictReason}</p>
            </div>
          </div>

          <div className="card">
            <h2 className="mb-3 font-semibold">Top 3 gaps vs the JD — what to prepare next</h2>
            <ol className="space-y-3">
              {r.topGaps.map((g, i) => (
                <li key={i} className="rounded-xl bg-panel-2 p-3 text-sm">
                  <div className="font-medium">
                    {i + 1}. {g.gap}
                  </div>
                  <div className="mt-1 text-muted">{g.prepare}</div>
                </li>
              ))}
            </ol>
          </div>

          <div className="card">
            <h2 className="mb-3 font-semibold">Communication</h2>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Filler words" value={stats.fillerCount} />
              <Stat label="Avg words / answer" value={stats.avgWordsPerAnswer} />
              <Stat label="Longest answer" value={`${stats.longestAnswerWords} w`} />
              <Stat label="Avg answer time" value={stats.avgAnswerSeconds != null ? `${stats.avgAnswerSeconds}s` : "—"} />
            </div>
            {Object.keys(stats.fillerBreakdown).length > 0 && (
              <p className="mb-3 text-xs text-muted">
                Fillers: {Object.entries(stats.fillerBreakdown).map(([k, v]) => `“${k}” ×${v}`).join(", ")}. (Browser speech
                recognition often drops “um/uh”, so the real count may be higher.)
              </p>
            )}
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {r.communication.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            {r.communication.rambling && <p className="mt-3 text-sm text-muted">Rambling: {r.communication.rambling}</p>}
          </div>

          <div className="space-y-4">
            <h2 className="font-semibold">Question by question</h2>
            {r.perQuestion.map((q) => (
              <QuestionCard key={q.questionIndex} q={q} session={session} />
            ))}
          </div>
        </>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Full transcript ({session.transcript.length} turns)</summary>
        <ol className="mt-3 space-y-3 text-sm">
          {session.transcript.map((t, i) => (
            <li key={i}>
              <div className="text-xs text-muted">
                {t.speaker === "interviewer" ? "Interviewer" : "You"}
                {t.isFollowUp ? " · follow-up" : ""}
              </div>
              <div>{t.text}</div>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-panel-2 p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function QuestionCard({ q, session }: { q: NonNullable<Session["report"]>["perQuestion"][number]; session: Session }) {
  const [open, setOpen] = useState(false);
  const answers = session.transcript.filter((t) => t.speaker === "candidate" && t.questionIndex === q.questionIndex);
  const tone = q.score >= 7 ? "text-good" : q.score >= 5 ? "text-warn" : "text-bad";
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <span className="text-muted">Q{q.questionIndex + 1}.</span> {q.question}
        </div>
        <div className={`shrink-0 text-lg font-semibold tabular-nums ${tone}`}>{q.score}/10</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-good">What was good</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {q.good.length ? q.good.map((g, i) => <li key={i}>{g}</li>) : <li className="text-muted">—</li>}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-bad">What was missing</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {q.missing.length ? q.missing.map((g, i) => <li key={i}>{g}</li>) : <li className="text-muted">—</li>}
          </ul>
        </div>
      </div>
      <div className="rounded-xl bg-panel-2 p-3 text-sm">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-accent">Improved answer (STAR, from your real resume)</h3>
        <dl className="space-y-1.5">
          {(["situation", "task", "action", "result"] as const).map((k) => (
            <div key={k}>
              <dt className="inline font-medium capitalize">{k}: </dt>
              <dd className="inline text-muted">{q.improvedAnswer[k]}</dd>
            </div>
          ))}
        </dl>
      </div>
      {answers.length > 0 && (
        <button className="text-xs text-muted hover:text-fg" onClick={() => setOpen((v) => !v)}>
          {open ? "▾ Hide" : "▸ Show"} what you said
        </button>
      )}
      {open && (
        <div className="space-y-2 text-sm text-muted">
          {answers.map((a, i) => (
            <p key={i} className="border-l-2 border-line pl-3">
              {a.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
