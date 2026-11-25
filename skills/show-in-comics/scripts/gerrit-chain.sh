#!/bin/bash
# Prints the Gerrit relation chain containing a change in collect-changes.sh's
# format, with CL numbers as ids and Gerrit links. Fetches the current patch
# sets the repository lacks.
set -euo pipefail

usage() {
  cat >&2 <<EOF
Usage: $0 <CL number or URL>
  A CL URL names its Gerrit server; a bare CL number needs GERRIT_URL.
  Env: GERRIT_URL      web URL of the Gerrit server, e.g. https://gerrit.example.com
       GERRIT_API_URL  REST base if it differs from the web URL
       GERRIT_USER + GERRIT_PASSWORD, or ~/.netrc
EOF
  exit 1
}

input="${1:-}"
[[ -z "$input" ]] && usage
command -v jq >/dev/null || { echo "Error: jq is required" >&2; exit 1; }

if [[ "$input" =~ ^(https?://[^/]+)/.*[^0-9]([0-9]+)/?$ ]]; then
  web="${BASH_REMATCH[1]}"
  cl="${BASH_REMATCH[2]}"
elif [[ "$input" =~ ^[0-9]+$ ]]; then
  [[ -n "${GERRIT_URL:-}" ]] || { echo "Error: set GERRIT_URL to use a bare CL number" >&2; exit 1; }
  web="${GERRIT_URL%/}"
  cl="$input"
else
  usage
fi
api="${GERRIT_API_URL:-$web}"
api="${api%/}"

auth=(--netrc-optional)
if [[ -n "${GERRIT_USER:-}" && -n "${GERRIT_PASSWORD:-}" ]]; then
  auth=(-u "$GERRIT_USER:$GERRIT_PASSWORD")
fi
get() { curl -fsS "${auth[@]}" "$api/a/$1" | tail -c +5; }

change=$(get "changes/$cl?o=CURRENT_REVISION")
project=$(jq -r .project <<<"$change")
chain=$(get "changes/$cl/revisions/current/related" | jq '[.changes | reverse[] |
  {number: ._change_number, patchset: ._revision_number, sha: .commit.commit}]')
if [[ $(jq length <<<"$chain") == 0 ]]; then
  chain=$(jq '[{number: ._number, patchset: .revisions[.current_revision]._number, sha: .current_revision}]' <<<"$change")
fi

missing=()
while IFS=$'\t' read -r number patchset sha; do
  git cat-file -e "$sha^{commit}" 2>/dev/null ||
    missing+=("refs/changes/$(printf '%02d' $((number % 100)))/$number/$patchset")
done < <(jq -r '.[] | [.number, .patchset, .sha] | @tsv' <<<"$chain")
if ((${#missing[@]})); then
  echo "Fetching ${#missing[@]} change refs..." >&2
  git fetch --quiet origin "${missing[@]}"
fi

first=$(jq -r '.[0].number' <<<"$chain")
last=$(jq -r '.[-1].number' <<<"$chain")
jq -r --arg base "$web/c/$project/+" '.[] | "\(.sha) \(.number) \($base)/\(.number)"' <<<"$chain" |
  "$(dirname "${BASH_SOURCE[0]}")/collect-changes.sh" --stdin |
  jq --arg label "Gerrit chain ${first}→${last} ($(jq length <<<"$chain") changes)" --arg url "$web/c/$project/+/$last" \
    '.source = {label: $label, url: $url}'
