#!/usr/bin/env python3
"""JARVIS-style HUD orb visualizer. Reads MP3, computes features with librosa,
renders HUD frames with PIL, pipes RGB to ffmpeg."""
import sys, os, subprocess, argparse, math
from typing import Tuple
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import librosa

def hex_to_rgb(h: str) -> Tuple[int, int, int]:
    h = h.strip()
    if h.startswith("0x") or h.startswith("0X"): h = h[2:]
    elif h.startswith("#"): h = h[1:]
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))

def make_radial_gradient(size: int, inner_color, outer_color, falloff=2.0) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cx = cy = size // 2
    y, x = np.ogrid[:size, :size]
    dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (size / 2)
    dist = np.clip(dist, 0, 1) ** falloff
    alpha = (1 - dist) * 255
    rgb = np.zeros((size, size, 3), dtype=np.uint8)
    for i in range(3):
        rgb[..., i] = (inner_color[i] * (1 - dist) + outer_color[i] * dist).astype(np.uint8)
    arr = np.dstack([rgb, alpha.astype(np.uint8)])
    return Image.fromarray(arr, "RGBA")

def make_background(w, h, bg_color, accent):
    img = Image.new("RGB", (w, h), bg_color)
    y, x = np.ogrid[:h, :w]
    cx, cy = w / 2, h / 2
    max_d = math.sqrt(cx ** 2 + cy ** 2)
    dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / max_d
    vignette = (dist * 80).astype(np.uint8)
    vign_img = Image.fromarray(vignette, "L")
    darker = Image.new("RGB", (w, h), (0, 0, 0))
    img = Image.composite(darker, img, vign_img)
    draw = ImageDraw.Draw(img, "RGBA")
    hex_r = 40
    hex_w = hex_r * math.sqrt(3)
    hex_h = hex_r * 1.5
    grid_color = (*accent, 18)
    for row in range(-1, int(h / hex_h) + 2):
        for col in range(-1, int(w / hex_w) + 2):
            cxh = col * hex_w + (hex_w / 2 if row % 2 else 0)
            cyh = row * hex_h
            pts = []
            for k in range(6):
                angle = math.pi / 3 * k + math.pi / 6
                px = cxh + hex_r * math.cos(angle)
                py = cyh + hex_r * math.sin(angle)
                pts.append((px, py))
            draw.line(pts + [pts[0]], fill=grid_color, width=1)
    cx, cy = w // 2, h // 2
    draw.line([(cx - 20, cy), (cx + 20, cy)], fill=(*accent, 30), width=1)
    draw.line([(cx, cy - 20), (cx, cy + 20)], fill=(*accent, 30), width=1)
    return img.convert("RGBA")

def make_orb_sprites(base_radius, primary):
    max_r = int(base_radius * 1.4)
    glow_full = make_radial_gradient(max_r * 4, primary, (0, 0, 0), falloff=2.5)
    glow_full = glow_full.filter(ImageFilter.GaussianBlur(radius=max_r * 0.2))
    body_full = make_radial_gradient(max_r * 2, (255, 255, 255), primary, falloff=1.6)
    body_full = body_full.filter(ImageFilter.GaussianBlur(radius=2))
    hl_size = int(max_r * 0.7)
    hl_full = make_radial_gradient(hl_size, (255, 255, 255), (255, 255, 255), falloff=2.0)
    hl_full = hl_full.filter(ImageFilter.GaussianBlur(radius=hl_size * 0.2))
    N_LEVELS = 12
    glow_levels, body_levels, hl_levels = [], [], []
    for i in range(N_LEVELS):
        e = i / (N_LEVELS - 1)
        r = base_radius * (1.0 + 0.3 * e)
        glow_w = int(r * 4)
        g = glow_full.resize((glow_w, glow_w), Image.LANCZOS)
        if e < 1.0:
            a = g.split()[3]
            a = a.point(lambda v, ev=e: int(v * (0.4 + 0.6 * ev)))
            g.putalpha(a)
        glow_levels.append(g)
        body_w = int(r * 2)
        b = body_full.resize((body_w, body_w), Image.LANCZOS)
        body_levels.append(b)
        hl_w = int(r * 0.5)
        h = hl_full.resize((hl_w, hl_w), Image.LANCZOS)
        a = h.split()[3]
        a = a.point(lambda v: int(v * 0.6))
        h.putalpha(a)
        hl_levels.append(h)
    return {"glow_levels": glow_levels, "body_levels": body_levels, "hl_levels": hl_levels, "n_levels": N_LEVELS, "max_r": max_r}

