#!/bin/bash
set -euo pipefail

PLAN_FILE="${1:-}"
EXIT_CODE=0

error() { echo "❌ $1" >&2; EXIT_CODE=1; }
warn() { echo "⚠️ $1" >&2; }
ok() { echo "✅ $1"; }

if [[ -z "$PLAN_FILE" ]]; then
    error "Usage: $0 <path-to-plan.md>"
    exit 1
fi

if [[ ! -f "$PLAN_FILE" ]]; then
    error "File not found: $PLAN_FILE"
    exit 1
fi

case "$PLAN_FILE" in
    *docs/exec_plans/active/*)
        ok "Plan path is under docs/exec_plans/active"
        ;;
    *docs/exec_plans/archive/*)
        ok "Plan path is under docs/exec_plans/archive"
        ;;
    *)
        warn "Plan path is outside docs/exec_plans/active or docs/exec_plans/archive"
        ;;
esac

PLAN_BASENAME="$(basename "$PLAN_FILE")"
if [[ "$PLAN_BASENAME" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$ ]]; then
    ok "Filename matches YYYY-MM-DD-short-plan-name.md"
else
    warn "Filename should match YYYY-MM-DD-short-plan-name.md"
fi

REQUIRED_SECTIONS=(
    "^# "
    "^## Purpose / Big Picture$"
    "^## Progress$"
    "^## Surprises & Discoveries$"
    "^## Decision Log$"
    "^## Outcomes & Retrospective$"
    "^## Context and Orientation$"
    "^## Plan of Work$"
    "^## Concrete Steps$"
    "^## Validation and Acceptance$"
    "^## Idempotence and Recovery$"
)

for pattern in "${REQUIRED_SECTIONS[@]}"; do
    if grep -Eq "$pattern" "$PLAN_FILE"; then
        ok "Found required section matching: $pattern"
    else
        error "Missing required section matching: $pattern"
    fi
done

progress_section="$(awk '/^## Progress$/{in_section=1;next} in_section && /^## /{in_section=0} in_section' "$PLAN_FILE")"

if printf '%s\n' "$progress_section" | grep -Eq '^- \[[ x]\]'; then
    ok "Progress contains checkbox items"
else
    error "Progress must contain checkbox items like: - [ ] Step or - [x] (2026-04-16 12:00Z) Step"
fi

completed_no_ts="$(printf '%s\n' "$progress_section" | grep -E '^- \[x\]' | grep -vE '^- \[x\] \([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}Z\)' || true)"
if [[ -n "$completed_no_ts" ]]; then
    error "Completed Progress items must have timestamps: - [x] (2026-04-16 12:00Z) Step"
elif printf '%s\n' "$progress_section" | grep -Eq '^- \[x\]'; then
    ok "Completed Progress items have timestamps"
fi

open_question_entries="$(awk '
    /^## Open Questions$/ { in_section=1; next }
    in_section && /^## / { in_section=0 }
    in_section && /^- / { print }
' "$PLAN_FILE")"

if [[ -n "$open_question_entries" ]]; then
    bad_open_question_entries="$(printf "%s\n" "$open_question_entries" | grep -Ev '^- OQ-[0-9]{3}:' || true)"
    if [[ -z "$bad_open_question_entries" ]]; then
        ok "Open questions use OQ-### identifiers"
    else
        error "Open question entries must start with identifiers like: - OQ-001:"
    fi
fi

if grep -q "^## Artifacts and Notes$" "$PLAN_FILE"; then
    ok "Found Artifacts and Notes section"
else
    warn "Artifacts and Notes section not found"
fi

if grep -q "^## Interfaces and Dependencies$" "$PLAN_FILE"; then
    ok "Found Interfaces and Dependencies section"
else
    warn "Interfaces and Dependencies section not found"
fi

if grep -q "^## Change Log$" "$PLAN_FILE"; then
    ok "Found Change Log section"
else
    warn "Change Log section not found"
fi

if grep -q '```' "$PLAN_FILE"; then
    warn "Plan file contains fenced code blocks. Standalone ExecPlan files should usually use indented examples instead."
fi

if [[ $EXIT_CODE -eq 0 ]]; then
    ok "Validation passed"
else
    error "Validation failed"
fi

exit $EXIT_CODE
