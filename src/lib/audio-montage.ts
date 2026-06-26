import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { mkdir, writeFile, readFile, unlink, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const WORK_DIR = path.join(process.cwd(), ".tmp", "audio-montage");
const DOWNLOAD_DIR = path.join(process.cwd(), "download");
const SCRIPTS_DIR = path.join(process.cwd(), "scripts");

export type CaptionStyle = "off" | "clean" | "neon" | "karaoke" | "top";
export type VisualStyle =
  | "waveform" | "spectrum" | "cqt" | "vectorscope" | "composite" | "orb";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type ColorTheme = "neon" | "sunset" | "ocean" | "mono" | "fire";

export interface GenerateOptions {
  style: VisualStyle;
  aspect: AspectRatio;
  theme: ColorTheme;
  fps: number;
  captions: CaptionStyle;
  spokenWord: boolean;
  beatFlash: boolean;
  trimStart?: number;
  trimEnd?: number;
  backgroundPath?: string | null;
}

export interface ProgressEvent {
  stage: "upload" | "probe" | "transcribe" | "encode" | "finalize" | "done" | "error";
  progress: number;
  message: string;
  jobId?: string;
  videoUrl?: string;
  error?: string;
  durationSec?: number;
  etaSec?: number;
  captionCount?: number;
}

export const THEME_COLORS: Record<ColorTheme, { primary: string; secondary: string; bg: string }> = {
  neon: { primary: "0x00FFFF", secondary: "0xFF00FF", bg: "0x0a0a14" },
  sunset: { primary: "0xFF6B35", secondary: "0xF7C548", bg: "0x1a0a05" },
  ocean: { primary: "0x00B4D8", secondary: "0x90E0EF", bg: "0x051a1f" },
  mono: { primary: "0xFFFFFF", secondary: "0xAAAAAA", bg: "0x000000" },
  fire: { primary: "0xFF2222", secondary: "0xFFAA00", bg: "0x100000" },
};

export function dimensions(aspect: AspectRatio): { w: number; h: number } {
  switch (aspect) {
    case "16:9": return { w: 1280, h: 720 };
    case "9:16": return { w: 720, h: 1280 };
    case "1:1": return { w: 1080, h: 1080 };
  }
}

function buildVisualFilter(opts: GenerateOptions): string {
  const { w, h } = dimensions(opts.aspect);
  const c = THEME_COLORS[opts.theme];
  const fps = opts.fps;
  switch (opts.style) {
    case "waveform":
      return `[0:a]showwaves=s=${w}x${h}:rate=${fps}:mode=cline:colors=${c.primary}|${c.secondary}[vraw]`;
    case "spectrum":
      return `[0:a]showspectrum=s=${w}x${h}:mode=combined:color=intensity:slide=scroll:scale=log:win_func=hann[vraw]`;
    case "cqt":
      return `[0:a]showcqt=s=${w}x${h}:fps=${fps}:count=2:bar_g=2:axis_h=0[vraw]`;
    case "vectorscope":
      return `[0:a]avectorscope=s=${w}x${h}:rate=${fps}:zoom=1.4:rc=60:gc=100:bc=200[vraw]`;
    case "composite": {
      const halfH = Math.floor(h / 2);
      const safeHalf = halfH % 2 === 0 ? halfH : halfH - 1;
      return `[0:a]asplit=2[a1][a2];[a1]showwaves=s=${w}x${safeHalf}:rate=${fps}:mode=cline:colors=${c.primary}|${c.secondary}[w1];[a2]showspectrum=s=${w}x${safeHalf}:mode=combined:color=intensity:slide=scroll:scale=log:win_func=hann[s1];[w1][s1]vstack=inputs=2[vraw]`;
    }
    default:
      return `[0:a]showwaves=s=${w}x${h}:rate=${fps}:mode=cline:colors=${c.primary}|${c.secondary}[vraw]`;
  }
}

function escapeAssPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
}

