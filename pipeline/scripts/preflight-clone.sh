#!/usr/bin/env bash
#
# preflight-clone.sh — Security and integrity gate for a freshly-cloned repo.
#
# The pipeline ingests untrusted user repositories. This step refuses
# inputs that would let a malicious repository read secrets, escape the
# working directory, exhaust runner resources, or run code at install
# time before the strict gate has had a chance to inspect it.
#
# Strict-mode checks (HARD; failure ⇒ exit 1):
#   1. Repository size cap (default 500 MB).
#   2. Symbolic links must not point outside <project-dir>.
#   3. .git directory must not contain executable hooks (would already be
#      running scripts before any pipeline analysis).
#   4. .npmrc / .yarnrc / .yarnrc.yml in the repo MUST NOT redirect the
#      registry to a non-public host (registry hijack).
#   5. .gitconfig in the repo MUST NOT contain `core.fsmonitor` /
#      `core.hooksPath` overrides.
#   6. No tracked files larger than 100 MB (would blow the runner cache).
#
# Reporting-only checks (warn but do not fail):
#   * package.json install lifecycle scripts (preinstall, install,
#     postinstall, prepare). Pipeline disables these by passing
#     --ignore-scripts; the report tells the operator what was skipped.
#   * Lockfile presence (reproducibility hint).
#   * pnpm `catalog:` / `workspace:` protocols (npm/yarn would reject).
#   * Suspicious top-level dot-files (.env*, .aws, .ssh, .npmrc with auth).
#
# Exit codes:
#   0   All hard checks passed (warnings printed but did not fail).
#   1   At least one hard check failed.
#   64  Bad arguments.

set -euo pipefail

PROJECT_DIR="${1:-}"
MAX_MB="${2:-500}"
MAX_TRACKED_FILE_MB="${3:-100}"

if [ -z "$PROJECT_DIR" ] || [ ! -d "$PROJECT_DIR" ]; then
    echo "[preflight] usage: preflight-clone.sh <project-dir> [<max-mb>] [<max-tracked-file-mb>]" >&2
    exit 64
fi

PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd -P)"
log() { printf '[preflight] %s\n' "$*"; }

# --- 1. Size cap ----------------------------------------------------------
SIZE_KB=$(du -sk "$PROJECT_DIR" | awk '{print $1}')
SIZE_MB=$((SIZE_KB / 1024))
log "repo size: ${SIZE_MB} MB (cap ${MAX_MB} MB)"
if [ "$SIZE_MB" -gt "$MAX_MB" ]; then
    log "FAIL: repo exceeds ${MAX_MB} MB cap"
    exit 1
fi

# --- 2. Symlink escape ----------------------------------------------------
SYMLINK_ESCAPED=0
while IFS= read -r -d '' link; do
    target="$(readlink -f "$link" 2>/dev/null || true)"
    case "$target" in
        "$PROJECT_DIR"|"$PROJECT_DIR"/*) : ;;
        "")
            log "  ⚠ broken symlink: ${link#$PROJECT_DIR/}"
            ;;
        *)
            log "  ✗ symlink escapes project: ${link#$PROJECT_DIR/} → $target"
            SYMLINK_ESCAPED=1
            ;;
    esac
done < <(find "$PROJECT_DIR" -type l -print0 2>/dev/null)
if [ "$SYMLINK_ESCAPED" -eq 1 ]; then
    log "FAIL: at least one symbolic link points outside the repository."
    exit 1
fi

# --- 3. Pre-baked git hooks ----------------------------------------------
if [ -d "$PROJECT_DIR/.git/hooks" ]; then
    HOOK_COUNT=$(find "$PROJECT_DIR/.git/hooks" -maxdepth 1 -type f ! -name '*.sample' 2>/dev/null | wc -l | tr -d ' ')
    if [ "${HOOK_COUNT:-0}" -gt 0 ]; then
        log "  ⚠ ${HOOK_COUNT} executable git hook(s) present — disabling"
        find "$PROJECT_DIR/.git/hooks" -maxdepth 1 -type f ! -name '*.sample' -exec chmod -x {} +
    fi
fi

# --- 4. Registry hijack via .npmrc / .yarnrc[.yml] -----------------------
ALLOWED_REGISTRY_HOSTS_REGEX='^https?://(registry\.npmjs\.org|registry\.yarnpkg\.com|npm\.pkg\.github\.com)(/|$)'
REGISTRY_HIJACK=0
for rcfile in .npmrc .yarnrc .yarnrc.yml; do
    abs="$PROJECT_DIR/$rcfile"
    [ -f "$abs" ] || continue
    log "  · inspecting $rcfile"
    while IFS= read -r line; do
        case "$line" in
            *registry*=*|*npmRegistryServer:*)
                value=$(echo "$line" | sed -E 's/.*[:=][[:space:]]*//; s/[[:space:]]+$//; s/^"//; s/"$//')
                if [ -n "$value" ] && ! echo "$value" | grep -Eq "$ALLOWED_REGISTRY_HOSTS_REGEX"; then
                    log "    ✗ $rcfile points registry at non-public host: $value"
                    REGISTRY_HIJACK=1
                fi
                ;;
            *_authToken*|*//*:_authToken*|*npmAuthToken:*)
                log "    ✗ $rcfile carries a registry auth token — refusing to install with project-supplied creds"
                REGISTRY_HIJACK=1
                ;;
        esac
    done < "$abs"
