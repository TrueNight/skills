import { compare, fixed, hypot } from "./fmt.ts";
import {
  arrange, canvasH, canvasW, cardItem, chipGap, chipH, chipWidth, corner, headH, headInset, inner, margin, pad,
  portItem, stub, trackGap, trackRoom,
  type Frame, type Hop, type Layout, type Link, type Path, type Point, type Port, type Rect, type Route,
} from "./layout.ts";
import type { Node } from "./model.ts";

// layoutView lays the view out left to right and top to bottom and keeps the
// one that shows larger fitted into the canvas, left to right on a tie.
export function layoutView(owner: Node | null, nodes: Node[], links: Link[], head: number): Frame {
  const lr = finish(arrange(owner, nodes, links, head, false));
  const tb = finish(arrange(owner, nodes, links, head, true));
  return scale(tb) > scale(lr) ? tb : lr;
}

function finish(l: Layout): Frame {
  spread(l);
  route(l);
  return frame(l);
}

// scale is the scale that shows the whole frame in the canvas, at most 1.
function scale(f: Frame): number {
  return Math.min(1, canvasW / f.w, canvasH / f.h);
}

// spread gives each edge its own place on a card's side, in the order of the
// items it heads for. Every other item meets its edge at its centre.
function spread(l: Layout): void {
  l.attach = new Map();
  l.items.forEach((it, ci) => {
    if (it.kind !== cardItem) return;
    for (const side of [it.up, it.down]) {
      const ns = side.slice().sort((a, b) => compare(l.items[a].y, l.items[b].y));
      const step = ns.length > 1 ? Math.min(16, (it.h - 28) / (ns.length - 1)) : 0;
      ns.forEach((nb, k) => l.attach.set(`${ci},${nb}`, it.y + step * (k - (ns.length - 1) / 2)));
    }
  });
}

function meet(l: Layout, i: number, toward: number): number {
  return l.attach.get(`${i},${toward}`) ?? l.items[i].y;
}

// Jog is the bend of one hop of a path in the gap between two layers: across
// from y1 at the lower layer to y2 at the higher.
type Jog = { path: number; hop: number; y1: number; y2: number };

const eps = 0.5;

// cost counts the crossings of two bends in one gap when a takes the track
// left of b, with a heavy charge where they would run along one line.
function cost(a: Jog, b: Jog): number {
  const between = (y: number, p: number, q: number) => y > Math.min(p, q) + eps && y < Math.max(p, q) - eps;
  let n = 0;
  if (between(a.y2, b.y1, b.y2)) n++;
  if (between(b.y1, a.y1, a.y2)) n++;
  if (Math.abs(a.y2 - b.y1) < eps) n += 10;
  return n;
}

// route gives every bend a track in its gap, then sets x layer by layer with
// each gap as wide as its tracks need.
function route(l: Layout): void {
  const gaps = l.layers.length - 1;
  const jogs: Jog[][] = Array.from({ length: Math.max(gaps, 0) }, () => []);
  l.paths.forEach((p, pi) => {
    p.hops = [];
    for (let j = 0; j < p.items.length - 1; j++) {
      const a = p.items[j];
      const b = p.items[j + 1];
      const h: Hop = { y1: meet(l, a, b), y2: meet(l, b, a), track: -1 };
      if (j > 0 && l.items[a].kind !== cardItem) h.y1 = p.hops[j - 1].y2; // a waypoint or label passes straight through
      if (Math.abs(h.y1 - h.y2) < eps) h.y2 = h.y1;
      else jogs[l.items[a].layer].push({ path: pi, hop: j, y1: h.y1, y2: h.y2 });
      p.hops.push(h);
    }
  });
  const width = jogs.map((js) => {
    const n = tracks(js);
    js.forEach((j, i) => (l.paths[j.path].hops[j.hop].track = n[i]));
    let used = 0;
    for (const t of n) used = Math.max(used, t + 1);
    return 2 * trackRoom + Math.max(used - 1, 0) * trackGap;
  });

  l.at = [];
  l.track0 = new Array<number>(Math.max(gaps, 0)).fill(0);
  let x = 0;
  l.layers.forEach((ly, k) => {
    let w = 0;
    for (const i of ly) w = Math.max(w, l.items[i].w);
    l.at.push([x, x + w]);
    for (const i of ly) l.items[i].x = x + w / 2;
    x += w;
    if (k < gaps) {
      l.track0[k] = x + trackRoom;
      x += width[k];
    }
  });
}

