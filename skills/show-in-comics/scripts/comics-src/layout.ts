import { compare, fields } from "./fmt.ts";
import type { Edge, Node } from "./model.ts";

export const cardW = 210;
export const cardH = 88;
export const pad = 28; // around the root picture
export const margin = 16; // around a boundary and its chips
export const inner = 26; // between a boundary and the cards it holds
export const headH = 40; // a boundary's header strip
export const headInset = 24; // where the header text starts
export const stub = 18; // a port's stub outside the boundary
export const chipH = 24;
export const chipGap = 4;
export const chipMax = 240;
export const corner = 6; // radius of a route's bends
export const trackRoom = 18; // between a channel's outer tracks and the layers beside it
export const trackGap = 10; // between parallel tracks in a channel
export const pillFont = 12;
const pillText = 140; // widest label line, unless one word is wider
export const pillLine = 15;

// The canvas of a 1440×900 window: the width beside the 380px panel, the
// height under the header and breadcrumbs (measured, about 700).
export const canvasW = 1060;
export const canvasH = 700;

export type Point = { x: number; y: number };

export type Rect = { x: number; y: number; w: number; h: number };

// Frame is one view as drawn: the owner's boundary with the view's own cards
// inside, and every edge as an orthogonal route. An edge whose other end lies
// outside the view ends at a port on the boundary. The root has no owner, no
// boundary and no ports.
export type Frame = {
  owner: Node | null;
  w: number;
  h: number;
  boundary: Rect;
  cards: Card[];
  routes: Route[];
};

export type Card = { node: Node; at: Rect };

// Link is an edge of a view with both ends resolved to the view's cards.
export type Link = {
  edge: Edge;
  key: string; // stable selection key: from>to, then .2, .3 for repeats
  from: string; // card ids, "" for the end outside the view
  to: string;
  outside: Node | null; // the node at the outside end, null when both ends are cards
  chip: string; // where the outside node lives, e.g. "Billing › API"
};

export type Route = Link & {
  pts: Point[]; // from the edge's from end to its to end, axis-aligned
  pill: Rect;
  lines: string[];
  port: Port | null; // null when both ends are cards
};

// An entry port takes an edge in from outside, an exit port out.
export type Port = { side: "entry" | "exit"; at: Point; chip: Rect };

// ItemKind orders a layer's items: cards first.
export const cardItem = 0;
const labelItem = 1;
const pointItem = 2; // waypoint of an edge that spans several layers
export const portItem = 3;
type ItemKind = typeof cardItem | typeof labelItem | typeof pointItem | typeof portItem;

// Item is one thing a layer stacks: a card, an edge label, an edge waypoint or
// a port. Cards and ports sit on even layers; the odd layers between them hold
// labels, so labels get their own slots and never sit under a card. Entry
// ports fill the first layer and exit ports the last. Until a layout is
// turned, x runs along the layers and y across them.
export type Item = {
  kind: ItemKind;
  card: number; // index into nodes, for a card
  layer: number;
  w: number;
  h: number;
  x: number; // centre
  y: number;
  up: number[]; // neighbours in layer-1 and layer+1
  down: number[];
};

// Path is a route while it is laid out, from its lower layer to its higher.
export type Path = {
  link: Link;
  rev: boolean;
  items: number[];
  label: number;
  text: string;
  lines: string[];
  hops: Hop[]; // between consecutive items
};

// Hop is the run of a path from one item to the next: along at y1, a bend on
// a track of the gap between their layers to y2, along into the next item. A
// straight hop has y1 == y2 and track -1.
export type Hop = { y1: number; y2: number; track: number };

export type Layout = {
  owner: Node | null;
  nodes: Node[];
  head: number; // width of the boundary's header text
  tb: boolean;
  in: boolean; // the first layer holds entry ports
  out: boolean; // the last layer holds exit ports
  items: Item[];
  paths: Path[];
  layers: number[][];
  strip: number; // the layer of the cards without edges, 0 if none
  attach: Map<string, number>; // "card,neighbour" -> where the edge meets the card
  at: [number, number][]; // per layer, where it starts and ends along
  track0: number[]; // per gap after a layer, where its first track runs
};

function item(kind: ItemKind, fields: Partial<Item> = {}): Item {
  return { kind, card: 0, layer: 0, w: 0, h: 0, x: 0, y: 0, up: [], down: [], ...fields };
}

