import { equalFoldASCII } from "./fmt.ts";

// The page template is written in Go's html/template syntax. This runs the
// part of it page.html uses: {{.A.B}}, {{$v.A}}, if, with and range with
// else, range $i, $x := ..., define, template, and the functions len, eq and
// the caller's own. Output is escaped by where it lands, as html/template
// escapes it; any other construct or context throws.

// Safe is text trusted for one context: html is inserted as markup, css in a
// style element, js in a script element.
export class Safe {
  kind: "html" | "css" | "js";
  text: string;

  constructor(kind: "html" | "css" | "js", text: string) {
    this.kind = kind;
    this.text = text;
  }
}

type Arg = { kind: "field"; root: string; chain: string[] } | { kind: "str"; v: string };
type Pipe = { fn: string | null; args: Arg[] };
type Node =
  | { kind: "text"; text: string }
  | { kind: "out"; pipe: Pipe }
  | { kind: "if" | "with"; pipe: Pipe; body: Node[]; alt: Node[] }
  | { kind: "range"; vars: string[]; pipe: Pipe; body: Node[]; alt: Node[] }
  | { kind: "call"; name: string; pipe: Pipe | null };

export type Funcs = Record<string, (v: unknown) => unknown>;

export function execute(src: string, data: unknown, funcs: Funcs): string {
  const defs = new Map<string, Node[]>();
  const main = parse(src, defs);
  const out = new Writer();
  run(main, data, new Map([["$", data]]), { defs, funcs, out });
  return out.text;
}

// parse

type Tok = { action: false; text: string } | { action: true; words: string[] };

const word = /\s*("(?:[^"\\]|\\.)*"|:=|,|\$?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\$|\.(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)?)/y;

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  for (;;) {
    const open = src.indexOf("{{", i);
    if (open < 0) {
      toks.push({ action: false, text: src.slice(i) });
      return toks;
    }
    toks.push({ action: false, text: src.slice(i, open) });
    const close = src.indexOf("}}", open);
    if (close < 0) throw new Error("template: unclosed action");
    const body = src.slice(open + 2, close);
    if (/^[-/]|-$/.test(body)) throw new Error(`template: unsupported action {{${body}}}`);
    const words: string[] = [];
    let at = 0;
    for (;;) {
      word.lastIndex = at;
      const m = word.exec(body);
      if (!m) break;
      words.push(m[1]);
      at = word.lastIndex;
    }
    if (body.slice(at).trim() !== "") throw new Error(`template: cannot parse {{${body}}}`);
    toks.push({ action: true, words });
    i = close + 2;
  }
}

function parse(src: string, defs: Map<string, Node[]>): Node[] {
  const toks = lex(src);
  let k = 0;
  // list reads nodes up to {{else}} or {{end}} and returns which one ended it.
  const list = (top: boolean): [Node[], string] => {
    const nodes: Node[] = [];
    while (k < toks.length) {
      const t = toks[k++];
      if (!t.action) {
        if (t.text) nodes.push({ kind: "text", text: t.text });
        continue;
      }
      const [head, ...rest] = t.words;
      switch (head) {
        case "end":
        case "else":
          if (top || rest.length) throw new Error(`template: unexpected {{${t.words.join(" ")}}}`);
          return [nodes, head];
        case "if":
        case "with":
        case "range": {
          let vars: string[] = [];
          let args = rest;
          if (head === "range" && rest.includes(":=")) {
            const at = rest.indexOf(":=");
            vars = rest.slice(0, at).filter((w) => w !== ",");
            args = rest.slice(at + 1);
          }
          const pipe = pipeline(args);
          const [body, stop] = list(false);
          const alt = stop === "else" ? close(list(false)) : [];
          nodes.push(head === "range" ? { kind: "range", vars, pipe, body, alt } : { kind: head, pipe, body, alt });
          break;
        }
        case "define": {
          if (!top || rest.length !== 1) throw new Error("template: define must be top level");
          defs.set(literal(rest[0]), close(list(false)));
          break;
        }
        case "template":
          nodes.push({ kind: "call", name: literal(rest[0] ?? ""), pipe: rest.length > 1 ? pipeline(rest.slice(1)) : null });
          break;
        default:
          nodes.push({ kind: "out", pipe: pipeline(t.words) });
      }
    }
    if (!top) throw new Error("template: missing {{end}}");
    return [nodes, ""];
  };
  const close = ([nodes, stop]: [Node[], string]): Node[] => {
    if (stop !== "end") throw new Error("template: missing {{end}}");
    return nodes;
  };
  return list(true)[0];
}

