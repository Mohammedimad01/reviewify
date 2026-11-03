"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Text-to-speech: sentence-chunked so speech starts while streaming   */
/* ------------------------------------------------------------------ */

const VOICE_PREFS = [
  /natural/i, // Edge neural voices, e.g. "Microsoft Aria Online (Natural)"
  /google us english/i,
  /google uk english female/i,
  /samantha/i,
  /aria|jenny|guy|libby|sonia/i,
  /google uk english male/i,
  /daniel|karen|moira|tessa/i,
];

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang) || v.lang === "en");
  for (const re of VOICE_PREFS) {
    const v = en.find((x) => re.test(x.name));
    if (v) return v;
  }
  return en.find((v) => /en[-_]US/i.test(v.lang)) ?? en[0] ?? null;
}

export function useSpeaker() {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string>("");
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const mutedRef = useRef(false);
  const pending = useRef(0);
  const live = useRef<SpeechSynthesisUtterance[]>([]); // keep refs: Chrome GC bug drops onend otherwise
  const buffer = useRef("");
  const streamDone = useRef(true);
  const waiters = useRef<(() => void)[]>([]);
  const keepAlive = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    const load = () => {
      const vs = window.speechSynthesis.getVoices();
      if (!vs.length) return;
      setVoices(vs.filter((v) => /^en/i.test(v.lang)));
      let saved = "";
      try {
        saved = localStorage.getItem("reviewify.voice") || "";
      } catch {}
      const v = vs.find((x) => x.name === saved) ?? pickVoice(vs);
      voiceRef.current = v;
      setVoiceName(v?.name ?? "");
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, []);

  const chooseVoice = useCallback(
    (name: string) => {
      const v = voices.find((x) => x.name === name) ?? null;
      voiceRef.current = v;
      setVoiceName(name);
      try {
        localStorage.setItem("reviewify.voice", name);
      } catch {}
    },
    [voices],
  );

  const settle = useCallback(() => {
    if (pending.current === 0 && streamDone.current) {
      setSpeaking(false);
      if (keepAlive.current) clearInterval(keepAlive.current);
      keepAlive.current = null;
      const w = waiters.current;
      waiters.current = [];
      w.forEach((f) => f());
    }
  }, []);

  const speakNow = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || !supported || mutedRef.current) return;
      const u = new SpeechSynthesisUtterance(t);
      if (voiceRef.current) {
        u.voice = voiceRef.current;
        u.lang = voiceRef.current.lang;
      } else u.lang = "en-US";
      u.rate = 1.0;
      u.pitch = 1.0;
      pending.current++;
      live.current.push(u);
      const done = () => {
        pending.current = Math.max(0, pending.current - 1);
        live.current = live.current.filter((x) => x !== u);
        settle();
      };
      u.onend = done;
      u.onerror = done;
      setSpeaking(true);
      window.speechSynthesis.speak(u);
      // Chrome pauses long queues after ~15s; nudging resume() keeps it going.
      if (!keepAlive.current) {
        keepAlive.current = setInterval(() => {
          if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          }
        }, 10000);
      }
    },
    [supported, settle],
  );

  /** Begin a new streamed utterance. */
  const begin = useCallback(() => {
    buffer.current = "";
    streamDone.current = false;
  }, []);

  /** Feed streamed text; complete sentences are spoken immediately. */
  const push = useCallback(
    (chunk: string) => {
      buffer.current += chunk;
      const re = /^([\s\S]*?[.!?]["')\]]?)(\s+)/;
      let m: RegExpMatchArray | null;
      while ((m = buffer.current.match(re))) {
        // Need a few words before speaking to avoid choppy "Okay." fragments at the start.
        if (m[1].trim().length < 3) break;
        speakNow(m[1]);
        buffer.current = buffer.current.slice(m[0].length);
      }
    },
    [speakNow],
  );

  /** Stream finished: speak any remainder. Resolves when all speech has ended. */
  const end = useCallback((): Promise<void> => {
    speakNow(buffer.current);
    buffer.current = "";
    streamDone.current = true;
    return new Promise<void>((resolve) => {
      waiters.current.push(resolve);
      settle();
    });
  }, [speakNow, settle]);

  const cancel = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    pending.current = 0;
    live.current = [];
    buffer.current = "";
    streamDone.current = true;
    settle();
  }, [supported, settle]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current && supported) {
      window.speechSynthesis.cancel();
    }
  }, [supported]);

  return { supported, voices, voiceName, chooseVoice, speaking, muted, toggleMute, begin, push, end, cancel };
}

