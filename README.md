# Reviewify: AI voice mock interviews

A voice-based mock interview app. Upload your resume and paste a job description. The AI compares the two, plans a targeted interview, and runs it out loud: it speaks each question, listens to your answer, and asks follow-ups. At the end you get a scored report with STAR-structured improved answers built from your real resume.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Web Speech API · Claude / Gemini / any OpenAI-compatible model · deploys on Vercel.

## Features

- **Setup:** upload a PDF or DOCX resume (text is extracted on the server) or paste it. Paste the JD, then pick the role, seniority, round (HR, Behavioral, Case, SQL, Excel, Python, Power BI, Mixed), length (5/10/15) and persona (friendly/neutral/tough).
- **Planning:** the app compares your resume against the JD and lists matched skills, gaps and resume claims to probe. It then writes a JSON interview plan: each question has a type, a target, and what a strong answer contains. The questions stay hidden so the interview feels real.
- **Live interview:**
  - The interviewer speaks with `speechSynthesis` and picks a natural English voice (you can change it).
  - Its replies stream from the model and are spoken sentence by sentence, so speech starts almost at once.
  - You answer with `SpeechRecognition` (continuous, with interim text shown live). It stops on its own after about 3 seconds of silence. There is also a **Done answering** button, and you can type instead.
  - After each answer the model decides whether to ask one follow-up or move on. A follow-up comes when an answer is vague, has no metric, or contradicts the resume. The server allows at most 2 follow-ups per question.
  - It shows a speaking/listening indicator, a question counter and a timer. Progress is saved after every turn, so a page refresh can resume.
- **Report:**
  - Overall score out of 100 and a hire / borderline / no-hire verdict.
  - For each question: a score out of 10, what was good, what was missing, and an improved answer in STAR form. Improved answers use only facts from your resume or transcript; unknown numbers become placeholders like `[your % improvement]`.
  - Communication stats: filler-word count, words per answer, answer length and time, plus notes on rambling.
  - Top 3 gaps against the JD, with what to prepare next.
  - **PDF download** of the report and transcript.
  - Past sessions are saved in `localStorage`.
- **Fallbacks:** if the browser has no SpeechRecognition (Firefox, and Safari in some setups), the app says so and switches to typed answers. Speech recognition works best in **Chrome or Edge**.

## Which AI provider? (Claude, Gemini, or open source)

All three work. Pick one with environment variables. Keys are read **only on the server** (in route handlers) and never reach the browser.

| Provider | Env vars | Notes |
|---|---|---|
| **Anthropic Claude** | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`) | Uses the official `@anthropic-ai/sdk`. Live turns run at low effort for speed; planning and grading run at medium. The server-side refusal fallback (`fallbacks: "default"`) is turned on. |
| **Google Gemini** (AI Studio) | `GEMINI_API_KEY`, optional `GEMINI_MODEL` (default `gemini-2.5-flash`) | Get a key at https://aistudio.google.com/apikey. Thinking is turned off for live turns so replies come back fast. Uses JSON mode for the plan and report. |
| **Open-source / OpenAI-compatible** | `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | Works with Groq (`https://api.groq.com/openai/v1`, e.g. `llama-3.3-70b-versatile`), OpenRouter, Together, OpenAI, or a local **Ollama** (`http://localhost:11434/v1`) or LM Studio. Use a 70B-class model or larger for good plans and grading. Small local models often produce weak JSON. |
| **Mock** | `LLM_PROVIDER=mock` | Canned offline responses, so you can try the whole UI without any key. |

If `LLM_PROVIDER` is empty, the app uses the first provider that has a key, in this order: Anthropic, Gemini, OpenAI-compatible. Visit `/api/health` to see which provider and model are active (the key is never shown).

**A Gemini key alone is enough.** Set `GEMINI_API_KEY` and nothing else.

## Local setup

Requires Node 20 or newer.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Edit `.env.local` and set ONE provider (for example `GEMINI_API_KEY=...`). Then start the dev server:

```bash
npm run dev
```

Open http://localhost:3000 in Chrome or Edge and allow microphone access. Click **Load sample** to try a ready-made resume and JD.

## Deploy to Vercel

1. Push this repo to GitHub.
2. On https://vercel.com/new, import the repo. The framework is detected as Next.js, and no build settings need changing.
3. In **Settings → Environment Variables**, add your provider's variables (for example `GEMINI_API_KEY`, or `ANTHROPIC_API_KEY`). Optionally add `LLM_PROVIDER` and the `*_MODEL` overrides.
4. Deploy. The site is served over HTTPS, which browsers require for microphone access.

Or use the CLI:

```bash
npx vercel
```

```bash
npx vercel env add GEMINI_API_KEY
```

```bash
npx vercel --prod
```

Notes:
- The route handlers set `maxDuration` to 60–180 s. Vercel's default (Fluid compute) allows this on every plan. If you use legacy functions on the Hobby plan, lower these values to 60.
- Vercel caps request bodies at 4.5 MB, so resume uploads are limited to 4 MB.

## Project structure

```
app/
  page.tsx               Setup screen + past sessions
  interview/page.tsx     Live voice interview loop
  report/page.tsx        Feedback report + PDF download
  api/extract/route.ts   PDF/DOCX -> text (unpdf, mammoth)
  api/plan/route.ts      Resume-vs-JD analysis + interview plan (JSON)
  api/turn/route.ts      Streaming interviewer turn (follow-up / next / end)
  api/report/route.ts    Final grading (JSON)
  api/health/route.ts    Shows the configured provider/model
lib/
  prompts.ts             ALL prompts. Tune the interviewer, planner and grader here
  llm.ts                 Provider layer (Anthropic SDK, Gemini REST, OpenAI-compatible, mock)
  validate.ts            Input validation + sanitising model JSON
  stats.ts               Filler words / answer-length stats
  storage.ts             localStorage sessions
  pdf.ts                 jsPDF report export
hooks/useSpeech.ts       speechSynthesis queue + SpeechRecognition with silence detection
samples/                 Sample resume + JD used for testing
```

## Tuning

- **Prompts:** everything is in `lib/prompts.ts`. That includes persona styles, the round-specific focus areas, the follow-up policy, the grading calibration and the "never invent experience" rule.
- **Max follow-ups:** `MAX_FOLLOWUPS_PER_QUESTION` in `lib/prompts.ts`. The server enforces it.
- **Silence timeout:** `silenceMs` in `app/interview/page.tsx` (default 3000 ms).
- **Voice:** choose one from the dropdown during the interview; your choice is remembered. The best voices are Edge's "Natural" voices and Chrome's "Google US English".

## How the turn protocol works

`POST /api/turn` streams plain text. The first line is a JSON header such as `{"action":"followup"|"next"|"end"}`, and everything after it is what the interviewer says. The model is asked to start its reply with an action tag (`[FOLLOWUP]`, `[NEXT]` or `[END]`). The server parses the tag and enforces the follow-up cap before forwarding text, so the browser can start speaking right away. The client works out its place in the plan from the saved transcript, which is why resuming after a refresh works.

## Privacy

Your resume, the JD and your transcripts are stored only in your browser's `localStorage`. They are sent to the server only to call the AI provider you configured. Browser speech recognition in Chrome sends audio to Google's speech service.