def draw_frequency_ring(base, cx, cy, ring_radius, mels, primary, secondary):
    n_bars = len(mels)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    inner_r = ring_radius
    for i in range(n_bars):
        angle = (i / n_bars) * 2 * math.pi - math.pi / 2
        h_norm = float(np.clip(mels[i], 0, 1))
        bar_len = 4 + h_norm * (ring_radius * 0.55)
        outer_r = inner_r + bar_len
        x1 = cx + inner_r * math.cos(angle)
        y1 = cy + inner_r * math.sin(angle)
        x2 = cx + outer_r * math.cos(angle)
        y2 = cy + outer_r * math.sin(angle)
        t = i / max(1, n_bars - 1)
        col = lerp_color(primary, secondary, t)
        alpha = int(120 + 135 * h_norm)
        width = max(2, int(ring_radius * 0.04))
        draw.line([(x1, y1), (x2, y2)], fill=(*col, alpha), width=width)
    base.alpha_composite(layer)

def draw_rotating_arc(base, cx, cy, radius, frame_idx, fps, primary):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    base_angle = (frame_idx / fps) * (math.pi / 15)
    arc_box = [cx - radius, cy - radius, cx + radius, cy + radius]
    start_deg = math.degrees(base_angle) % 360
    draw.arc(arc_box, start=start_deg, end=start_deg + 90, fill=(*primary, 160), width=2)
    draw.arc(arc_box, start=start_deg + 180, end=start_deg + 270, fill=(*primary, 100), width=2)
    for k in range(24):
        a = base_angle + (k * math.pi / 12)
        is_major = k % 6 == 0
        tick_len = radius * 0.08 if is_major else radius * 0.04
        r1 = radius + 6
        r2 = r1 + tick_len
        x1 = cx + r1 * math.cos(a)
        y1 = cy + r1 * math.sin(a)
        x2 = cx + r2 * math.cos(a)
        y2 = cy + r2 * math.sin(a)
        alpha = 180 if is_major else 80
        draw.line([(x1, y1), (x2, y2)], fill=(*primary, alpha), width=1 if not is_major else 2)
    base.alpha_composite(layer)

def draw_pulse_rings(base, cx, cy, rings, primary):
    if not rings: return
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    for ring in rings:
        r = ring["radius"]
        alpha = int(180 * ring["alpha"])
        if alpha <= 0: continue
        box = [cx - r, cy - r, cx + r, cy + r]
        draw.ellipse(box, outline=(*primary, alpha), width=2)
    base.alpha_composite(layer)

