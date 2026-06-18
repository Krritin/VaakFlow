#!/usr/bin/env bash
# Run the VaakFlow backend (:8000) and frontend (:3000) together.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -x "backend/.venv/bin/python" ]]; then
  echo "Backend venv missing. Run: make setup-backend" >&2
  exit 1
fi
if [[ ! -d "apps/web/node_modules" ]]; then
  echo "Frontend deps missing. Run: make setup-web" >&2
  exit 1
fi

echo "▶ backend  → http://localhost:8000  (docs: /docs)"
( cd backend && PYTHONPATH=. .venv/bin/python -m uvicorn app.main:app --reload --port 8000 ) &
BACK=$!

echo "▶ frontend → http://localhost:3000  (dashboard: /dashboard)"
( cd apps/web && npm run dev ) &
FRONT=$!

trap 'echo; echo "stopping…"; kill $BACK $FRONT 2>/dev/null || true' INT TERM EXIT
wait
