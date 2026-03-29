#!/usr/bin/env bash
set -euo pipefail

# dev-env.sh - Dev environment management via git worktrees
# Reads .dev-env.yml config from project root

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Find project root (git toplevel or where .dev-env.yml lives) ---
find_project_root() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    [ -f "$dir/.dev-env.yml" ] && { echo "$dir"; return; }
    dir="$(dirname "$dir")"
  done
  # Fallback to git toplevel
  git rev-parse --show-toplevel 2>/dev/null || { echo "Error: not in a git repo" >&2; exit 1; }
}

PROJECT_ROOT="$(find_project_root)"
CONFIG="$PROJECT_ROOT/.dev-env.yml"
PORTS_FILE="$PROJECT_ROOT/.worktree-ports"

# --- Minimal YAML parser (no dependencies) ---
yaml_get() {
  local key="$1" file="${2:-$CONFIG}"
  grep "^${key}:" "$file" 2>/dev/null | sed "s/^${key}:[[:space:]]*//" | sed 's/[[:space:]]*$//'
}

yaml_get_nested() {
  local key="$1" file="${2:-$CONFIG}"
  # For nested keys like "scripts.up", find indented value after parent
  local parent="${key%%.*}"
  local child="${key#*.}"
  awk "/^${parent}:/{found=1; next} found && /^[^ ]/{found=0} found && /^  ${child}:/{gsub(/^  ${child}:[[:space:]]*/, \"\"); print; exit}" "$file"
}

yaml_list() {
  local key="$1" field="$2" file="${3:-$CONFIG}"
  # Match "- field:" at any indent level
  awk "/- ${field}:/{gsub(/.*- ${field}:[[:space:]]*/, \"\"); print}" "$file"
}