function buildFilter(opts: GenerateOptions, captionAssPath: string | null, beatAssPath: string | null, hasBackground: boolean): string {
  const { w, h } = dimensions(opts.aspect);
  const visual = buildVisualFilter(opts);
  let filter = visual;
  let currentLabel = "vraw";
  if (hasBackground) {
    filter += `;[1:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[bg]`;
    filter += `;[${currentLabel}]colorkey=0x000000:0.25:0.15[${currentLabel}k]`;
    filter += `;[bg][${currentLabel}k]overlay=0:0:format=auto[vbg]`;
    currentLabel = "vbg";
  }
  if (captionAssPath) {
    const esc = escapeAssPath(captionAssPath);
    filter += `;[${currentLabel}]subtitles='${esc}'[vcap]`;
    currentLabel = "vcap";
  }
  if (beatAssPath) {
    const esc = escapeAssPath(beatAssPath);
    filter += `;[${currentLabel}]subtitles='${esc}'[vbeat]`;
    currentLabel = "vbeat";
  }
  if (currentLabel !== "v") {
    filter += `;[${currentLabel}]null[v]`;
  } else {
    filter = filter.replace(/\[vraw\]$/, "[v]");
  }
  return filter;
}

export interface JobContext {
  jobId: string;
  mp3Path: string;
  mp4Path: string;
  downloadPath: string;
  durationSec: number;
}

export async function ensureDirs(): Promise<void> {
  await mkdir(WORK_DIR, { recursive: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
}

export async function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) { reject(new Error(`ffprobe failed: ${stderr}`)); return; }
      const dur = parseFloat(stdout.trim());
      if (isNaN(dur) || dur <= 0) { reject(new Error(`Invalid duration: ${stdout}`)); return; }
      resolve(dur);
    });
    proc.on("error", reject);
  });
}

export function runFfmpegWithProgress(
  ctx: JobContext,
  opts: GenerateOptions,
  onProgress: (ev: ProgressEvent) => void,
  captionAssPath: string | null = null,
  beatAssPath: string | null = null,
  progressRange: [number, number] = [5, 100]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const hasBg = !!opts.backgroundPath;
    const filter = buildFilter(opts, captionAssPath, beatAssPath, hasBg);
    const args = ["-y", "-i", ctx.mp3Path];
    if (hasBg && opts.backgroundPath) {
      const bgExt = opts.backgroundPath.toLowerCase();
      if (bgExt.endsWith(".mp4") || bgExt.endsWith(".mov") || bgExt.endsWith(".webm")) {
        args.push("-stream_loop", "-1", "-i", opts.backgroundPath);
      } else {
        args.push("-loop", "1", "-i", opts.backgroundPath);
      }
    }
    args.push("-filter_complex", filter, "-map", "[v]", "-map", "0:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-shortest", "-progress", "pipe:2", "-nostats", ctx.mp4Path);

    const proc = spawn("ffmpeg", args);
    let stderrBuf = "";
    let lastProgressSent = -1;
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() || "";
      let outTimeUs: number | null = null;
      let isEnd = false;
      let speed: number | null = null;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("out_time_us=")) outTimeUs = parseInt(trimmed.split("=")[1], 10);
        else if (trimmed.startsWith("out_time_ms=") && outTimeUs === null) outTimeUs = parseInt(trimmed.split("=")[1], 10);
        else if (trimmed === "progress=end") isEnd = true;
        else if (trimmed.startsWith("speed=")) {
          const m = trimmed.match(/speed=\s*([\d.]+)x/);
          if (m) speed = parseFloat(m[1]);
        }
      }
      if (outTimeUs !== null) {
        const processedSec = outTimeUs / 1_000_000;
        const encodeFrac = Math.min(1, Math.max(0, processedSec / ctx.durationSec));
        const [pStart, pEnd] = progressRange;
        const pct = Math.round(pStart + encodeFrac * (pEnd - pStart));
        if (pct > lastProgressSent) {
          lastProgressSent = pct;
          const etaSec = speed && speed > 0 ? Math.max(0, (ctx.durationSec - processedSec) / speed) : undefined;
          onProgress({ stage: "encode", progress: pct, message: `Encoding video — ${Math.round(encodeFrac * 100)}%${speed ? ` @ ${speed.toFixed(1)}x` : ""}`, etaSec });
        }
      }
      if (isEnd) onProgress({ stage: "finalize", progress: progressRange[1], message: "Finalizing output file…" });
    });
    proc.on("close", async (code) => {
      if (code === 0) {
        try {
          const data = await readFile(ctx.mp4Path);
          await writeFile(ctx.downloadPath, data);
          onProgress({ stage: "done", progress: 100, message: "Done!", jobId: ctx.jobId, videoUrl: `/api/video?jobId=${ctx.jobId}`, durationSec: ctx.durationSec });
          resolve();
        } catch (e) { reject(e as Error); }
      } else {
        reject(new Error(`ffmpeg exited with code ${code}. Last stderr: ${stderrBuf.slice(-500)}`));
      }
    });
    proc.on("error", (err) => reject(err));
  });
}

