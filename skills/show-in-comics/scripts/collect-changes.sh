#!/bin/bash
# Prints commits as JSON for show-in-comics, oldest first: id, sha, subject,
# optional url, line counts and files, plus line totals per area (the first
# two path segments).
set -euo pipefail

usage() {
  cat >&2 <<EOF
Usage: $0 [--url-template URL] <revision range>   e.g. origin/main..HEAD
       $0 [--url-template URL] --stdin            lines "<sha> [<id> [<url>]]", in order
  A change's id defaults to its 12-character sha. --url-template replaces {sha}
  with the full sha, e.g. https://github.com/org/repo/commit/{sha}.
EOF
  exit 1
}

template=""
from_stdin=false
range=()
while (($#)); do
  case "$1" in
    --url-template) [[ $# -ge 2 ]] || usage; template="$2"; shift 2 ;;
    --stdin) from_stdin=true; shift ;;
    -h|--help) usage ;;
    *) range+=("$1"); shift ;;
  esac
done
command -v jq >/dev/null || { echo "Error: jq is required" >&2; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "Error: run inside the repository" >&2; exit 1; }

if $from_stdin; then
  list=$(cat)
  label="$(grep -c . <<<"$list") commits"
else
  ((${#range[@]})) || usage
  list=$(git rev-list --reverse "${range[@]}")
  label="${range[*]} ($(grep -c . <<<"$list") commits)"
fi
[[ -n "$list" ]] || { echo "Error: no commits" >&2; exit 1; }

changes=$(while read -r rev id url; do
  sha=$(git rev-parse --verify --quiet "$rev^{commit}") || { echo "Error: unknown commit $rev" >&2; exit 1; }
  [[ -n "$id" ]] || id="${sha:0:12}"
  [[ -n "$url" || -z "$template" ]] || url="${template//\{sha\}/$sha}"
  jq -n --arg id "$id" --arg sha "$sha" --arg subject "$(git log -1 --format=%s "$sha")" --arg url "$url" \
    '{id: $id, sha: $sha, subject: $subject} + (if $url == "" then {} else {url: $url} end)'
done <<<"$list" | jq -s .)

shas=()
while IFS= read -r sha; do shas+=("$sha"); done < <(jq -r '.[].sha' <<<"$changes")
files=$(git log --no-walk=unsorted --numstat --format='@%H' "${shas[@]}" |
  awk -F'\t' '
    /^@/ { sha = substr($0, 2); next }
    NF == 3 { printf "%s\t%s\t%s\t%s\n", sha, ($1 == "-" ? 0 : $1), ($2 == "-" ? 0 : $2), $3 }' |
  jq -R -s '
    def renamed: if test("[{].* => .*[}]") then sub("[{](?<a>[^}]*) => (?<b>[^}]*)[}]"; .b) | gsub("//"; "/")
                 elif test(" => ") then sub("^.* => "; "") else . end;
    [split("\n")[] | select(length > 0) | split("\t") |
     {sha: .[0], insertions: (.[1] | tonumber), deletions: (.[2] | tonumber), path: (.[3] | renamed)}] |
    group_by(.sha) | map({key: .[0].sha, value: map(del(.sha))}) | from_entries')

jq --arg label "$label" --argjson files "$files" '
  map(. + {files: ($files[.sha] // []),
           insertions: (($files[.sha] // []) | map(.insertions) | add // 0),
           deletions: (($files[.sha] // []) | map(.deletions) | add // 0)}) as $changes |
  {
    source: {label: $label},
    changes: $changes,
    areas: ([$changes[] | .id as $id | .files[] |
              {area: (.path | split("/") | .[0:(if length > 2 then 2 else 1 end)] | join("/")),
               id: $id, insertions, deletions}] |
            group_by(.area) |
            map({area: .[0].area, changes: (map(.id) | unique),
                 insertions: (map(.insertions) | add), deletions: (map(.deletions) | add)}) |
            sort_by(-(.insertions + .deletions)))
  }' <<<"$changes"
