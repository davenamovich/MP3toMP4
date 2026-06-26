#!/usr/bin/env python3
"""Generate beat-flash ASS from MP3 using librosa beat detection."""
import sys, argparse
import librosa
import numpy as np

def hex_to_rgb(h: str):
    h = h.strip()
    if h.startswith("0x") or h.startswith("0X"): h = h[2:]
    elif h.startswith("#"): h = h[1:]
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

def format_ass_time(sec: float) -> str:
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h}:{m:02d}:{s:05.2f}"

def build_beat_ass(mp3_path: str, ass_path: str, w: int, h: int, primary_hex: str):
    y, sr = librosa.load(mp3_path, sr=22050, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, aggregate=np.median)
    onset_at_beats = onset_env[beat_frames] if len(beat_frames) > 0 else np.array([])
    if len(onset_at_beats) > 0:
        omax = float(onset_at_beats.max())
        onset_norm = 0.3 + 0.7 * (onset_at_beats / omax) if omax > 0 else np.ones_like(onset_at_beats) * 0.5
    else:
        onset_norm = np.array([])
    r, g, b = hex_to_rgb(primary_hex)
    header = f"""[Script Info]
Title: Beat Flash
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Flash,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,1,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    flash_duration = 0.15
    for i, t in enumerate(beat_times):
        intensity = float(onset_norm[i]) if i < len(onset_norm) else 0.5
        start = t
        end = t + flash_duration
        peak_alpha_val = int((1.0 - intensity * 0.35) * 255)
        peak_alpha_hex = f"&H{peak_alpha_val:02X}&"
        draw_cmd = f"m 0 0 l {w} 0 l {w} {h} l 0 {h} 0 0"
        fade_in = 20
        fade_out = 130
        events.append(f"Dialogue: 0,{format_ass_time(start)},{format_ass_time(end)},Flash,,0,0,0,,{{\\alpha{peak_alpha_hex}\\fad({fade_in},{fade_out})\\p1}}{draw_cmd}{{\\p0}}")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header)
        f.write("\n".join(events))
        f.write("\n")
    sys.stderr.write(f"beat_count={len(beat_times)}\n")
    sys.stderr.flush()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp3_path")
    ap.add_argument("ass_path")
    ap.add_argument("width", type=int)
    ap.add_argument("height", type=int)
    ap.add_argument("primary_hex")
    args = ap.parse_args()
    build_beat_ass(args.mp3_path, args.ass_path, args.width, args.height, args.primary_hex)

if __name__ == "__main__":
    main()