def draw_orb(base, cx, cy, base_radius, energy, brightness, sprites, primary):
    n = sprites["n_levels"]
    idx = min(n - 1, max(0, int(round(energy * (n - 1)))))
    glow = sprites["glow_levels"][idx]
    body = sprites["body_levels"][idx]
    hl = sprites["hl_levels"][idx]
    gw, gh = glow.size
    base.alpha_composite(glow, (cx - gw // 2, cy - gh // 2))
    bw, bh = body.size
    base.alpha_composite(body, (cx - bw // 2, cy - bh // 2))
    hw, hh = hl.size
    r = base_radius * (1.0 + 0.3 * energy)
    base.alpha_composite(hl, (cx - int(r * 0.35) - hw // 2, cy - int(r * 0.35) - hh // 2))

def draw_scanner_line(base, cx, cy, radius, frame_idx, fps, primary):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    angle = (frame_idx / fps) * (math.pi * 2 / 3)
    x2 = cx + radius * math.cos(angle)
    y2 = cy + radius * math.sin(angle)
    draw.line([(cx, cy), (x2, y2)], fill=(*primary, 100), width=1)
    base.alpha_composite(layer)

def render(mp3_path, output_path, w, h, fps, primary, secondary, bg, ass_path=None, beat_ass_path=None, bg_media_path=None):
    y, sr = librosa.load(mp3_path, sr=22050, mono=True)
    duration = len(y) / sr
    n_frames = max(1, int(duration * fps))
    hop = max(256, sr // fps)
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0]
    rms = np.pad(rms, (0, max(0, n_frames - len(rms))), mode="constant")
    rms_max = float(np.percentile(rms, 99)) if len(rms) > 0 else 1.0
    if rms_max <= 0: rms_max = 1.0
    rms_norm = np.clip(rms / rms_max, 0, 1) ** 0.7
    mel = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=64, hop_length=hop, fmax=8000)
    mel_db = librosa.power_to_db(mel, ref=np.max)
    mel_min, mel_max = float(mel_db.min()), float(mel_db.max())
    mel_norm = (mel_db - mel_min) / (mel_max - mel_min) if mel_max - mel_min >= 1e-6 else np.zeros_like(mel_db)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset_frames = set(librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop).tolist())
    onset_threshold = float(np.median(onset_env) * 1.4) if len(onset_env) > 0 else 0
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
    if len(centroid) > 1:
        c_min, c_max = float(centroid.min()), float(centroid.max())
        centroid_norm = (centroid - c_min) / (c_max - c_min + 1e-6) if c_max > c_min else np.zeros_like(centroid)
    else:
        centroid_norm = np.zeros(n_frames)

    if bg_media_path:
        bg_img = Image.open(bg_media_path).convert("RGBA")
        bg_ratio = bg_img.width / bg_img.height
        frame_ratio = w / h
        if bg_ratio > frame_ratio:
            new_h = h; new_w = int(h * bg_ratio)
        else:
            new_w = w; new_h = int(w / bg_ratio)
        bg_img = bg_img.resize((new_w, new_h), Image.LANCZOS)
        left = (new_w - w) // 2
        top = (new_h - h) // 2
        bg_img = bg_img.crop((left, top, left + w, top + h))
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 100))
        background = Image.alpha_composite(bg_img, overlay)
    else:
        background = make_background(w, h, bg, primary).convert("RGBA")
    cx, cy = w // 2, h // 2
    base_radius = min(w, h) * 0.16
    sprites = make_orb_sprites(int(base_radius), primary)

    ffmpeg_args = ["ffmpeg", "-y", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", f"{w}x{h}", "-framerate", str(fps), "-i", "-", "-i", mp3_path]
    if ass_path or beat_ass_path:
        vf_parts = []
        if ass_path:
            esc = ass_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")
            vf_parts.append(f"subtitles='{esc}'")
        if beat_ass_path:
            esc2 = beat_ass_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")
            vf_parts.append(f"subtitles='{esc2}'")
        ffmpeg_args += ["-vf", ",".join(vf_parts)]
    ffmpeg_args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-progress", "pipe:2", "-nostats", output_path]
    proc = subprocess.Popen(ffmpeg_args, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    pulse_rings = []
    last_progress_print = -1
    try:
        for i in range(n_frames):
            e = float(rms_norm[i]) if i < len(rms_norm) else 0
            br = float(centroid_norm[i]) if i < len(centroid_norm) else 0
            mel_col = mel_norm[:, min(i, mel_norm.shape[1] - 1)]
            on = float(onset_env[i]) if i < len(onset_env) else 0
            if i in onset_frames and on > onset_threshold:
                pulse_rings.append({"frame": i, "radius": base_radius, "alpha": 1.0})
            for ring in pulse_rings:
                age = i - ring["frame"]
                ring["radius"] = base_radius + age * (base_radius * 0.15)
                ring["alpha"] = max(0, 1 - age / 25)
            pulse_rings = [r for r in pulse_rings if r["alpha"] > 0]
            frame = background.copy()
            draw_pulse_rings(frame, cx, cy, pulse_rings, primary)
            draw_frequency_ring(frame, cx, cy, base_radius * 2.2, mel_col, primary, secondary)
            draw_rotating_arc(frame, cx, cy, base_radius * 1.55, i, fps, primary)
            draw_scanner_line(frame, cx, cy, base_radius * 0.95, i, fps, primary)
            draw_orb(frame, cx, cy, base_radius, e, br, sprites, primary)
            rgb_frame = frame.convert("RGB")
            try:
                proc.stdin.write(rgb_frame.tobytes())
            except BrokenPipeError:
                err = proc.stderr.read().decode("utf-8", errors="replace")
                sys.stderr.write("ffmpeg closed stdin early:\n" + err[-2000:])
                proc.wait()
                sys.exit(proc.returncode or 1)
            pct = int((i + 1) * 100 / n_frames)
            if pct > last_progress_print and (pct % 5 == 0 or i == n_frames - 1):
                last_progress_print = pct
                sys.stderr.write(f"orb_progress={pct}\n")
                sys.stderr.flush()
    finally:
        if proc.stdin:
            try: proc.stdin.close()
            except BrokenPipeError: pass
    stderr_data = b""
    try: stderr_data = proc.stderr.read()
    except: pass
    proc.wait()
    if proc.returncode != 0:
        sys.stderr.write(stderr_data.decode("utf-8", errors="replace")[-2000:])
        sys.exit(proc.returncode or 1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp3_path")
    ap.add_argument("output_path")
    ap.add_argument("width", type=int)
    ap.add_argument("height", type=int)
    ap.add_argument("fps", type=int)
    ap.add_argument("primary_hex")
    ap.add_argument("secondary_hex")
    ap.add_argument("bg_hex")
    ap.add_argument("--ass", default=None)
    ap.add_argument("--beat-ass", default=None, dest="beat_ass")
    ap.add_argument("--bg-media", default=None, dest="bg_media")
    args = ap.parse_args()
    primary = hex_to_rgb(args.primary_hex)
    secondary = hex_to_rgb(args.secondary_hex)
    bg = hex_to_rgb(args.bg_hex)
    render(args.mp3_path, args.output_path, args.width, args.height, args.fps, primary, secondary, bg, ass_path=args.ass, beat_ass_path=args.beat_ass, bg_media_path=args.bg_media)

if __name__ == "__main__":
    main()
