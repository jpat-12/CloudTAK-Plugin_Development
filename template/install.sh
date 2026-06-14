#!/usr/bin/env bash
#
# install.sh — deploy this CloudTAK plugin into a CloudTAK checkout.
#
# A CloudTAK plugin has two halves that must land in two different places, then the API image
# must be rebuilt so both are baked in:
#   • plugin/      → <CloudTAK>/api/web/plugins/<NAME>/   (web half; entry = <NAME>/index.ts)
#   • server/*.ts  → <CloudTAK>/api/routes/               (server half; auto-loaded)
#
# CloudTAK's native WEB_PLUGINS env var canNOT install a two-half plugin: it clones the whole
# repo (nesting the web entry one level too deep for Vite's glob) and never installs the server
# routes. So we copy both halves into place ourselves and rebuild. See ../docs/04-build-install-deploy.md.
#
# Usage:
#   Install:  ./install.sh [/path/to/CloudTAK]
#   Update:   ./install.sh --pull [/path/to/CloudTAK]   (git pull this repo, then reinstall + rebuild)
#   Remove:   ./install.sh --remove [/path/to/CloudTAK]
#
# Options:
#   /path/to/CloudTAK   Your CloudTAK checkout (the dir containing docker-compose.yml). Default: ~/CloudTAK
#   --pull              git pull this plugin repo first (latest version).
#   --no-build          Copy/remove files only; skip the docker rebuild + restart.
#   --remove            Uninstall: delete the copied files, then rebuild.
#
# Requires: bash; git (only for --pull); and (unless --no-build) docker + docker compose.

set -euo pipefail

# Web-plugin dir name under api/web/plugins/. Must match the route paths/keys you chose.
# Change this to your plugin's name.
INSTALL_DIR_NAME="example"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() { sed -n '/^# Usage:/,/^# Requires:/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# --- parse args --------------------------------------------------------------------
CT_DIR=""; DO_BUILD=1; DO_PULL=0; ACTION="install"
for arg in "$@"; do
    case "$arg" in
        --pull)     DO_PULL=1 ;;
        --no-build) DO_BUILD=0 ;;
        --remove)   ACTION="remove" ;;
        -h|--help)  usage; exit 0 ;;
        -*)         echo "Unknown option: $arg" >&2; echo >&2; usage >&2; exit 2 ;;
        *)          CT_DIR="$arg" ;;
    esac
done
CT_DIR="${CT_DIR:-$HOME/CloudTAK}"

# --- validate the CloudTAK checkout ------------------------------------------------
[ -d "$CT_DIR" ]     || { echo "ERROR: CloudTAK dir not found: $CT_DIR" >&2; exit 1; }
[ -d "$CT_DIR/api" ] || { echo "ERROR: $CT_DIR is not a CloudTAK checkout (no api/ dir)." >&2; exit 1; }
if [ "$DO_BUILD" -eq 1 ] && [ ! -f "$CT_DIR/docker-compose.yml" ]; then
    echo "ERROR: no docker-compose.yml in $CT_DIR — re-run with --no-build to copy only." >&2; exit 1
fi

WEB_DEST="$CT_DIR/api/web/plugins/$INSTALL_DIR_NAME"
ROUTES_DEST="$CT_DIR/api/routes"

echo "CloudTAK:  $CT_DIR"
echo "Plugin:    $REPO_DIR"
echo "Action:    $ACTION"
echo

# --- optional self-update ----------------------------------------------------------
if [ "$DO_PULL" -eq 1 ]; then
    [ -d "$REPO_DIR/.git" ] || { echo "ERROR: --pull given but $REPO_DIR is not a git checkout." >&2; exit 1; }
    echo "Pulling latest plugin source..."; git -C "$REPO_DIR" pull; echo
fi

if [ "$ACTION" = "remove" ]; then
    # --- uninstall -----------------------------------------------------------------
    [ -d "$WEB_DEST" ] && { rm -rf "$WEB_DEST"; echo "Removed web plugin: api/web/plugins/$INSTALL_DIR_NAME"; }
    for src in "$REPO_DIR"/server/*.ts; do
        [ -e "$src" ] || continue
        fname="$(basename "$src")"
        [ -f "$ROUTES_DEST/$fname" ] && { rm -f "$ROUTES_DEST/$fname"; echo "Removed server route: api/routes/$fname"; }
    done
else
    # --- install / update ----------------------------------------------------------
    [ -d "$REPO_DIR/plugin" ] || { echo "ERROR: $REPO_DIR/plugin not found — run from the plugin repo." >&2; exit 1; }
    mkdir -p "$CT_DIR/api/web/plugins" "$ROUTES_DEST"

    # Web half: replace the dir wholesale so removed files don't linger, and so the entry lands
    # at the correct depth: api/web/plugins/<NAME>/index.ts
    rm -rf "$WEB_DEST"; cp -R "$REPO_DIR/plugin" "$WEB_DEST"
    echo "Installed web plugin: api/web/plugins/$INSTALL_DIR_NAME"

    # Server half: every *.ts in server/ → api/routes/
    shopt -s nullglob
    for src in "$REPO_DIR"/server/*.ts; do
        fname="$(basename "$src")"; cp "$src" "$ROUTES_DEST/$fname"
        echo "Installed server route: api/routes/$fname"
    done
    shopt -u nullglob
fi
echo

# --- rebuild -----------------------------------------------------------------------
if [ "$DO_BUILD" -eq 0 ]; then
    echo "Skipped rebuild (--no-build). To apply, run in $CT_DIR:"
    echo "    docker compose build --no-cache api && docker compose up -d --force-recreate api"
    exit 0
fi

echo "Rebuilding CloudTAK API image — this takes 5-15 minutes..."
( cd "$CT_DIR" && docker compose build --no-cache api )
echo "Restarting CloudTAK API container..."
( cd "$CT_DIR" && docker compose up -d --force-recreate api )

echo
if [ "$ACTION" = "remove" ]; then
    echo "✓ Plugin removed."
else
    echo "✓ Plugin installed."
    echo "  → In CloudTAK: Settings → Refresh App to activate the new service worker."
    echo "    (A hard refresh does NOT work — the service worker intercepts requests.)"
    echo "    The plugin appears at the bottom of the right-side menu."
fi