/* ------------------------------------------------------------------ */
/* Speech recognition: continuous, interim results, silence auto-stop  */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any;

function getSRCtor(): (new () => SR) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useRecognizer(opts: { silenceMs?: number; onAutoStop?: (text: string) => void }) {
  const silenceMs = opts.silenceMs ?? 3000;
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rec = useRef<SR | null>(null);
  const want = useRef(false);
  const committed = useRef(""); // text from earlier recognition sessions (Chrome restarts)
  const sessionFinal = useRef("");
  const sessionInterim = useRef("");
  const resultCount = useRef(0); // results seen in the current session
  const skipBefore = useRef(0); // ignore results before this index (after a reset)
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAutoStop = useRef(opts.onAutoStop);
  onAutoStop.current = opts.onAutoStop;

  useEffect(() => {
    setSupported(!!getSRCtor());
    return () => {
      want.current = false;
      try {
        rec.current?.abort();
      } catch {}
    };
  }, []);

  const fullText = () => [committed.current, sessionFinal.current, sessionInterim.current].join(" ").replace(/\s+/g, " ").trim();

  const clearSilence = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  };

  const stop = useCallback((): string => {
    want.current = false;
    clearSilence();
    try {
      rec.current?.stop();
    } catch {}
    const text = fullText();
    setListening(false);
    setInterim("");
    setFinalText(text);
    return text;
  }, []);

  const armSilence = useCallback(() => {
    clearSilence();
    silenceTimer.current = setTimeout(() => {
      if (!want.current) return;
      const text = fullText();
      if (!text) return; // nothing said yet: keep waiting
      const t = stop();
      onAutoStop.current?.(t);
    }, silenceMs);
  }, [silenceMs, stop]);

  const startSession = useCallback(() => {
    const Ctor = getSRCtor();
    if (!Ctor) return;
    const r: SR = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.maxAlternatives = 1;
    sessionFinal.current = "";
    sessionInterim.current = "";
    resultCount.current = 0;
    skipBefore.current = 0;

    r.onresult = (e: any) => {
      let fin = "";
      let int = "";
      resultCount.current = e.results.length;
      for (let i = skipBefore.current; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript + " ";
        else int += res[0].transcript + " ";
      }
      sessionFinal.current = fin.trim();
      sessionInterim.current = int.trim();
      setFinalText([committed.current, sessionFinal.current].join(" ").trim());
      setInterim(sessionInterim.current);
      armSilence();
    };
    r.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // onend will restart
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        want.current = false;
        setError("Microphone access was blocked. Allow the mic in your browser, or type your answer instead.");
      } else if (e.error === "audio-capture") {
        want.current = false;
        setError("No microphone found. Type your answer instead.");
      } else if (e.error === "network") {
        setError("Speech recognition needs an internet connection (Chrome sends audio to Google). Retrying…");
      }
    };
    r.onend = () => {
      // Chrome ends sessions on its own (silence, ~60s limit). Keep listening if we still want to.
      committed.current = [committed.current, sessionFinal.current, sessionInterim.current].join(" ").replace(/\s+/g, " ").trim();
      sessionFinal.current = "";
      sessionInterim.current = "";
      if (want.current) {
        try {
          startSession();
        } catch {
          setTimeout(() => want.current && startSession(), 250);
        }
      } else {
        setListening(false);
      }
    };
    rec.current = r;
    r.start();
  }, [armSilence]);

  const start = useCallback(() => {
    if (!getSRCtor()) return;
    setError(null);
    committed.current = "";
    setFinalText("");
    setInterim("");
    want.current = true;
    setListening(true);
    try {
      startSession();
    } catch (e) {
      setError("Couldn't start the microphone: " + (e as Error).message);
      want.current = false;
      setListening(false);
    }
  }, [startSession]);

  const reset = useCallback(() => {
    skipBefore.current = resultCount.current;
    committed.current = "";
    sessionFinal.current = "";
    sessionInterim.current = "";
    setFinalText("");
    setInterim("");
  }, []);

  /** Abort without returning text (e.g., ending the interview). */
  const abort = useCallback(() => {
    want.current = false;
    clearSilence();
    try {
      rec.current?.abort();
    } catch {}
    setListening(false);
  }, []);

  return { supported, listening, finalText, interim, error, start, stop, abort, reset };
}
