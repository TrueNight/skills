# The comics model

One JSON document describes the whole page. `scripts/comics validate` checks it; unknown keys are rejected.

```json
{
  "title": "MCP gateway and the search indexer",
  "summary": "One to three sentences under the title.",
  "source": {"label": "Gerrit chain 1201→1350 (150 changes)", "url": "https://gerrit.example.com/c/search/+/1350"},
  "changes": [{"id": "1201", "subject": "…", "url": "https://gerrit.example.com/c/search/+/1201", "insertions": 14, "deletions": 30}],
  "root": {"title": "System", "summary": "…", "nodes": [], "edges": []}
}
```

## Change

`{"id", "subject", "url"?, "insertions", "deletions"}`. `id` is what reviewers call the change: a CL number as a string, or a 12-character sha. Without `url` the change shows as plain text. Every element's `changes` lists these ids.

## View

`{"title", "summary"?, "nodes": [Node, …], "edges": [Edge, …]}`. At least one node. The root view is the top of the page; every other view belongs to a node.

## Levels

The page zooms like C4, three levels at most. A node's kind decides whether it opens:

| Level | View of | Holds |
|---|---|---|
| 1 | the root | systems, people, external systems. A system that is one deployable may sit here as a `service`. |
| 2 | a `system` at the root | its containers: each deployable as a `service`, its stores and queues |
| 3 | a `service` at the root or level 2 | its components: a package, a module, a handler set |

Only these nodes have a `view`. A component never opens: put its states or steps in its `detail` as bullets.

## Node

| Field | |
|---|---|
| `id` | `[a-z0-9][a-z0-9-]*`, unique in the whole document |
| `name` | card title |
| `kind` | `person`, `system`, `service`, `store`, `queue`, `component`, `external` |
| `status` | `added`, `changed`, `removed`, `unchanged` |
| `tech` | optional, up to 40 characters: `Go, gRPC`, `Postgres`, `Rust` |
| `summary` | optional, one line up to 160 characters: what it is |
| `detail` | optional, markdown-lite: what changed in this series and why |
| `changes` | optional ids of the changes that touch it |
| `files` | optional paths, directories end in `/` |
| `flags` | optional, see Flag |
| `view` | optional; makes the node open, see Levels |

## Edge

`{"from", "to", "label", "status", "detail"?, "changes"?, "flags"?}`. `label` is up to 48 characters: the protocol and what travels, `gRPC, Bearer FM token`. One end must be a node of the view the edge sits in. The other end may be any node in the document. An end that is a node of the view, or lies inside one of its cards, attaches to that card. Any other end is outside: the edge ends at a port on the view's boundary, and selecting it shows that node as a grey chip that goes to where it lives. Use these to show how a component talks to the services around its parent. An edge whose two ends land on one card is rejected.

An edge is selected by `from>to`, with `.2`, `.3` for repeats of the same pair in one view; a node by its id.

## Flag

`{"level", "title", "detail"?, "changes"?}`, title up to 90 characters. Levels, most severe first:

- `irreversible`: costly to undo once shipped. Schema and data migrations, deleted data or code paths others use, wire contracts (proto, REST, events), persisted formats and index mappings, ID formats, public URLs.
- `risk`: could break production or security. Auth and authorization paths, secrets, concurrency and fencing, retry storms, resource limits, rollout order between services.
- `decision`: a hard choice with a real alternative the reviewer should agree with. Name the alternative not taken and the reason.
- `question`: left open. A TODO, a mismatch between the design doc and the code, a path no test covers.

`detail` says where to look (file, function, change) and what to check. A card's badge counts the flags of the node, its edges and everything inside it, coloured by the most severe.

## Markdown-lite

Paragraphs separated by blank lines, `- ` bullets, `` `code` ``, `**bold**`. Nothing else is interpreted.
