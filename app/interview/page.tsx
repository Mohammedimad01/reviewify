"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRecognizer, useSpeaker } from "@/hooks/useSpeech";
import { getSession, saveSession } from "@/lib/storage";
import { computeStats } from "@/lib/stats";
import { formatClock, Spinner } from "@/components/ui";
import type { Session, Turn } from "@/lib/types";

type Status = "ready" | "thinking" | "speaking" | "listening" | "typing" | "finishing" | "error";
type Action = "followup" | "next" | "end";

export default function InterviewPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Room />
    </Suspense>
  );
}

/** Where are we in the plan, derived from the transcript (so refresh/resume works). */
function position(t: Turn[]) {
  const lastQ = [...t].reverse().find((x) => x.speaker === "interviewer");
  if (!lastQ) return { currentIndex: 0, followUpsUsed: 0 };
  const idx = lastQ.questionIndex;
  const followUpsUsed = t.filter((x) => x.speaker === "interviewer" && x.questionIndex === idx && x.isFollowUp).length;
  return { currentIndex: idx, followUpsUsed };
}

function Room() {
  const router = useRouter();
  const id = useSearchParams().get("id") || "";
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const sessRef = useRef<Session | null>(null);

  const [status, _setStatus] = useState<Status>("ready");
  const statusRef = useRef<Status>("ready");
  const setStatus = (s: Status) => {
    statusRef.current = s;
    _setStatus(s);
  };
  const [liveText, setLiveText] = useState("");
  const [typed, setTyped] = useState("");
  const [preferText, setPreferText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const answerStart = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastPhase = useRef<"start" | "answer">("start");

  const speakerHook = useSpeaker();
  const speakerRef = useRef(speakerHook);
  speakerRef.current = speakerHook;
  const submitRef = useRef<(t: string) => void>(() => {});
  const recogHook = useRecognizer({ silenceMs: 3000, onAutoStop: (t) => submitRef.current(t) });
  const recogRef = useRef(recogHook);
  recogRef.current = recogHook;
  // Inside callbacks use the refs so we never call a stale closure.
  const speaker = speakerHook;
  const recog = recogHook;
  const voiceMode = recog.supported === true && !preferText;
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;

  useEffect(() => {
    const s = getSession(id);
    if (s?.status === "completed") {
      router.replace(`/report?id=${id}`);
      return;
    }
    sessRef.current = s ?? null;
    setSession(s ?? null);
    setLoaded(true);
  }, [id, router]);

  // Interview timer
  useEffect(() => {
    if (!session?.startedAt || status === "ready" || status === "finishing") return;
    const tick = () => setElapsed((Date.now() - (sessRef.current?.startedAt ?? Date.now())) / 1000);
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [session?.startedAt, status]);

  // Clean up on unmount
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const update = useCallback((s: Session) => {
    sessRef.current = s;
    setSession(s);
    saveSession(s);
  }, []);

  const finish = useCallback(() => {
    const s = sessRef.current;
    if (!s) return;
    setStatus("finishing");
    recogRef.current.abort();
    update({ ...s, status: "completed", endedAt: Date.now(), stats: computeStats(s.transcript) });
    router.push(`/report?id=${s.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, update]);

  const beginAnswer = useCallback(() => {
    answerStart.current = Date.now();
    setTyped("");
    recogRef.current.reset();
    if (voiceModeRef.current && !recogRef.current.error) {
      recogRef.current.start();
      setStatus("listening");
    } else {
      setStatus("typing");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestTurn = useCallback(
    async (phase: "start" | "answer") => {
      const s = sessRef.current;
      if (!s) return;
      lastPhase.current = phase;
      const { currentIndex, followUpsUsed } = position(s.transcript);
      setStatus("thinking");
      setError(null);
      setLiveText("");
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let action: Action = "next";
      let text = "";
      try {
        const res = await fetch("/api/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            config: s.config,
            resume: s.resume,
            analysis: s.plan.analysis,
            questions: s.plan.questions,
            transcript: s.transcript,
            phase,
            currentIndex,
            followUpsUsed,
          }),
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let head = "";
        let gotHeader = false;
        let streamErr = "";
        speakerRef.current.begin();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          let chunk = dec.decode(value, { stream: true });
          if (!gotHeader) {
            head += chunk;
            const nl = head.indexOf("\n");
            if (nl === -1) continue;
            try {
              action = (JSON.parse(head.slice(0, nl)).action as Action) || "next";
            } catch {
              action = "next";
            }
            gotHeader = true;
            chunk = head.slice(nl + 1);
          }
          const errAt = chunk.indexOf("[[ERROR]]");
          if (errAt !== -1) {
            streamErr = chunk.slice(errAt + 9).trim() || "The AI stream failed.";
            chunk = chunk.slice(0, errAt);
          }
          if (chunk) {
            text += chunk;
            setLiveText(text);
            if (statusRef.current === "thinking") setStatus("speaking");
            speakerRef.current.push(chunk);
          }
          if (streamErr) break;
        }
        if (streamErr && !text.trim()) throw new Error(streamErr);
        if (!text.trim()) throw new Error("The interviewer returned an empty response.");

        const speechDone = speakerRef.current.end();
        setStatus("speaking");
        const latest = sessRef.current!;
        const qIndex =
          phase === "start" ? 0 : action === "next" ? Math.min(currentIndex + 1, latest.plan.questions.length - 1) : currentIndex;
        const turn: Turn = {
          speaker: "interviewer",
          text: text.trim(),
          questionIndex: qIndex,
          isFollowUp: action === "followup",
          at: Date.now(),
        };
        update({
          ...latest,
          status: "in-progress",
          startedAt: latest.startedAt ?? Date.now(),
          transcript: [...latest.transcript, turn],
        });
        await speechDone;
        if (ctrl.signal.aborted) return;
        if (action === "end") return finish();
        beginAnswer();
      } catch (e) {
        if (ctrl.signal.aborted) return;
        speakerRef.current.cancel();
        setError((e as Error).message);
        setStatus("error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beginAnswer, finish, update],
  );

  const submitAnswer = useCallback(
    (raw: string) => {
      if (statusRef.current !== "listening" && statusRef.current !== "typing") return;
      recogRef.current.abort();
      const s = sessRef.current!;
      const { currentIndex } = position(s.transcript);
      const text = raw.trim() || "(The candidate did not answer.)";
      const turn: Turn = {
        speaker: "candidate",
        text,
        questionIndex: currentIndex,
        durationSec: Math.round((Date.now() - answerStart.current) / 1000),
        at: Date.now(),
      };
      update({ ...s, transcript: [...s.transcript, turn] });
      setTyped("");
      recogRef.current.reset();
      requestTurn("answer");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestTurn, update],
  );
  submitRef.current = submitAnswer;

  function start() {
    // Prime speech synthesis inside the click (needed on Safari/iOS).
    try {
      if ("speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    } catch {}
    const s = sessRef.current!;
    if (!s.transcript.length) return requestTurn("start");
    const last = s.transcript[s.transcript.length - 1];
    if (last.speaker === "candidate") return requestTurn("answer");
    setLiveText(last.text);
    beginAnswer();
  }

  function endEarly() {
    if (!confirm("End the interview now and get feedback on the questions answered so far?")) return;
    abortRef.current?.abort();
    speaker.cancel();
    finish();
  }

  function switchToText() {
    if (statusRef.current === "listening") {
      const t = recog.stop();
      setTyped(t);
      setStatus("typing");
    }
    setPreferText(true);
  }

  function switchToVoice() {
    setPreferText(false);
    if (statusRef.current === "typing" && recog.supported) {
      recog.reset();
      recog.start();
      setStatus("listening");
    }
  }

  // If the mic fails mid-interview, drop into typing.
  useEffect(() => {
    if (recog.error && statusRef.current === "listening" && !recog.listening) setStatus("typing");
  }, [recog.error, recog.listening]);

  if (!loaded) return <p className="text-muted">Loading…</p>;
  if (!session)
    return (
      <div className="card text-sm">
        Session not found. <a className="text-accent hover:underline" href="/">Set up a new interview</a>.
      </div>
    );

  const total = session.plan.questions.length;
  const { currentIndex, followUpsUsed } = position(session.transcript);
  const lastInterviewer = [...session.transcript].reverse().find((t) => t.speaker === "interviewer");
  const shownQuestion = liveText || lastInterviewer?.text || "";
  const answerText = [recog.finalText, recog.interim].filter(Boolean).join(" ");
  const started = session.transcript.length > 0;

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-panel-2 px-2.5 py-1 font-medium">
            Question {Math.min(currentIndex + 1, total)} / {total}
            {followUpsUsed > 0 && lastInterviewer?.isFollowUp && <span className="text-muted"> · follow-up</span>}
          </span>
          <span className="font-mono tabular-nums text-muted">{formatClock(elapsed)}</span>
        </div>
        <div className="flex items-center gap-2">
          {speaker.supported && speaker.voices.length > 0 && (
            <select
              className="input !w-auto max-w-[11rem] !py-1.5 text-xs"
              value={speaker.voiceName}
              onChange={(e) => speaker.chooseVoice(e.target.value)}
              aria-label="Interviewer voice"
            >
              {speaker.voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
          {speaker.supported && (
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={speaker.toggleMute}>
              {speaker.muted ? "🔇 Voice off" : "🔊 Voice on"}
            </button>
          )}
          {started && status !== "finishing" && (
            <button className="btn-ghost !px-3 !py-1.5 text-xs text-bad" onClick={endEarly}>
              End
            </button>
          )}
        </div>
      </div>

      {recog.supported === false && (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          Voice answers aren’t supported in this browser (speech recognition works best in Chrome or Edge on desktop). You
          can still do the interview: the interviewer will speak{speaker.supported ? "" : " (as text)"} and you type your
          answers.
        </div>
      )}
      {recog.error && <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">{recog.error}</div>}

      {/* Stage */}
      <div className="card flex flex-col items-center gap-5 py-8 text-center">
        <Indicator status={status} />
        <div className="text-xs uppercase tracking-widest text-muted">{statusLabel(status, session.config.persona)}</div>
        <p className="max-w-2xl text-lg leading-relaxed sm:text-xl">
          {shownQuestion || (
            <span className="text-muted">
              Your {session.config.persona} interviewer is ready. {session.plan.questions.length} questions ·{" "}
              {session.config.round}.
            </span>
          )}
        </p>

        {status === "ready" && (
          <button className="btn-primary px-6 py-3 text-base" onClick={start}>
            {started ? "Resume interview" : "Start interview"}
          </button>
        )}
        {status === "error" && (
          <div className="space-y-3">
            <p className="text-sm text-bad">{error}</p>
            <div className="flex justify-center gap-2">
              <button className="btn-primary" onClick={() => requestTurn(lastPhase.current)}>
                Retry
              </button>
              {started && (
                <button className="btn-ghost" onClick={finish}>
                  Finish & get report
                </button>
              )}
            </div>
          </div>
        )}
        {status === "finishing" && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Wrapping up…
          </p>
        )}
      </div>

      {/* Answer area */}
      {(status === "listening" || status === "typing") && (
        <div className="card space-y-3">
          {status === "listening" ? (
            <>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Your answer (live transcript) — stops automatically after ~3s of silence</span>
                <button className="text-accent hover:underline" onClick={switchToText}>
                  Type instead
                </button>
              </div>
              <div className="min-h-24 rounded-xl bg-panel-2 p-3 text-left text-sm leading-relaxed">
                {recog.finalText}
                {recog.interim && <span className="text-muted"> {recog.interim}</span>}
                {!answerText && <span className="text-muted">Listening… start speaking.</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => submitAnswer(recog.stop())}>
                  Done answering
                </button>
                <button className="btn-ghost" onClick={() => recog.reset()} disabled={!answerText}>
                  Clear & restart answer
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Type your answer (Ctrl/⌘ + Enter to send)</span>
                {recog.supported && !recog.error && (
                  <button className="text-accent hover:underline" onClick={switchToVoice}>
                    Answer by voice
                  </button>
                )}
              </div>
              <textarea
                autoFocus
                className="input h-36 resize-y"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAnswer(typed);
                }}
                placeholder="Type your answer…"
              />
              <button className="btn-primary" onClick={() => submitAnswer(typed)} disabled={!typed.trim()}>
                Send answer
              </button>
            </>
          )}
        </div>
      )}

      {/* Transcript */}
      {started && (
        <div className="card">
          <button className="text-sm text-muted hover:text-fg" onClick={() => setShowLog((v) => !v)}>
            {showLog ? "▾ Hide" : "▸ Show"} conversation ({session.transcript.length} turns)
          </button>
          {showLog && (
            <ol className="mt-3 space-y-3 text-sm">
              {session.transcript.map((t, i) => (
                <li key={i} className={t.speaker === "candidate" ? "pl-4 sm:pl-10" : ""}>
                  <div className="mb-0.5 text-xs text-muted">{t.speaker === "interviewer" ? "Interviewer" : "You"}</div>
                  <div className={`rounded-xl p-3 ${t.speaker === "candidate" ? "bg-accent/10" : "bg-panel-2"}`}>{t.text}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function statusLabel(s: Status, persona: string) {
  switch (s) {
    case "ready":
      return "Ready when you are";
    case "thinking":
      return "Interviewer is thinking…";
    case "speaking":
      return "Interviewer speaking";
    case "listening":
      return "Listening to you";
    case "typing":
      return "Your turn";
    case "finishing":
      return "Interview complete";
    case "error":
      return "Something went wrong";
    default:
      return persona;
  }
}

function Indicator({ status }: { status: Status }) {
  if (status === "speaking") {
    return (
      <div className="eq flex h-16 items-end gap-1.5" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="block h-full w-2.5 rounded-full bg-accent" />
        ))}
      </div>
    );
  }
  if (status === "listening") {
    return (
      <div className="relative flex h-16 w-16 items-center justify-center text-good" aria-hidden>
        <span className="ring-pulse absolute inset-0 rounded-full" />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-good text-2xl text-black">🎙</span>
      </div>
    );
  }
  if (status === "thinking" || status === "finishing") {
    return (
      <div className="flex h-16 items-center gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-3 w-3 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    );
  }
  return <div className="h-16 w-16 rounded-full border-2 border-line bg-panel-2" aria-hidden />;
}
