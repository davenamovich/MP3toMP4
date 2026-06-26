import { NextRequest, NextResponse } from "next/server";
import {
  saveUpload, probeDuration, runFfmpegWithProgress, runOrbRenderer,
  trimAudio, generateBeatAss, transcribeMp3, srtToAss,
  jobFiles, jobWorkFiles, cleanupJob, ensureDirs, dimensions, THEME_COLORS,
  type GenerateOptions, type ProgressEvent, type VisualStyle, type AspectRatio, type ColorTheme, type CaptionStyle,
} from "@/lib/audio-montage";
import { createJob, updateJob, type JobStage } from "@/lib/job-store";
import { writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID_STYLES: VisualStyle[] = ["waveform", "spectrum", "cqt", "vectorscope", "composite", "orb"];
const VALID_ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];
const VALID_THEMES: ColorTheme[] = ["neon", "sunset", "ocean", "mono", "fire"];
const VALID_CAPTIONS: CaptionStyle[] = ["off", "clean", "neon", "karaoke", "top"];
const VALID_BG_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm"];

export async function POST(req: NextRequest): Promise<Response> {
  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 }); }

  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing 'file' field (mp3 expected)" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".mp3") && file.type !== "audio/mpeg")
    return NextResponse.json({ error: `Expected an .mp3 file. Got: ${file.name}` }, { status: 400 });

  const style = (formData.get("style") as VisualStyle) || "waveform";
  const aspect = (formData.get("aspect") as AspectRatio) || "16:9";
  const theme = (formData.get("theme") as ColorTheme) || "neon";
  const fps = Number(formData.get("fps") || 30);
  const captions = (formData.get("captions") as CaptionStyle) || "off";
  const spokenWord = formData.get("spokenWord") === "true";
  const beatFlash = formData.get("beatFlash") === "true";
  const trimStart = formData.get("trimStart") ? Number(formData.get("trimStart")) : undefined;
  const trimEnd = formData.get("trimEnd") ? Number(formData.get("trimEnd")) : undefined;
  const preview = formData.get("preview") === "true";

  const bgFile = formData.get("background");
  let backgroundPath: string | null = null;
  if (bgFile instanceof File && bgFile.size > 0) {
    const bgExt = path.extname(bgFile.name).toLowerCase();
    if (!VALID_BG_EXTS.includes(bgExt)) return NextResponse.json({ error: `Background must be jpg/png/webp/mp4/mov/webm` }, { status: 400 });
  }

  if (!VALID_STYLES.includes(style)) return NextResponse.json({ error: `Invalid style: ${style}` }, { status: 400 });
  if (!VALID_ASPECTS.includes(aspect)) return NextResponse.json({ error: `Invalid aspect: ${aspect}` }, { status: 400 });
  if (!VALID_THEMES.includes(theme)) return NextResponse.json({ error: `Invalid theme: ${theme}` }, { status: 400 });
  if (![24, 30, 60].includes(fps)) return NextResponse.json({ error: `Invalid fps: ${fps}` }, { status: 400 });
  if (!VALID_CAPTIONS.includes(captions)) return NextResponse.json({ error: `Invalid captions: ${captions}` }, { status: 400 });

  await ensureDirs();
  const job = createJob();
  const opts: GenerateOptions = { style, aspect, theme, fps, captions, spokenWord, beatFlash, trimStart, trimEnd, backgroundPath: null };

  if (bgFile instanceof File && bgFile.size > 0) {
    const workFiles = jobWorkFiles(job.jobId);
    const bgExt = path.extname(bgFile.name).toLowerCase();
    backgroundPath = workFiles.bgMedia + bgExt;
    const buf = Buffer.from(await bgFile.arrayBuffer());
    await writeFile(backgroundPath, buf);
    opts.backgroundPath = backgroundPath;
  }

  runJobInBackground(job.jobId, file, opts, preview).catch((err) => {
    updateJob(job.jobId, { stage: "error", progress: 0, message: err instanceof Error ? err.message : "Unknown error", error: err instanceof Error ? err.message : "Unknown error" });
  });

  return NextResponse.json({ jobId: job.jobId, message: "Job started" });
}

