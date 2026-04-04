#!/bin/bash
# Stop hook for jira-relay spawned Claude sessions.
# Checks if the impl checkpoint reached step 10 before allowing stop.
# If not, blocks the stop so Claude continues working.
#
# Expected env: CLAUDE_PROJECT_DIR (set by Claude Code)
# Reads: .devflow/checkpoint-*.json

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Find the most recent checkpoint file
CHECKPOINT=$(ls -t "$PROJECT_DIR"/.devflow/checkpoint-*.json 2>/dev/null | head -1)

if [ -z "$CHECKPOINT" ]; then
  # No checkpoint file - might be plan phase or early in impl. Allow stop.
  echo '{"decision": "allow"}'
  exit 0
fi

# Read the step from checkpoint
STEP=$(cat "$CHECKPOINT" 2>/dev/null | grep -o '"step":[0-9]*' | grep -o '[0-9]*')

if [ -z "$STEP" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

if [ "$STEP" -ge 10 ]; then
  # All steps complete
  echo '{"decision": "allow"}'
else
  echo "{\"decision\": \"block\", \"reason\": \"Checkpoint at step $STEP/10. Continue working - steps $((STEP+1))-10 remain.\"}"
fi
