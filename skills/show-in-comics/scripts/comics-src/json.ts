import { escapeRune, isPrint, isSpace } from "./fmt.ts";

// Raw is a JSON value as read: numbers keep their text, objects keep every
// member in order, repeated keys included.
export type Raw =
  | { kind: "null" }
  | { kind: "bool"; v: boolean }
  | { kind: "num"; v: string }
  | { kind: "str"; v: string }
  | { kind: "arr"; v: Raw[] }
  | { kind: "obj"; v: [string, Raw][] };

// Stop ends a read: at text that breaks the grammar, or at the end of the
// data (syntax null). offset counts the bytes up to the end of that text.
class Stop {
  syntax: { msg: string; offset: number } | null;

  constructor(syntax: { msg: string; offset: number } | null) {
    this.syntax = syntax;
  }
}

const maxDepth = 10000;

// read parses the first JSON value of data and rejects anything after it. A
// problem names the text that breaks the grammar by line and column.
export function read(data: Uint8Array): { kind: "ok"; value: Raw } | { kind: "bad"; problem: string } {
  const r = new Reader(data);
  let value: Raw;
  try {
    value = r.value();
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    const s = e.syntax;
    if (!s) return { kind: "bad", problem: data.some((c) => !isWS(c)) ? "unexpected EOF" : "EOF" };
    const before = data.subarray(0, Math.min(s.offset, data.length));
    const line = before.filter((c) => c === 10).length + 1;
    const col = before.length - before.lastIndexOf(10);
    return { kind: "bad", problem: `invalid JSON at line ${line} column ${col}: ${s.msg}` };
  }
  if (data.subarray(r.i).some((c) => !isWS(c))) return { kind: "bad", problem: "trailing data after the top-level object" };
  return { kind: "ok", value };
}