// arrange layers, orders and places a view's items left to right, or top to
// bottom when tb; route.ts routes the result.
export function arrange(owner: Node | null, nodes: Node[], links: Link[], head: number, tb: boolean): Layout {
  const l: Layout = {
    owner, nodes, head, tb, in: false, out: false, items: [], paths: [], layers: [], strip: 0,
    attach: new Map(), at: [], track0: [],
  };
  const along = (w: number, h: number): [number, number] => (tb ? [h, w] : [w, h]);
  const [cw, ch] = along(cardW, cardH);
  const at = new Map<string, number>();
  nodes.forEach((n, i) => {
    at.set(n.id, i);
    l.items.push(item(cardItem, { card: i, w: cw, h: ch }));
  });
  const cards = nodes.length;

  // Cards are layered by the edges between them; ports pull their cards
  // toward the side they face.
  type Arc = { a: number; b: number; rev: boolean }; // card indexes; -1 for a port
  const arcs: Arc[] = [];
  const out: number[][] = Array.from({ length: cards }, () => []);
  const hasIn = new Array<boolean>(cards).fill(false);
  const hasOut = new Array<boolean>(cards).fill(false);
  links.forEach((lk, i) => {
    const a = lk.from !== "" ? at.get(lk.from)! : -1;
    const b = lk.to !== "" ? at.get(lk.to)! : -1;
    arcs.push({ a, b, rev: false });
    if (a < 0) {
      hasIn[b] = true;
      l.in = true;
    } else if (b < 0) {
      hasOut[a] = true;
      l.out = true;
    } else {
      out[a].push(i);
    }
  });

  // Break cycles: an edge back into the DFS stack is reversed.
  const state = new Array<number>(cards).fill(0);
  const dfs = (u: number) => {
    state[u] = 1;
    for (const ai of out[u]) {
      const w = arcs[ai].b;
      if (state[w] === 0) dfs(w);
      else if (state[w] === 1) arcs[ai].rev = true;
    }
    state[u] = 2;
  };
  for (let u = 0; u < cards; u++) if (state[u] === 0) dfs(u);
  const succ: number[][] = Array.from({ length: cards }, () => []);
  const pred: number[][] = Array.from({ length: cards }, () => []);
  for (const a of arcs) {
    if (a.a < 0 || a.b < 0) continue;
    if (a.rev) [a.a, a.b] = [a.b, a.a];
    succ[a.a].push(a.b);
    pred[a.b].push(a.a);
  }

  // Longest-path layering after the entry ports, then pull each source next
  // to its nearest successor or to the exit ports.
  const base = l.in ? 1 : 0;
  const indeg = pred.map((p) => p.length);
  const topo: number[] = [];
  for (let u = 0; u < cards; u++) if (indeg[u] === 0) topo.push(u);
  for (let k = 0; k < topo.length; k++) {
    for (const w of succ[topo[k]]) if (--indeg[w] === 0) topo.push(w);
  }
  const rank = new Array<number>(cards).fill(base);
  for (const u of topo) for (const w of succ[u]) rank[w] = Math.max(rank[w], rank[u] + 1);
  let last = Math.max(...rank);
  for (let k = topo.length - 1; k >= 0; k--) {
    const u = topo[k];
    if (pred[u].length > 0 || hasIn[u] || (succ[u].length === 0 && !hasOut[u])) continue;
    let r = Infinity;
    for (const w of succ[u]) r = Math.min(r, rank[w]);
    if (hasOut[u]) r = Math.min(r, last + 1);
    rank[u] = Math.max(base, r - 1);
  }
  // Cards without edges go in a strip after the last layer of cards.
  last = Math.max(...rank);
  const edgeless = (u: number) => pred[u].length + succ[u].length === 0 && !hasIn[u] && !hasOut[u];
  for (let u = 0; u < cards; u++) {
    if (edgeless(u) && links.length > 0) {
      rank[u] = last + 1;
      l.strip = 2 * rank[u];
    }
  }
  const outRank = Math.max(...rank) + 1;
  for (let u = 0; u < cards; u++) l.items[u].layer = 2 * rank[u];

  links.forEach((lk, i) => {
    const a = arcs[i];
    const p: Path = { link: lk, rev: a.rev, items: [], label: 0, text: "", lines: [], hops: [] };
    const ends = [a.a, a.b].map((c, k) => {
      if (c >= 0) return c;
      const it = item(portItem, { h: 8 });
      if (k === 0) {
        if (tb) it.w = headH;
      } else {
        it.layer = 2 * outRank;
      }
      l.items.push(it);
      return l.items.length - 1;
    });
    const la = l.items[ends[0]].layer;
    const lb = l.items[ends[1]].layer;
    p.items = [ends[0]];
    const labelLayer = la + 1 + 2 * Math.trunc((Math.trunc((lb - la) / 2) - 1) / 2); // the middle gap
    for (let layer = la + 1; layer < lb; layer++) {
      const it = item(pointItem, { layer, h: 4 });
      if (layer % 2 === 0) it.w = cw;
      if (layer === labelLayer) {
        it.kind = labelItem;
        p.label = l.items.length;
        p.text = lk.edge.flags.length > 0 ? "⚠ " + lk.edge.label : lk.edge.label;
      }
      p.items.push(l.items.length);
      l.items.push(it);
    }
    p.items.push(ends[1]);
    for (let j = 1; j < p.items.length; j++) {
      const ia = p.items[j - 1];
      const ib = p.items[j];
      l.items[ia].down.push(ib);
      l.items[ib].up.push(ia);
    }
    l.paths.push(p);
  });

  // A gap is as deep as its most demanding label: left to right, the width
  // of that label on two lines; top to bottom, its lines at full width. The
  // other labels in the gap take their most compact shape within that depth.
  const depth = new Map<number, number>();
  for (const p of l.paths) {
    const need = tb ? wrap(p.text, 1).length : linesWidth(wrap(p.text, 2));
    const k = l.items[p.label].layer;
    depth.set(k, Math.max(depth.get(k) ?? 0, need));
  }
  for (const p of l.paths) {
    const it = l.items[p.label];
    const d = depth.get(it.layer) ?? 0;
    p.lines = tb ? wrap(p.text, Math.trunc(d)) : breakAt(p.text, d);
    [it.w, it.h] = along(Math.max(16, linesWidth(p.lines) + 18), pillLine * p.lines.length + 9);
  }

  let top = 0;
  for (const it of l.items) top = Math.max(top, it.layer);
  l.layers = Array.from({ length: top + 1 }, () => []);
  l.items.forEach((it, i) => l.layers[it.layer].push(i));
  order(l);
  placeAcross(l);
  return l;
}

