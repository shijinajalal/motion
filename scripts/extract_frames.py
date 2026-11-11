#!/usr/bin/env python3
"""
Inspect public/character.mp4 and pre-extract the cursor-tracking frame set.

Outputs
-------
public/frames/f00.webp .. f63.webp   64 frames along the 360 deg circular
                                     head-rotation trajectory (~5.625 deg apart)
public/frames/center.webp            neutral pose, direct eye contact
src/frameData.js                     ES module manifest (keyframes, face center,
                                     background gradient) consumed by the React app

Timeline (verified visually frame-by-frame, 302 frames @ 30 fps, 1920x1080):
    CENTER hold  0 - 16      neutral, looking at camera
    transition  16 - 24      center -> up
    UP          28           (hold 26-29)
    UP-RIGHT    48           (hold 44-51)
    RIGHT       76           (hold 72-79)
    DOWN-RIGHT  108          (hold 104-113)
    DOWN        152          (hold 150-156, eyes open after blink 144-149)
    DOWN-LEFT   177          (hold 174-181)
    LEFT        200          (hold 196-205)
    UP-LEFT     232          (hold 226-239)
    return     240 - 264     up-left -> center
    CENTER hold 285 - 301    neutral, direct eye contact  -> center.webp = 292

The video sweeps a full clockwise circle (viewer perspective):
    UP -> UP-RIGHT -> RIGHT -> DOWN-RIGHT -> DOWN -> DOWN-LEFT -> LEFT -> UP-LEFT
i.e. screen angle (atan2, y down) increases monotonically 270 -> 585 deg.
The final wedge UP-LEFT(225 deg) -> UP(270 deg) is never played as a pure
pose; we synthesize those 7 bins by horizontally mirroring the UP -> UP-RIGHT
segment (t 28..48), which maps angle a -> 180 - a, closing the circle with the
correct gaze direction and no alpha blending.
"""
import math
import os
import sys

import cv2
import numpy as np

VIDEO = "public/character.mp4"
OUT_DIR = "public/frames"
FRAME_JS = "src/frameData.js"
N = 64
STEP_DEG = 360.0 / N  # 5.625

# Verified compass keyframes (video frame numbers) + neutral end pose.
KEY = {
    "UP": 28,
    "UP-RIGHT": 48,
    "RIGHT": 76,
    "DOWN-RIGHT": 108,
    "DOWN": 152,
    "DOWN-LEFT": 177,
    "LEFT": 200,
    "UP-LEFT": 232,
    "CENTER": 292,
}

# Face centre in video pixel coords (eye-line midpoint), measured on frame 292.
FACE_X, FACE_Y = 955.0, 360.0
VID_W, VID_H = 1920, 1080

# Unwrapped trajectory anchors: screen angle (deg) -> video frame.
# Screen angle: 0=right, 90=down, 180=left, 270=up (atan2, y down).
ANCHORS = [
    (270.0, KEY["UP"]),
    (315.0, KEY["UP-RIGHT"]),
    (360.0, KEY["RIGHT"]),
    (405.0, KEY["DOWN-RIGHT"]),
    (450.0, KEY["DOWN"]),
    (495.0, KEY["DOWN-LEFT"]),
    (540.0, KEY["LEFT"]),
    (585.0, KEY["UP-LEFT"]),
]
GAP_START, GAP_END = 585.0, 630.0  # UP-LEFT -> UP wedge (mirrored segment)


# --------------------------------------------------------------------------- #
# Inspection
# --------------------------------------------------------------------------- #
def inspect(n_frames, fps, diffs):
    print("=" * 64)
    print(f"video          : {VIDEO}")
    print(f"frames         : {n_frames}")
    print(f"fps            : {fps:.3f}")
    print(f"duration       : {n_frames / fps:.3f}s")
    print(f"resolution     : {VID_W}x{VID_H}")
    print("=" * 64)

    diffs = np.asarray(diffs)
    print(f"motion diff    : mean={diffs.mean():.3f} min={diffs.min():.3f} max={diffs.max():.3f}")

    thr = diffs.mean() * 0.35
    stable, start = [], None
    for i, d in enumerate(diffs):
        if d < thr and start is None:
            start = i
        elif d >= thr and start is not None:
            if i - start >= 3:
                stable.append((start, i - 1))
            start = None
    if start is not None and len(diffs) - start >= 3:
        stable.append((start, len(diffs) - 1))
    print("stable holds   :", ", ".join(f"{a}-{b}" for a, b in stable) or "none")

    print("compass keyframes (verified):")
    for name in ["UP", "UP-RIGHT", "RIGHT", "DOWN-RIGHT", "DOWN",
                 "DOWN-LEFT", "LEFT", "UP-LEFT", "CENTER"]:
        t = KEY[name]
        print(f"  {name:<12s} frame {t:>3d}   t={t / fps:5.2f}s")