// tracks numbers the bends of one gap from left to right. Bends whose spans
// overlap get different tracks, in the order that crosses least; the others
// may share one.
function tracks(js: Jog[]): number[] {
  const n = js.length;
  const span = (j: Jog) => [Math.min(j.y1, j.y2) - 2 * corner, Math.max(j.y1, j.y2) + 2 * corner];
  const after: number[][] = Array.from({ length: n }, () => []); // after[a] holds the bends right of a
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const [alo, ahi] = span(js[a]);
      const [blo, bhi] = span(js[b]);
      if (ahi <= blo || bhi <= alo) continue;
      if (cost(js[b], js[a]) < cost(js[a], js[b])) after[b].push(a);
      else after[a].push(b);
    }
  }
  // Break cycles by turning back edges around, so every overlapping pair
  // keeps an order, then give each bend the longest chain of bends left of it.
  const state = new Array<number>(n).fill(0);
  const post: number[] = [];
  const dfs = (u: number) => {
    state[u] = 1;
    for (let i = 0; i < after[u].length; i++) {
      const w = after[u][i];
      if (state[w] === 0) dfs(w);
      else if (state[w] === 1) {
        after[u].splice(i, 1);
        after[w].push(u);
        i--;
      }
    }
    state[u] = 2;
    post.push(u);
  };
  for (let u = 0; u < n; u++) if (state[u] === 0) dfs(u);
  const t = new Array<number>(n).fill(0);
  for (let k = post.length - 1; k >= 0; k--) {
    const u = post[k];
    for (const w of after[u]) t[w] = Math.max(t[w], t[u] + 1);
  }
  return t;
}

// frame turns the layout into the picture: the routes as points, the
// boundary, the ports and their chips, in screen coordinates.
function frame(l: Layout): Frame {
  const bd = bounds(l);
  const f: Frame = { owner: l.owner, w: 0, h: 0, boundary: { x: 0, y: 0, w: 0, h: 0 }, cards: [], routes: [] };
  for (const p of l.paths) f.routes.push(trace(l, p, bd));
  for (const it of l.items) {
    if (it.kind === cardItem) f.cards.push({ node: l.nodes[it.card], at: { x: it.x - it.w / 2, y: it.y - it.h / 2, w: it.w, h: it.h } });
  }

  // Room around the picture: at the root for the flag badges above the top
  // cards, around a boundary for the stubs and chips on its port sides.
  let [lead, trail, side0, side1] = [margin, margin, margin, margin];
  if (!l.owner && l.tb) [lead, trail, side0, side1] = [pad + 14, pad, pad, pad];
  else if (!l.owner) [lead, trail, side0, side1] = [pad, pad, pad + 14, pad];
  else {
    if (l.in) lead = chipRoom(l, f, "entry");
    if (l.out) trail = chipRoom(l, f, "exit");
  }
  const turn = (p: Point): Point => {
    const q = { x: p.x - bd.x + lead, y: p.y - bd.y + side0 };
    return l.tb ? { x: q.y, y: q.x } : q;
  };
  const box = (r: Rect): Rect => {
    const a = turn({ x: r.x, y: r.y });
    return l.tb ? { x: a.x, y: a.y, w: r.h, h: r.w } : { x: a.x, y: a.y, w: r.w, h: r.h };
  };
  [f.w, f.h] = [bd.w + lead + trail, bd.h + side0 + side1];
  if (l.tb) [f.w, f.h] = [f.h, f.w];
  if (l.owner) f.boundary = box(bd);
  for (const c of f.cards) c.at = box(c.at);
  for (const r of f.routes) {
    r.pts = r.pts.map(turn);
    r.pill = box(r.pill);
    if (!r.port) continue;
    const at = turn(r.port.at);
    const cw = chipWidth(r.chip);
    r.port.at = at;
    if (!l.tb && r.port.side === "entry") r.port.chip = { x: at.x - stub - chipGap - cw, y: at.y - chipH / 2, w: cw, h: chipH };
    else if (!l.tb) r.port.chip = { x: at.x + stub + chipGap, y: at.y - chipH / 2, w: cw, h: chipH };
    else if (r.port.side === "entry") {
      r.port.chip = { x: clamp(at.x - cw / 2, margin, f.w - margin - cw), y: at.y - stub - chipGap - chipH, w: cw, h: chipH };
    } else {
      r.port.chip = { x: clamp(at.x - cw / 2, margin, f.w - margin - cw), y: at.y + stub + chipGap, w: cw, h: chipH };
    }
  }
  return f;
}

