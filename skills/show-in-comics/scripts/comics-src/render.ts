import { readFileSync } from "node:fs";
import { esc, fixed, trimSpace } from "./fmt.ts";
import { chipMax, chipWidth, fit, headH, headInset, pillLine, textWidth, type Card, type Frame, type Link } from "./layout.ts";
import { levels, parents, resolve, severity, type Change, type Doc, type Edge, type Flag, type Level, type Node, type View } from "./model.ts";
import { layoutView, pathData } from "./route.ts";
import { execute, Safe } from "./template.ts";

const asset = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

type ViewInfo = {
  v: View;
  owner: Node | null; // null at the root
  index: number;
  path: string; // node ids from the root joined by "/"; "" is the root
  crumbs: string; // view titles from the root joined by " › "
  below: string[]; // view titles under the root
  here: Set<string>;
  links: Link[];
};

class Rollup {
  n = 0;
  top: Level | null = null; // the most severe level, null while n is 0

  add(fs: Flag[]): void {
    for (const f of fs) this.count(1, f.level);
  }

  merge(o: Rollup): void {
    if (o.top) this.count(o.n, o.top);
  }

  count(n: number, top: Level): void {
    this.n += n;
    if (!this.top || severity(top) < severity(this.top)) this.top = top;
  }
}

// The template's data, named as page.html names it.
type Anchor = { Text: string; Href: string };
type ChangeT = { ID: string; URL: string; Subject: string; Insertions: bigint; Deletions: bigint };
type FlagT = { Level: Level; Title: string; Detail: string; Refs: ChangeT[] };
type Page = {
  Doc: { Title: string; Summary: string; Source: { Label: string; URL: string } | null };
  NChanges: number;
  NFlags: number;
  Added: number;
  Changed: number;
  Removed: number;
  CSS: Safe;
  JS: Safe;
  Views: { Tpl: string; V: { Title: string; Summary: string; Nodes: Node[]; Edges: Edge[] }; Flags: number; SVG: Safe }[];
  Nodes: {
    Tpl: string;
    N: { Name: string; Kind: string; Status: string; Tech: string; Summary: string; Detail: string; Files: string[] };
    Where: string;
    Inside: string;
    Flags: FlagT[];
    Changes: ChangeT[];
  }[];
  Edges: {
    Tpl: string;
    E: { Label: string; Status: string; Detail: string };
    Where: string;
    From: Anchor;
    To: Anchor;
    Flags: FlagT[];
    Changes: ChangeT[];
  }[];
  Attention: { Level: Level; Items: { Title: string; Where: string; Href: string }[] }[];
  Changes: (ChangeT & { Change: ChangeT; Cites: Anchor[] })[];
};

const changeT = (c: Change): ChangeT => ({ ID: c.id, URL: c.url, Subject: c.subject, Insertions: c.insertions, Deletions: c.deletions });

class Site {
  views: ViewInfo[] = [];
  nodes = new Map<string, Node>();
  home = new Map<string, ViewInfo>();
  parent: Map<string, string>;
  changes = new Map<string, Change>();
  roll = new Map<string, Rollup>(); // per node: its flags, its edges' and its subtree's
  inside = new Map<View, Rollup>(); // per view: every flag in it and below it

  constructor(d: Doc) {
    this.parent = parents(d.root);
    for (const c of d.changes) this.changes.set(c.id, c);
  }

  walk(v: View, owner: Node | null, path: string[], titles: string[]): void {
    titles = [...titles, v.title];
    const vi: ViewInfo = {
      v, owner, index: this.views.length, path: path.join("/"), crumbs: titles.join(" › "), below: titles.slice(1),
      here: new Set(), links: [],
    };
    this.views.push(vi);
    for (const n of v.nodes) {
      this.nodes.set(n.id, n);
      this.home.set(n.id, vi);
      vi.here.add(n.id);
    }
    for (const n of v.nodes) if (n.view) this.walk(n.view, n, [...path, n.id], titles);
  }