export function runOrbRenderer(
  ctx: JobContext,
  opts: GenerateOptions,
  onProgress: (ev: ProgressEvent) => void,
  captionAssPath: string | null = null,
  beatAssPath: string | null = null,
  progressRange: [number, number] = [5, 100]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { w, h } = dimensions(opts.aspect);
    const c = THEME_COLORS[opts.theme];
    const orbScript = path.join(SCRIPTS_DIR, "orb_renderer.py");
    const args = [orbScript, ctx.mp3Path, ctx.mp4Path, String(w), String(h), String(opts.fps), c.primary, c.secondary, c.bg];
    if (opts.backgroundPath) args.push("--bg-media", opts.backgroundPath);
    if (captionAssPath) args.push("--ass", captionAssPath);
    if (beatAssPath) args.push("--beat-ass", beatAssPath);
    const proc = spawn("python3", args);
    let stderrBuf = "";
    let lastProgressSent = -1;
    const [pStart, pEnd] = progressRange;
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        const m = trimmed.match(/^orb_progress=(\d+)/);
        if (m) {
          const orbPct = parseInt(m[1], 10);
          const pct = Math.round(pStart + (orbPct / 100) * (pEnd - pStart));
          if (pct > lastProgressSent) {
            lastProgressSent = pct;
            onProgress({ stage: "encode", progress: pct, message: `Rendering orb — ${orbPct}%` });
          }
        }
      }
    });
    proc.on("close", async (code) => {
      if (code === 0) {
        try {
          const data = await readFile(ctx.mp4Path);
          await writeFile(ctx.downloadPath, data);
          onProgress({ stage: "finalize", progress: 100, message: "Finalizing output file…" });
          onProgress({ stage: "done", progress: 100, message: "Done!", jobId: ctx.jobId, videoUrl: `/api/video?jobId=${ctx.jobId}`, durationSec: ctx.durationSec });
          resolve();
        } catch (e) { reject(e as Error); }
      } else {
        reject(new Error(`orb renderer exited with code ${code}. Last stderr: ${stderrBuf.slice(-800)}`));
      }
    });
    proc.on("error", (err) => reject(err));
  });
}

export async function saveUpload(file: File, jobId: string): Promise<string> {
  await ensureDirs();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dest = path.join(WORK_DIR, `${jobId}__${safeName}`);
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(dest, buf);
  return dest;
}

export function newJobId(): string { return randomUUID().slice(0, 8); }

export function jobFiles(jobId: string) {
  return {
    mp4Path: path.join(WORK_DIR, `${jobId}.mp4`),
    downloadPath: path.join(DOWNLOAD_DIR, `audio-montage-${jobId}.mp4`),
  };
}

export function jobWorkFiles(jobId: string) {
  return {
    trimmedMp3: path.join(WORK_DIR, `${jobId}_trimmed.mp3`),
    captionSrt: path.join(WORK_DIR, `${jobId}_captions.srt`),
    captionAss: path.join(WORK_DIR, `${jobId}_captions.ass`),
    beatAss: path.join(WORK_DIR, `${jobId}_beats.ass`),
    bgMedia: path.join(WORK_DIR, `${jobId}_bg`),
  };
}