# --------------------------------------------------------------------------- #
# Circular trajectory -> video frame mapping
# --------------------------------------------------------------------------- #
def lerp(a, b, t):
    return a + (b - a) * t


def frame_for_angle(deg):
    """Return (video_frame, mirrored) for a screen angle in [0, 360)."""
    u = deg if deg >= 270.0 else deg + 360.0  # unwrap into [270, 630)
    if u <= GAP_START:
        for (a0, f0), (a1, f1) in zip(ANCHORS, ANCHORS[1:]):
            if u <= a1:
                t = (u - a0) / (a1 - a0)
                return int(round(lerp(f0, f1, t))), False
        return ANCHORS[-1][1], False
    if u < GAP_END:
        # mirrored wedge: source angle 540 - deg lies in (270, 315)
        src = 900.0 - u
        (a0, f0), (a1, f1) = ANCHORS[0], ANCHORS[1]
        t = (src - a0) / (a1 - a0)
        return int(round(lerp(f0, f1, t))), True
    return KEY["UP"], False


def build_bin_table():
    bins = []
    for i in range(N):
        deg = i * STEP_DEG
        f, mir = frame_for_angle(deg)
        bins.append((i, deg, f, mir))
    return bins


# --------------------------------------------------------------------------- #
# Background: fit a radial gradient from known-background sample rectangles
# --------------------------------------------------------------------------- #
BG_RECTS = [
    (0, 0, 340, VID_H),        # left strip (left of blazer)
    (1580, 0, VID_W, VID_H),   # right strip (right of blazer)
    (400, 80, 620, 460),       # left of head
    (1290, 80, 1560, 620),     # right of head
    (0, 0, VID_W, 45),         # above hair
]


