import os
import uuid
import time
import json
import asyncio
import tempfile
import subprocess
from typing import Dict, List, Optional
from pathlib import Path

from pydantic import BaseModel, HttpUrl
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv

# ── Load environment variables ───────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env"))

GROQ_API_KEY   = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# ── API clients (initialised lazily so missing keys don't crash startup) ─────
_groq_client   = None
_gemini_model  = None

def get_groq():
    global _groq_client
    if _groq_client is None:
        from groq import Groq
        _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client

def get_gemini():
    global _gemini_model
    if _gemini_model is None:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        _gemini_model = genai.GenerativeModel("gemini-1.5-flash")
    return _gemini_model

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Vidlytics API Server",
    description="Serves Vidlytics landing pages, bento dashboard, and runs real Groq + Gemini pipelines.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# ── In-memory store ───────────────────────────────────────────────────────────
VIDEOS: Dict[str, dict] = {
    "vid-1": {
        "id": "vid-1",
        "title": "Build your GTM automation using Revenue Agents",
        "duration_seconds": 182,
        "thumbnail_url": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=60",
        "status": "done",
        "source_type": "url",
        "source_url": "https://www.youtube.com/watch?v=attio-gtm",
        "created_at": "2026-07-01T10:00:00Z",
        "summary": {
            "tldr": "This video outlines how Attio's new Revenue Agents automate pipeline creation, capture intent signals, and connect outreach programs natively without third-party integrations.",
            "chapters": [
                {"title": "Introduction to GTM Agents",  "start_ts": "00:00", "summary": "Setting the stage for intelligent pipelines that act around the clock."},
                {"title": "The Dotted Grid Engine",       "start_ts": "01:15", "summary": "Deep dive into visual workflow connections and automated condition routers."},
                {"title": "Live Customer Case Studies",   "start_ts": "02:30", "summary": "Railway head of marketing shares how the team automates pipeline updates."}
            ],
            "steps": [
                {"order": 1, "instruction": "Initialize your Attio workspace data model with custom objects.", "timestamp": "00:25"},
                {"order": 2, "instruction": "Define your custom workflows and set the trigger criteria for deal value changes.", "timestamp": "01:45"},
                {"order": 3, "instruction": "Connect cold outreach tasks to auto-draft emails using CrewAI copywriters.", "timestamp": "02:10"}
            ],
            "key_quotes": [
                "Intelligent GTM agents don't just log details; they operate active pipelines while you sleep.",
                "Moving away from static spreadsheets to live context graphs is the standard for modern developers."
            ]
        }
    },
    "vid-2": {
        "id": "vid-2",
        "title": "Gemini 2.5 Multimodal Audio & Video Input Guide",
        "duration_seconds": 712,
        "thumbnail_url": "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&auto=format&fit=crop&q=60",
        "status": "done",
        "source_type": "url",
        "source_url": "https://www.youtube.com/watch?v=gemini-multimodal",
        "created_at": "2026-06-30T14:22:15Z",
        "summary": {
            "tldr": "A technical review of feeding raw MP3 audio directly into Gemini's multi-modal architecture. Demonstrates Whisper fallback patterns and context window optimisations.",
            "chapters": [
                {"title": "Multimodal Input Basics", "start_ts": "00:00", "summary": "Overview of direct audio analysis capabilities without text transcription first."},
                {"title": "Fallback Protocols",       "start_ts": "04:20", "summary": "Designing custom middleware to switch to Gemini if Groq API rate limits are hit."},
                {"title": "Performance Benchmark",    "start_ts": "09:40", "summary": "Analysing latency, cost efficiency, and accuracy variations between models."}
            ],
            "steps": [
                {"order": 1, "instruction": "Encode your audio payload to base64 or stream it directly via the API.", "timestamp": "01:10"},
                {"order": 2, "instruction": "Integrate error wrappers to detect HTTP 429 status codes from Whisper endpoints.", "timestamp": "05:05"},
                {"order": 3, "instruction": "Run parallel testing with low bitrates to reduce payload latency.", "timestamp": "10:15"}
            ],
            "key_quotes": [
                "Direct audio comprehension avoids transcription information loss, allowing tone detection.",
                "Whisper plus Gemini is the ultimate stack for 99.9% uptime transcription pipelines."
            ]
        }
    },
    "vid-3": {
        "id": "vid-3",
        "title": "Remotion Vertical Captioning Engine and Render Pipelines",
        "duration_seconds": 345,
        "thumbnail_url": "https://images.unsplash.com/photo-1626785774573-4b799315345d?w=800&auto=format&fit=crop&q=60",
        "status": "failed",
        "source_type": "upload",
        "source_url": "vertical_captions_tutorial.mp4",
        "created_at": "2026-06-29T09:11:40Z",
        "error_message": "Audio track extraction failed: ffmpeg reported out of memory when processing vertical_captions_tutorial.mp4."
    }
}

