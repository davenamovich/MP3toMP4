#!/usr/bin/env python3
"""Word-level transcription pipeline. Splits audio into short segments, ASRs each,
distributes words proportionally across time. Outputs word-group SRT."""
import sys, os, json, subprocess, tempfile, argparse, time
import librosa
import soundfile as sf
import numpy as np

def transcribe_chunk(wav_path: str) -> str:
    max_retries = 3
    for attempt in range(max_retries):
        try:
            result = subprocess.run(["z-ai", "asr", "-f", wav_path], capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                if "429" in result.stderr or "Too many requests" in result.stderr:
                    wait = 2 ** attempt
                    sys.stderr.write(f"transcribe_status=Rate limited, retrying in {wait}s…\n")
                    sys.stderr.flush()
                    time.sleep(wait)
                    continue
                return ""
            stdout = result.stdout
            lines = stdout.split("\n")
            for line in lines:
                line = line.strip()
                if line.startswith("{") and '"text"' in line:
                    try:
                        data = json.loads(line)
                        return data.get("text", "").strip()
                    except json.JSONDecodeError:
                        pass
            first = stdout.find("{")
            last = stdout.rfind("}")
            if first >= 0 and last > first:
                try:
                    data = json.loads(stdout[first:last+1])
                    return data.get("text", "").strip()
                except json.JSONDecodeError:
                    pass
            return ""
        except Exception as e:
            sys.stderr.write(f"transcribe_status=ASR error: {e}\n")
            sys.stderr.flush()
            return ""
    return ""

def format_srt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def split_into_word_groups(text: str, max_words: int = 3) -> list:
    words = text.split()
    if not words: return []
    groups = []
    for i in range(0, len(words), max_words):
        groups.append(" ".join(words[i:i+max_words]))
    return groups

def build_word_srt(segments: list, output_path: str):
    entries = []
    for start, end, text in segments:
        text = text.strip()
        if not text: continue
        groups = split_into_word_groups(text, max_words=3)
        n_groups = len(groups)
        if n_groups == 0: continue
        dur = end - start
        word_counts = [len(g.split()) for g in groups]
        total_words = sum(word_counts)
        cur = start
        for i, group in enumerate(groups):
            group_dur = dur * (word_counts[i] / total_words) if total_words > 0 else dur / n_groups
            group_end = cur + group_dur if i < n_groups - 1 else end
            if group_end - cur < 0.4: group_end = cur + 0.4
            entries.append((cur, group_end, group))
            cur = group_end
    with open(output_path, "w", encoding="utf-8") as f:
        for i, (start, end, text) in enumerate(entries, 1):
            f.write(f"{i}\n{format_srt_time(start)} --> {format_srt_time(end)}\n{text}\n\n")
    return len(entries)

def process(mp3_path: str, srt_path: str, spoken_word: bool = False):
    top_db = 30 if spoken_word else 35
    min_segment = 0.8 if spoken_word else 1.0
    max_chunk = 6.0
    merge_gap = 0.15
    sys.stderr.write(f"transcribe_status=Loading audio…\n")
    sys.stderr.flush()
    y, sr = librosa.load(mp3_path, sr=16000, mono=True)
    intervals = librosa.effects.split(y, top_db=top_db, frame_length=1024, hop_length=256)
    merged = []
    for start_s, end_s in intervals:
        start_sec = start_s / sr
        end_sec = end_s / sr
        if merged and start_sec - merged[-1][1] < merge_gap:
            merged[-1] = (merged[-1][0], end_sec)
        else:
            merged.append((start_sec, end_sec))
    merged = [(s, e) for s, e in merged if e - s >= min_segment]
    chunks = []
    for s, e in merged:
        if e - s <= max_chunk:
            chunks.append((s, e))
        else:
            cur = s
            while cur < e:
                nxt = min(cur + max_chunk, e)
                chunks.append((cur, nxt))
                cur = nxt
    total_chunks = len(chunks)
    sys.stderr.write(f"transcribe_status=Transcribing {total_chunks} segments…\n")
    sys.stderr.flush()
    segments_out = []
    with tempfile.TemporaryDirectory() as tmpdir:
        for i, (s, e) in enumerate(chunks):
            start_sample = int(s * sr)
            end_sample = int(e * sr)
            chunk_audio = y[start_sample:end_sample]
            wav_path = os.path.join(tmpdir, f"chunk_{i:04d}.wav")
            sf.write(wav_path, chunk_audio, sr, format="WAV", subtype="PCM_16")
            sys.stderr.write(f"transcribe_chunk={i+1}/{total_chunks}\n")
            pct = int(((i + 1) / total_chunks) * 100) if total_chunks > 0 else 100
            sys.stderr.write(f"transcribe_progress={pct}\n")
            sys.stderr.flush()
            text = transcribe_chunk(wav_path)
            if text: segments_out.append((s, e, text))
            time.sleep(0.5)
    entry_count = build_word_srt(segments_out, srt_path)
    sys.stderr.write(f"transcribe_segment_count={entry_count}\n")
    sys.stderr.write(f"transcribe_progress=100\n")
    if entry_count == 0:
        sys.stderr.write(f"transcribe_status=No speech detected (may be instrumental)\n")
    else:
        sys.stderr.write(f"transcribe_status=Done — {entry_count} word groups\n")
    sys.stderr.flush()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp3_path")
    ap.add_argument("srt_path")
    ap.add_argument("--spoken-word", action="store_true", dest="spoken_word")
    args = ap.parse_args()
    process(args.mp3_path, args.srt_path, spoken_word=args.spoken_word)

if __name__ == "__main__":
    main()
