#!/usr/bin/env python3
"""Convert SRT to styled ASS. Word-level: each entry fades in quickly (live caption feel).
Font sizes target ~5.5-6% of frame height."""
import sys, re

def scale_fonts(base_style: dict, video_h: int) -> dict:
    scale = video_h / 720.0
    s = dict(base_style)
    s["fontsize"] = max(14, int(base_style["fontsize"] * scale))
    s["outline"] = max(1, round(base_style["outline"] * scale))
    s["shadow"] = max(0, round(base_style["shadow"] * scale))
    s["margin_v"] = max(20, int(base_style["margin_v"] * scale))
    s["margin_l"] = max(20, int(base_style.get("margin_l", 40) * scale))
    s["margin_r"] = max(20, int(base_style.get("margin_r", 40) * scale))
    return s

STYLES_BASE = {
    "clean": {"fontname": "Liberation Sans", "fontsize": 42, "primary_colour": "&H00FFFFFF", "outline_colour": "&H00000000", "back_colour": "&H00000000", "bold": 1, "outline": 3, "shadow": 0, "alignment": 2, "margin_v": 60, "margin_l": 40, "margin_r": 40},
    "neon": {"fontname": "Liberation Sans", "fontsize": 44, "primary_colour": "&H00FFFF00", "outline_colour": "&H00FF00FF", "back_colour": "&H00000000", "bold": 1, "outline": 4, "shadow": 0, "alignment": 2, "margin_v": 60, "margin_l": 40, "margin_r": 40},
    "karaoke": {"fontname": "Liberation Sans", "fontsize": 46, "primary_colour": "&H0000FFFF", "outline_colour": "&H00000000", "back_colour": "&H00000000", "bold": 1, "outline": 3, "shadow": 0, "alignment": 2, "margin_v": 80, "margin_l": 40, "margin_r": 40},
    "top": {"fontname": "Liberation Sans", "fontsize": 42, "primary_colour": "&H00FFFFFF", "outline_colour": "&H00000000", "back_colour": "&H00000000", "bold": 1, "outline": 3, "shadow": 0, "alignment": 8, "margin_v": 40, "margin_l": 40, "margin_r": 40},
}

def srt_time_to_ass(time_str: str) -> str:
    m = re.match(r"(\d+):(\d+):(\d+),(\d+)", time_str)
    if not m: return "0:00:00.00"
    h, mn, s, ms = m.groups()
    total_s = int(h) * 3600 + int(mn) * 60 + int(s) + int(ms) / 1000
    h_out = int(total_s // 3600)
    m_out = int((total_s % 3600) // 60)
    s_out = total_s % 60
    return f"{h_out}:{m_out:02d}:{s_out:05.2f}"

def escape_ass_text(text: str) -> str:
    text = text.replace("\\", "\\\\")
    text = text.replace("{", "\\{")
    text = text.replace("}", "\\}")
    text = text.replace("\n", "\\N")
    return text

def build_ass(srt_path: str, ass_path: str, style_name: str = "clean", video_w: int = 1280, video_h: int = 720):
    if style_name not in STYLES_BASE: style_name = "clean"
    s = scale_fonts(STYLES_BASE[style_name], video_h)
    header = f"""[Script Info]
Title: Audio Montage Captions
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{s['fontname']},{s['fontsize']},{s['primary_colour']},&H000000FF,{s['outline_colour']},{s['back_colour']},{s['bold']},0,0,0,100,100,0,0,1,{s['outline']},{s['shadow']},{s['alignment']},{s['margin_l']},{s['margin_r']},{s['margin_v']},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    with open(srt_path, "r", encoding="utf-8") as f:
        content = f.read()
    blocks = re.split(r"\n\s*\n", content.strip())
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3: continue
        time_match = re.match(r"(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)", lines[1])
        if not time_match: continue
        start = srt_time_to_ass(time_match.group(1))
        end = srt_time_to_ass(time_match.group(2))
        text = " ".join(lines[2:]).strip()
        if not text: continue
        text = escape_ass_text(text)
        events.append(f"Dialogue: 0,{start},{end},Caption,,0,0,0,,{{\\fad(50,100)}}{text}")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header)
        f.write("\n".join(events))
        f.write("\n")
    sys.stderr.write(f"srt_to_ass: style={style_name} fontsize={s['fontsize']} entries={len(events)} ({video_w}x{video_h})\n")
    sys.stderr.flush()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: srt_to_ass.py <srt_path> <ass_path> [style] [w] [h]", file=sys.stderr)
        sys.exit(1)
    style = sys.argv[3] if len(sys.argv) > 3 else "clean"
    w = int(sys.argv[4]) if len(sys.argv) > 4 else 1280
    h = int(sys.argv[5]) if len(sys.argv) > 5 else 720
    build_ass(sys.argv[1], sys.argv[2], style, w, h)