// order reduces crossings with barycentre sweeps, keeping the best ordering seen.
function order(l: Layout): void {
  const pos = new Array<number>(l.items.length).fill(0);
  for (const ly of l.layers) ly.forEach((i, k) => (pos[i] = k));
  let best = cloneLayers(l.layers);
  let bestX = crossings(l, pos);
  const bary = new Array<number>(l.items.length).fill(0);
  const sweep = (ly: number[], nb: (i: number) => number[]) => {
    for (const i of ly) {
      bary[i] = pos[i];
      const ns = nb(i);
      if (ns.length > 0) {
        let sum = 0;
        for (const n of ns) sum += pos[n];
        bary[i] = sum / ns.length;
      }
    }
    ly.sort((a, b) => compare(bary[a], bary[b]));
    ly.forEach((i, k) => (pos[i] = k));
  };
  for (let iter = 0; iter < 16 && bestX > 0; iter++) {
    if (iter % 2 === 0) {
      for (let k = 1; k < l.layers.length; k++) sweep(l.layers[k], (i) => l.items[i].up);
    } else {
      for (let k = l.layers.length - 2; k >= 0; k--) sweep(l.layers[k], (i) => l.items[i].down);
    }
    const x = crossings(l, pos);
    if (x < bestX) {
      best = cloneLayers(l.layers);
      bestX = x;
    }
  }
  l.layers = best;
  // The strip keeps its cards first, so they line up at the top.
  if (l.strip > 0) l.layers[l.strip].sort((a, b) => l.items[a].kind - l.items[b].kind);
}

function crossings(l: Layout, pos: number[]): number {
  let n = 0;
  for (const ly of l.layers) {
    const segs: [number, number][] = [];
    for (const a of ly) for (const b of l.items[a].down) segs.push([pos[a], pos[b]]);
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) n++;
      }
    }
  }
  return n;
}

function cloneLayers(ls: number[][]): number[][] {
  return ls.map((ly) => ly.slice());
}