function literal(w: string): string {
  if (!w.startsWith('"')) throw new Error(`template: want a string, got ${w}`);
  return JSON.parse(w) as string;
}

function pipeline(words: string[]): Pipe {
  if (words.length === 0) throw new Error("template: empty pipeline");
  const isFn = /^[A-Za-z_]\w*$/.test(words[0]);
  return { fn: isFn ? words[0] : null, args: words.slice(isFn ? 1 : 0).map(arg) };
}

function arg(w: string): Arg {
  if (w.startsWith('"')) return { kind: "str", v: literal(w) };
  const [root, ...chain] = w.split(".");
  if (root === "") return { kind: "field", root: "$.", chain: chain.filter((c) => c !== "") };
  if (root.startsWith("$")) return { kind: "field", root, chain };
  throw new Error(`template: unsupported argument ${w}`);
}

// run

type Env = { defs: Map<string, Node[]>; funcs: Funcs; out: Writer };

function run(nodes: Node[], dot: unknown, vars: Map<string, unknown>, env: Env): void {
  for (const n of nodes) {
    switch (n.kind) {
      case "text":
        env.out.text += n.text;
        env.out.feed(n.text);
        break;
      case "out": {
        const v = evaluate(n.pipe, dot, vars, env);
        env.out.text += env.out.escape(v);
        break;
      }
      case "if":
      case "with": {
        const v = evaluate(n.pipe, dot, vars, env);
        if (truth(v)) run(n.body, n.kind === "with" ? v : dot, vars, env);
        else run(n.alt, dot, vars, env);
        break;
      }
      case "range": {
        const v = evaluate(n.pipe, dot, vars, env);
        if (!Array.isArray(v)) throw new Error("template: range over a non-list");
        if (v.length === 0) run(n.alt, dot, vars, env);
        v.forEach((e, i) => {
          const inner = new Map(vars);
          if (n.vars.length === 1) inner.set(n.vars[0], e);
          if (n.vars.length === 2) {
            inner.set(n.vars[0], i);
            inner.set(n.vars[1], e);
          }
          run(n.body, e, inner, env);
        });
        break;
      }
      case "call": {
        const body = env.defs.get(n.name);
        if (!body) throw new Error(`template: no template ${n.name}`);
        const v = n.pipe ? evaluate(n.pipe, dot, vars, env) : null;
        run(body, v, new Map([["$", v]]), env);
        break;
      }
      default: {
        const _exhaustive: never = n;
        throw new Error(`template: unknown node ${String(_exhaustive)}`);
      }
    }
  }
}

function evaluate(p: Pipe, dot: unknown, vars: Map<string, unknown>, env: Env): unknown {
  const args = p.args.map((a) => value(a, dot, vars));
  switch (p.fn) {
    case null:
      if (args.length !== 1) throw new Error("template: want one value");
      return args[0];
    case "len":
      if (!Array.isArray(args[0])) throw new Error("template: len of a non-list");
      return args[0].length;
    case "eq":
      if (args.length !== 2 || typeof args[0] !== typeof args[1]) throw new Error("template: eq wants two values of one type");
      return args[0] === args[1];
  }
  const fn = Object.hasOwn(env.funcs, p.fn) ? env.funcs[p.fn] : undefined;
  if (!fn || args.length !== 1) throw new Error(`template: unknown function ${p.fn}`);
  return fn(args[0]);
}

