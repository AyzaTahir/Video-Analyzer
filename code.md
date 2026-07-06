# Product Requirements Document (PRD)
## Video Analyzer — AI-Powered Video Summarization Platform

**Version:** 1.0
**Owner:** [Your Name]
**Status:** Draft — for iterative build (loop engineering with AI coding agents)
**Target Deployment:** Vercel (monorepo)

---

## 1. Executive Summary

Video Analyzer is a web platform that lets a user submit a video — either by **uploading an MP4 file** or **pasting a URL** (YouTube Shorts, long-form YouTube, or other supported hosts) — and receive an AI-generated **summary, step-by-step breakdown, and searchable transcript** of the content.

Internally, the pipeline extracts and compresses the video's audio track to MP3, transcribes it (Groq Whisper as primary, Gemini as automatic fallback), and runs the transcript through an LLM summarization chain to produce chapters, key steps, and a digestible summary. The frontend is built around a **Bento grid dashboard**, uses **Lottie animations** for processing/loading states, and can generate **auto-rendered highlight/summary video clips using Remotion**.

The system is built as a **Turborepo monorepo**, deployed on **Vercel**, with a lightweight external worker for long-running media/transcription jobs that exceed serverless function limits.

---

## 2. Goals & Success Metrics

| Goal | Metric |
|---|---|
| Fast, accurate summarization | <3 min processing time for a 20-min video; >90% transcript word accuracy |
| Reliable transcription | <1% total failure rate (Groq + Gemini fallback combined) |
| Delightful UX | Processing screen keeps users engaged (Lottie), dashboard feels premium (Bento grid) |
| Shareability | User can export/share a summary card or a Remotion-rendered highlight clip |
| Scalable architecture | Works for a 30-second Short and a 3-hour podcast without redesign |

---

## 3. Core User Flows

1. **Upload flow:** User drags in an `.mp4` → client compresses audio to MP3 (ffmpeg.wasm, in-browser) → uploads MP3 (not the full video) to storage → job queued → transcript → summary → results dashboard.
2. **URL flow:** User pastes a YouTube (or other) URL → backend worker resolves the URL via `yt-dlp`, extracts audio-only stream directly (no full video download needed) → same pipeline as above.
3. **Results flow:** User lands on a video's detail page: summary, chaptered steps, full transcript (searchable, timestamped), and an option to generate a shareable highlight reel via Remotion.

---

## 4. Feature Set

### 4.1 Core Features (MVP)
- MP4 upload with client-side audio extraction + MP3 compression (ffmpeg.wasm)
- YouTube URL ingestion (Shorts + long-form) via server-side `yt-dlp`
- Transcription: **Groq (Whisper large-v3-turbo) primary → Gemini 2.x (audio input) fallback** on error/timeout/rate-limit
- LLM summarization: TL;DR summary + numbered "steps explained in the video" + auto-chapters with timestamps
- Dashboard (Bento grid) listing all analyzed videos with status (queued/processing/done/failed)
- Video detail page: summary, transcript, chapters, key quotes

### 4.2 Differentiator / Phase 2+ Features
- **Remotion-rendered highlight clip**: auto-select top N moments (via LLM ranking of transcript segments) and render a captioned vertical highlight video
- **Shareable summary card** (OG-image style, generated server-side) for social sharing
- Speaker diarization (who said what) — Groq/Gemini permitting
- Multi-language transcription + translated summaries
- "Ask the video" — chat Q&A grounded in the transcript (RAG over transcript chunks)
- Batch/playlist analysis (multiple URLs at once)
- Browser extension / bookmarklet to send a YouTube tab directly to the analyzer
- Usage-based API key system so users can plug in their own Groq/Gemini keys (BYO-key tier) vs. platform-provided keys (metered/paid tier)

---

## 5. UI/UX Design

### 5.1 Design Language
- **Bento grid** as the primary dashboard layout: variable-sized cards (recent video, processing status, quick stats, "paste a URL" quick-action card, latest highlight reel) — think Apple-keynote-style bento tiles, responsive down to mobile as a stacked single column.
- **Lottie animations** used for: idle/empty states, the "processing" screen (waveform/brain-scanning style animation while transcription + summarization run), and success/failure micro-interactions. Lottie files stored in `packages/ui/lottie/` and rendered via `lottie-react`.
- **Remotion** used for: (a) generating the auto highlight-reel deliverable, and (b) optionally rendering an animated "summary explainer" video composited from the bento data (title, key steps, waveform) — this doubles as a marketing-shareable asset.