// placeAcross sets y by repeated least-squares alignment with neighbours under
// order and spacing constraints.
function placeAcross(l: Layout): void {
  for (const ly of l.layers) {
    for (let k = 1; k < ly.length; k++) l.items[ly[k]].y = l.items[ly[k - 1]].y + spacing(l, ly[k - 1], ly[k]);
  }
  for (let r = 0; r < 8; r++) {
    for (let k = 1; k < l.layers.length; k++) align(l, l.layers[k], true, false);
    for (let k = l.layers.length - 2; k >= 0; k--) align(l, l.layers[k], false, true);
  }
  for (let r = 0; r < 4; r++) for (const ly of l.layers) align(l, ly, true, true);
  if (l.strip > 0) {
    let top = Infinity;
    for (const it of l.items) if (it.layer !== l.strip) top = Math.min(top, it.y - it.h / 2);
    const ly = l.layers[l.strip];
    const first = l.items[ly[0]];
    const shift = top - first.y + first.h / 2;
    for (const i of ly) l.items[i].y += shift;
  }
}

function spacing(l: Layout, a: number, b: number): number {
  const ia = l.items[a];
  const ib = l.items[b];
  let gap = 10;
  if (ia.kind === cardItem && ib.kind === cardItem) gap = 32;
  else if (ia.kind === cardItem || ib.kind === cardItem) gap = 22;
  return (ia.h + ib.h) / 2 + gap;
}

// align moves a layer's items as close as possible to the mean y of their
// neighbours without reordering or crowding them (pool adjacent violators).
function align(l: Layout, ly: number[], up: boolean, down: boolean): void {
  const n = ly.length;
  const off = new Array<number>(n).fill(0);
  for (let k = 1; k < n; k++) off[k] = off[k - 1] + spacing(l, ly[k - 1], ly[k]);
  type Block = { sum: number; n: number; start: number };
  const bs: Block[] = [];
  ly.forEach((i, k) => {
    const it = l.items[i];
    const ns = [...(up ? it.up : []), ...(down ? it.down : [])];
    let want = it.y;
    if (ns.length > 0) {
      want = 0;
      for (const nb of ns) want += l.items[nb].y;
      want /= ns.length;
    }
    bs.push({ sum: want - off[k], n: 1, start: k });
    while (bs.length > 1) {
      const p = bs[bs.length - 2];
      const q = bs[bs.length - 1];
      if (p.sum / p.n <= q.sum / q.n) break;
      bs.pop();
      bs[bs.length - 1] = { sum: p.sum + q.sum, n: p.n + q.n, start: p.start };
    }
  });
  for (const b of bs) {
    const m = b.sum / b.n;
    for (let k = b.start; k < b.start + b.n; k++) l.items[ly[k]].y = m + off[k];
  }
}

export function chipWidth(s: string): number {
  return Math.min(chipMax, textWidth(s, 12, false) + 20);
}

export function textWidth(s: string, size: number, bold: boolean): number {
  let w = 0;
  for (const r of s) {
    if ("ijlI.,:;'|!".includes(r)) w += 0.28;
    else if ("frt -()[]/".includes(r)) w += 0.36;
    else if ("mwMW".includes(r)) w += 0.86;
    else if (r >= "A" && r <= "Z") w += 0.68;
    else if (r >= "0" && r <= "9") w += 0.58;
    else if (r.codePointAt(0)! < 128) w += 0.54;
    else w += 1.0;
  }
  if (bold) w *= 1.08;
  return w * size;
}

// fit truncates s with an ellipsis so it renders within width.
export function fit(s: string, width: number, size: number, bold: boolean): string {
  if (textWidth(s, size, bold) <= width) return s;
  const rs = [...s];
  while (rs.length > 0 && textWidth(rs.join("") + "…", size, bold) > width) rs.pop();
  return rs.join("").replace(/ +$/, "") + "…";
}

// wrap breaks a label into at most n lines as narrow as it can, no wider than
// pillText or its widest word; a label that needs more lines gets them.
function wrap(s: string, n: number): string[] {
  let hi = pillText;
  for (const w of fields(s)) hi = Math.max(hi, textWidth(w, pillFont, false));
  const lines = breakAt(s, hi);
  if (lines.length > n) return lines;
  let lo = 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    if (breakAt(s, mid).length <= n) hi = mid;
    else lo = mid;
  }
  return breakAt(s, hi);
}

// breakAt fills each line of a label up to width; a wider word gets a line of its own.
function breakAt(s: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of fields(s)) {
    if (line === "") line = w;
    else if (textWidth(line + " " + w, pillFont, false) <= width) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  lines.push(line);
  return lines;
}

function linesWidth(lines: string[]): number {
  let w = 0;
  for (const ln of lines) w = Math.max(w, textWidth(ln, pillFont, false));
  return w;
}
