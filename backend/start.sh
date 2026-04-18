#!/usr/bin/env bash
# Start the SVG Workshop backend.
# Usage: ./backend/start.sh
set -e
cd "$(dirname "$0")"
exec python -m uvicorn main:app --host 127.0.0.1 --port 5174 --reload
