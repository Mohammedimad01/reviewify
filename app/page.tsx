"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner, verdictClass } from "@/components/ui";
import { deleteSession, listSessions, newId, saveSession } from "@/lib/storage";
import {
  LENGTHS,
  PERSONAS,
  ROUNDS,
  SENIORITIES,
  type InterviewConfig,
  type PlanResponse,
  type Session,
} from "@/lib/types";

const DRAFT_KEY = "reviewify.draft.v1";

export default function SetupPage() {
  const router = useRouter();
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [config, setConfig] = useState<InterviewConfig>({
    role: "",
    seniority: "Junior",
    round: "Mixed",
    length: 5,
    persona: "neutral",
  });
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [history, setHistory] = useState<Session[]>([]);
  const [provider, setProvider] = useState<{ configured: boolean; provider: string | null; model: string | null; error?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Restore draft + history; check provider.
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d) {
        setResume(d.resume ?? "");
        setJd(d.jd ?? "");
        if (d.config) setConfig((c) => ({ ...c, ...d.config }));
      }
    } catch {}
    setHistory(listSessions());
    fetch("/api/health")
      .then((r) => r.json())
      .then(setProvider)
      .catch(() => setProvider(null));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ resume, jd, config }));
    } catch {}
  }, [resume, jd, config]);

  const set = <K extends keyof InterviewConfig>(k: K, v: InterviewConfig[K]) => {
    setConfig((c) => ({ ...c, [k]: v }));
    setPlan(null);
  };

  async function onFile(f: File) {
    setError(null);
    setUploading(true);
    setFileName(f.name);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed");
      setResume(j.text);
      setPlan(null);
    } catch (e) {
      setError((e as Error).message);
      setFileName("");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function makePlan() {
    setError(null);
    if (!config.role.trim()) return setError("Enter a target role, e.g. “Business Analyst”.");
    if (resume.trim().length < 50) return setError("Add your resume (upload a file or paste the text).");
    if (jd.trim().length < 50) return setError("Paste the job description.");
    setPlanning(true);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, resume, jd }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Planning failed");
      setPlan(j);
      setTimeout(() => document.getElementById("analysis")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  }

  function startInterview() {
    if (!plan) return;
    const s: Session = {
      id: newId(),
      createdAt: Date.now(),
      config,
      resume,
      jd,
      plan,
      transcript: [],
      status: "planned",
    };
    saveSession(s);
    router.push(`/interview?id=${s.id}`);
  }

  function loadSample() {
    Promise.all([fetch("/samples/resume.txt").then((r) => r.text()), fetch("/samples/jd.txt").then((r) => r.text())]).then(
      ([r, j]) => {
        setResume(r);
        setJd(j);
        setFileName("");
        setConfig((c) => ({ ...c, role: c.role || "Business Analyst" }));
        setPlan(null);
      },
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Practice a real interview, out loud.</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Upload your resume and the job description. An AI interviewer plans questions that target your gaps and resume
          claims, interviews you by voice, asks follow-ups, then gives you a scored report.
        </p>
      </section>

      {provider && !provider.configured && (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          No AI provider is configured on the server. {provider.error} See the README.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <span className="label !mb-0">Resume</span>
            <button type="button" className="text-xs text-accent hover:underline" onClick={loadSample}>
              Load sample
            </button>
          </div>
          <label
            className="mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-panel-2 px-3 py-4 text-sm text-muted hover:border-accent"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            {uploading ? "Extracting text…" : fileName ? `✓ ${fileName} — click to replace` : "Upload PDF or DOCX (or drop it here)"}
          </label>
          <textarea
            className="input h-56 resize-y font-mono text-xs leading-relaxed"
            placeholder="…or paste your resume text"
            value={resume}
            onChange={(e) => {
              setResume(e.target.value);
              setPlan(null);
            }}
          />
        </div>

        <div className="card">
          <span className="label">Job description</span>
          <textarea
            className="input h-[19.5rem] resize-y font-mono text-xs leading-relaxed"
            placeholder="Paste the full job description"
            value={jd}
            onChange={(e) => {
              setJd(e.target.value);
              setPlan(null);
            }}
          />
        </div>
      </div>

      <div className="card space-y-5">
        <div>
          <label className="label" htmlFor="role">
            Target role
          </label>
          <input
            id="role"
            className="input"
            placeholder="e.g. Business Analyst"
            value={config.role}
            onChange={(e) => set("role", e.target.value)}
          />
        </div>
        <ChipGroup label="Seniority" options={SENIORITIES} value={config.seniority} onChange={(v) => set("seniority", v)} />
        <ChipGroup label="Interview round" options={ROUNDS} value={config.round} onChange={(v) => set("round", v)} />
        <div className="grid gap-5 sm:grid-cols-2">
          <ChipGroup
            label="Length"
            options={LENGTHS.map(String) as string[]}
            value={String(config.length)}
            onChange={(v) => set("length", Number(v))}
            suffix=" questions"
          />
          <ChipGroup label="Interviewer persona" options={PERSONAS} value={config.persona} onChange={(v) => set("persona", v)} capitalize />
        </div>

        {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={makePlan} disabled={planning || uploading}>
            {planning ? (
              <>
                <Spinner /> Analysing resume vs JD…
              </>
            ) : plan ? (
              "Re-plan"
            ) : (
              "Analyse & plan interview"
            )}
          </button>
          {provider?.configured && (
            <span className="text-xs text-muted">
              Using {provider.provider} · {provider.model}
            </span>
          )}
        </div>
      </div>

      {plan && (
        <section id="analysis" className="card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Pre-interview analysis</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted">{plan.analysis.summary}</p>
            </div>
            <button className="btn-primary" onClick={startInterview}>
              Start interview →
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <TagList title="Matched skills" items={plan.analysis.matchedSkills} tone="good" />
            <TagList title="Gaps vs JD" items={plan.analysis.gaps} tone="bad" />
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted">Resume claims to be probed</h3>
              <ul className="space-y-2 text-sm">
                {plan.analysis.claimsToProbe.map((c, i) => (
                  <li key={i} className="rounded-lg bg-panel-2 p-2.5">
                    <div>“{c.claim}”</div>
                    <div className="mt-1 text-xs text-muted">{c.why}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted">
            {plan.questions.length} questions planned. They stay hidden until the interview so it feels real. Works best in
            Chrome or Edge with a microphone; you can always type instead.
          </p>
        </section>
      )}

      {history.length > 0 && (
        <section className="card">
          <h2 className="mb-3 text-lg font-semibold">Past sessions</h2>
          <ul className="divide-y divide-line">
            {history.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {s.config.role} · {s.config.round}
                  </div>
                  <div className="text-xs text-muted">
                    {new Date(s.createdAt).toLocaleString()} · {s.config.seniority} · {s.config.persona}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {s.report ? (
                    <span className={`rounded-md px-2 py-0.5 text-xs ${verdictClass(s.report.verdict)}`}>
                      {s.report.overallScore}/100 · {s.report.verdict}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">{s.status === "planned" ? "not started" : "unfinished"}</span>
                  )}
                  <a
                    className="btn-ghost !px-3 !py-1.5"
                    href={s.report || s.status === "completed" ? `/report?id=${s.id}` : `/interview?id=${s.id}`}
                  >
                    {s.report ? "View" : "Resume"}
                  </a>
                  <button
                    className="btn-ghost !px-3 !py-1.5 text-muted"
                    aria-label="Delete session"
                    onClick={() => {
                      deleteSession(s.id);
                      setHistory(listSessions());
                    }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  suffix = "",
  capitalize,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  suffix?: string;
  capitalize?: boolean;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === value}
            className={`chip ${o === value ? "chip-on" : ""} ${capitalize ? "capitalize" : ""}`}
            onClick={() => onChange(o)}
          >
            {o}
            {suffix}
          </button>
        ))}
      </div>
    </div>
  );
}

function TagList({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-muted">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {items.length ? (
          items.map((s, i) => (
            <span key={i} className={`rounded-md px-2 py-1 text-xs ${tone === "good" ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>
              {s}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted">None</span>
        )}
      </div>
    </div>
  );
}
