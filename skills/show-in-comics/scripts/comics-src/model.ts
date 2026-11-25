import { equalFoldASCII, quote, runeCount, trimSpace } from "./fmt.ts";
import { read, type Raw } from "./json.ts";

export const kinds = ["person", "system", "service", "store", "queue", "component", "external"] as const;
export const statuses = ["added", "changed", "removed", "unchanged"] as const;
// levels runs from the most to the least severe.
export const levels = ["irreversible", "risk", "decision", "question"] as const;

export type Kind = (typeof kinds)[number];
export type Status = (typeof statuses)[number];
export type Level = (typeof levels)[number];

export type Doc = {
  title: string;
  summary: string;
  source: Source | null;
  changes: Change[];
  root: View;
};

export type Source = { label: string; url: string };

export type Change = {
  id: string;
  subject: string;
  url: string;
  insertions: bigint;
  deletions: bigint;
};

export type View = {
  title: string;
  summary: string;
  nodes: Node[];
  edges: Edge[];
};

export type Node = {
  id: string;
  name: string;
  kind: Kind;
  status: Status;
  tech: string;
  summary: string;
  detail: string;
  changes: string[];
  files: string[];
  flags: Flag[];
  view: View | null;
};

export type Edge = {
  from: string;
  to: string;
  label: string;
  status: Status;
  detail: string;
  changes: string[];
  flags: Flag[];
};

export type Flag = {
  level: Level;
  title: string;
  detail: string;
  changes: string[];
};

// Draft is a decoded model before validation: kinds, statuses and levels may
// be any string.
type Loose<T> = T extends string ? string : T extends (infer E)[] ? Loose<E>[] : T extends object ? { [K in keyof T]: Loose<T[K]> } : T;
type Draft = Loose<Doc>;

// Shape is the JSON form of each type above, keyed by JSON names.
type Struct = { kind: "struct"; fields: Record<string, Shape> };
type Shape = { kind: "string" } | { kind: "int" } | { kind: "list"; of: Shape } | { kind: "ptr"; to: Struct } | Struct;

const str: Shape = { kind: "string" };
const int: Shape = { kind: "int" };
const list = (of: Shape): Shape => ({ kind: "list", of });
const struct = (fields: Record<string, Shape>): Struct => ({ kind: "struct", fields });

const flagShape = struct({ level: str, title: str, detail: str, changes: list(str) });
const viewShape = struct({});
const nodeShape = struct({
  id: str, name: str, kind: str, status: str, tech: str, summary: str, detail: str,
  changes: list(str), files: list(str), flags: list(flagShape), view: { kind: "ptr", to: viewShape },
});
const edgeShape = struct({
  from: str, to: str, label: str, status: str, detail: str, changes: list(str), flags: list(flagShape),
});
viewShape.fields = { title: str, summary: str, nodes: list(nodeShape), edges: list(edgeShape) };
const docShape = struct({
  title: str, summary: str, source: { kind: "ptr", to: struct({ label: str, url: str }) },
  changes: list(struct({ id: str, subject: str, url: str, insertions: int, deletions: int })), root: viewShape,
});

// parse decodes the model strictly. Every unknown field and type mismatch is
// reported with its JSON path; the returned draft is null only for unreadable
// JSON.
export function parse(data: Uint8Array): { draft: Draft | null; problems: string[] } {
  const r = read(data);
  if (r.kind === "bad") return { draft: null, problems: ["document: " + r.problem] };
  if (r.value.kind !== "obj") return { draft: null, problems: ["document: want an object"] };
  const root = { v: zero(docShape) };
  decode(r.value, docShape, { get: () => root.v, set: (x) => (root.v = x) });
  return { draft: root.v as Draft, problems: checkShape(r.value) };
}

