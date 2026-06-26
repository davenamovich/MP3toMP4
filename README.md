# 🎬 Audio Montage — MP3 to Music-Reactive Video

Drop an MP3, pick a visualizer style, and get a beat-synced MP4 video you can download and share. Powered by ffmpeg + librosa, inspired by [OpenMontage](https://github.com/davenamovich/OpenMontage).

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss" alt="Tailwind 4">
  <img src="https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma" alt="Prisma 6">
  <img src="https://img.shields.io/badge/Bun-latest-FBF0DF?logo=bun" alt="Bun">
</p>

---

## ✨ Features

- **6 visualizer styles** — Waveform, Spectrum, CQT, Vectorscope, Composite (stacked), and JARVIS Orb (HUD-style glow orb with rotating arcs)
- **3 aspect ratios** — 16:9 (YouTube), 9:16 (Shorts/TikTok), 1:1 (Instagram)
- **5 color themes** — Neon, Sunset, Ocean, Fire, Mono
- **Beat detection** — librosa onset detection with flash overlays synced to tempo
- **Auto captions** — ASR transcription via `z-ai asr` with word-level timing, 4 caption styles (Clean, Neon, Karaoke, Top)
- **Spoken-word mode** — Optimized silence detection and larger fonts for speech-heavy audio
- **Audio trimming** — Set custom start/end before rendering
- **Background images/video** — Overlay your visualizer on a custom background
- **15s preview mode** — Quick render to test settings before full export
- **Publish & share** — One-click publish to here.now with a shareable landing page
- **Progress tracking** — Real-time progress with ETA via polling

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | [Next.js 16](https://nextjs.org/) (standalone output) |
| **Frontend** | React 19, Tailwind CSS 4, [shadcn/ui](https://ui.shadcn.com/), Framer Motion |
| **Database** | SQLite via [Prisma](https://www.prisma.io/) |
| **Audio/Video** | ffmpeg + ffprobe |
| **Analysis** | librosa (Python) — beat detection, onset, spectral features |
| **Transcription** | `z-ai asr` (whisper-based) |
| **Rendering** | PIL/Pillow + ffmpeg pipe (JARVIS Orb renderer) |
| **Reverse Proxy** | [Caddy](https://caddyserver.com/) |
| **Package Manager** | [Bun](https://bun.sh/) |

---

## 📋 Prerequisites

- **[Bun](https://bun.sh/)** (v1.0+)
- **[ffmpeg + ffprobe](https://ffmpeg.org/)** (in PATH)
- **[Python 3.9+](https://www.python.org/)** with the following packages:
  ```bash
  pip install librosa numpy soundfile pillow
  ```
- **[Caddy](https://caddyserver.com/)** (for production reverse proxy)
- **`z-ai` CLI** (for ASR transcription — captions silently fall back if unavailable. Install via your platform's `z-ai` package)

---

## 🚀 Getting Started

### 1. Clone & install dependencies

```bash
git clone https://github.com/davenamovich/MP3toMP4.git
cd MP3toMP4
bun install
```

### 2. Set up environment variables

Create a `.env` file:

```env
DATABASE_URL="file:./db/custom.db"
```

### 3. Initialize the database

```bash
bun run db:push
```

### 4. Start the dev server

```bash
bun run dev
```

The app will be available at **http://localhost:3000**.

---

## 🏗️ Production Build

### Build

The build script creates a standalone Next.js build, packages the database, and bundles everything with Caddy:

```bash
bash .zscripts/build.sh
```

This produces a `.tar.gz` package containing:
- Standalone Next.js server
- Static assets
- SQLite database (migrated)
- Mini-services (if any)
- Caddy reverse proxy config

### Start (production)

```bash
bash .zscripts/start.sh
```

This starts the Next.js server, mini-services, and Caddy — all orchestrated with graceful shutdown on Ctrl+C.

---

## 📁 Project Structure

```
.
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Main UI (drag-drop, settings, preview)
│   │   ├── layout.tsx                # Root layout + metadata
│   │   ├── globals.css               # Tailwind + animations
│   │   └── api/
│   │       ├── generate/route.ts     # POST /api/generate — start a job
│   │       ├── status/route.ts       # GET /api/status — poll job progress
│   │       ├── video/route.ts        # GET /api/video — serve rendered MP4
│   │       └── publish/route.ts      # POST /api/publish — publish to here.now
│   ├── components/ui/                # shadcn/ui components (80+)
│   ├── hooks/                        # Custom React hooks
│   └── lib/
│       ├── audio-montage.ts          # Core: ffmpeg, orb renderer, transcription
│       ├── job-store.ts              # In-memory job state management
│       ├── db.ts                     # Prisma client singleton
│       └── utils.ts                  # Tailwind class merging
├── scripts/
│   ├── beat_ass.py                   # Beat detection → ASS overlay
│   ├── orb_renderer.py               # JARVIS HUD orb frame renderer
│   ├── transcribe_words.py           # Word-level ASR → SRT
│   └── srt_to_ass.py                 # SRT → styled ASS captions
├── prisma/
│   └── schema.prisma                 # Database schema (User, Post)
├── .zscripts/                        # Build, dev, and production scripts
├── Caddyfile                         # Reverse proxy config (port 81 → 3000)
├── db/
│   └── custom.db                     # SQLite database (git-ignored)
└── download/                         # Rendered MP4 output (git-ignored)
```

---

## 🔌 API Endpoints

### `POST /api/generate`
Start a video generation job.
- **Body:** `multipart/form-data`
  - `file` (required) — MP3 file
  - `style` — `waveform` | `spectrum` | `cqt` | `vectorscope` | `composite` | `orb`
  - `aspect` — `16:9` | `9:16` | `1:1`
  - `theme` — `neon` | `sunset` | `ocean` | `mono` | `fire`
  - `fps` — `30` | `60`
  - `captions` — `off` | `clean` | `neon` | `karaoke` | `top`
  - `spokenWord` — `true` | `false`
  - `beatFlash` — `true` | `false`
  - `trimStart` / `trimEnd` — seconds
  - `preview` — `true` | `false` (15s preview)
  - `background` — image/video file
- **Response:** `{ "jobId": "abc12345" }`

### `GET /api/status?jobId=<id>`
Poll job progress.
- **Response:** `{ "stage": "encode", "progress": 45, "message": "Encoding video — 45%", "etaSec": 30, ... }`

### `GET /api/video?jobId=<id>`
Stream or download the rendered MP4. Supports HTTP range requests.

### `POST /api/publish`
Publish a completed video to here.now.
- **Body:** `{ "jobId": "abc12345" }`
- **Response:** `{ "siteUrl": "https://..." }`

---

## 🎨 Visualizer Styles

| Style | Description | Best For |
|-------|-------------|----------|
| **Waveform** | Classic oscilloscope line trace | Simple, clean visualizations |
| **Spectrum** | Rolling frequency spectrum bars | EDM, bass-heavy tracks |
| **CQT** | Constant-Q transform (musical pitch) | Melodic/acoustic music |
| **Vectorscope** | Stereo field Lissajous plot | Stereo-rich tracks |
| **Composite** | Waveform + spectrum stacked | All-purpose |
| **Orb** | Glowing HUD orb with rotating arcs, frequency rings, and pulse waves | Cinematic, futuristic vibes |

---

## 🔧 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | `file:./db/custom.db` | SQLite database path |
| `NODE_ENV` | No | `development` | Set to `production` in production |
| `PORT` | No | `3000` | Server port |

---

## 📝 Credits

- Inspired by [OpenMontage](https://github.com/davenamovich/OpenMontage)
- UI built with [shadcn/ui](https://ui.shadcn.com/) and [Radix UI](https://www.radix-ui.com/)
- Beat detection powered by [librosa](https://librosa.org/)
- ASR transcription via `z-ai`
- Publishing powered by [here.now](https://here.now)

---

## 📄 License

MIT