export async function getVideoPath(jobId: string): Promise<string | null> {
  const { mp4Path, downloadPath } = jobFiles(jobId);
  if (existsSync(downloadPath)) return downloadPath;
  if (existsSync(mp4Path)) return mp4Path;
  return null;
}

export async function getVideoSize(jobId: string): Promise<number> {
  const p = await getVideoPath(jobId);
  if (!p) return 0;
  const s = await stat(p);
  return s.size;
}

export async function cleanupJob(jobId: string, mp3Path?: string): Promise<void> {
  try { if (mp3Path && existsSync(mp3Path)) await unlink(mp3Path); } catch {}
}

export async function trimAudio(inputPath: string, outputPath: string, startSec: number, endSec: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-ss", String(startSec), "-to", String(endSec), "-i", inputPath, "-c", "copy", "-avoid_negative_ts", "make_zero", outputPath];
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`trimAudio failed (code ${code}): ${stderr.slice(-300)}`));
    });
    proc.on("error", reject);
  });
}

export async function generateBeatAss(mp3Path: string, assPath: string, w: number, h: number, primaryHex: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const script = path.join(SCRIPTS_DIR, "beat_ass.py");
    const proc = spawn("python3", [script, mp3Path, assPath, String(w), String(h), primaryHex]);
    let stderr = "";
    let beatCount = 0;
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      const lines = stderr.split("\n");
      for (const line of lines) {
        const m = line.trim().match(/^beat_count=(\d+)/);
        if (m) beatCount = parseInt(m[1], 10);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(beatCount);
      else reject(new Error(`beat_ass.py failed (code ${code}): ${stderr.slice(-400)}`));
    });
    proc.on("error", reject);
  });
}

export interface TranscribeResult { segmentCount: number; srtPath: string; }

export async function transcribeMp3(
  mp3Path: string, srtPath: string, spokenWord: boolean,
  onProgress?: (pct: number, message: string) => void
): Promise<TranscribeResult> {
  return new Promise((resolve, reject) => {
    const script = path.join(SCRIPTS_DIR, "transcribe_words.py");
    const args = [script, mp3Path, srtPath];
    if (spokenWord) args.push("--spoken-word");
    const proc = spawn("python3", args);
    let stderr = "";
    let segmentCount = 0;
    let lastStatus = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      const lines = stderr.split("\n");
      stderr = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        const pm = trimmed.match(/^transcribe_progress=(\d+)/);
        if (pm) { const pct = parseInt(pm[1], 10); onProgress?.(pct, lastStatus); }
        const cm = trimmed.match(/^transcribe_chunk=(\d+)\/(\d+)/);
        if (cm) { lastStatus = `Transcribing chunk ${cm[1]}/${cm[2]}…`; onProgress?.(0, lastStatus); }
        const sm = trimmed.match(/^transcribe_status=(.*)$/);
        if (sm) { lastStatus = sm[1]; onProgress?.(0, lastStatus); }
        const sc = trimmed.match(/^transcribe_segment_count=(\d+)/);
        if (sc) segmentCount = parseInt(sc[1], 10);
      }
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ segmentCount, srtPath });
      else reject(new Error(`transcribe_words.py failed (code ${code}): ${stderr.slice(-400)}`));
    });
    proc.on("error", reject);
  });
}

export async function srtToAss(srtPath: string, assPath: string, style: CaptionStyle, w: number, h: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = path.join(SCRIPTS_DIR, "srt_to_ass.py");
    const styleName = style === "off" ? "clean" : style;
    const proc = spawn("python3", [script, srtPath, assPath, styleName, String(w), String(h)]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`srt_to_ass.py failed (code ${code}): ${stderr.slice(-400)}`));
    });
    proc.on("error", reject);
  });
}
