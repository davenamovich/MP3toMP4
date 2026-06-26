import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return NextResponse.json({ error: "Missing or invalid jobId" }, { status: 400 });
  }
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found (may have expired after 30 min)" }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}