// checkShape lists, depth first with keys in order, every unknown field and
// value of the wrong type. A stack stands in for recursion, so nesting as deep
// as read allows fits.
function checkShape(doc: Raw): string[] {
  const problems: string[] = [];
  const todo: ({ kind: "check"; path: string; v: Raw; s: Shape } | { kind: "unknown"; path: string })[] = [
    { kind: "check", path: "", v: doc, s: docShape },
  ];
  for (let t = todo.pop(); t; t = todo.pop()) {
    if (t.kind === "unknown") {
      problems.push(t.path + ": unknown field");
      continue;
    }
    const { path, v } = t;
    const s = t.s.kind === "ptr" ? t.s.to : t.s;
    const add = (msg: string) => problems.push(path + ": " + msg);
    if (v.kind === "null") continue;
    switch (s.kind) {
      case "struct": {
        if (v.kind !== "obj") {
          add("want an object");
          break;
        }
        const members = new Map(v.v);
        const keys = [...members.keys()].sort(byCodePoint).reverse();
        for (const k of keys) {
          const p = path ? path + "." + k : k;
          todo.push(Object.hasOwn(s.fields, k) ? { kind: "check", path: p, v: members.get(k)!, s: s.fields[k] } : { kind: "unknown", path: p });
        }
        break;
      }
      case "list":
        if (v.kind !== "arr") add("want an array");
        else for (let i = v.v.length - 1; i >= 0; i--) todo.push({ kind: "check", path: `${path}[${i}]`, v: v.v[i], s: s.of });
        break;
      case "string":
        if (v.kind !== "str") add("want a string");
        break;
      case "int":
        if (v.kind !== "num" || !isInt64(v.v)) add("want an integer");
        break;
    }
  }
  return problems;
}

function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

function isInt64(s: string): boolean {
  return /^-?\d+$/.test(s) && BigInt(s) >= -(2n ** 63n) && BigInt(s) < 2n ** 63n;
}

function zero(s: Shape): unknown {
  switch (s.kind) {
    case "string":
      return "";
    case "int":
      return 0n;
    case "list":
      return [];
    case "ptr":
      return null;
    case "struct":
      return Object.fromEntries(Object.entries(s.fields).map(([k, f]) => [k, zero(f)]));
  }
}

// spare holds the elements a list had beyond its current length, which a
// repeated key decodes into again.
const spare = new WeakMap<unknown[], unknown[]>();

type Slot = { get: () => unknown; set: (v: unknown) => void };

// decode stores v into slot best-effort: a value of the wrong type leaves the
// slot as it was, null clears a list or pointer, and keys match fields
// exactly or else case-insensitively. A repeated key decodes into what the
// earlier one left, elements dropped by a shorter list included; an empty
// list clears. Like checkShape it keeps a stack, in document order.
function decode(doc: Raw, docS: Shape, docSlot: Slot): void {
  const todo: { v: Raw; s: Shape; slot: Slot }[] = [{ v: doc, s: docS, slot: docSlot }];
  for (let t = todo.pop(); t; t = todo.pop()) {
    const { v, s, slot } = t;
    const cur = slot.get();
    switch (s.kind) {
      case "string":
        if (v.kind === "str") slot.set(v.v);
        break;
      case "int":
        if (v.kind === "num" && isInt64(v.v)) slot.set(BigInt(v.v));
        break;
      case "list": {
        if (v.kind === "null" || (v.kind === "arr" && v.v.length === 0)) slot.set([]);
        if (v.kind !== "arr" || v.v.length === 0) break;
        const old = [...(cur as unknown[]), ...(spare.get(cur as unknown[]) ?? [])];
        const out = v.v.map((_, i) => (i < old.length ? old[i] : zero(s.of)));
        if (old.length > out.length) spare.set(out, old.slice(out.length));
        slot.set(out);
        for (let i = out.length - 1; i >= 0; i--) todo.push({ v: v.v[i], s: s.of, slot: { get: () => out[i], set: (x) => (out[i] = x) } });
        break;
      }
      case "ptr":
        if (v.kind === "null") {
          slot.set(null);
          break;
        }
        if (cur === null) slot.set(zero(s.to));
        todo.push({ v, s: s.to, slot });
        break;
      case "struct": {
        if (v.kind !== "obj") break;
        const out = cur as Record<string, unknown>;
        for (let i = v.v.length - 1; i >= 0; i--) {
          const [k, e] = v.v[i];
          const f = fieldFor(s, k);
          if (f) todo.push({ v: e, s: s.fields[f], slot: { get: () => out[f], set: (x) => (out[f] = x) } });
        }
        break;
      }
    }
  }
}

