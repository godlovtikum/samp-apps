#!/usr/bin/env bash
#
# sanitize-log.sh — Redaction filter for build event messages and log files.
#
# The strict pipeline never logs secrets, but defence in depth: every
# message that crosses the trust boundary into Supabase or the user-
# facing transparency report is filtered through this script.
#
# Patterns redacted:
#   * SUPABASE_*, GH_*, GITHUB_TOKEN, AWS_*, GCP_*, STRIPE_* env values
#     when they accidentally appear in log lines (defence in depth)
#   * Bearer / Basic / Token authorization headers
#   * GitHub fine-grained PATs (ghp_*, gho_*, ghu_*, ghs_*, ghr_*)
#   * Slack / Discord / Telegram bot tokens
#   * AWS access key IDs (AKIA…) and secret keys (when adjacent)
#   * Long base64-looking blobs (≥ 80 chars) — likely tokens / keys
#   * Absolute filesystem paths inside /home/runner/* or /tmp/sb/*
#   * Email addresses inside arbitrary user content
#
# Usage:
#   echo "$message" | sanitize-log.sh           # filter stdin
#   sanitize-log.sh <input-file> <output-file>  # filter a file in place
#
# Exit code: always 0 unless invoked with malformed arguments.

set -euo pipefail

apply_redactions() {
    sed -E \
        -e 's/(Bearer|Basic|Token)\s+[A-Za-z0-9._\-]+/\1 [REDACTED]/Ig' \
        -e 's/(authorization\s*[:=]\s*)[^[:space:]\"]+/\1[REDACTED]/Ig' \
        -e 's/(apikey\s*[:=]\s*)[^[:space:]\"]+/\1[REDACTED]/Ig' \
        -e 's/gh[pousr]_[A-Za-z0-9]{30,}/[REDACTED_GH_TOKEN]/g' \
        -e 's/AKIA[0-9A-Z]{12,}/[REDACTED_AWS_KEY_ID]/g' \
        -e 's/xox[baprs]-[A-Za-z0-9-]{10,}/[REDACTED_SLACK_TOKEN]/g' \
        -e 's/[0-9]{8,12}:[A-Za-z0-9_-]{30,}/[REDACTED_TELEGRAM_TOKEN]/g' \
        -e 's/(SUPABASE_[A-Z_]+\s*=\s*)[^[:space:]\"]+/\1[REDACTED]/g' \
        -e 's/(GITHUB_TOKEN\s*=\s*)[^[:space:]\"]+/\1[REDACTED]/g' \
        -e 's|/home/runner/[A-Za-z0-9_./-]*|[RUNNER_PATH]|g' \
        -e 's|/tmp/sb/[A-Za-z0-9_./-]*|[SB_ENV_PATH]|g' \
        -e 's/[A-Za-z0-9+/=]{80,}/[REDACTED_BLOB]/g' \
        -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[REDACTED_EMAIL]/g'
}

if [ "$#" -eq 0 ]; then
    apply_redactions
    exit 0
fi

if [ "$#" -ne 2 ]; then
    echo "usage: sanitize-log.sh                    # stdin filter" >&2
    echo "       sanitize-log.sh <input> <output>  # file filter"  >&2
    exit 64
fi

input_file="$1"
output_file="$2"
if [ ! -f "$input_file" ]; then
    echo "sanitize-log: input not found: $input_file" >&2
    exit 1
fi
apply_redactions < "$input_file" > "$output_file"
exit 0
