import { NextRequest, NextResponse } from "next/server";
import { getVideoPath } from "@/lib/audio-montage";
import { stat } from "fs/promises";
import { readFile } from "fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const HERENOW_API = "https://here.now/api/v1/publish";

interface HerenowCreateResponse {
  siteUrl?: string;
  upload?: {
    versionId: string;
    uploads: Array<{ path: string; url: string; headers?: Record<string, string> }>;
    finalizeUrl: string;
  };
}

function buildSharePage(videoFilename: string, appOrigin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Audio Montage — music-reactive video</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #070710; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 2rem 1rem; }
  .container { max-width: 720px; width: 100%; }
  h1 { font-size: 1.5rem; background: linear-gradient(135deg, #f0abfc, #67e8f9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin-bottom: 0.5rem; }
  .subtitle { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
  video { width: 100%; border-radius: 0.75rem; box-shadow: 0 0 40px rgba(217, 70, 239, 0.2); }
  .cta { display: block; text-align: center; margin-top: 1.5rem; padding: 1rem 2rem; background: linear-gradient(135deg, #d946ef, #22d3ee); color: #000; text-decoration: none; font-weight: 700; border-radius: 0.5rem; font-size: 1.05rem; transition: transform 0.15s; }
  .cta:hover { transform: scale(1.02); }
  .footer { margin-top: 2rem; color: #475569; font-size: 0.75rem; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <h1>Audio Montage</h1>
  <p class="subtitle">A music-reactive video — made with ffmpeg + librosa</p>
  <video src="${videoFilename}" controls autoplay loop playsinline></video>
  <a class="cta" href="${appOrigin}" target="_blank" rel="noreferrer">✨ Create your own songs for free →</a>
  <p class="footer">Powered by Audio Montage · Published via here.now</p>
</div>
</body>
</html>`;
}

export async function POST(req: NextRequest): Promise<Response> {
  const { jobId } = (await req.json()) as { jobId?: string };
  if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return NextResponse.json({ error: "Missing or invalid jobId" }, { status: 400 });
  }
  const videoPath = await getVideoPath(jobId);
  if (!videoPath) return NextResponse.json({ error: "Video not found" }, { status: 404 });

  const videoStat = await stat(videoPath);
  const videoSize = videoStat.size;
  const videoData = await readFile(videoPath);
  const appOrigin = `https://${req.headers.get("host") || "preview-zai.space-z.ai"}`;
  const html = buildSharePage("video.mp4", appOrigin);
  const htmlSize = Buffer.byteLength(html, "utf-8");

  const createBody = {
    files: [
      { path: "index.html", size: htmlSize, contentType: "text/html; charset=utf-8" },
      { path: "video.mp4", size: videoSize, contentType: "video/mp4" },
    ],
  };

  const createRes = await fetch(HERENOW_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HereNow-Client": "audio-montage/app" },
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    return NextResponse.json({ error: `here.now create failed (${createRes.status}): ${errText.slice(0, 300)}` }, { status: 502 });
  }

  const createData = (await createRes.json()) as HerenowCreateResponse;
  if (!createData.upload?.uploads || createData.upload.uploads.length < 2 || !createData.upload.finalizeUrl) {
    return NextResponse.json({ error: "here.now returned unexpected response structure" }, { status: 502 });
  }

  const htmlUpload = createData.upload.uploads.find((u) => u.path === "index.html")!;
  const videoUpload = createData.upload.uploads.find((u) => u.path === "video.mp4")!;
  const versionId = createData.upload.versionId;

  const [htmlPutRes, videoPutRes] = await Promise.all([
    fetch(htmlUpload.url, { method: "PUT", headers: { "Content-Type": "text/html; charset=utf-8" }, body: html }),
    fetch(videoUpload.url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: videoData }),
  ]);
  if (!htmlPutRes.ok || !videoPutRes.ok) {
    return NextResponse.json({ error: `Upload failed: html=${htmlPutRes.status}, video=${videoPutRes.status}` }, { status: 502 });
  }

  const finalizeRes = await fetch(createData.upload.finalizeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HereNow-Client": "audio-montage/app" },
    body: JSON.stringify({ versionId }),
  });
  if (!finalizeRes.ok) {
    const errText = await finalizeRes.text().catch(() => "");
    return NextResponse.json({ error: `here.now finalize failed (${finalizeRes.status}): ${errText.slice(0, 300)}` }, { status: 502 });
  }

  const finalizeData = (await finalizeRes.json()) as { siteUrl?: string };
  const siteUrl = finalizeData.siteUrl || createData.siteUrl;
  if (!siteUrl) return NextResponse.json({ error: "here.now did not return a siteUrl" }, { status: 502 });

  return NextResponse.json({ siteUrl });
}
