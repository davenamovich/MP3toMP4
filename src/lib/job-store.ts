import { randomUUID } from "crypto";

export type JobStage =
  | "queued"
  | "upload"
  | "probe"
  | "transcribe"
  | "encode"
  | "finalize"
  | "done"
  | "error";

export interface JobState {
  jobId: string;
  stage: JobStage;
  progress: number;
  message: string;
  videoUrl?: string;
  error?: string;
  durationSec?: number;
  etaSec?: number;
  captionCount?: number;
  createdAt: number;
  updatedAt: number;
}

interface GlobalStore {
  __jobStore?: Map<string, JobState>;
  __jobCleanupTimer?: NodeJS.Timeout;
}

const globalStore = globalThis as unknown as GlobalStore;
if (!globalStore.__jobStore) {
  globalStore.__jobStore = new Map<string, JobState>();
}
const store = globalStore.__jobStore!;
const CLEANUP_MS = 30 * 60 * 1000;

export function createJob(): JobState {
  const jobId = randomUUID().slice(0, 8);
  const now = Date.now();
  const job: JobState = {
    jobId,
    stage: "queued",
    progress: 0,
    message: "Queued…",
    createdAt: now,
    updatedAt: now,
  };
  store.set(jobId, job);
  return job;
}

export function getJob(jobId: string): JobState | undefined {
  return store.get(jobId);
}

export function updateJob(
  jobId: string,
  patch: Partial<Omit<JobState, "jobId" | "createdAt">>
): void {
  const job = store.get(jobId);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
}

export function deleteJob(jobId: string): void {
  store.delete(jobId);
}

if (!globalStore.__jobCleanupTimer) {
  globalStore.__jobCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, job] of store) {
      if (
        (job.stage === "done" || job.stage === "error") &&
        now - job.updatedAt > CLEANUP_MS
      ) {
        store.delete(id);
      }
    }
  }, 5 * 60 * 1000);
}