function value(a: Arg, dot: unknown, vars: Map<string, unknown>): unknown {
  if (a.kind === "str") return a.v;
  let v = a.root === "$." ? dot : vars.get(a.root);
  if (!vars.has(a.root) && a.root !== "$.") throw new Error(`template: undefined variable ${a.root}`);
  for (const f of a.chain) {
    if (typeof v !== "object" || v === null || !Object.hasOwn(v, f)) throw new Error(`template: can't evaluate field ${f}`);
    v = (v as Record<string, unknown>)[f];
  }
  return v;
}

function truth(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Safe) return v.text !== "";
  if (typeof v === "bigint") return v !== 0n;
  return Boolean(v);
}

function stringify(v: unknown): string {
  switch (typeof v) {
    case "string":
      return v;
    case "bigint":
    case "boolean":
      return String(v);
    case "number":
      if (Number.isInteger(v)) return String(v);
  }
  throw new Error(`template: cannot print ${String(v)}`);
}

// escaping

// Ctx is where the template text written so far leaves the output: in text,
// in an element's raw content, or somewhere inside a tag.
type Ctx =
  | { kind: "text" }
  | { kind: "rcdata" | "css" | "js"; element: string }
  | { kind: "tagName"; name: string; end: boolean }
  | { kind: "tag"; element: string }
  | { kind: "attrName"; element: string; name: string }
  | { kind: "afterName"; element: string; name: string }
  | { kind: "beforeValue"; element: string; name: string }
  | { kind: "value"; element: string; name: string; quote: string; empty: boolean };

const rawElements = new Map<string, "rcdata" | "css" | "js">([["title", "rcdata"], ["textarea", "rcdata"], ["style", "css"], ["script", "js"]]);

class Writer {
  text = "";
  ctx: Ctx = { kind: "text" };

  feed(s: string): void {
    let i = 0;
    while (i < s.length) i = this.step(s, i);
  }

  // step moves through s from i and returns where it stopped.
  step(s: string, i: number): number {
    const c = this.ctx;
    const ch = s[i];
    switch (c.kind) {
      case "text": {
        const lt = s.indexOf("<", i);
        if (lt < 0) return s.length;
        if (s.startsWith("<!--", lt)) throw new Error("template: comments are not supported");
        const end = s[lt + 1] === "/";
        const at = end ? lt + 2 : lt + 1;
        if (/[A-Za-z]/.test(s[at] ?? "")) this.ctx = { kind: "tagName", name: "", end };
        return at;
      }
      case "rcdata":
      case "css":
      case "js": {
        const close = new RegExp(`</${c.element}(?=[ \\t\\n\\f\\r/>])`, "i");
        const m = close.exec(s.slice(i));
        if (!m) return s.length;
        this.ctx = { kind: "tag", element: "" };
        return i + m.index + m[0].length;
      }
      case "tagName":
        if (/[ \t\n\f\r/>]/.test(ch)) {
          this.ctx = { kind: "tag", element: c.end ? "" : c.name.toLowerCase() };
          return i;
        }
        c.name += ch;
        return i + 1;
      case "tag":
        if (ch === ">") {
          const raw = rawElements.get(c.element);
          this.ctx = raw ? { kind: raw, element: c.element } : { kind: "text" };
        } else if (!/[ \t\n\f\r/]/.test(ch)) {
          this.ctx = { kind: "attrName", element: c.element, name: ch };
        }
        return i + 1;
      case "attrName":
        if (/[ \t\n\f\r=/>]/.test(ch)) {
          this.ctx = { kind: "afterName", element: c.element, name: c.name.toLowerCase() };
          return i;
        }
        c.name += ch;
        return i + 1;
      case "afterName":
        if (ch === "=") {
          this.ctx = { kind: "beforeValue", element: c.element, name: c.name };
          return i + 1;
        }
        if (/[ \t\n\f\r]/.test(ch)) return i + 1;
        this.ctx = { kind: "tag", element: c.element };
        return i;
      case "beforeValue":
        if (/[ \t\n\f\r]/.test(ch)) return i + 1;
        if (ch !== '"' && ch !== "'") throw new Error("template: unquoted attribute values are not supported");
        this.ctx = { kind: "value", element: c.element, name: c.name, quote: ch, empty: true };
        return i + 1;
      case "value": {
        const q = s.indexOf(c.quote, i);
        if (q < 0) {
          c.empty = false;
          return s.length;
        }
        if (q > i) c.empty = false;
        this.ctx = { kind: "tag", element: c.element };
        return q + 1;
      }
    }
  }