function fieldFor(s: Struct, key: string): string | undefined {
  if (Object.hasOwn(s.fields, key)) return key;
  return Object.keys(s.fields).find((f) => equalFoldASCII(key, f));
}

const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const changeID = /^[A-Za-z0-9._-]{1,40}$/;

type DraftView = Draft["root"];
type DraftNode = DraftView["nodes"][number];
type DraftFlag = DraftNode["flags"][number];

// validate checks a draft; with no problems it is a Doc.
export function validate(d: Draft): { doc: Doc } | { problems: string[] } {
  const c = new Checker();
  c.text("title", d.title, 0, true);
  if (d.source) {
    c.text("source.label", d.source.label, 0, true);
    c.url("source.url", d.source.url);
  }
  d.changes.forEach((ch, i) => {
    const p = `changes[${i}]`;
    if (!changeID.test(ch.id)) c.add(p + ".id", `${quote(ch.id)} must match [A-Za-z0-9._-]{1,40}`);
    else if (c.changes.has(ch.id)) c.add(p + ".id", `duplicate change ${quote(ch.id)}`);
    c.changes.add(ch.id);
    c.text(p + ".subject", ch.subject, 0, true);
    if (ch.url !== "") c.url(p + ".url", ch.url);
    if (ch.insertions < 0n || ch.deletions < 0n) c.add(p, "insertions and deletions must not be negative");
  });
  c.index(d.root, "root");
  c.parent = parents(d.root);
  c.view(d.root, "root", "");
  return c.problems.length ? { problems: c.problems } : { doc: d as Doc };
}

// parents maps each node id to the id of the node whose view holds it, "" in
// the root view. The first definition of a duplicate id wins.
export function parents(root: DraftView): Map<string, string> {
  const m = new Map<string, string>();
  const walk = (v: DraftView, owner: string) => {
    for (const n of v.nodes) {
      if (!m.has(n.id)) m.set(n.id, owner);
      if (n.view) walk(n.view, n.id);
    }
  };
  walk(root, "");
  return m;
}

// resolve returns the node of a view that an edge end attaches to: the end
// itself, its ancestor in the view, or "" when the end lies outside the view.
export function resolve(id: string, here: Set<string>, parent: Map<string, string>): string {
  for (; id !== ""; id = parent.get(id) ?? "") {
    if (here.has(id)) return id;
  }
  return "";
}

// nesting says why a node of kind k may not have a view inside the view of a
// node of kind owner, "" for the root view; it returns "" when it may. Each
// level is one C4 level: systems open to containers, services to components.
function nesting(k: string, owner: string): string {
  if (k === "system" && owner !== "") return "a system has a view only in the root view";
  if (k === "service" && owner !== "" && owner !== "system") return "a service has a view only in the root view or a system's view";
  if (k !== "system" && k !== "service") return `a ${k} has no view`;
  return "";
}

class Checker {
  problems: string[] = [];
  changes = new Set<string>();
  first = new Map<string, string>(); // node id -> JSON path of its first definition
  parent = new Map<string, string>();

  index(v: DraftView, path: string): void {
    for (let i = 0; i < v.nodes.length; i++) {
      const n = v.nodes[i];
      const p = `${path}.nodes[${i}]`;
      if (n.id !== "" && !this.first.has(n.id)) this.first.set(n.id, p);
      if (n.view) this.index(n.view, p + ".view");
    }
  }