# --- Read config ---
read_config() {
  if [ ! -f "$CONFIG" ]; then
    echo "Error: .dev-env.yml not found in $PROJECT_ROOT"
    echo "Run /dev:init to create one."
    exit 1
  fi

  PROJECT_NAME=$(yaml_get "name")
  WORKTREE_DIR=$(yaml_get_nested "worktrees.dir")
  [ -z "$WORKTREE_DIR" ] && WORKTREE_DIR=".worktrees"

  # Read repos list
  REPOS=()
  while IFS= read -r path; do
    [ -n "$path" ] && REPOS+=("$path")
  done <<< "$(yaml_list "repos" "path")"

  # If no repos listed, single-repo mode
  if [ ${#REPOS[@]} -eq 0 ]; then
    REPOS=(".")
  fi

  # Read custom scripts
  SCRIPT_UP=$(yaml_get_nested "scripts.up")
  SCRIPT_DOWN=$(yaml_get_nested "scripts.down")
  SCRIPT_STATUS=$(yaml_get_nested "scripts.status")

  # Detect service types
  SERVICE_TYPES=()
  for svc_type in $(awk '/^  [a-z]/{key=$0; next} /type:/{if(key) print}' "$CONFIG" | sed 's/.*type:[[:space:]]*//'); do
    SERVICE_TYPES+=("$svc_type")
  done
}

# --- Colors ---
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

ok() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
warn() { echo -e "  ${YELLOW}●${NC} $1"; }

# --- Strip branch prefix ---
short_name() {
  echo "$1" | sed -E 's|^(feature|fix|update|refactor)/||'
}

# --- Actions ---

action_list() {
  read_config

  echo -e "${BOLD}=== Dev Environments: $PROJECT_NAME ===${NC}"
  echo ""

  # If custom status script, use it
  if [ -n "$SCRIPT_STATUS" ]; then
    cd "$PROJECT_ROOT" && $SCRIPT_STATUS 2>&1
    echo ""
  fi

  # Show git worktrees from all repos
  local all_worktrees=()
  for repo in "${REPOS[@]}"; do
    local repo_path="$PROJECT_ROOT/$repo"
    [ ! -d "$repo_path/.git" ] && [ ! -f "$repo_path/.git" ] && continue

    local repo_name=$(basename "$repo")
    while IFS= read -r line; do
      local wt_path=$(echo "$line" | awk '{print $1}')
      local wt_branch=$(echo "$line" | sed 's/.*\[//' | sed 's/\]//')

      # Skip main worktree
      echo "$wt_path" | grep -q "/$WORKTREE_DIR/" || continue

      local wt_name=$(basename "$wt_path")
      # Track unique worktree names
      local found=false
      for existing in "${all_worktrees[@]:-}"; do
        [ "$existing" = "$wt_name" ] && { found=true; break; }
      done
      $found || all_worktrees+=("$wt_name")
    done <<< "$(cd "$repo_path" && git worktree list 2>/dev/null)"
  done

  if [ ${#all_worktrees[@]} -eq 0 ]; then
    echo "No worktrees found."
    echo ""
    echo "Create one with: /dev:env create <branch>"
    return
  fi

  # Show each worktree with status
  local idx=1
  for wt_name in "${all_worktrees[@]}"; do
    local repos_with=""
    for repo in "${REPOS[@]}"; do
      local repo_path="$PROJECT_ROOT/$repo"
      local repo_name=$(basename "$repo")
      [ -d "$repo_path/$WORKTREE_DIR/$wt_name" ] && repos_with="$repos_with $repo_name"
    done
    repos_with=$(echo "$repos_with" | sed 's/^ //')

    # Check infra status if ports file exists
    local status="${RED}no infra${NC}"
    if [ -f "$PORTS_FILE" ] && grep -q "^$wt_name " "$PORTS_FILE"; then
      local port=$(grep "^$wt_name " "$PORTS_FILE" | awk '{print $2}')
      if lsof -ti :"$port" >/dev/null 2>&1; then
        status="${GREEN}running${NC}"
      else
        status="${YELLOW}stopped${NC}"
      fi
    fi

    echo -e "  [$idx] ${BOLD}$wt_name${NC}  [${status}]  repos: $repos_with"
    idx=$((idx + 1))
  done
  echo ""
}

action_create() {
  local branch="$1"
  local name=$(short_name "$branch")
  read_config

  echo -e "${BOLD}=== Creating dev environment: $name ===${NC}"
  echo ""

  # Create worktrees
  for repo in "${REPOS[@]}"; do
    local repo_path="$PROJECT_ROOT/$repo"
    local repo_name=$(basename "$repo")
    [ ! -d "$repo_path/.git" ] && [ ! -f "$repo_path/.git" ] && continue

    local wt_path="$repo_path/$WORKTREE_DIR/$name"
    if [ -d "$wt_path" ]; then
      warn "$repo_name: worktree already exists"
      continue
    fi

    # Check if branch exists
    local branch_exists=false
    (cd "$repo_path" && git rev-parse --verify "$branch" >/dev/null 2>&1) && branch_exists=true
    (cd "$repo_path" && git rev-parse --verify "origin/$branch" >/dev/null 2>&1) && branch_exists=true

    if $branch_exists; then
      mkdir -p "$repo_path/$WORKTREE_DIR"
      (cd "$repo_path" && git worktree add "$WORKTREE_DIR/$name" "$branch" 2>&1)
      ok "$repo_name: created worktree"
    else
      warn "$repo_name: branch '$branch' not found, skipping"
    fi
  done

  # Ensure .worktrees in .gitignore
  for repo in "${REPOS[@]}"; do
    local repo_path="$PROJECT_ROOT/$repo"
    [ ! -d "$repo_path/.git" ] && [ ! -f "$repo_path/.git" ] && continue
    local gitignore="$repo_path/.gitignore"
    if [ -f "$gitignore" ]; then
      grep -q "^${WORKTREE_DIR}/" "$gitignore" || echo "${WORKTREE_DIR}/" >> "$gitignore"
    fi
  done

  echo ""

  # Start infra
  action_up "$name"
}

action_remove() {
  local name="$1"
  read_config

  echo -e "${BOLD}=== Removing dev environment: $name ===${NC}"
  echo ""

  # Safety check
  local has_warnings=false
  for repo in "${REPOS[@]}"; do
    local repo_path="$PROJECT_ROOT/$repo"
    local repo_name=$(basename "$repo")
    local wt_path="$repo_path/$WORKTREE_DIR/$name"
    [ ! -d "$wt_path" ] && continue

    local dirty=$(cd "$wt_path" && git status --short 2>/dev/null || true)
    if [ -n "$dirty" ]; then
      echo -e "${YELLOW}WARNING: $repo_name has uncommitted changes:${NC}"
      echo "$dirty" | sed 's/^/  /'
      has_warnings=true
    fi

    local branch=$(cd "$wt_path" && git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    if [ -n "$branch" ]; then
      local unpushed=$(cd "$wt_path" && git log --oneline "origin/$branch..$branch" 2>/dev/null || true)
      if [ -n "$unpushed" ]; then
        echo -e "${YELLOW}WARNING: $repo_name has unpushed commits on $branch:${NC}"
        echo "$unpushed" | sed 's/^/  /'
        has_warnings=true
      fi
    fi
  done

  if $has_warnings; then
    echo ""
    echo "HAS_WARNINGS=true"
    echo "Confirm removal with user before proceeding."
    return 1
  fi

  # Stop infra
  action_down "$name" 2>/dev/null || true

  # Remove worktrees
  for repo in "${REPOS[@]}"; do
    local repo_path="$PROJECT_ROOT/$repo"
    local repo_name=$(basename "$repo")
    local wt_path="$repo_path/$WORKTREE_DIR/$name"
    [ ! -d "$wt_path" ] && continue

    (cd "$repo_path" && git worktree remove "$WORKTREE_DIR/$name" --force 2>/dev/null) && ok "$repo_name: worktree removed" || fail "$repo_name: failed to remove"
  done

  echo ""
  echo "Done."
}

action_up() {
  local name="$1"
  shift
  read_config

  if [ -n "$SCRIPT_UP" ]; then
    echo "Running: $SCRIPT_UP $name $*"
    cd "$PROJECT_ROOT" && $SCRIPT_UP "$name" "$@"
    return
  fi

  # Generic up: detect service command from config
  local cmd=$(yaml_get_nested "services.app.command" 2>/dev/null)
  [ -z "$cmd" ] && cmd=$(yaml_get_nested "services.frontend.command" 2>/dev/null)

  if [ -z "$cmd" ]; then
    echo "No scripts.up and no service command found in .dev-env.yml"
    echo "NEEDS_CLAUDE=true"
    return 1
  fi

  # Replace <name> placeholder with worktree name
  cmd="${cmd//<name>/$name}"

  local wt_path=""
  if [ ${#REPOS[@]} -eq 1 ] && [ "${REPOS[0]}" = "." ]; then
    wt_path="$PROJECT_ROOT/$WORKTREE_DIR/$name"
  else
    # Use first repo that has the worktree
    for repo in "${REPOS[@]}"; do
      [ -d "$PROJECT_ROOT/$repo/$WORKTREE_DIR/$name" ] && { wt_path="$PROJECT_ROOT/$repo/$WORKTREE_DIR/$name"; break; }
    done
  fi

  if [ -z "$wt_path" ] || [ ! -d "$wt_path" ]; then
    fail "Worktree not found for $name"
    return 1
  fi

  # Setup logs
  local logs_dir="$PROJECT_ROOT/logs/worktree"
  mkdir -p "$logs_dir"
  local log_file="$logs_dir/$name.log"
  local pid_file="$logs_dir/$name.pid"

  # Kill existing if running
  if [ -f "$pid_file" ]; then
    local old_pid=$(cat "$pid_file")
    kill "$old_pid" 2>/dev/null && warn "Killed existing process $old_pid"
    rm -f "$pid_file"
  fi

  echo "Starting: $cmd"
  echo "  in: $wt_path"
  cd "$wt_path" && $cmd > "$log_file" 2>&1 &
  local pid=$!
  echo "$pid" > "$pid_file"
  ok "Started (PID: $pid, log: $log_file)"
}

action_down() {
  local name="$1"
  read_config

  if [ -n "$SCRIPT_DOWN" ]; then
    echo "Running: $SCRIPT_DOWN $name"
    cd "$PROJECT_ROOT" && $SCRIPT_DOWN "$name"
    return
  fi

  # Generic down: kill by PID file
  local pid_file="$PROJECT_ROOT/logs/worktree/$name.pid"
  if [ -f "$pid_file" ]; then
    local pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      sleep 1
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
      ok "Stopped process $pid"
    else
      warn "Process $pid already dead"
    fi
    rm -f "$pid_file"
    rm -f "$PROJECT_ROOT/logs/worktree/$name.log"
  else
    warn "No PID file found for $name"
  fi
}

action_status() {
  local name="$1"
  read_config

  if [ -n "$SCRIPT_STATUS" ]; then
    cd "$PROJECT_ROOT" && $SCRIPT_STATUS "$name"
  else
    echo -e "${BOLD}=== Status: $name ===${NC}"
    echo ""
    for repo in "${REPOS[@]}"; do
      local repo_path="$PROJECT_ROOT/$repo"
      local repo_name=$(basename "$repo")
      local wt_path="$repo_path/$WORKTREE_DIR/$name"
      if [ -d "$wt_path" ]; then
        local branch=$(cd "$wt_path" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
        ok "$repo_name: worktree exists (branch: $branch)"
      else
        fail "$repo_name: no worktree"
      fi
    done

    if [ -f "$PORTS_FILE" ] && grep -q "^$name " "$PORTS_FILE"; then
      echo ""
      local ports=$(grep "^$name " "$PORTS_FILE" | cut -d' ' -f2-)
      echo "  Ports: $ports"
      for port in $ports; do
        if lsof -ti :"$port" >/dev/null 2>&1; then
          ok "Port $port: in use"
        else
          fail "Port $port: not listening"
        fi
      done
    fi

    # Check PID file
    local pid_file="$PROJECT_ROOT/logs/worktree/$name.pid"
    if [ -f "$pid_file" ]; then
      local pid=$(cat "$pid_file")
      echo ""
      if kill -0 "$pid" 2>/dev/null; then
        ok "Process running (PID: $pid)"
      else
        fail "Process dead (PID: $pid)"
      fi
    fi

    # Show last log lines
    local log_file="$PROJECT_ROOT/logs/worktree/$name.log"
    if [ -f "$log_file" ]; then
      echo ""
      echo "Last 5 log lines:"
      tail -5 "$log_file" | sed 's/^/  /'
    fi
  fi
}

action_switch() {
  local target="$1"
  read_config

  echo -e "${BOLD}=== Switching to: $target ===${NC}"
  echo ""

  # Resolve number to name
  if [[ "$target" =~ ^[0-9]+$ ]]; then
    local idx=0
    local all_worktrees=()
    for repo in "${REPOS[@]}"; do
      local repo_path="$PROJECT_ROOT/$repo"
      [ ! -d "$repo_path/.git" ] && [ ! -f "$repo_path/.git" ] && continue
      while IFS= read -r line; do
        local wt_path=$(echo "$line" | awk '{print $1}')
        echo "$wt_path" | grep -q "/$WORKTREE_DIR/" || continue
        local wt_name=$(basename "$wt_path")
        local found=false
        for existing in "${all_worktrees[@]:-}"; do
          [ "$existing" = "$wt_name" ] && { found=true; break; }
        done
        $found || all_worktrees+=("$wt_name")
      done <<< "$(cd "$repo_path" && git worktree list 2>/dev/null)"
    done

    if [ "$target" -gt 0 ] && [ "$target" -le ${#all_worktrees[@]} ]; then
      target="${all_worktrees[$((target - 1))]}"
      echo "Resolved to: $target"
    else
      echo "Error: invalid index $target"
      exit 1
    fi
  fi

  local name=$(short_name "$target")

  for repo in "${REPOS[@]}"; do
    local repo_path="$PROJECT_ROOT/$repo"
    local repo_name=$(basename "$repo")
    [ ! -d "$repo_path/.git" ] && [ ! -f "$repo_path/.git" ] && continue

    # Check dirty
    local dirty=$(cd "$repo_path" && git status --short 2>/dev/null || true)
    if [ -n "$dirty" ]; then
      fail "$repo_name: has uncommitted changes, skipping"
      echo "$dirty" | sed 's/^/    /'
      continue
    fi

    local current=$(cd "$repo_path" && git rev-parse --abbrev-ref HEAD 2>/dev/null)

    if [ "$target" = "master" ] || [ "$target" = "main" ]; then
      # Switch back to default branch
      local default_branch="$target"
      (cd "$repo_path" && git checkout "$default_branch" 2>&1) && ok "$repo_name: on $default_branch" || fail "$repo_name: failed"
      # Recreate worktree if branch exists
      if [ -n "$current" ] && [ "$current" != "$default_branch" ]; then
        local wt_path="$repo_path/$WORKTREE_DIR/$(short_name "$current")"
        if [ ! -d "$wt_path" ]; then
          (cd "$repo_path" && git worktree add "$WORKTREE_DIR/$(short_name "$current")" "$current" 2>/dev/null) && ok "$repo_name: recreated worktree for $current"
        fi
      fi
    else
      # Switch to feature branch
      local wt_path="$repo_path/$WORKTREE_DIR/$name"
      if [ -d "$wt_path" ]; then
        (cd "$repo_path" && git worktree remove "$WORKTREE_DIR/$name" --force 2>/dev/null) || true
      fi
      (cd "$repo_path" && git checkout "$target" 2>&1) && ok "$repo_name: on $target" || {
        (cd "$repo_path" && git checkout "$name" 2>&1) && ok "$repo_name: on $name" || fail "$repo_name: branch not found"
      }
    fi
  done
  echo ""
}

# --- Main ---
ACTION="${1:-list}"
shift 2>/dev/null || true

case "$ACTION" in
  list)     action_list ;;
  create)   [ -z "${1:-}" ] && { echo "Usage: dev-env.sh create <branch>"; exit 1; }; action_create "$1" ;;
  remove)   [ -z "${1:-}" ] && { echo "Usage: dev-env.sh remove <name>"; exit 1; }; action_remove "$1" ;;
  up)       [ -z "${1:-}" ] && { echo "Usage: dev-env.sh up <name>"; exit 1; }; action_up "$@" ;;
  down)     [ -z "${1:-}" ] && { echo "Usage: dev-env.sh down <name>"; exit 1; }; action_down "$1" ;;
  status)   [ -z "${1:-}" ] && { echo "Usage: dev-env.sh status <name>"; exit 1; }; action_status "$1" ;;
  switch)   [ -z "${1:-}" ] && { echo "Usage: dev-env.sh switch <name|number>"; exit 1; }; action_switch "$1" ;;
  *)        echo "Unknown action: $ACTION"; echo "Usage: dev-env.sh [list|create|remove|up|down|status|switch] [args]"; exit 1 ;;
esac