function isWS(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function isDigit(c: number | undefined): boolean {
  return c !== undefined && c >= 0x30 && c <= 0x39;
}

// hexAt parses the four hex digits at d[at:], -1 if they are not.
function hexAt(d: Uint8Array, at: number): number {
  let r = 0;
  for (let k = at; k < at + 4; k++) {
    const c = d[k];
    const h = c === undefined ? -1 : isDigit(c) ? c - 0x30 : c >= 0x61 && c <= 0x66 ? c - 0x57 : c >= 0x41 && c <= 0x46 ? c - 0x37 : -1;
    if (h < 0) return -1;
    r = r * 16 + h;
  }
  return r;
}

// Open is a container whose closing bracket is still ahead; key is the name
// of the member being read.
type Open = { kind: "arr"; items: Raw[] } | { kind: "obj"; members: [string, Raw][]; key: string };

const escapes: Record<number, string> = {
  0x22: '"', 0x5c: "\\", 0x2f: "/", 0x62: "\b", 0x66: "\f", 0x6e: "\n", 0x72: "\r", 0x74: "\t",
};

class Reader {
  data: Uint8Array;
  i = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  // fail rejects the character at i.
  fail(where: string): never {
    const [, n] = decodeRune(this.data, this.i);
    const msg = `invalid character ${quoteRune(this.data.subarray(this.i, this.i + n))} ${where}`;
    throw new Stop({ msg, offset: this.i + n });
  }

  // badEscape rejects the n bytes of an escape sequence at i.
  badEscape(n: number): never {
    const what = this.data.subarray(this.i, this.i + n);
    throw new Stop({ msg: `invalid escape sequence ${showText(what)} in string`, offset: this.i + what.length });
  }

  peek(): number {
    const c = this.data[this.i];
    if (c === undefined) throw new Stop(null);
    return c;
  }

  skip(): number {
    while (this.i < this.data.length && isWS(this.data[this.i])) this.i++;
    return this.peek();
  }

  // value reads one value, keeping open containers on a stack rather than
  // the call stack, so nesting to maxDepth fits.
  value(): Raw {
    const stack: Open[] = [];
    for (;;) {
      let v = this.start(stack);
      if (!v) continue;
      for (;;) {
        const top = stack[stack.length - 1];
        if (!top) return v;
        if (top.kind === "arr") top.items.push(v);
        else top.members.push([top.key, v]);
        const c = this.skip();
        if (c === (top.kind === "arr" ? 0x5d : 0x7d)) {
          this.i++;
          stack.pop();
          v = top.kind === "arr" ? { kind: "arr", v: top.items } : { kind: "obj", v: top.members };
          continue;
        }
        if (c !== 0x2c) this.fail(top.kind === "arr" ? "after array element" : "after object key:value pair");
        this.i++;
        if (top.kind === "obj") top.key = this.key();
        break;
      }
    }
  }

  // start reads a scalar or an empty container. Any other container it opens
  // on the stack, returning null.
  start(stack: Open[]): Raw | null {
    const c = this.skip();
    if (c === 0x7b || c === 0x5b) {
      if (stack.length === maxDepth) throw new Stop({ msg: "exceeded max depth", offset: this.i + 1 });
      this.i++;
      const obj = c === 0x7b;
      if (this.skip() === (obj ? 0x7d : 0x5d)) {
        this.i++;
        return obj ? { kind: "obj", v: [] } : { kind: "arr", v: [] };
      }
      stack.push(obj ? { kind: "obj", members: [], key: this.key() } : { kind: "arr", items: [] });
      return null;
    }
    switch (c) {
      case 0x22:
        return { kind: "str", v: this.string() };
      case 0x74:
        this.literal("true");
        return { kind: "bool", v: true };
      case 0x66:
        this.literal("false");
        return { kind: "bool", v: false };
      case 0x6e:
        this.literal("null");
        return { kind: "null" };
    }
    if (c === 0x2d || isDigit(c)) return { kind: "num", v: this.number() };
    this.fail("looking for beginning of value");
  }

  key(): string {
    if (this.skip() !== 0x22) this.fail("looking for beginning of object key string");
    const k = this.string();
    if (this.skip() !== 0x3a) this.fail("after object key");
    this.i++;
    return k;
  }

  literal(word: string): void {
    this.i++;
    for (let k = 1; k < word.length; k++) {
      if (this.peek() !== word.charCodeAt(k)) this.fail(`in literal ${word} (expecting '${word[k]}')`);
      this.i++;
    }
  }

  number(): string {
    const d = this.data;
    const start = this.i;
    const digits = () => {
      if (!isDigit(this.peek())) this.fail("in numeric literal");
      while (isDigit(d[this.i])) this.i++;
    };
    if (d[this.i] === 0x2d) this.i++;
    if (this.peek() === 0x30) this.i++;
    else digits();
    if (d[this.i] === 0x2e) {
      this.i++;
      digits();
    }
    if (d[this.i] === 0x65 || d[this.i] === 0x45) {
      this.i++;
      if (this.peek() === 0x2b || this.peek() === 0x2d) this.i++;
      digits();
    }
    let s = "";
    for (let k = start; k < this.i; k++) s += String.fromCharCode(d[k]);
    return s;
  }

  // string reads a string literal. Invalid UTF-8 and unpaired surrogate
  // escapes become U+FFFD, one per bad byte or escape.
  string(): string {
    this.i++;
    let out = "";
    for (;;) {
      const c = this.peek();
      if (c === 0x22) {
        this.i++;
        return out;
      }
      if (c === 0x5c) out += this.escape();
      else if (c < 0x20) this.fail("in string");
      else {
        const [r, n] = decodeRune(this.data, this.i);
        out += String.fromCodePoint(r);
        this.i += n;
      }
    }
  }

  escape(): string {
    const d = this.data;
    const at = this.i;
    if (at + 2 > d.length) throw new Stop(null);
    const simple = escapes[d[at + 1]];
    if (simple !== undefined) {
      this.i += 2;
      return simple;
    }
    if (d[at + 1] !== 0x75) this.badEscape(2);
    if (at + 6 > d.length) {
      const rest = [...d.subarray(at + 2)].map((c) => String.fromCharCode(c)).join("");
      if (/^[0-9A-Fa-f]*$/.test(rest)) throw new Stop(null);
      this.badEscape(d.length - at);
    }
    const r = hexAt(d, at + 2);
    if (r < 0) this.badEscape(6);
    this.i += 6;
    if (r < 0xd800 || r >= 0xe000) return String.fromCharCode(r);
    const lo = d[at + 6] === 0x5c && d[at + 7] === 0x75 ? hexAt(d, at + 8) : -1;
    if (r >= 0xdc00 || lo < 0xdc00 || lo >= 0xe000) return "�";
    this.i += 6;
    return String.fromCodePoint(0x10000 + ((r - 0xd800) << 10) + (lo - 0xdc00));
  }
}

// decodeRune decodes the UTF-8 sequence at i; an invalid one is U+FFFD of
// width 1.
function decodeRune(d: Uint8Array, i: number): [number, number] {
  const b0 = d[i];
  const cont = (k: number, lo = 0x80, hi = 0xbf) => {
    const b = d[i + k];
    return b !== undefined && b >= lo && b <= hi;
  };
  if (b0 < 0x80) return [b0, 1];
  if (b0 >= 0xc2 && b0 <= 0xdf && cont(1)) return [((b0 & 0x1f) << 6) | (d[i + 1] & 0x3f), 2];
  if (b0 >= 0xe0 && b0 <= 0xef && cont(1, b0 === 0xe0 ? 0xa0 : 0x80, b0 === 0xed ? 0x9f : 0xbf) && cont(2)) {
    return [((b0 & 0x0f) << 12) | ((d[i + 1] & 0x3f) << 6) | (d[i + 2] & 0x3f), 3];
  }
  if (b0 >= 0xf0 && b0 <= 0xf4 && cont(1, b0 === 0xf0 ? 0x90 : 0x80, b0 === 0xf4 ? 0x8f : 0xbf) && cont(2) && cont(3)) {
    return [((b0 & 0x07) << 18) | ((d[i + 1] & 0x3f) << 12) | ((d[i + 2] & 0x3f) << 6) | (d[i + 3] & 0x3f), 4];
  }
  return [0xfffd, 1];
}

type Rune = { kind: "ok"; ch: string } | { kind: "bad"; byte: number };

function runes(b: Uint8Array): Rune[] {
  const out: Rune[] = [];
  for (let i = 0; i < b.length; ) {
    const [r, n] = decodeRune(b, i);
    out.push(r === 0xfffd && n === 1 ? { kind: "bad", byte: b[i] } : { kind: "ok", ch: String.fromCodePoint(r) });
    i += n;
  }
  return out;
}

// quoteRune shows one character in single quotes, an invalid byte as '\xNN'.
function quoteRune(b: Uint8Array): string {
  const r = runes(b)[0];
  return r.kind === "bad" ? `'\\x${r.byte.toString(16)}'` : `'${escapeRune(r.ch, "'")}'`;
}

// showText shows invalid text in backquotes, or quoted when it holds
// characters that would not show.
function showText(b: Uint8Array): string {
  const rs = runes(b);
  if (rs.length === 1) return quoteRune(b);
  const hidden = rs.some((r) => r.kind === "bad" || r.ch === "`" || r.ch === "�" || isSpace(r.ch) || !isPrint(r.ch));
  if (!hidden) return "`" + rs.map((r) => (r.kind === "ok" ? r.ch : "")).join("") + "`";
  const parts = rs.map((r) => (r.kind === "bad" ? "\\x" + r.byte.toString(16).padStart(2, "0") : escapeRune(r.ch, '"')));
  return '"' + parts.join("") + '"';
}
