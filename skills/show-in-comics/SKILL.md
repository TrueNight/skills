---
name: show-in-comics
description: >
  Turns a large change series (a git range or branch, a Gerrit chain) into one
  clickable HTML page for review, zoomed like C4: the systems it adds or
  changes and how they talk at the root, a click opening a system's containers
  and a container's components, and warning marks on irreversible, risky and
  hard decisions rolled up to the top.
usage: >
  When the user wants to review or understand a big series of changes as a
  picture, asks where to look in a branch or chain, or says "show in comics".
version: 0.1.0
tags: [skill, review, diagram, html, git, chain]
---

# Show in comics

The runtime prints `Base directory for this skill: <path>` when the skill loads; that path is `<skill_dir>`. Script paths below are relative to it. Keep every working file in one temporary directory outside the repository, `<work>`.

The page answers three questions in this order: what runs and talks to what, what changed inside each piece, and where a reviewer must look hard. Read `references/model.md` before writing any JSON.

Needs bash, git, jq and Node. The renderer runs its TypeScript source directly on Node 22.18 or newer (on 23.x, 23.6 or newer). A release build carries compiled JavaScript in `scripts/comics-dist/`, which it prefers.

## 1. Collect the changes

From inside the repository, for any git range:

```bash
"<skill_dir>/scripts/collect-changes.sh" origin/main..HEAD > <work>/collected.json
```

It prints every commit, oldest first, with its id (the 12-character sha), sha, subject, files and line counts, and `areas`: line totals per directory pair. `--url-template 'https://…/commit/{sha}'` links each change to the forge.

For a Gerrit chain or CL, the ids are the CL numbers and the links go to Gerrit:

```bash
"<skill_dir>/scripts/gerrit-chain.sh" <CL number or URL> > <work>/collected.json
```

A CL URL names its server; a bare CL number needs `GERRIT_URL`. `GERRIT_API_URL` sets a separate REST base when the web host sits behind a login proxy. It authenticates with `GERRIT_USER` and `GERRIT_PASSWORD`, or `~/.netrc`. It fetches the patch sets the repository lacks, so `git show <sha>` works afterwards. For another forge, print `<sha> <id> <url>` lines in order and pipe them to `collect-changes.sh --stdin`.

## 2. Draw the root

Write `<work>/root-skeleton.json`: `title`, `summary` and the `root` view. Use `areas`, the subjects and any design doc the series adds or cites. Then add the source and the changes:

```bash
jq --slurpfile c <work>/collected.json \
  '. + {source: $c[0].source, changes: [$c[0].changes[] | {id, subject, url, insertions, deletions} | with_entries(select(.value != null))]}' \
  <work>/root-skeleton.json > <work>/root.json
```

- Root nodes are level 1 of the Levels table: systems, people and external systems, plus any single-deployable `service`. They run or hold state; never a folder. Include unchanged direct neighbours when they show the blast radius.
- Edges are runtime interactions. The label names the protocol and what travels; the detail names the auth.
- Put the series-wide flags on the root nodes and edges they concern.
- Every change belongs to at least one node. This prints the ones nothing cites:

  ```bash
  jq -r '[.changes[].id] - ([.root | .. | objects | select(has("id") or has("from") or has("level")) | .changes[]?] | unique) | .[]' <work>/root.json
  ```

- A system too big for one subagent gets its second level drawn here, so each of its parts becomes its own subagent's node.

## 3. Fill each service

Start one subagent per added or changed node that has no view yet, in parallel. Give each:

- its root node as written, the ids and names of its neighbours, and the edges between them;
- its changes: id, sha and subject;
- `<skill_dir>/references/model.md` and the flag levels in it;
- the output path `<work>/fragments/<node id>.json`.

It writes one Node object with the same `id`: the root fields refined, plus a `view` one level down, by the Levels table in `references/model.md`:
- A `system` opens to its containers: each deployable as a `service`, its stores and its queues. Each changed `service` in it opens to its components.
- A `service` opens to its components, up to nine. A component is a unit with one responsibility: a package, a module, a handler set.
- Components never open. Their states and steps go in `detail` as bullets.

Draw an edge from each component to every outside node it talks to, at whatever level that node lives; the page ends it at a port on the view's boundary. Each element cites the changes that touch it.

Tell it to read every commit message and `git show --stat`, then the non-test diff of each change, and to flag what the levels in `references/model.md` describe, with a pointer to the file and the change.

Merge the fragments into the root. A fragment replaces the node with its id at any depth:

```bash
jq -s 'map({(.id): .}) | add' <work>/fragments/*.json > <work>/fragments.json
jq --slurpfile f <work>/fragments.json \
  'walk(if type == "object" and has("id") and $f[0][.id] then $f[0][.id] else . end)' \
  <work>/root.json > <work>/model.json
```

Run the coverage check of step 2 on `<work>/model.json` again.

## 4. Render

```bash
"<skill_dir>/scripts/comics" render <work>/model.json -o <work>/page.html
```

It validates first and prints one line per problem. Fix the element named and render again.

## 5. Look at it

Screenshot the root and one opened view with headless Chrome or Chromium on a throwaway profile, and read the images. On macOS the binary is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`:

```bash
<chrome> --headless --user-data-dir=<work>/chrome \
  --no-first-run --disable-gpu --hide-scrollbars --window-size=1440,1000 \
  --screenshot=<work>/root.png "file://<work>/page.html#/"
```

Fix a crowded view by grouping its nodes into containers, or by dropping edges that only repeat what a neighbour's edge says. Then open the page for the user. Publish it only when asked.