### 5.2 Key Screens
1. **Home / New Analysis** — big paste-URL input + drag-and-drop upload zone, bento cards below showing recent analyses.
2. **Processing Screen** — Lottie animation, live status ticker ("Extracting audio → Transcribing (Groq) → Summarizing → Done"), progress bar backed by real job status polling (SWR/React Query).
3. **Dashboard** — bento grid of all past videos, filter/search, status badges.
4. **Video Detail** — left: video/audio player with synced transcript scroll; right: tabs for Summary / Steps / Chapters / Transcript; footer action bar: "Generate Highlight Reel (Remotion)", "Export PDF/Markdown", "Share".
5. **Settings** — API key management (Groq key, Gemini key — user's own or platform default), plan/usage.

---

## 6. System Architecture

### 6.1 Monorepo Structure (Turborepo, deployed on Vercel)

```
video-analyzer/
├── apps/
│   ├── web/                 # Next.js 15 app (App Router) — frontend + API routes
│   │   ├── app/
│   │   ├── components/
│   │   └── ...
│   └── worker/              # Long-running job worker (NOT on Vercel — see 6.3)
├── packages/
│   ├── ui/                  # Shared React components, Bento grid, Lottie wrapper
│   ├── remotion/             # Remotion compositions (highlight reel, summary video)
│   ├── db/                  # Drizzle ORM schema + client (shared by web + worker)
│   ├── ai/                  # Groq/Gemini client wrappers, prompt templates, fallback logic
│   ├── config/               # eslint, tsconfig, tailwind config
│   └── types/                # Shared TypeScript types/zod schemas
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

### 6.2 Why not 100% on Vercel serverless
Vercel functions have execution time limits (10s–800s depending on plan) and no persistent binaries like `ffmpeg`/`yt-dlp` guarantees across cold starts. Audio extraction from long videos and Groq/Gemini transcription of long files can exceed these limits. **Recommended pattern:**
- `apps/web` (Next.js) deployed on Vercel — handles UI, auth, upload URLs, DB reads, triggering jobs.
- `apps/worker` — a small long-running service (Railway, Fly.io, or Render) that runs `yt-dlp` + `ffmpeg`, calls Groq/Gemini, writes results back to the shared Postgres DB, and updates job status.
- Communication: Vercel enqueues a job (via **Inngest** or **QStash**, both Vercel-friendly) → worker picks it up → worker updates DB → frontend polls/subscribes (Supabase Realtime or simple polling) for status.
- **Client-side compression**: for uploaded files, use `ffmpeg.wasm` in the browser to strip video and compress to MP3 *before* upload — this avoids ever sending the raw MP4 to the server, saving bandwidth and worker time. For URL-based ingestion, the worker uses `yt-dlp -x --audio-format mp3` server-side.

### 6.3 High-Level Diagram (described)
`Browser (upload/URL) → Next.js API route (Vercel) → Job queue (Inngest/QStash) → Worker (Railway/Fly) → [ffmpeg / yt-dlp] → Groq API (primary) → (on failure) Gemini API (fallback) → Summarization LLM call → Postgres (Neon/Supabase) → Web app reads result → Remotion render (on-demand, worker or Vercel function with @remotion/renderer) → Storage (S3/Vercel Blob) → CDN delivery`

---

## 7. Backend / API Design

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/analyze/upload` | POST | Get a signed upload URL (Vercel Blob/S3) for a compressed MP3 |
| `/api/analyze/url` | POST | Submit a YouTube/other URL; enqueues extraction job |
| `/api/jobs/:id` | GET | Poll job status (queued/processing/transcribing/summarizing/done/failed) |
| `/api/videos` | GET | List user's analyzed videos (bento dashboard data) |
| `/api/videos/:id` | GET | Full detail: summary, chapters, transcript |
| `/api/videos/:id/highlight` | POST | Trigger Remotion render of a highlight reel |
| `/api/videos/:id/export` | GET | Export as PDF/Markdown |
| `/api/settings/keys` | POST/GET | Store/retrieve user's own Groq/Gemini API keys (encrypted) |
| `/api/webhooks/worker` | POST | Worker → web callback when a job completes/fails |

All routes validated with `zod`; auth via **Clerk** or **NextAuth** (Vercel-native options).

---

## 8. AI / Transcription & Summarization Pipeline

1. **Transcription — Groq primary:** `whisper-large-v3-turbo` via Groq API (fast, cheap, great for MP3). Timeout/retry policy: 2 retries with backoff.
2. **Fallback — Gemini:** if Groq errors, times out, or rate-limits, the same MP3 is sent to Gemini (`gemini-2.x` multimodal audio input) for transcription. This dual-key setup means **both `GROQ_API_KEY` and `GEMINI_API_KEY` are configured simultaneously**, with the `packages/ai` module implementing a `transcribe()` function that tries Groq first and transparently swaps to Gemini on failure — the frontend never knows which provider ran.
3. **Chunking for long videos:** transcripts over ~15k tokens are chunked and summarized map-reduce style (per-chunk summary → final reduce pass) to stay within context limits and keep chapter timestamps accurate.
4. **Summarization prompt output (structured JSON via function-calling/schema):**
   ```json
   {
     "tldr": "string",
     "chapters": [{ "title": "string", "start_ts": "00:00:00", "summary": "string" }],
     "steps": [{ "order": 1, "instruction": "string", "timestamp": "00:01:12" }],
     "key_quotes": ["string"]
   }
   ```
5. **Highlight ranking (Phase 2):** a secondary LLM pass scores transcript segments for "quotability/energy/informativeness" to pick clips for the Remotion highlight reel.

---

## 9. Database Schema (Postgres — Neon or Supabase, via Drizzle ORM)

```
users (id, email, plan, groq_key_encrypted, gemini_key_encrypted, created_at)

videos (
  id, user_id -> users.id, source_type ENUM('upload','url'),
  source_url, title, duration_seconds, thumbnail_url,
  audio_url, status ENUM('queued','extracting','transcribing','summarizing','done','failed'),
  error_message, created_at, updated_at
)

transcripts (id, video_id -> videos.id, provider ENUM('groq','gemini'), raw_text, segments JSONB, created_at)

summaries (id, video_id -> videos.id, tldr TEXT, chapters JSONB, steps JSONB, key_quotes JSONB, created_at)

jobs (id, video_id -> videos.id, type, status, attempts, last_error, created_at, updated_at)

highlight_reels (id, video_id -> videos.id, remotion_render_id, output_url, status, created_at)

api_usage (id, user_id -> users.id, provider, tokens_or_seconds, cost_estimate, created_at)
```

Indexes on `videos.user_id`, `videos.status`, `jobs.status` for dashboard/queue queries.

---

## 10. Tech Stack Summary

| Layer | Choice |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| UI kit | Custom Bento grid components, shadcn/ui primitives |
| Animation | Lottie (`lottie-react`), Framer Motion for micro-interactions |
| Video generation | Remotion (`@remotion/renderer`, `@remotion/lambda` optional for scaled rendering) |
| Client audio compression | ffmpeg.wasm |
| Server audio/video extraction | `yt-dlp` + native `ffmpeg` (on worker service) |
| Transcription | Groq (primary), Gemini (fallback) |
| Summarization LLM | Groq/Gemini or Claude/GPT via same `packages/ai` abstraction |
| Job queue | Inngest or QStash |
| Worker hosting | Railway / Fly.io / Render (persistent Node process with ffmpeg + yt-dlp binaries) |
| Database | Postgres (Neon or Supabase) + Drizzle ORM |
| File storage | Vercel Blob or S3-compatible (R2) |
| Auth | Clerk or NextAuth |
| Hosting | Vercel (web app), external host (worker) |

---

## 11. Phased Roadmap (for iterative "loop engineering")

**Phase 1 — Foundation (MVP skeleton)**
Monorepo scaffold, DB schema + migrations, auth, basic upload flow (no compression yet), Groq transcription only, plain-text summary output, minimal UI (no bento/lottie/remotion yet). *Acceptance: user can upload an MP4, wait, and see a text summary.*

**Phase 2 — Pipeline Hardening**
Add ffmpeg.wasm client-side compression, add `yt-dlp` URL ingestion via worker, add Gemini fallback logic, structured JSON summarization (chapters/steps), job status polling. *Acceptance: both upload and URL flows work end-to-end with fallback tested by force-failing Groq.*

**Phase 3 — Experience Layer**
Build Bento grid dashboard, integrate Lottie processing animations, video detail page with synced transcript, export (PDF/Markdown). *Acceptance: full polished UX matching design goals.*

**Phase 4 — Remotion & Sharing**
Highlight-reel generation pipeline (segment ranking + Remotion render + storage), shareable summary cards, social share flow. *Acceptance: user can generate and download/share a rendered highlight clip.*

**Phase 5 — Scale & Monetization**
BYO API key settings, usage metering/billing, multi-language support, "Ask the video" chat, speaker diarization, playlist/batch mode.

Each phase should ship independently deployable and testable — ideal checkpoints for an AI coding agent loop (build → test → review → next phase).

---

## 12. Risks & Open Questions

- **Vercel execution limits** for anything long-running — mitigated by external worker (must be decided early, affects architecture).
- **YouTube ToS/`yt-dlp` reliability** — YouTube extraction can break with platform changes; needs monitoring/update strategy.
- **Cost control** on Groq/Gemini for long videos — needs usage caps per plan tier.
- **Copyright** — summarizing third-party video content; ensure ToS clarifies fair-use/personal-use framing.
- Decide early: **Inngest vs QStash** for queueing, and **Railway vs Fly.io** for the worker — both are "loop-friendly" (fast redeploys) so either works; pick based on team familiarity.

---

## 13. Environment Variables (reference)

```
GROQ_API_KEY=
GEMINI_API_KEY=
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=      # or S3/R2 credentials
NEXT_PUBLIC_APP_URL=
CLERK_SECRET_KEY= / NEXTAUTH_SECRET=
INNGEST_EVENT_KEY= / QSTASH_TOKEN=
WORKER_CALLBACK_SECRET=
REMOTION_RENDER_BUCKET=
```

---

*End of PRD — ready to be broken into engineering tickets per phase.*