WEBHOOK_LOGS: List[dict] = []

# ── Pydantic models ───────────────────────────────────────────────────────────
class AnalyzeURLRequest(BaseModel):
    url: HttpUrl
    webhook_url: Optional[str] = None

class AnalyzeUploadRequest(BaseModel):
    filename: str
    file_size_bytes: int
    webhook_url: Optional[str] = None

# ── Helpers ───────────────────────────────────────────────────────────────────

def _log_webhook(video_id: str, title: str, status: str, source_type: str,
                 source_url: str, webhook_url: Optional[str], error: Optional[str] = None):
    payload = {
        "event": f"job.{status}",
        "timestamp": time.time(),
        "data": {
            "video_id": video_id,
            "title": title,
            "status": status,
            "source_type": source_type,
            "source_url": source_url,
            "error": error
        }
    }
    WEBHOOK_LOGS.insert(0, payload)
    print(f"[WEBHOOK] {payload['event']} → {webhook_url or 'Dashboard'}")


def _download_youtube_audio(url: str, out_path: str) -> bool:
    """Download audio from a YouTube URL as MP3 using yt-dlp."""
    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--extract-audio",
                "--audio-format", "mp3",
                "--audio-quality", "5",          # ~128 kbps — fast & small
                "--no-playlist",
                "--output", out_path,
                url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"[yt-dlp ERROR] {e}")
        return False


def _transcribe_with_groq(audio_path: str) -> str:
    """Send audio file to Groq Whisper and return transcript text."""
    client = get_groq()
    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-large-v3-turbo",
            file=f,
            response_format="text",
        )
    return response if isinstance(response, str) else response.text


def _summarize_with_gemini(title: str, transcript: str) -> dict:
    """Send transcript to Gemini and get structured JSON summary."""
    model = get_gemini()

    prompt = f"""
You are an expert video analyst. Below is the transcript of a video titled:
"{title}"

TRANSCRIPT:
{transcript[:15000]}

Return a JSON object with EXACTLY this structure (no markdown, no code fences — raw JSON only):
{{
  "tldr": "<2–3 sentence summary of the whole video>",
  "chapters": [
    {{"title": "<chapter title>", "start_ts": "<MM:SS>", "summary": "<1–2 sentences>"}},
    ...
  ],
  "steps": [
    {{"order": 1, "instruction": "<clear action step>", "timestamp": "<MM:SS>"}},
    ...
  ],
  "key_quotes": [
    "<verbatim or near-verbatim impactful quote from the transcript>",
    ...
  ]
}}

Rules:
- Provide 3–5 chapters, 3–5 steps, and 2–4 key quotes.
- Timestamps must be realistic (sequential, within video length).
- Return ONLY the raw JSON. No explanation, no markdown.
"""

    response = model.generate_content(prompt)
    raw = response.text.strip()

    # Strip any accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    return json.loads(raw)


# ── Real AI pipeline ──────────────────────────────────────────────────────────

