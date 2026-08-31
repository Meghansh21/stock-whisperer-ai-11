#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# SmallCap Signal — Python ML Backend startup script
# Usage:
#   chmod +x start.sh && ./start.sh              # development (auto-reload)
#   ./start.sh --prod                            # production (no reload)
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Create / activate virtual environment ────────────────────────────────────
if [ ! -d ".venv" ]; then
  echo "🐍  Creating virtual environment…"
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

# ── Install / upgrade dependencies ───────────────────────────────────────────
echo "📦  Installing dependencies…"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# ── Load .env if present ─────────────────────────────────────────────────────
if [ -f ../.env ]; then
  set -a
  # shellcheck disable=SC1091
  source ../.env
  set +a
  echo "✅  Loaded environment from ../.env"
fi

# ── Determine run mode ───────────────────────────────────────────────────────
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

if [[ "${1:-}" == "--prod" ]]; then
  echo "🚀  Starting in PRODUCTION mode on ${HOST}:${PORT}"
  uvicorn main:app --host "$HOST" --port "$PORT" --workers 2
else
  echo "🔧  Starting in DEVELOPMENT mode on ${HOST}:${PORT} (auto-reload)"
  uvicorn main:app --host "$HOST" --port "$PORT" --reload
fi