  // resolveEdges attaches each edge end to a card of the view: the node itself,
  // or the card it lies inside. Any other end is outside and becomes a port.
  resolveEdges(vi: ViewInfo): Link[] {
    const seen = new Map<string, number>();
    return vi.v.edges.map((e) => {
      let key = e.from + ">" + e.to;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > 1) key = `${key}.${n}`;
      const from = resolve(e.from, vi.here, this.parent);
      const to = resolve(e.to, vi.here, this.parent);
      const outside = from === "" ? this.node(e.from) : to === "" ? this.node(e.to) : null;
      return { edge: e, key, from, to, outside, chip: outside ? this.where(outside) : "" };
    });
  }

  node(id: string): Node {
    return this.nodes.get(id)!;
  }

  // where names a node with the views it sits in, dropping the outer ones while
  // it is wider than a chip: "Billing › billing-api › Intake".
  where(n: Node): string {
    const parts = [...this.home.get(n.id)!.below, n.name];
    let text = parts.join(" › ");
    for (let k = 1; k < parts.length && chipWidth(text) >= chipMax; k++) text = "… › " + parts.slice(k).join(" › ");
    return text;
  }

  // rollup counts, for each node, its flags, the flags of the edges drawn on
  // its card and every flag inside it. Children come after their parents in
  // views, so walking it backwards sees each subtree first.
  rollup(): void {
    for (const vi of this.views.slice().reverse()) {
      const all = new Rollup();
      for (const n of vi.v.nodes) {
        const r = new Rollup();
        r.add(n.flags);
        all.add(n.flags);
        if (n.view) {
          r.merge(this.inside.get(n.view)!);
          all.merge(this.inside.get(n.view)!);
        }
        for (const lk of vi.links) if (lk.from === n.id || lk.to === n.id) r.add(lk.edge.flags);
        this.roll.set(n.id, r);
      }
      for (const e of vi.v.edges) all.add(e.flags);
      this.inside.set(vi.v, all);
    }
  }

  flags(fs: Flag[]): FlagT[] {
    return fs.map((f) => ({ Level: f.level, Title: f.title, Detail: f.detail, Refs: this.refs(f.changes) }));
  }

  refs(ids: string[]): ChangeT[] {
    return ids.map((id) => changeT(this.changes.get(id)!));
  }

  nodeAnchor(id: string): Anchor {
    return { Text: this.node(id).name, Href: href(this.home.get(id)!.path, id) };
  }

  svg(vi: ViewInfo): string {
    const f = layoutView(vi.owner, vi.v.nodes, vi.links, headWidth(vi.owner, this.roll));
    const [w, h] = [fixed(f.w, 0), fixed(f.h, 0)];
    let b = `<svg class="view" data-path="${esc(vi.path)}" data-title="${esc(vi.v.title)}" data-t="t-v-${vi.index}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(vi.v.title)}">`;
    if (f.owner) b += this.boundary(vi, f);
    f.routes.forEach((r, ei) => {
      const e = r.edge;
      const d = pathData(r.pts);
      b += `<a class="edge st-${e.status}" href="${esc(href(vi.path, r.key))}" data-sel="${esc(r.key)}" data-ends="${r.from} ${r.to}" data-t="t-e-${vi.index}-${ei}"><title>${esc(this.node(e.from).name + " → " + this.node(e.to).name + ": " + e.label)}</title><path class="hit" d="${d}"/><path class="line" d="${d}" marker-end="url(#a-${e.status})"/>`;
      if (r.port) b += `<circle class="port" cx="${fixed(r.port.at.x, 1)}" cy="${fixed(r.port.at.y, 1)}" r="4"/>`;
      b += `</a>`;
    });
    f.routes.forEach((r, ei) => {
      const [e, pl] = [r.edge, r.pill];
      b += `<a class="pill st-${e.status}" href="${esc(href(vi.path, r.key))}" data-sel="${esc(r.key)}" data-ends="${r.from} ${r.to}" data-t="t-e-${vi.index}-${ei}"><rect x="${fixed(pl.x, 1)}" y="${fixed(pl.y, 1)}" width="${fixed(pl.w, 1)}" height="${fixed(pl.h, 1)}" rx="9"/><text y="${fixed(pl.y + 4.5, 1)}">`;
      r.lines.forEach((ln, i) => {
        b += `<tspan x="${fixed(pl.x + pl.w / 2, 1)}" dy="${fixed(pillLine, 0)}">`;
        if (i === 0 && e.flags.length > 0 && ln.startsWith("⚠")) {
          const er = new Rollup();
          er.add(e.flags);
          b += `<tspan class="warn fl-${er.top}">⚠</tspan>${esc(ln.slice("⚠".length))}`;
        } else {
          b += esc(ln);
        }
        b += `</tspan>`;
      });
      b += `</text></a>`;
    });
    for (const c of f.cards) b += this.card(vi, c);
    f.routes.forEach((r, ei) => {
      if (!r.port) return;
      const [o, c] = [r.outside!, r.port.chip];
      b += `<a class="xchip" href="${esc(href(this.home.get(o.id)!.path, o.id))}" data-sel="${esc(r.key)}" data-t="t-e-${vi.index}-${ei}"><title>Go to ${esc(o.name)}</title><rect x="${fixed(c.x, 1)}" y="${fixed(c.y, 1)}" width="${fixed(c.w, 1)}" height="${fixed(c.h, 1)}" rx="12"/><text x="${fixed(c.x + c.w / 2, 1)}" y="${fixed(c.y + c.h / 2 + 4, 1)}">${esc(fit(r.chip, c.w - 16, 12, false))}</text></a>`;
    });
    return b + `</svg>`;
  }

  // boundary draws the owner expanded: its outline, and a header strip that
  // selects the owner.
  boundary(vi: ViewInfo, f: Frame): string {
    const [n, r] = [f.owner!, f.boundary];
    const g = (v: number) => fixed(v, 1);
    let b = `<g class="boundary k-${n.kind} st-${n.status}"><rect class="bd" x="${g(r.x)}" y="${g(r.y)}" width="${g(r.w)}" height="${g(r.h)}" rx="14"/>`;
    b += `<a class="hdr" href="${esc(href(vi.path, n.id))}" data-sel="${n.id}" data-t="t-n-${n.id}"><title>${esc(n.name)}</title>`;
    b += `<path class="hbg" d="M${g(r.x)} ${g(r.y + headH)}V${g(r.y + 14)}A14 14 0 0 1 ${g(r.x + 14)} ${g(r.y)}H${g(r.x + r.w - 14)}A14 14 0 0 1 ${g(r.x + r.w)} ${g(r.y + 14)}V${g(r.y + headH)}Z"/>`;
    b += `<rect class="stripe" x="${g(r.x + 8)}" y="${g(r.y + 10)}" width="6" height="${g(headH - 20)}"/>`;
    let x = r.x + headInset;
    const y = r.y + headH / 2 + 5;
    b += `<text class="hn" x="${g(x)}" y="${g(y)}">${esc(n.name)}</text>`;
    x += textWidth(n.name, 15, true) + 12;
    b += `<text class="tc" x="${g(x)}" y="${g(y)}">${esc(subtitle(n))}</text>`;
    x += textWidth(subtitle(n), 12, false) + 12;
    const cw = textWidth(n.status, 12, true) + 14;
    b += `<g class="chip"><rect x="${g(x)}" y="${g(y - 14)}" width="${g(cw)}" height="19" rx="9.5"/><text x="${g(x + cw / 2)}" y="${g(y)}">${n.status}</text></g>`;
    x += cw + 10;
    const ro = this.roll.get(n.id)!;
    if (ro.n > 0) {
      const label = `⚠ ${ro.n}`;
      const w = textWidth(label, 12, true) + 14;
      b += `<g class="badge fl-${ro.top}"><rect x="${g(x)}" y="${g(y - 14.5)}" width="${g(w)}" height="20" rx="10"/><text x="${g(x + w / 2)}" y="${g(y)}">${label}</text></g>`;
    }
    return b + `</a></g>`;
  }

  card(vi: ViewInfo, c: Card): string {
    const n = c.node;
    const link = n.view ? href(join(vi.path, n.id), "") : href(vi.path, n.id);
    let tip = n.name;
    if (n.summary !== "") tip += "\n" + n.summary;
    if (n.view) tip += "\nClick to open " + n.view.title;
    const [g, i] = [(v: number) => fixed(v, 1), (v: number) => fixed(v, 0)];
    let b = `<g transform="translate(${g(c.at.x)} ${g(c.at.y)})"><a class="node k-${n.kind} st-${n.status}" href="${esc(link)}" data-sel="${n.id}" data-t="t-n-${n.id}"><title>${esc(tip)}</title>`;

    let [top, clip] = [0, "clip-card"];
    if (n.kind === "store") {
      [top, clip] = [7, "clip-store"];
      b += `<path class="card" d="${storePath}"/>`;
    } else {
      if (n.kind === "queue") {
        b += `<rect class="card back" x="8" y="-8" width="210" height="88" rx="10"/><rect class="card back" x="4" y="-4" width="210" height="88" rx="10"/>`;
      }
      b += `<rect class="card" width="210" height="88" rx="10"/>`;
    }
    b += `<rect class="stripe" width="6" height="88" clip-path="url(#${clip})"/>`;
    if (n.kind === "store") b += `<path class="rim" d="M0 9A105 9 0 0 0 210 9"/>`;
    let left = 18;
    if (n.kind === "person") {
      b += `<g class="avatar"><circle cx="34" cy="38" r="16"/><circle class="face" cx="34" cy="33" r="5"/><path class="face" d="M25 47a9 7 0 0 1 18 0z"/></g>`;
      left = 60;
    }
    const nameCls = n.status === "removed" ? "nm struck" : "nm";
    b += `<text class="${nameCls}" x="${i(left)}" y="${i(28 + top)}">${esc(fit(n.name, 200 - left, 14, true))}</text>`;
    b += `<text class="tc" x="${i(left)}" y="${i(46 + top)}">${esc(fit(subtitle(n), 200 - left, 12, false))}</text>`;
    const cw = textWidth(n.status, 12, true) + 14;
    b += `<g class="chip"><rect x="18" y="${i(58 + top / 2)}" width="${g(cw)}" height="19" rx="9.5"/><text x="${g(18 + cw / 2)}" y="${i(72 + top / 2)}">${n.status}</text></g>`;
    const r = this.roll.get(n.id)!;
    if (r.n > 0) {
      const label = `⚠ ${r.n}`;
      const w = textWidth(label, 12, true) + 14;
      b += `<g class="badge fl-${r.top}"><rect x="${g(202 - w)}" y="-10" width="${g(w)}" height="20" rx="10"/><text x="${g(202 - w / 2)}" y="4.5">${label}</text></g>`;
    }
    if (n.view) {
      const label = `▸ ${n.view.nodes.length} inside`;
      const w = textWidth(label, 12, true) + 16;
      b += `<g class="inside"><rect x="${g(200 - w)}" y="${i(57 + top / 2)}" width="${g(w)}" height="21" rx="10.5"/><text x="${g(200 - w / 2)}" y="${i(72 + top / 2)}">${label}</text></g>`;
    }
    return b + `</a></g>`;
  }
}