// bounds is the box the picture is drawn around, before it turns: the
// owner's boundary, or at the root the cards and routes alone. Entry ports sit
// on its leading side and exit ports on its trailing side.
function bounds(l: Layout): Rect {
  const last = l.layers.length - 1;
  let [x0, x1] = [l.at[0][0], l.at[last][1]];
  let [y0, y1] = [Infinity, -Infinity];
  for (const it of l.items) [y0, y1] = [Math.min(y0, it.y - it.h / 2), Math.max(y1, it.y + it.h / 2)];
  if (!l.owner) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  [x0, x1, y0, y1] = [x0 - inner, x1 + inner, y0 - inner, y1 + inner];
  if (l.in) x0 = l.at[0][0]; // top to bottom, the entry layer is the header strip
  else if (l.tb) x0 -= headH;
  if (l.out) x1 = l.at[last][0];
  const room = headInset + l.head + 16;
  if (l.tb) {
    if (l.in) {
      // entry ports come in right of the header text
      const first = l.items[l.layers[0][0]];
      y0 = Math.min(y0, first.y - first.h / 2 - room);
    }
    y1 = Math.max(y1, y0 + room);
  } else {
    y0 -= headH;
    x1 = Math.max(x1, x0 + room);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// trace lays out a path's points hop by hop from its lower layer to its
// higher, then orders them from the edge's from end to its to end.
function trace(l: Layout, p: Path, bd: Rect): Route {
  const r: Route = { ...p.link, pts: [], pill: { x: 0, y: 0, w: 0, h: 0 }, lines: p.lines, port: null };
  const pts: Point[] = [];
  const a0 = p.items[0];
  const y = p.hops[0].y1;
  if (l.items[a0].kind === portItem) {
    pts.push({ x: bd.x - stub, y }, { x: bd.x, y }, { x: l.at[0][1], y });
    r.port = port("entry", { x: bd.x, y });
  } else {
    pts.push({ x: side(l, a0, true), y });
  }
  p.hops.forEach((h, j) => {
    const a = p.items[j];
    const b = p.items[j + 1];
    if (h.track >= 0) {
      const x = l.track0[l.items[a].layer] + h.track * trackGap;
      pts.push({ x, y: h.y1 }, { x, y: h.y2 });
    }
    const end = bd.x + bd.w;
    if (b === p.label) {
      const lb = l.items[b];
      r.pill = { x: lb.x - lb.w / 2, y: h.y2 - lb.h / 2, w: lb.w, h: lb.h };
    }
    if (b === p.label || j < p.hops.length - 1) {
      pts.push({ x: side(l, b, false), y: h.y2 }, { x: side(l, b, true), y: h.y2 });
    } else if (l.items[b].kind === portItem) {
      pts.push({ x: end, y: h.y2 }, { x: end + stub, y: h.y2 });
      r.port = port("exit", { x: end, y: h.y2 });
    } else {
      pts.push({ x: side(l, b, false), y: h.y2 });
    }
  });
  r.pts = simplify(pts);
  if (p.rev) r.pts.reverse();
  return r;
}

function port(side: Port["side"], at: Point): Port {
  return { side, at, chip: { x: 0, y: 0, w: 0, h: 0 } };
}

// side is where a path enters an item along the layers, or leaves it when far.
// A queue's back cards stick out to the top right.
function side(l: Layout, i: number, far: boolean): number {
  const it = l.items[i];
  const sign = far ? 1 : -1;
  let x = it.x + (sign * it.w) / 2;
  if (it.kind === cardItem && l.nodes[it.card].kind === "queue" && far !== l.tb) x += sign * 8;
  return x;
}

// chipRoom is the room beyond a side of the boundary for its stubs and chips.
function chipRoom(l: Layout, f: Frame, s: Port["side"]): number {
  if (l.tb) return stub + chipGap + chipH + margin;
  let w = 0;
  for (const r of f.routes) if (r.port && r.port.side === s) w = Math.max(w, chipWidth(r.chip));
  return stub + chipGap + w + margin;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

// simplify drops repeated points and the middle of three on one line.
function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const n = out.length;
    if (n > 0 && Math.abs(out[n - 1].x - p.x) < eps && Math.abs(out[n - 1].y - p.y) < eps) continue;
    if (n > 1) {
      const a = out[n - 2];
      const b = out[n - 1];
      if ((Math.abs(a.x - b.x) < eps && Math.abs(b.x - p.x) < eps) || (Math.abs(a.y - b.y) < eps && Math.abs(b.y - p.y) < eps)) {
        out[n - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

// pathData draws points as straight runs joined by small rounded corners.
export function pathData(pts: Point[]): string {
  const f = (v: number) => fixed(v, 1);
  let b = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  const toward = (from: Point, to: Point, d: number): Point => {
    const len = hypot(to.x - from.x, to.y - from.y);
    return { x: from.x + ((to.x - from.x) * d) / len, y: from.y + ((to.y - from.y) * d) / len };
  };
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(corner, hypot(c.x - p.x, c.y - p.y) / 2, hypot(n.x - c.x, n.y - c.y) / 2);
    const a = toward(c, p, r);
    const z = toward(c, n, r);
    b += `L${f(a.x)} ${f(a.y)}Q${f(c.x)} ${f(c.y)} ${f(z.x)} ${f(z.y)}`;
  }
  const last = pts[pts.length - 1];
  return b + `L${f(last.x)} ${f(last.y)}`;
}
