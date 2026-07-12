#!/usr/bin/env bash

set -Eeuo pipefail

NAME="${1:?Usage: tools/process-page.sh NAME URL}"
URL="${2:?Usage: tools/process-page.sh NAME URL}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CAPTURE_DIR="captures/products/$NAME"
ANALYSIS_DIR="analysis/products/$NAME"
PAGES_DIR="pages/products"

CAPTURE_FILE="$CAPTURE_DIR/$NAME.singlefile.html"
CLEAN_FILE="$PAGES_DIR/$NAME.html"
PREVIEW_FILE="$PAGES_DIR/$NAME-preview.html"

mkdir -p \
    "$CAPTURE_DIR" \
    "$ANALYSIS_DIR" \
    "$PAGES_DIR"

BROWSER="$(
    command -v google-chrome ||
    command -v chromium ||
    command -v chromium-browser ||
    true
)"

if [ -z "$BROWSER" ]; then
    echo "Chrome or Chromium was not found."
    exit 1
fi

echo
echo "Capturing: $NAME"
echo "URL:       $URL"
echo

npx single-file \
    "$URL" \
    "$CAPTURE_FILE" \
    --browser-executable-path="$BROWSER" \
    --browser-width=1440 \
    --browser-height=1400 \
    --browser-wait-until=networkAlmostIdle \
    --browser-load-max-time=120000 \
    --browser-capture-max-time=120000 \
    --browser-wait-delay=10000 \
    --load-deferred-images=true \
    --load-deferred-images-dispatch-scroll-event=true \
    --load-deferred-images-max-idle-time=3000 \
    --block-scripts=false \
    --remove-hidden-elements=false \
    --remove-unused-styles=false \
    --remove-unused-fonts=false \
    --remove-alternative-fonts=false \
    --remove-alternative-medias=false \
    --remove-alternative-images=false \
    --compress-HTML=false \
    --compress-CSS=false \
    --move-styles-in-head=true \
    --filename-conflict-action=overwrite \
    --console-messages-file="$CAPTURE_DIR/console.json" \
    --errors-file="$CAPTURE_DIR/errors.json"

echo
echo "Analyzing HTML versus compiled CSS..."
echo

node tools/analyze-page.mjs \
    "$CAPTURE_FILE" \
    assets/css/bagisto-theme.css \
    "$ANALYSIS_DIR"

echo
echo "Cleaning React, Next.js, and SingleFile runtime content..."
echo

node tools/clean-page.mjs \
    "$CAPTURE_FILE" \
    "$CLEAN_FILE"

cp "$CLEAN_FILE" "$PREVIEW_FILE"
node tools/refresh-previews.mjs "$PREVIEW_FILE"

echo
echo "Completed: $NAME"
echo "Capture:  $CAPTURE_FILE"
echo "Clean:    $CLEAN_FILE"
echo "Preview:  $PREVIEW_FILE"
echo "Analysis: $ANALYSIS_DIR"
echo