  view(v: DraftView, path: string, owner: string): void {
    this.text(path + ".title", v.title, 0, true);
    if (v.nodes.length === 0) this.add(path + ".nodes", "needs at least one node");
    const here = new Set(v.nodes.map((n) => n.id));
    v.nodes.forEach((n, i) => this.node(n, `${path}.nodes[${i}]`, owner));
    const seen = new Set<string>();
    v.edges.forEach((e, i) => {
      const p = `${path}.edges[${i}]`;
      let known = true;
      for (const [name, id] of [["from", e.from], ["to", e.to]] as const) {
        if (id === "") {
          this.add(p + "." + name, "is required");
          known = false;
        } else if (!this.first.has(id)) {
          this.add(p + "." + name, `unknown node ${quote(id)}`);
          known = false;
        }
      }
      if (e.from !== "" && e.from === e.to) this.add(p, "from and to are the same node");
      else if (known && !here.has(e.from) && !here.has(e.to)) {
        this.add(p, `neither ${quote(e.from)} nor ${quote(e.to)} is a node of this view`);
      } else if (known && resolve(e.from, here, this.parent) === resolve(e.to, here, this.parent)) {
        this.add(p, `both ends are inside ${quote(resolve(e.from, here, this.parent))}, so the edge starts and ends on its card`);
      }
      this.text(p + ".label", e.label, 48, true);
      this.oneOf(p + ".status", e.status, statuses);
      const key = JSON.stringify([e.from, e.to, e.label]);
      if (seen.has(key)) this.add(p, `duplicates edge ${e.from} -> ${e.to} ${quote(e.label)}`);
      seen.add(key);
      this.refs(p + ".changes", e.changes);
      this.flags(p + ".flags", e.flags);
    });
  }

  node(n: DraftNode, path: string, owner: string): void {
    if (n.id === "") this.add(path + ".id", "is required");
    else if (!idPattern.test(n.id)) this.add(path + ".id", `${quote(n.id)} must match [a-z0-9][a-z0-9-]*`);
    else if (this.first.get(n.id) !== path) this.add(path + ".id", `duplicate id ${quote(n.id)} (first at ${this.first.get(n.id)})`);
    this.text(path + ".name", n.name, 0, true);
    this.oneOf(path + ".kind", n.kind, kinds);
    this.oneOf(path + ".status", n.status, statuses);
    this.text(path + ".tech", n.tech, 40, false);
    this.text(path + ".summary", n.summary, 160, false);
    n.files.forEach((f, i) => this.text(`${path}.files[${i}]`, f, 0, true));
    this.refs(path + ".changes", n.changes);
    this.flags(path + ".flags", n.flags);
    if (!n.view) return;
    const why = nesting(n.kind, owner);
    if (why) return this.add(path + ".view", why);
    this.view(n.view, path + ".view", n.kind);
  }

  flags(path: string, fs: DraftFlag[]): void {
    fs.forEach((f, i) => {
      const p = `${path}[${i}]`;
      this.oneOf(p + ".level", f.level, levels);
      this.text(p + ".title", f.title, 90, true);
      this.refs(p + ".changes", f.changes);
    });
  }

  refs(path: string, ids: string[]): void {
    ids.forEach((id, i) => {
      if (!this.changes.has(id)) this.add(`${path}[${i}]`, `unknown change ${quote(id)}`);
    });
  }

  // text checks a one-line field; limit 0 means no length limit.
  text(path: string, s: string, limit: number, required: boolean): void {
    const n = runeCount(s);
    if (required && trimSpace(s) === "") this.add(path, "is required");
    else if (/[\r\n]/.test(s)) this.add(path, "must be one line");
    else if (limit > 0 && n > limit) this.add(path, `is ${n} characters, limit ${limit}`);
  }

  url(path: string, u: string): void {
    if (!u.startsWith("https://") && !u.startsWith("http://")) this.add(path, "must be an http(s) URL");
  }

  oneOf(path: string, v: string, all: readonly string[]): void {
    if (v === "") this.add(path, "is required");
    else if (!all.includes(v)) this.add(path, `${quote(v)} is not one of [${all.join(" ")}]`);
  }

  add(path: string, msg: string): void {
    this.problems.push(path + ": " + msg);
  }
}

export function severity(l: Level): number {
  return levels.indexOf(l);
}