  escape(v: unknown): string {
    const c = this.ctx;
    switch (c.kind) {
      case "text":
        return v instanceof Safe && v.kind === "html" ? v.text : replace(plain(v));
      case "rcdata":
        return replace(plain(v));
      case "css":
      case "js":
        if (v instanceof Safe && v.kind === c.kind) return v.text;
        throw new Error(`template: only trusted ${c.kind} goes in <${c.element}>`);
      case "value": {
        const t = attrType(c.name);
        if (t === "plain") {
          c.empty = false;
          return replace(plain(v));
        }
        if (t === "url" && c.empty) {
          c.empty = false;
          return replace(normalizeURL(filterURL(plain(v))));
        }
        throw new Error(`template: unsupported value in attribute ${c.name}`);
      }
      default:
        throw new Error(`template: unsupported action inside a tag (${c.kind})`);
    }
  }
}

function plain(v: unknown): string {
  if (v instanceof Safe) throw new Error(`template: trusted ${v.kind} used as text`);
  return stringify(v);
}

const replacements: Record<string, string> = {
  "\0": "�", '"': "&#34;", "&": "&amp;", "'": "&#39;", "+": "&#43;", "<": "&lt;", ">": "&gt;",
};

function replace(s: string): string {
  return s.replace(/[\0"&'+<>]/g, (c) => replacements[c]);
}

const urlAttrs = new Set([
  "action", "archive", "background", "cite", "classid", "codebase", "data", "formaction", "href", "icon",
  "longdesc", "manifest", "poster", "profile", "src", "usemap", "xmlns",
]);

function attrType(name: string): "url" | "css" | "js" | "srcset" | "plain" {
  if (name.startsWith("data-")) name = name.slice(5);
  else if (name.includes(":")) {
    const [prefix, short] = [name.slice(0, name.indexOf(":")), name.slice(name.indexOf(":") + 1)];
    if (prefix === "xmlns") return "url";
    name = short;
  }
  if (urlAttrs.has(name)) return "url";
  if (name === "style") return "css";
  if (name === "srcset") return "srcset";
  if (name.startsWith("on")) return "js";
  if (name.includes("src") || name.includes("uri") || name.includes("url")) return "url";
  return "plain";
}

// filterURL replaces a URL whose scheme is not http, https or mailto.
function filterURL(s: string): string {
  const colon = s.indexOf(":");
  if (colon < 0) return s;
  const scheme = s.slice(0, colon);
  if (scheme.includes("/") || ["http", "https", "mailto"].some((p) => equalFoldASCII(scheme, p))) return s;
  return "#ZgotmplZ";
}

// normalizeURL percent-encodes the UTF-8 bytes that may not appear in a URL,
// keeping valid escapes.
function normalizeURL(s: string): string {
  const b = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    const ch = String.fromCharCode(c);
    if (/[A-Za-z0-9!#$&*+,/:;=?@[\]\-._~]/.test(ch)) out += ch;
    else if (c === 0x25 && i + 2 < b.length && isHex(b[i + 1]) && isHex(b[i + 2])) out += ch;
    else out += "%" + c.toString(16).padStart(2, "0");
  }
  return out;
}

function isHex(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}