async def run_ai_pipeline(video_id: str, title: str, source_type: str,
                          source_url: str, webhook_url: Optional[str]):
    """
    Full pipeline:
      1. Download audio (YouTube) or accept upload path
      2. Transcribe with Groq Whisper
      3. Summarize with Gemini
    """
    def log(status: str, error: Optional[str] = None):
        _log_webhook(video_id, title, status, source_type, source_url, webhook_url, error)

    log("created")

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = os.path.join(tmpdir, f"{video_id}.mp3")

        # ── Stage 1: Extract audio ─────────────────────────────────────────
        VIDEOS[video_id]["status"] = "extracting"
        log("extracting")

        if source_type == "url":
            loop = asyncio.get_event_loop()
            success = await loop.run_in_executor(
                None, _download_youtube_audio, source_url, audio_path
            )
            if not success or not os.path.exists(audio_path):
                VIDEOS[video_id]["status"] = "failed"
                VIDEOS[video_id]["error_message"] = (
                    "yt-dlp could not download audio. "
                    "The URL may be private, age-restricted, or unavailable."
                )
                log("failed", error=VIDEOS[video_id]["error_message"])
                return
        else:
            # For uploads we'd receive an actual file; simulate a short wait
            await asyncio.sleep(2)
            # Create a tiny placeholder so transcription doesn't crash
            with open(audio_path, "wb") as f:
                f.write(b"")

        # ── Stage 2: Transcribe ────────────────────────────────────────────
        VIDEOS[video_id]["status"] = "transcribing"
        log("transcribing")

        try:
            loop = asyncio.get_event_loop()
            # Only transcribe if we actually have audio bytes
            if os.path.getsize(audio_path) > 0:
                transcript = await loop.run_in_executor(
                    None, _transcribe_with_groq, audio_path
                )
            else:
                transcript = f"[Simulated transcript for uploaded file: {source_url}]"
        except Exception as e:
            VIDEOS[video_id]["status"] = "failed"
            VIDEOS[video_id]["error_message"] = f"Groq Whisper transcription failed: {e}"
            log("failed", error=VIDEOS[video_id]["error_message"])
            return

        # ── Stage 3: Summarize ─────────────────────────────────────────────
        VIDEOS[video_id]["status"] = "summarizing"
        log("summarizing")

        try:
            loop = asyncio.get_event_loop()
            summary = await loop.run_in_executor(
                None, _summarize_with_gemini, title, transcript
            )
        except Exception as e:
            VIDEOS[video_id]["status"] = "failed"
            VIDEOS[video_id]["error_message"] = f"Gemini summarization failed: {e}"
            log("failed", error=VIDEOS[video_id]["error_message"])
            return

        # ── Done ───────────────────────────────────────────────────────────
        VIDEOS[video_id]["status"] = "done"
        VIDEOS[video_id]["summary"] = summary
        VIDEOS[video_id]["transcript"] = transcript  # store full transcript too
        log("completed")
        print(f"[PIPELINE DONE] {video_id} — '{title}'")


# ── API Routes ────────────────────────────────────────────────────────────────

@app.get("/api/videos")
def list_videos():
    return list(VIDEOS.values())


@app.get("/api/videos/{video_id}")
def get_video(video_id: str):
    if video_id not in VIDEOS:
        raise HTTPException(status_code=404, detail="Video analysis not found")
    return VIDEOS[video_id]


@app.post("/api/analyze/url")
def analyze_url(req: AnalyzeURLRequest, background_tasks: BackgroundTasks):
    video_id  = f"vid-{uuid.uuid4().hex[:8]}"
    url_str   = str(req.url)

    # Derive a readable title from the URL
    mock_title = "YouTube Video"
    if "youtu" in url_str:
        mock_title = "YouTube Video: " + url_str.split("=")[-1][:12]

    VIDEOS[video_id] = {
        "id": video_id,
        "title": mock_title,
        "duration_seconds": 0,
        "thumbnail_url": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=60",
        "status": "queued",
        "source_type": "url",
        "source_url": url_str,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    background_tasks.add_task(
        run_ai_pipeline, video_id, mock_title, "url", url_str, req.webhook_url
    )

    return {"message": "Job successfully enqueued", "video_id": video_id}


@app.post("/api/analyze/upload")
def analyze_upload(req: AnalyzeUploadRequest, background_tasks: BackgroundTasks):
    video_id = f"vid-{uuid.uuid4().hex[:8]}"

    VIDEOS[video_id] = {
        "id": video_id,
        "title": req.filename,
        "duration_seconds": 0,
        "thumbnail_url": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=60",
        "status": "queued",
        "source_type": "upload",
        "source_url": req.filename,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    background_tasks.add_task(
        run_ai_pipeline, video_id, req.filename, "upload", req.filename, req.webhook_url
    )

    return {"message": "Upload signature approved, analysis queued", "video_id": video_id}


@app.get("/api/webhooks/logs")
def get_webhook_logs():
    return WEBHOOK_LOGS


@app.get("/api/webhooks/clear")
def clear_webhook_logs():
    WEBHOOK_LOGS.clear()
    return {"message": "Logs cleared"}


# ── Serve Frontend SPA ────────────────────────────────────────────────────────

@app.get("/")
def get_home():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(
        content="<h2>Vidlytics</h2><p>Static assets are building. Please wait...</p>",
        status_code=202
    )


if os.path.exists(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")
