import { NextRequest, NextResponse } from "next/server";
import { getVideoPath, getVideoSize } from "@/lib/audio-montage";
import { stat } from "fs/promises";
import { createReadStream } from "fs";
import { Readable } from "stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return NextResponse.json({ error: "Missing or invalid jobId" }, { status: 400 });
  }
  const vpath = await getVideoPath(jobId);
  if (!vpath) return NextResponse.json({ error: "Video not found" }, { status: 404 });
  const stats = await stat(vpath);
  const size = stats.size;
  const filename = `audio-montage-${jobId}.mp4`;

  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      const chunkSize = end - start + 1;
      const stream = createReadStream(vpath, { start, end });
      const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
  }

  const stream = createReadStream(vpath);
  const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function HEAD(req: NextRequest): Promise<Response> {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) return new Response(null, { status: 400 });
  const size = await getVideoSize(jobId);
  if (size === 0) return new Response(null, { status: 404 });
  return new Response(null, { status: 200, headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Accept-Ranges": "bytes" } });
}
