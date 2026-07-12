#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
    cat <<'USAGE'
Usage:

  Capture a public URL:
    tools/process-route.sh GROUP NAME --url URL

  Import an already-saved authenticated page:
    tools/process-route.sh GROUP NAME --local "/path/to/page.html"

Examples:

  tools/process-route.sh customer login \
    --url "https://example.com/customer/login"

  tools/process-route.sh home index-logged-in \
    --local "/home/user/Downloads/page.html"
USAGE
}

if [ "$#" -lt 4 ]; then
    usage
    exit 1
fi

GROUP="$1"
NAME="$2"
MODE="$3"
SOURCE="$4"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CAPTURE_DIR="captures/$GROUP/$NAME"
ANALYSIS_DIR="analysis/$GROUP/$NAME"
PAGE_DIR="pages/$GROUP"

CAPTURE_FILE="$CAPTURE_DIR/$NAME.singlefile.html"
CLEAN_FILE="$PAGE_DIR/$NAME.html"
PREVIEW_FILE="$PAGE_DIR/$NAME-preview.html"

mkdir -p \
    "$CAPTURE_DIR" \
    "$ANALYSIS_DIR" \
    "$PAGE_DIR"

case "$MODE" in
    --url)
        URL="$SOURCE"

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
        echo "Capturing public route"
        echo "Name: $NAME"
        echo "URL:  $URL"
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
        ;;

    --local)
        LOCAL_FILE="$SOURCE"

        if [ ! -f "$LOCAL_FILE" ]; then
            echo "Local HTML file not found:"
            echo "$LOCAL_FILE"
            exit 1
        fi

        echo
        echo "Importing local authenticated capture"
        echo "Name:   $NAME"
        echo "Source: $LOCAL_FILE"
        echo

        cp -- "$LOCAL_FILE" "$CAPTURE_FILE"
        ;;

    *)
        usage
        exit 1
        ;;
esac

echo
echo "Analyzing HTML and CSS coverage..."

node tools/analyze-page.mjs \
    "$CAPTURE_FILE" \
    assets/css/bagisto-theme.css \
    "$ANALYSIS_DIR"

echo
echo "Cleaning framework runtime..."

node tools/clean-page.mjs \
    "$CAPTURE_FILE" \
    "$CLEAN_FILE"

echo
echo "Creating interactive preview..."

python3 - \
    "$CLEAN_FILE" \
    "$PREVIEW_FILE" <<'PY'
import os
import re
import sys
from pathlib import Path

clean_path = Path(sys.argv[1]).resolve()
preview_path = Path(sys.argv[2]).resolve()
root = Path.cwd().resolve()

theme_css = root / "assets/css/bagisto-theme.css"
fixes_css = root / "assets/css/port-fixes.css"
shell_js = root / "assets/js/site-shell.js"

if not clean_path.exists():
    raise SystemExit(f"Missing clean page: {clean_path}")

if not theme_css.exists():
    raise SystemExit(f"Missing theme CSS: {theme_css}")

html = clean_path.read_text(encoding="utf-8")

# Fix duplicated DOCTYPE produced by some browser/SingleFile imports.
html = re.sub(
    r"^(?:\s*<!DOCTYPE html>\s*)+",
    "<!DOCTYPE html>\n",
    html,
    flags=re.IGNORECASE,
)

if "</head>" not in html:
    raise SystemExit(f"No </head> found in {clean_path}")

if "</body>" not in html:
    raise SystemExit(f"No </body> found in {clean_path}")

def relative(asset: Path) -> str:
    return os.path.relpath(
        asset.resolve(),
        preview_path.parent.resolve(),
    ).replace(os.sep, "/")

head_assets = [
    (
        f'<link rel="stylesheet" '
        f'href="{relative(theme_css)}" '
        f'data-bagisto-theme-css>'
    ),
]

if fixes_css.exists():
    head_assets.append(
        f'<link rel="stylesheet" '
        f'href="{relative(fixes_css)}" '
        f'data-bagisto-port-fixes>'
    )

html = html.replace(
    "</head>",
    "\n".join(head_assets) + "\n</head>",
    1,
)

if shell_js.exists():
    script = (
        f'<script src="{relative(shell_js)}" '
        f'data-bagisto-shell-js defer></script>'
    )

    html = html.replace(
        "</body>",
        script + "\n</body>",
        1,
    )

preview_path.parent.mkdir(parents=True, exist_ok=True)
preview_path.write_text(html, encoding="utf-8")

print(f"Preview created: {preview_path}")
PY

echo
echo "Completed: $GROUP/$NAME"
echo "Capture:  $CAPTURE_FILE"
echo "Clean:    $CLEAN_FILE"
echo "Preview:  $PREVIEW_FILE"
echo "Analysis: $ANALYSIS_DIR"
echo
