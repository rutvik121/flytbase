#!/usr/bin/env bash
# Re-encode a source clip into a scrub-friendly web asset (+ optional poster).
#
#   ./scripts/encode-sequence.sh <source.mp4> [out-basename] [crf] [poster:yes|no]
#
#   ./scripts/encode-sequence.sh raw/mine.mp4  sqm-sequence   27 yes
#   ./scripts/encode-sequence.sh raw/world.mp4 world-pullout  25 no
#
# Scroll-scrubbing seeks constantly, so the encode uses a very short keyframe
# interval (-g 6). That costs bitrate but makes every seek land on or near an
# I-frame, which is what keeps the scrub smooth instead of snapping between
# distant keyframes. Set FFMPEG to point at a specific binary.
set -euo pipefail

SRC="${1:?usage: encode-sequence.sh <source-video> [out-basename] [crf] [poster]}"
OUT_NAME="${2:-sqm-sequence}"
CRF="${3:-27}"
POSTER="${4:-yes}"
OUT_DIR="$(cd "$(dirname "$0")/../public/media" && pwd)"
FFMPEG="${FFMPEG:-ffmpeg}"

"$FFMPEG" -y -i "$SRC" \
  -vf "scale=1280:-2,format=yuv420p" \
  -an \
  -c:v libx264 -profile:v high -crf "$CRF" \
  -g 6 -keyint_min 6 -sc_threshold 0 \
  -preset slow -movflags +faststart \
  "$OUT_DIR/$OUT_NAME.mp4"

if [ "$POSTER" = "yes" ]; then
  "$FFMPEG" -y -i "$OUT_DIR/$OUT_NAME.mp4" \
    -vf "select=eq(n\,0)" -frames:v 1 -update 1 -q:v 6 \
    "$OUT_DIR/$OUT_NAME-poster.jpg"
fi

ls -la "$OUT_DIR/$OUT_NAME".*