def sample_background(frame):
    xs, ys, cols = [], [], []
    for x0, y0, x1, y1 in BG_RECTS:
        block = frame[y0:y1, x0:x1].reshape(-1, 3).astype(np.float32)
        step = max(1, len(block) // 6000)
        block = block[::step]
        cols.append(block)
        gx, gy = np.meshgrid(np.arange(x0, x1, step), np.arange(y0, y1, step))
        xs.append(gx.ravel()[: len(block)])
        ys.append(gy.ravel()[: len(block)])
    return np.concatenate(xs), np.concatenate(ys), np.concatenate(cols)


def fit_background(frame):
    xs, ys, cols = sample_background(frame)  # cols are BGR
    best = None
    for cx in range(760, 1201, 20):
        for cy in range(160, 561, 20):
            r = np.hypot(xs - cx, ys - cy)
            order = np.argsort(r)
            r, c = r[order], cols[order]
            # 8 quantile bins -> within-bin variance score
            edges = np.quantile(r, np.linspace(0, 1, 9))
            score, mids, meds = 0.0, [], []
            for k in range(8):
                m = (r >= edges[k]) & (r <= edges[k + 1] + 1e-6)
                if m.sum() < 10:
                    continue
                bc = np.median(c[m], axis=0)
                score += float(((c[m] - bc) ** 2).mean())
                mids.append(float(np.median(r[m])))
                meds.append(bc)
            if best is None or score < best[0]:
                best = (score, cx, cy, np.asarray(mids), np.asarray(meds))
    _, cx, cy, mids, meds = best

    # linear fit per channel (meds are BGR) vs radius, extrapolate to 0..rmax
    rgb = meds[:, ::-1]  # BGR -> RGB
    A = np.vstack([mids, np.ones_like(mids)]).T
    coeffs = [np.linalg.lstsq(A, rgb[:, ch], rcond=None)[0] for ch in range(3)]
    rmax = float(np.hypot(max(cx, VID_W - cx), max(cy, VID_H - cy)))
    stops = []
    for frac in (0.0, 0.22, 0.45, 0.7, 1.0):
        r = rmax * frac
        px = [c[0] * r + c[1] for c in coeffs]
        hexc = "#" + "".join(f"{int(round(min(255, max(0, v)))):02X}" for v in px)
        stops.append((round(frac * 100), hexc))

    center_hex = stops[0][1]
    edge_hex = stops[-1][1]
    grad = (f"radial-gradient(ellipse {rmax / VID_W * 100:.1f}% "
            f"{rmax / VID_H * 100:.1f}% at {cx / VID_W * 100:.1f}% "
            f"{cy / VID_H * 100:.1f}%, "
            + ", ".join(f"{h} {p}%" for p, h in stops) + ")")
    return {"center": center_hex, "edge": edge_hex, "css": grad,
            "cx": cx, "cy": cy}


# --------------------------------------------------------------------------- #
# Extraction
# --------------------------------------------------------------------------- #
def main():
    if not os.path.exists(VIDEO):
        sys.exit(f"missing {VIDEO}")
    cap = cv2.VideoCapture(VIDEO)
    if not cap.isOpened():
        sys.exit(f"cannot open {VIDEO}")
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    bins = build_bin_table()
    needed = {KEY["CENTER"]} | {f for _, _, f, _ in bins}
    print(f"\nbin mapping (64 frames, {STEP_DEG} deg steps):")
    for i, deg, f, mir in bins:
        if i % 8 == 0 or mir:
            tag = " [MIRROR]" if mir else ""
            print(f"  f{i:02d}  {deg:6.2f} deg -> video {f:>3d}{tag}")

    # Single sequential pass: motion profile + cache only the frames we need.
    # (The MP4 has ~1 keyframe; random seeking is unreliable, so never seek.)
    cache, diffs, prev = {}, [], None
    idx = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if idx in needed:
            cache[idx] = fr
        g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        if prev is not None:
            diffs.append(float(np.mean(cv2.absdiff(g, prev))))
        prev = g
        idx += 1
    cap.release()
    n = idx
    inspect(n, fps, diffs)

    missing = needed - set(cache)
    if missing:
        sys.exit(f"frames not decoded: {sorted(missing)}")

    center_frame = cache[KEY["CENTER"]]

    # background fit on the neutral end frame
    bg = fit_background(center_frame)
    print(f"\nbackground center hex : {bg['center']}")
    print(f"background edge hex   : {bg['edge']}")
    print(f"background gradient   : {bg['css']}")

    os.makedirs(OUT_DIR, exist_ok=True)

    # center.webp
    cv2.imwrite(os.path.join(OUT_DIR, "center.webp"), center_frame,
                [cv2.IMWRITE_WEBP_QUALITY, 93])

    # 64 circular frames
    q = 90
    for i, deg, f, mir in bins:
        fr = cache[min(max(f, 0), n - 1)]
        if mir:
            fr = np.ascontiguousarray(fr[:, ::-1])
        path = os.path.join(OUT_DIR, f"f{i:02d}.webp")
        if not cv2.imwrite(path, fr, [cv2.IMWRITE_WEBP_QUALITY, q]):
            sys.exit(f"failed writing {path}")

    total = sum(os.path.getsize(os.path.join(OUT_DIR, x))
                for x in os.listdir(OUT_DIR))
    print(f"\nwrote {OUT_DIR}/ (64 + center), total {total / 1e6:.2f} MB")

    # ES module manifest
    mirror_bins = [i for i, _, _, m in bins if m]
    os.makedirs("src", exist_ok=True)
    with open(FRAME_JS, "w") as fh:
        fh.write("// GENERATED by scripts/extract_frames.py — do not edit.\n")
        fh.write("export const FRAME_COUNT = %d;\n" % N)
        fh.write("export const FRAME_STEP_DEG = %s;\n" % STEP_DEG)
        fh.write("export const VIDEO_SIZE = { w: %d, h: %d };\n" % (VID_W, VID_H))
        fh.write("export const FACE_CENTER = { nx: %.6f, ny: %.6f };\n"
                 % (FACE_X / VID_W, FACE_Y / VID_H))
        fh.write("export const KEYFRAMES = %s;\n"
                 % str(KEY).replace("'", '"'))
        fh.write("export const MIRROR_BINS = %s;\n" % str(mirror_bins))
        fh.write("export const BACKGROUND = %s;\n"
                 % str({k: bg[k] for k in ("center", "edge", "css")}).replace("'", '"'))
        fh.write("export const BASE_FRAMES = `${import.meta.env.BASE_URL}frames/`;\n")
    print(f"wrote {FRAME_JS}")

    print("\nDONE: 64 trajectory frames + center.webp extracted with zero "
          "alpha blending (each file is one opaque pose).")


if __name__ == "__main__":
    main()