done
if [ "$REGISTRY_HIJACK" -eq 1 ]; then
    log "FAIL: registry hijack attempt detected in repo-level npm/yarn config."
    exit 1
fi

# --- 5. .gitconfig overrides ---------------------------------------------
if [ -f "$PROJECT_DIR/.gitconfig" ]; then
    if grep -Eiq '^[[:space:]]*(core[[:space:]]*=[[:space:]]*|hooksPath|fsmonitor)' "$PROJECT_DIR/.gitconfig"; then
        log "FAIL: repo .gitconfig overrides core.hooksPath / core.fsmonitor"
        exit 1
    fi
fi

# --- 6. Oversized tracked files ------------------------------------------
LARGE_FILE_COUNT=0
while IFS= read -r -d '' big; do
    rel="${big#$PROJECT_DIR/}"
    case "$rel" in
        .git/*) continue ;;
    esac
    size_mb=$(( $(stat -c %s "$big" 2>/dev/null || stat -f %z "$big" 2>/dev/null || echo 0) / 1048576 ))
    if [ "$size_mb" -gt "$MAX_TRACKED_FILE_MB" ]; then
        log "  ✗ tracked file exceeds ${MAX_TRACKED_FILE_MB} MB: $rel (${size_mb} MB)"
        LARGE_FILE_COUNT=$((LARGE_FILE_COUNT + 1))
    fi
done < <(find "$PROJECT_DIR" -type f -size +"${MAX_TRACKED_FILE_MB}"M -print0 2>/dev/null)
if [ "$LARGE_FILE_COUNT" -gt 0 ]; then
    log "FAIL: ${LARGE_FILE_COUNT} file(s) exceed the per-file size cap."
    exit 1
fi

# --- 7. Lifecycle script report (warn-only) ------------------------------
PKG="$PROJECT_DIR/package.json"
if [ -f "$PKG" ]; then
    for hook in preinstall install postinstall prepare; do
        val=$(node -e "try{const p=require('$PKG');process.stdout.write((p.scripts&&p.scripts['$hook'])||'')}catch(e){}" 2>/dev/null || true)
        if [ -n "$val" ]; then
            log "  ⚠ package.json defines script \"$hook\": $val"
            log "     (skipped at install time via --ignore-scripts)"
        fi
    done
fi

# --- 8. Lockfile presence (warn-only) ------------------------------------
if [ -f "$PKG" ]; then
    HAS_LOCK=0
    for lock in package-lock.json yarn.lock pnpm-lock.yaml bun.lockb npm-shrinkwrap.json; do
        if [ -f "$PROJECT_DIR/$lock" ]; then
            log "  ✓ lockfile present: $lock"
            HAS_LOCK=1
        fi
    done
    if [ "$HAS_LOCK" -eq 0 ]; then
        log "  ⚠ no lockfile found"
        log "     install will resolve to floating versions; reproducibility is reduced"
    fi
    if grep -q '"catalog:' "$PKG" 2>/dev/null; then
        if [ ! -f "$PROJECT_DIR/pnpm-workspace.yaml" ]; then
            log "  ⚠ package.json uses pnpm 'catalog:' protocol but pnpm-workspace.yaml is missing"
        else
            log "  ℹ package.json uses pnpm 'catalog:' protocol — pnpm install required"
        fi
    fi
    if grep -q '"workspace:' "$PKG" 2>/dev/null; then
        log "  ⚠ package.json uses 'workspace:' protocol — repo must install as part of its parent workspace"
    fi
fi

# --- 9. Suspicious dotfiles report (warn-only) ---------------------------
for dotfile in .env .env.local .env.production .aws .ssh; do
    if [ -e "$PROJECT_DIR/$dotfile" ]; then
        log "  ⚠ repo ships '$dotfile' — pipeline will not source it; flagged for transparency report"
    fi
done

log "preflight: OK"
exit 0
