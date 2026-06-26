"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AudioLines, Upload, FileAudio, Sparkles, Download, RefreshCw,
  AlertCircle, Loader2, Activity, Radio, BarChart3, Layers, Orbit,
  CheckCircle2, Clock, Film, Github, ArrowRight, Zap, Scissors,
  Image as ImageIcon, Eye, Mic, Share2, ExternalLink, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type VisualStyle = "waveform" | "spectrum" | "cqt" | "vectorscope" | "composite" | "orb";
type AspectRatio = "16:9" | "9:16" | "1:1";
type ColorTheme = "neon" | "sunset" | "ocean" | "mono" | "fire";
type CaptionStyle = "off" | "clean" | "neon" | "karaoke" | "top";

interface ProgressEvent {
  stage: "upload" | "probe" | "transcribe" | "encode" | "finalize" | "done" | "error";
  progress: number;
  message: string;
  jobId?: string;
  videoUrl?: string;
  error?: string;
  durationSec?: number;
  etaSec?: number;
}

const STYLE_OPTIONS: { id: VisualStyle; label: string; icon: typeof AudioLines; desc: string }[] = [
  { id: "waveform", label: "Waveform", icon: AudioLines, desc: "Classic oscilloscope line trace" },
  { id: "spectrum", label: "Spectrum", icon: BarChart3, desc: "Rolling frequency spectrum bars" },
  { id: "cqt", label: "CQT Spectrum", icon: Activity, desc: "Constant-Q transform (musical pitch)" },
  { id: "vectorscope", label: "Vectorscope", icon: Radio, desc: "Stereo field Lissajous plot" },
  { id: "composite", label: "Composite", icon: Layers, desc: "Waveform + spectrum stacked" },
  { id: "orb", label: "JARVIS Orb", icon: Orbit, desc: "Glowing HUD orb · pulses with beat" },
];

const ASPECT_OPTIONS: { id: AspectRatio; label: string; hint: string; w: number; h: number }[] = [
  { id: "16:9", label: "16:9", hint: "YouTube / landscape", w: 32, h: 18 },
  { id: "9:16", label: "9:16", hint: "Shorts / Reels / TikTok", w: 18, h: 32 },
  { id: "1:1", label: "1:1", hint: "Instagram feed", w: 24, h: 24 },
];

const THEME_OPTIONS: { id: ColorTheme; label: string; swatch: string }[] = [
  { id: "neon", label: "Neon", swatch: "linear-gradient(135deg,#00FFFF,#FF00FF)" },
  { id: "sunset", label: "Sunset", swatch: "linear-gradient(135deg,#FF6B35,#F7C548)" },
  { id: "ocean", label: "Ocean", swatch: "linear-gradient(135deg,#00B4D8,#90E0EF)" },
  { id: "fire", label: "Fire", swatch: "linear-gradient(135deg,#FF2222,#FFAA00)" },
  { id: "mono", label: "Mono", swatch: "linear-gradient(135deg,#FFFFFF,#888888)" },
];

const CAPTION_OPTIONS: { id: CaptionStyle; label: string; preview: string }[] = [
  { id: "off", label: "Off", preview: "linear-gradient(135deg,#333,#222)" },
  { id: "clean", label: "Clean", preview: "linear-gradient(135deg,#ffffff,#cccccc)" },
  { id: "neon", label: "Neon", preview: "linear-gradient(135deg,#00ffff,#ff00ff)" },
  { id: "karaoke", label: "Karaoke", preview: "linear-gradient(135deg,#ffff00,#ff8800)" },
  { id: "top", label: "Top", preview: "linear-gradient(135deg,#ffffff,#888888)" },
];

