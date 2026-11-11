#!/usr/bin/env python3
"""Inspect character.mp4: frame count, timeline, background color, motion profile."""
import cv2
import numpy as np

VIDEO = "public/character.mp4"

cap = cv2.VideoCapture(VIDEO)
if not cap.isOpened():
    raise SystemExit(f"Cannot open {VIDEO}")

fps = cap.get(cv2.CAP_PROP_FPS)
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
print(f"fps={fps:.3f} frames={n} size={w}x{h} duration={n/fps:.3f}s")

# Sample every frame's corner color (background estimate) + diff vs prev
frames = []
bg_votes = {}
prev_gray = None
diffs = []
corner_samples = []

idx = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    frames.append(frame)
    # sample 4 corners 10x10 patches
    patches = [
        frame[0:10, 0:10], frame[0:10, w-10:w],
        frame[h-10:h, 0:10], frame[h-10:h, w-10:w],
    ]
    for p in patches:
        med = tuple(int(x) for x in np.median(p.reshape(-1, 3), axis=0))
        bg_votes[med] = bg_votes.get(med, 0) + 1
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    if prev_gray is not None:
        d = float(np.mean(cv2.absdiff(gray, prev_gray)))
        diffs.append(d)
    prev_gray = gray
    idx += 1

cap.release()
print(f"actually read {idx} frames")

# Most common background color
top_bg = sorted(bg_votes.items(), key=lambda kv: -kv[1])[:5]
print("top background colors (BGR, count):")
for c, cnt in top_bg:
    print(f"  {c}  #{c[2]:02X}{c[1]:02X}{c[0]:02X}  count={cnt}")

# Motion profile: print diff stats every 10 frames + find low-motion windows
diffs = np.array(diffs)
print(f"\nmotion diff: mean={diffs.mean():.2f} min={diffs.min():.2f} max={diffs.max():.2f}")

# Print a compact profile: 20 buckets
buckets = 20
per = max(1, len(diffs) // buckets)
print("\nmotion profile (bucket: mean diff):")
for b in range(buckets):
    s, e = b * per, (b + 1) * per if b < buckets - 1 else len(diffs)
    if s >= len(diffs):
        break
    print(f"  frames {s:4d}-{e:4d}: {diffs[s:e].mean():7.3f}")

# Find segments where diff below threshold (stable poses)
thr = diffs.mean() * 0.35
stable = diffs < thr
segments = []
start = None
for i, st in enumerate(stable):
    if st and start is None:
        start = i
    elif not st and start is not None:
        if i - start >= 3:
            segments.append((start, i - 1))
        start = None
if start is not None and len(diffs) - start >= 3:
    segments.append((start, len(diffs) - 1))
print(f"\nstable segments (diff < {thr:.2f}), {len(segments)} found:")
for s, e in segments:
    mid = (s + e) // 2
    print(f"  frames {s:4d}-{e:4d} (mid={mid}, len={e-s+1})")

# Also detect "holds" as local minima of a smoothed diff
kernel = np.ones(5) / 5
smooth = np.convolve(diffs, kernel, mode="same")
print("\nlocal minima of smoothed diff (potential pose holds):")
mins = []
for i in range(2, len(smooth) - 2):
    if smooth[i] <= smooth[i-1] and smooth[i] <= smooth[i+1] and smooth[i] < smooth.mean() * 0.6:
        if not mins or i - mins[-1] > 5:
            mins.append(i)
for i in mins:
    print(f"  frame {i:4d} smoothed_diff={smooth[i]:.3f}")