export function render(d: Doc): string {
  const s = new Site(d);
  s.walk(d.root, null, [], []);
  for (const vi of s.views) vi.links = s.resolveEdges(vi);
  s.rollup();

  const p: Page = {
    Doc: { Title: d.title, Summary: d.summary, Source: d.source && { Label: d.source.label, URL: d.source.url } },
    NChanges: d.changes.length, NFlags: 0, Added: 0, Changed: 0, Removed: 0,
    CSS: new Safe("css", asset("page.css")), JS: new Safe("js", asset("page.js")),
    Views: [], Nodes: [], Edges: [], Attention: [], Changes: [],
  };
  const cites = new Map<string, Anchor[]>();
  const cite = (ids: string[], a: Anchor) => {
    for (const id of ids) {
      const list = cites.get(id) ?? [];
      if (!list.some((c) => c.Text === a.Text && c.Href === a.Href)) list.push(a);
      cites.set(id, list);
    }
  };
  const att = new Map<Level, { Title: string; Where: string; Href: string }[]>();
  const attend = (f: Flag, where: string, a: Anchor) => {
    att.set(f.level, [...(att.get(f.level) ?? []), { Title: f.title, Where: where, Href: a.Href }]);
  };
  for (const vi of s.views) {
    for (const n of vi.v.nodes) {
      if (n.status === "added") p.Added++;
      else if (n.status === "changed") p.Changed++;
      else if (n.status === "removed") p.Removed++;
      const a = { Text: n.name, Href: href(vi.path, n.id) };
      p.Nodes.push({
        Tpl: "t-n-" + n.id,
        N: { Name: n.name, Kind: n.kind, Status: n.status, Tech: n.tech, Summary: n.summary, Detail: n.detail, Files: n.files },
        Where: vi.crumbs, Inside: n.view ? href(join(vi.path, n.id), "") : "", Flags: s.flags(n.flags), Changes: s.refs(n.changes),
      });
      cite(n.changes, a);
      for (const f of n.flags) {
        cite(f.changes, a);
        attend(f, vi.crumbs + " › " + n.name, a);
      }
    }
    vi.links.forEach((lk, ei) => {
      const e = lk.edge;
      const name = s.node(e.from).name + " → " + s.node(e.to).name;
      const a = { Text: name, Href: href(vi.path, lk.key) };
      p.Edges.push({
        Tpl: `t-e-${vi.index}-${ei}`, E: { Label: e.label, Status: e.status, Detail: e.detail }, Where: vi.crumbs,
        From: s.nodeAnchor(e.from), To: s.nodeAnchor(e.to), Flags: s.flags(e.flags), Changes: s.refs(e.changes),
      });
      cite(e.changes, a);
      for (const f of e.flags) {
        cite(f.changes, a);
        attend(f, vi.crumbs + " › " + name, a);
      }
    });
    p.Views.push({
      Tpl: `t-v-${vi.index}`, V: { Title: vi.v.title, Summary: vi.v.summary, Nodes: vi.v.nodes, Edges: vi.v.edges },
      Flags: s.inside.get(vi.v)!.n, SVG: new Safe("html", s.svg(vi)),
    });
  }
  for (const lv of levels) {
    const items = att.get(lv) ?? [];
    if (items.length > 0) {
      p.Attention.push({ Level: lv, Items: items });
      p.NFlags += items.length;
    }
  }
  for (const c of d.changes) p.Changes.push({ ...changeT(c), Change: changeT(c), Cites: cites.get(c.id) ?? [] });
  return execute(asset("page.html"), p, { md: markdown });
}

