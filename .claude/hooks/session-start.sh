#!/bin/bash
set -euo pipefail

# ClipWise bootstrap for Claude Code on the web: install Node deps so the agent
# can build / lint / review immediately in a fresh container. Local machines
# already have node_modules, so skip there.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
npm install --no-audit --no-fund