const STAGE_LABELS: Record<ProgressEvent["stage"], string> = {
  upload: "Uploading", probe: "Probing audio", transcribe: "Transcribing",
  encode: "Encoding video", finalize: "Finalizing", done: "Complete", error: "Failed",
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [style, setStyle] = useState<VisualStyle>("waveform");
  const [aspect, setAspect] = useState<AspectRatio>("16:9");
  const [theme, setTheme] = useState<ColorTheme>("neon");
  const [fps, setFps] = useState<30 | 60>(30);
  const [captions, setCaptions] = useState<CaptionStyle>("off");
  const [spokenWord, setSpokenWord] = useState(false);
  const [beatFlash, setBeatFlash] = useState(true);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [previewMode, setPreviewMode] = useState(false);

  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "running"; progress: number; stage: ProgressEvent["stage"]; message: string; etaSec?: number }
    | { kind: "done"; videoUrl: string; jobId: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { return () => abortRef.current?.abort(); }, []);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!f.name.toLowerCase().endsWith(".mp3") && f.type !== "audio/mpeg") {
      setStatus({ kind: "error", message: `Please choose an .mp3 file. Got: ${f.name}` });
      return;
    }
    setFile(f);
    setFileDuration(null);
    setStatus({ kind: "idle" });
    const url = URL.createObjectURL(f);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setFileDuration(audio.duration);
        setTrimEnd(audio.duration);
      }
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => URL.revokeObjectURL(url);
    audio.src = url;
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onGenerate = useCallback(async () => {
    if (!file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: "running", progress: 0, stage: "upload", message: "Uploading…" });

    const fd = new FormData();
    fd.append("file", file);
    fd.append("style", style);
    fd.append("aspect", aspect);
    fd.append("theme", theme);
    fd.append("fps", String(fps));
    fd.append("captions", captions);
    fd.append("spokenWord", String(spokenWord));
    fd.append("beatFlash", String(beatFlash));
    fd.append("preview", String(previewMode));
    if (trimEnabled && fileDuration) {
      fd.append("trimStart", String(Math.min(trimStart, fileDuration)));
      fd.append("trimEnd", String(Math.min(trimEnd, fileDuration)));
    }
    if (backgroundFile) fd.append("background", backgroundFile);
    setPublishedUrl(null);

    try {
      const res = await fetch("/api/generate", { method: "POST", body: fd, signal: controller.signal });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Server returned ${res.status}: ${errText.slice(0, 200)}`);
      }
      const { jobId } = (await res.json()) as { jobId: string };
      if (!jobId) throw new Error("Server did not return a jobId");

      const poll = async () => {
        if (controller.signal.aborted) return;
        try {
          const sres = await fetch(`/api/status?jobId=${encodeURIComponent(jobId)}`, { signal: controller.signal });
          if (sres.status === 404) throw new Error("Job not found — it may have expired.");
          if (!sres.ok) throw new Error(`Status ${sres.status}`);
          const job = (await sres.json()) as { stage: string; progress: number; message: string; videoUrl?: string; error?: string; etaSec?: number };
          if (job.stage === "done" && job.videoUrl) {
            setStatus({ kind: "done", videoUrl: job.videoUrl, jobId });
            return;
          }
          if (job.stage === "error") {
            setStatus({ kind: "error", message: job.error || job.message || "Unknown error" });
            return;
          }
          setStatus({ kind: "running", progress: job.progress, stage: job.stage as ProgressEvent["stage"], message: job.message, etaSec: job.etaSec });
          setTimeout(poll, 1500);
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          setStatus({ kind: "error", message: err instanceof Error ? err.message : "Polling error" });
        }
      };
      setTimeout(poll, 500);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Unknown error" });
    }
  }, [file, style, aspect, theme, fps, captions, spokenWord, beatFlash, trimEnabled, trimStart, trimEnd, previewMode, backgroundFile]);

  const onReset = useCallback(() => {
    abortRef.current?.abort();
    setFile(null);
    setFileDuration(null);
    setBackgroundFile(null);
    setTrimEnabled(false);
    setTrimStart(0);
    setTrimEnd(0);
    setPreviewMode(false);
    setCaptions("off");
    setSpokenWord(false);
    setPublishedUrl(null);
    setStatus({ kind: "idle" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const onPublish = useCallback(async () => {
    if (status.kind !== "done" || !status.jobId) return;
    setPublishing(true);
    setPublishedUrl(null);
    try {
      const res = await fetch("/api/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: status.jobId }) });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Publish failed (${res.status}): ${errText.slice(0, 200)}`);
      }
      const data = (await res.json()) as { siteUrl: string };
      setPublishedUrl(data.siteUrl);
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Publish failed" });
    } finally {
      setPublishing(false);
    }
  }, [status]);

  const formatEta = (sec?: number) => {
    if (!sec || sec <= 0) return "";
    if (sec < 60) return `${Math.ceil(sec)}s left`;
    return `${Math.floor(sec / 60)}m ${Math.ceil(sec % 60)}s left`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const formatDuration = (sec: number) => {
    if (sec < 60) return `${Math.round(sec)}s`;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  };

  const isRunning = status.kind === "running";
  const isDone = status.kind === "done";

  return (
    <div className="min-h-screen flex flex-col bg-[#070710] text-slate-100 selection:bg-fuchsia-500/40">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute -top-20 right-0 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-violet-500/15 blur-3xl" />
      </div>

      <header className="relative z-10 border-b border-white/5 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-cyan-400 shadow-lg shadow-fuchsia-500/30">
              <Film className="h-5 w-5 text-black" />
            </div>
            <div>
              <div className="font-semibold tracking-tight text-base sm:text-lg">Audio Montage</div>
              <div className="text-[11px] text-slate-400 -mt-0.5">Drop MP3 → get a music-reactive video</div>
            </div>
          </div>
          <a href="https://github.com/davenamovich/OpenMontage" target="_blank" rel="noreferrer" className="hidden sm:inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-100 transition-colors">
            <Github className="h-3.5 w-3.5" /> inspired by OpenMontage <ArrowRight className="h-3 w-3" />
          </a>
        </div>
      </header>

      <main className="relative z-10 flex-1 mx-auto max-w-6xl w-full px-4 sm:px-6 py-8 sm:py-12">
        <section className="text-center mb-10 sm:mb-12">
          <Badge variant="outline" className="mb-4 border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/15">
            <Sparkles className="h-3 w-3 mr-1.5" /> ffmpeg + librosa · powered pipeline
          </Badge>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight bg-gradient-to-br from-white via-fuchsia-100 to-cyan-200 bg-clip-text text-transparent">
            Turn any MP3 into a<br className="hidden sm:block" /> music-reactive video
          </h1>
          <p className="mt-4 text-sm sm:text-base text-slate-400 max-w-xl mx-auto">
            Drop in an audio file, pick a visualizer style and aspect ratio, and we&apos;ll render a beat-synced MP4 you can download.
          </p>
        </section>

        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6">
          {/* LEFT */}
          <div className="space-y-5">
            <Card className={cn("relative overflow-hidden border-2 border-dashed bg-white/[0.02] backdrop-blur-sm transition-all", dragOver ? "border-fuchsia-400 bg-fuchsia-500/10" : "border-white/15 hover:border-white/25", file && "border-solid border-emerald-400/40 bg-emerald-500/[0.04]")}>
              <CardContent className="p-0">
                <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} onClick={() => fileInputRef.current?.click()} className="px-6 py-10 sm:py-14 cursor-pointer flex flex-col items-center justify-center text-center">
                  <input ref={fileInputRef} type="file" accept=".mp3,audio/mpeg,audio/mp3" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                  <AnimatePresence mode="wait">
                    {!file ? (
                      <motion.div key="empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="flex flex-col items-center">
                        <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500/20 to-cyan-400/20 ring-1 ring-white/10 mb-4">
                          <Upload className="h-6 w-6 text-fuchsia-200" />
                        </div>
                        <div className="text-base font-medium">Drop an MP3 here</div>
                        <div className="text-xs text-slate-400 mt-1">or click to browse — only .mp3 files</div>
                      </motion.div>
                    ) : (
                      <motion.div key="file" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="flex flex-col items-center">
                        <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-400/30 mb-4">
                          <FileAudio className="h-6 w-6 text-emerald-200" />
                        </div>
                        <div className="text-base font-medium truncate max-w-full">{file.name}</div>
                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap justify-center">
                          <span>{formatFileSize(file.size)}</span>
                          {fileDuration && (<><span className="text-slate-600">•</span><span>{formatDuration(fileDuration)}</span></>)}
                          <span className="text-slate-600">•</span>
                          <button onClick={(e) => { e.stopPropagation(); onReset(); }} className="text-fuchsia-300 hover:text-fuchsia-200 underline-offset-2 hover:underline">change</button>
                        </div>
                        {fileDuration && fileDuration > 90 && style === "orb" && (
                          <div className="mt-2 text-[11px] text-amber-300/80 bg-amber-500/10 border border-amber-400/20 rounded px-2 py-1">
                            Est. render time: ~{formatDuration(fileDuration / 1.7)} (JARVIS orb renders at ~1.7× real-time)
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </CardContent>
            </Card>

            <div>
              <Label>Visualizer style</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                {STYLE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = style === opt.id;
                  return (
                    <button key={opt.id} type="button" onClick={() => setStyle(opt.id)} disabled={isRunning} className={cn("group relative text-left rounded-xl p-3 border transition-all", active ? "border-fuchsia-400 bg-fuchsia-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]", isRunning && "opacity-50 cursor-not-allowed")}>
                      <Icon className={cn("h-4 w-4 mb-2", active ? "text-fuchsia-300" : "text-slate-400")} />
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Aspect ratio</Label>
                <div className="flex gap-2 mt-2">
                  {ASPECT_OPTIONS.map((opt) => {
                    const active = aspect === opt.id;
                    return (
                      <button key={opt.id} type="button" onClick={() => setAspect(opt.id)} disabled={isRunning} className={cn("flex-1 rounded-lg p-2 border transition-all flex flex-col items-center gap-1", active ? "border-cyan-400 bg-cyan-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20", isRunning && "opacity-50 cursor-not-allowed")} title={opt.hint}>
                        <div className={cn("rounded-sm border-2", active ? "border-cyan-300" : "border-slate-500")} style={{ width: `${opt.w}px`, height: `${opt.h}px` }} />
                        <div className="text-[11px] font-medium">{opt.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label>Frame rate</Label>
                <ToggleGroup type="single" value={String(fps)} onValueChange={(v) => v && setFps(Number(v) as 30 | 60)} className="mt-2 grid grid-cols-2 gap-2" disabled={isRunning}>
                  <ToggleGroupItem value="30" className="data-[state=on]:bg-violet-500/20 data-[state=on]:border-violet-400 border border-white/10">30 fps</ToggleGroupItem>
                  <ToggleGroupItem value="60" className="data-[state=on]:bg-violet-500/20 data-[state=on]:border-violet-400 border border-white/10">60 fps</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            <div>
              <Label>Color theme</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {THEME_OPTIONS.map((opt) => {
                  const active = theme === opt.id;
                  return (
                    <button key={opt.id} type="button" onClick={() => setTheme(opt.id)} disabled={isRunning} className={cn("flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1.5 border transition-all", active ? "border-white/60 bg-white/10" : "border-white/10 hover:border-white/30", isRunning && "opacity-50 cursor-not-allowed")}>
                      <span className="h-5 w-5 rounded-full ring-1 ring-white/20" style={{ background: opt.swatch }} />
                      <span className="text-xs">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>Captions</Label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                {CAPTION_OPTIONS.map((opt) => {
                  const active = captions === opt.id;
                  return (
                    <button key={opt.id} type="button" onClick={() => setCaptions(opt.id)} disabled={isRunning} className={cn("group relative rounded-lg p-2 border transition-all flex flex-col items-center gap-1.5", active ? "border-emerald-400 bg-emerald-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20", isRunning && "opacity-50 cursor-not-allowed")}>
                      <div className="h-4 w-full rounded-sm" style={{ background: opt.preview }} />
                      <span className="text-[10px] font-medium">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
              {captions !== "off" && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/10 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Mic className="h-3.5 w-3.5 text-emerald-300" />
                    <span className="text-xs font-semibold text-slate-300">Spoken word</span>
                  </div>
                  <button type="button" role="switch" aria-checked={spokenWord} onClick={() => setSpokenWord(!spokenWord)} disabled={isRunning} className={cn("relative h-5 w-9 rounded-full transition-colors", spokenWord ? "bg-emerald-500" : "bg-white/15", isRunning && "opacity-50")}>
                    <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", spokenWord ? "translate-x-4" : "translate-x-0.5")} />
                  </button>
                </div>
              )}
              {captions !== "off" && (
                <p className="text-[10px] text-slate-500 mt-2">
                  {spokenWord ? "Optimized for speech: larger font, longer display, sensitive silence detection" : "Auto-transcribed via ASR — best for vocals over music"}
                </p>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-amber-300" />
                  <span className="text-xs font-semibold text-slate-300">Beat flash</span>
                </div>
                <button type="button" role="switch" aria-checked={beatFlash} onClick={() => setBeatFlash(!beatFlash)} disabled={isRunning} className={cn("relative h-5 w-9 rounded-full transition-colors", beatFlash ? "bg-amber-500" : "bg-white/15", isRunning && "opacity-50")}>
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", beatFlash ? "translate-x-4" : "translate-x-0.5")} />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 -mt-1">Flashes the screen on every detected beat (librosa)</p>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Scissors className="h-3.5 w-3.5 text-cyan-300" />
                  <span className="text-xs font-semibold text-slate-300">Trim audio</span>
                </div>
                <button type="button" role="switch" aria-checked={trimEnabled} onClick={() => setTrimEnabled(!trimEnabled)} disabled={isRunning || !fileDuration} className={cn("relative h-5 w-9 rounded-full transition-colors", trimEnabled ? "bg-cyan-500" : "bg-white/15", (isRunning || !fileDuration) && "opacity-50")}>
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", trimEnabled ? "translate-x-4" : "translate-x-0.5")} />
                </button>
              </div>
              {trimEnabled && fileDuration && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>{formatDuration(trimStart)}</span>
                    <span>{formatDuration(trimEnd)}</span>
                  </div>
                  <input type="range" min={0} max={Math.floor(fileDuration)} value={trimStart} onChange={(e) => setTrimStart(Math.min(Number(e.target.value), trimEnd - 1))} disabled={isRunning} className="w-full h-1.5 accent-cyan-400" />
                  <input type="range" min={0} max={Math.floor(fileDuration)} value={trimEnd} onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 1))} disabled={isRunning} className="w-full h-1.5 accent-cyan-400" />
                  <div className="text-[10px] text-slate-500">Rendering {formatDuration(trimEnd - trimStart)} of {formatDuration(fileDuration)}</div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-3.5 w-3.5 text-violet-300" />
                  <span className="text-xs font-semibold text-slate-300">Background</span>
                </div>
                <label className={cn("text-[10px] px-2 py-1 rounded border border-white/15 bg-white/[0.03] hover:bg-white/[0.06] cursor-pointer", isRunning && "opacity-50 pointer-events-none")}>
                  {backgroundFile ? backgroundFile.name.slice(0, 16) : "Upload…"}
                  <input type="file" accept="image/*,video/mp4,video/webm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setBackgroundFile(f); }} disabled={isRunning} />
                </label>
              </div>
              {backgroundFile && (
                <button onClick={() => setBackgroundFile(null)} className="text-[10px] text-slate-500 hover:text-slate-300">Remove background</button>
              )}

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Eye className="h-3.5 w-3.5 text-emerald-300" />
                  <span className="text-xs font-semibold text-slate-300">15s preview</span>
                </div>
                <button type="button" role="switch" aria-checked={previewMode} onClick={() => setPreviewMode(!previewMode)} disabled={isRunning} className={cn("relative h-5 w-9 rounded-full transition-colors", previewMode ? "bg-emerald-500" : "bg-white/15", isRunning && "opacity-50")}>
                  <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", previewMode ? "translate-x-4" : "translate-x-0.5")} />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 -mt-1">Quick 15-second render to test settings</p>
            </div>

            <Button size="lg" onClick={onGenerate} disabled={!file || isRunning} className="w-full h-12 text-base font-semibold bg-gradient-to-r from-fuchsia-500 to-cyan-400 hover:from-fuchsia-400 hover:to-cyan-300 text-black border-0 shadow-lg shadow-fuchsia-500/30 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed">
              {isRunning ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>) : (<><Sparkles className="h-4 w-4 mr-2" />Generate video</>)}
            </Button>
          </div>

          {/* RIGHT */}
          <div className="space-y-5">
            <Card className="bg-white/[0.02] border-white/10 backdrop-blur-sm">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Status</span>
                  {status.kind === "running" && status.etaSec ? (
                    <span className="text-xs text-slate-400 flex items-center gap-1.5"><Clock className="h-3 w-3" />{formatEta(status.etaSec)}</span>
                  ) : null}
                </div>
                <AnimatePresence mode="wait">
                  {status.kind === "idle" && (
                    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-8">
                      <div className="grid h-14 w-14 mx-auto place-items-center rounded-full bg-white/[0.03] ring-1 ring-white/10 mb-3">
                        <Film className="h-6 w-6 text-slate-500" />
                      </div>
                      <div className="text-sm text-slate-400">Drop an MP3 and hit <span className="text-fuchsia-300 font-medium">Generate video</span> to start.</div>
                    </motion.div>
                  )}
                  {status.kind === "running" && (
                    <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-fuchsia-300" />
                          {STAGE_LABELS[status.stage]}
                        </span>
                        <span className="text-2xl font-bold tabular-nums">{status.progress}<span className="text-sm text-slate-500">%</span></span>
                      </div>
                      <Progress value={status.progress} className="h-2.5 bg-white/10" />
                      <div className="text-xs text-slate-400 mt-2 min-h-[1rem]">{status.message}</div>
                    </motion.div>
                  )}
                  {status.kind === "done" && (
                    <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="flex items-center gap-2 mb-3 text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-sm font-medium">Render complete</span>
                      </div>
                    </motion.div>
                  )}
                  {status.kind === "error" && (
                    <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                      <div className="flex items-start gap-2 text-red-300">
                        <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">
                          <div className="font-medium mb-1">Render failed</div>
                          <div className="text-xs text-red-200/80 break-words font-mono">{status.message}</div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>

            {isDone && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                <Card className="bg-white/[0.02] border-white/10 backdrop-blur-sm overflow-hidden">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Preview</span>
                      <Badge variant="outline" className="border-emerald-400/30 text-emerald-300 bg-emerald-500/10">
                        <CheckCircle2 className="h-3 w-3 mr-1" />Ready
                      </Badge>
                    </div>
                    <div className="rounded-lg overflow-hidden bg-black ring-1 ring-white/10">
                      <video src={status.videoUrl} controls autoPlay loop playsInline className="w-full h-auto max-h-[60vh] object-contain bg-black" />
                    </div>
                    <div className="mt-4 flex flex-col sm:flex-row gap-2">
                      <Button onClick={async () => {
                        try {
                          setDownloading(true);
                          const res = await fetch(status.videoUrl);
                          if (!res.ok) throw new Error(`Download failed: ${res.status}`);
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `audio-montage-${status.jobId}.mp4`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        } catch {
                          window.open(status.videoUrl, "_blank");
                        } finally {
                          setDownloading(false);
                        }
                      }} disabled={downloading} className="flex-1 bg-gradient-to-r from-fuchsia-500 to-cyan-400 hover:from-fuchsia-400 hover:to-cyan-300 text-black border-0">
                        {downloading ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Downloading…</>) : (<><Download className="h-4 w-4 mr-2" />Download MP4</>)}
                      </Button>
                      <Button variant="outline" onClick={onReset} className="border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:text-white">
                        <RefreshCw className="h-4 w-4 mr-2" />Start over
                      </Button>
                    </div>
                    <div className="mt-4 pt-4 border-t border-white/10">
                      {!publishedUrl ? (
                        <Button onClick={onPublish} disabled={publishing} variant="outline" className="w-full border-fuchsia-400/30 bg-fuchsia-500/5 hover:bg-fuchsia-500/15 hover:text-white">
                          {publishing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Publishing to here.now…</>) : (<><Share2 className="h-4 w-4 mr-2" />Publish &amp; share to here.now</>)}
                        </Button>
                      ) : (
                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                          <div className="flex items-center gap-2 text-xs text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span className="font-medium">Published!</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input readOnly value={publishedUrl} className="flex-1 text-xs bg-white/[0.03] border border-white/10 rounded px-2 py-1.5 text-cyan-200 font-mono truncate" />
                            <Button size="sm" variant="outline" className="border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:text-white shrink-0" asChild>
                              <a href={publishedUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                            </Button>
                            <Button size="sm" variant="outline" className="border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:text-white shrink-0" onClick={() => { navigator.clipboard?.writeText(publishedUrl); }}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          <p className="text-[10px] text-slate-500">Shareable page with a &quot;Create your own&quot; CTA. Expires in 24h (anonymous).</p>
                        </motion.div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            <Card className="bg-white/[0.02] border-white/10">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">How it works</div>
                <ol className="space-y-2.5 text-sm text-slate-300">
                  <li className="flex gap-3"><span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-fuchsia-500/20 text-fuchsia-300 text-[10px] font-bold mt-0.5">1</span><span>Your MP3 is uploaded and probed with <code className="text-slate-200">ffprobe</code> to get its duration.</span></li>
                  <li className="flex gap-3"><span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-bold mt-0.5">2</span><span><code className="text-slate-200">ffmpeg</code> runs an audio-visualization filter at your chosen resolution &amp; FPS.</span></li>
                  <li className="flex gap-3"><span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-bold mt-0.5">3</span><span>Output is muxed with the original audio into an H.264/AAC MP4, saved to <code className="text-slate-200">/download/</code>.</span></li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/5 mt-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div>Built with ffmpeg + Next.js. Inspired by <a href="https://github.com/davenamovich/OpenMontage" target="_blank" rel="noreferrer" className="text-slate-300 hover:text-white underline-offset-2 hover:underline">OpenMontage</a>.</div>
          <div>Audio is processed in-process — nothing leaves the server.</div>
        </div>
      </footer>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold block">{children}</label>;
}