function href(path: string, sel: string): string {
  return sel === "" ? "#/" + path : "#/" + path + "?sel=" + sel;
}

function join(path: string, id: string): string {
  return path === "" ? id : path + "/" + id;
}

// headWidth is the width of a boundary's header text: name, kind and tech,
// status and flag badge.
function headWidth(n: Node | null, roll: Map<string, Rollup>): number {
  if (!n) return 0;
  let w = textWidth(n.name, 15, true) + 12 + textWidth(subtitle(n), 12, false) + 12 + textWidth(n.status, 12, true) + 14;
  const r = roll.get(n.id)!;
  if (r.n > 0) w += 10 + textWidth(`⚠ ${r.n}`, 12, true) + 14;
  return w;
}

function subtitle(n: Node): string {
  return n.tech !== "" ? n.kind + " · " + n.tech : n.kind;
}

const storePath = "M0 9A105 9 0 0 1 210 9V79A105 9 0 0 1 0 79Z";

// markdown renders markdown-lite: paragraphs, "- " bullets, `code` and **bold**.
function markdown(v: unknown): Safe {
  let b = "";
  for (const block of trimSpace(String(v)).split(/\n[ \t]*\n/)) {
    let para: string[] = [];
    let list = false;
    const flush = () => {
      if (para.length > 0) {
        b += "<p>" + inline(para.join(" ")) + "</p>";
        para = [];
      }
    };
    for (let line of block.split("\n")) {
      line = trimSpace(line);
      if (line.startsWith("- ")) {
        flush();
        if (!list) {
          b += "<ul>";
          list = true;
        }
        b += "<li>" + inline(line.slice(2)) + "</li>";
        continue;
      }
      if (list) {
        b += "</ul>";
        list = false;
      }
      if (line !== "") para.push(line);
    }
    flush();
    if (list) b += "</ul>";
  }
  return new Safe("html", b);
}

function inline(s: string): string {
  let b = "";
  const code = s.split("`");
  code.forEach((part, i) => {
    if (i % 2 === 1 && i < code.length - 1) {
      b += "<code>" + esc(part) + "</code>";
      return;
    }
    if (i % 2 === 1) b += "`";
    const bold = part.split("**");
    bold.forEach((t, j) => {
      if (j % 2 === 1 && j < bold.length - 1) b += "<b>" + esc(t) + "</b>";
      else if (j % 2 === 1) b += "**" + esc(t);
      else b += esc(t);
    });
  });
  return b;
}