async function runJobInBackground(jobId: string, file: File, opts: GenerateOptions, preview: boolean): Promise<void> {
  let mp3Path: string | undefined;
  let trimmedPath: string | undefined;
  try {
    updateJob(jobId, { stage: "upload", progress: 1, message: `Saving "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB)…` });
    mp3Path = await saveUpload(file, jobId);
    updateJob(jobId, { stage: "probe", progress: 3, message: "Probing audio duration…" });
    let durationSec = await probeDuration(mp3Path);

    const trimStart = opts.trimStart && opts.trimStart > 0 ? opts.trimStart : 0;
    let trimEnd = opts.trimEnd && opts.trimEnd > 0 ? opts.trimEnd : durationSec;
    if (preview) trimEnd = Math.min(trimEnd, trimStart + 15);

    if (trimStart > 0 || trimEnd < durationSec) {
      updateJob(jobId, { stage: "probe", progress: 4, message: `Trimming audio to ${trimStart.toFixed(1)}s–${trimEnd.toFixed(1)}s…` });
      const workFiles = jobWorkFiles(jobId);
      trimmedPath = await trimAudio(mp3Path, workFiles.trimmedMp3, trimStart, trimEnd);
      mp3Path = trimmedPath;
      durationSec = trimEnd - trimStart;
    }

    const { mp4Path, downloadPath } = jobFiles(jobId);
    const ctx = { jobId, mp3Path, mp4Path, downloadPath, durationSec };
    const { w, h } = dimensions(opts.aspect);

    let beatAssPath: string | null = null;
    if (opts.beatFlash) {
      updateJob(jobId, { stage: "encode", progress: 4, message: "Detecting beats with librosa…", durationSec });
      const workFiles = jobWorkFiles(jobId);
      const primaryHex = THEME_COLORS[opts.theme].primary;
      try {
        const beatCount = await generateBeatAss(mp3Path, workFiles.beatAss, w, h, primaryHex);
        beatAssPath = workFiles.beatAss;
        updateJob(jobId, { stage: "encode", progress: 5, message: `Detected ${beatCount} beats. Starting render…`, durationSec });
      } catch {
        updateJob(jobId, { stage: "encode", progress: 5, message: `Beat detection failed, continuing without…`, durationSec });
      }
    }

    let captionAssPath: string | null = null;
    if (opts.captions !== "off") {
      const workFiles = jobWorkFiles(jobId);
      updateJob(jobId, { stage: "transcribe", progress: 5, message: opts.spokenWord ? "Transcribing (spoken-word mode)…" : "Transcribing audio…", durationSec });
      try {
        const result = await transcribeMp3(mp3Path, workFiles.captionSrt, opts.spokenWord, (pct, message) => {
          updateJob(jobId, { stage: "transcribe", progress: 5 + Math.round(pct * 0.1), message: message || "Transcribing…", durationSec });
        });
        if (result.segmentCount === 0) {
          updateJob(jobId, { stage: "encode", progress: 15, message: "No speech detected — continuing without captions.", durationSec, captionCount: 0 });
        } else {
          await srtToAss(workFiles.captionSrt, workFiles.captionAss, opts.captions, w, h);
          captionAssPath = workFiles.captionAss;
          updateJob(jobId, { stage: "encode", progress: 15, message: `${result.segmentCount} captions ready. Starting render…`, durationSec, captionCount: result.segmentCount });
        }
      } catch {
        updateJob(jobId, { stage: "encode", progress: 15, message: `Transcription failed, continuing without captions…`, durationSec });
      }
    }

    if (!beatAssPath && !captionAssPath) {
      updateJob(jobId, { stage: "encode", progress: 5, message: opts.style === "orb" ? `Rendering JARVIS orb — ${durationSec.toFixed(1)}s of audio…` : `Starting ffmpeg — ${durationSec.toFixed(1)}s of audio…`, durationSec });
    }

    const onProgress = (ev: ProgressEvent) => {
      const baseProgress = captionAssPath ? 15 : 5;
      const scaledProgress = captionAssPath || beatAssPath ? baseProgress + Math.round((ev.progress - 5) * ((100 - baseProgress) / 95)) : ev.progress;
      updateJob(jobId, { stage: ev.stage as JobStage, progress: scaledProgress, message: ev.message, etaSec: ev.etaSec, captionCount: ev.captionCount, videoUrl: ev.videoUrl, durationSec: ev.durationSec ?? durationSec });
    };

    if (opts.style === "orb") await runOrbRenderer(ctx, opts, onProgress, captionAssPath, beatAssPath);
    else await runFfmpegWithProgress(ctx, opts, onProgress, captionAssPath, beatAssPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during encoding";
    updateJob(jobId, { stage: "error", progress: 0, message, error: message });
  } finally {
    if (mp3Path) await cleanupJob(jobId, mp3Path).catch(() => {});
  }
}
