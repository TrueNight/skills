// Number and string formatting that the page and the problem lines depend on
// byte for byte.

// fixed formats x with prec decimals, breaking exact binary ties to even
// (0.25 is "0.2"); toFixed breaks them upward.
export function fixed(x: number, prec: 0 | 1): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "+Inf" : "-Inf";
  const a = Math.abs(x);
  let s = a.toFixed(prec);
  const t = a * 2 ** (prec + 1);
  if (Number.isInteger(t) && t % 2 === 1) {
    const d = s.charCodeAt(s.length - 1) - 48;
    if (d % 2 === 1) s = s.slice(0, -1) + String(d - 1);
  }
  return (x < 0 || Object.is(x, -0) ? "-" : "") + s;
}

const printable = /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u;
const named: Record<number, string> = { 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };

// isPrint says whether a rune is a letter, mark, number, punctuation,
// symbol or the ASCII space.
export function isPrint(ch: string): boolean {
  return ch === " " || printable.test(ch);
}

// quote is a string literal in q quotes with non-printable runes escaped.
export function quote(s: string, q = '"'): string {
  let out = q;
  for (const ch of s) out += escapeRune(ch, q);
  return out + q;
}

export function escapeRune(ch: string, q: string): string {
  const r = ch.codePointAt(0)!;
  if (ch === q || ch === "\\") return "\\" + ch;
  if (isPrint(ch)) return ch;
  if (named[r]) return named[r];
  if (r < 0x20 || r === 0x7f) return "\\x" + r.toString(16).padStart(2, "0");
  if (r < 0x10000) return "\\u" + r.toString(16).padStart(4, "0");
  return "\\U" + r.toString(16).padStart(8, "0");
}

const space = /^\p{White_Space}$/u;

export function isSpace(ch: string): boolean {
  return space.test(ch);
}

// fields splits s around runs of white space.
export function fields(s: string): string[] {
  const out: string[] = [];
  let word = "";
  for (const ch of s) {
    if (!isSpace(ch)) word += ch;
    else if (word) {
      out.push(word);
      word = "";
    }
  }
  if (word) out.push(word);
  return out;
}

export function trimSpace(s: string): string {
  const rs = [...s];
  let i = 0;
  let j = rs.length;
  while (i < j && isSpace(rs[i])) i++;
  while (j > i && isSpace(rs[j - 1])) j--;
  return rs.slice(i, j).join("");
}

// equalFoldASCII says whether s equals the ASCII text t ignoring case. Of the
// non-ASCII runes only ſ and the Kelvin sign fold to ASCII letters.
export function equalFoldASCII(s: string, t: string): boolean {
  let out = "";
  for (const ch of s) out += ch === "\u017f" ? "S" : ch === "\u212a" ? "K" : ch >= "a" && ch <= "z" ? ch.toUpperCase() : ch;
  return out === t.toUpperCase();
}

export function runeCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

const htmlEsc: Record<string, string> = { "&": "&amp;", "'": "&#39;", "<": "&lt;", ">": "&gt;", '"': "&#34;" };

// esc escapes text for HTML element content and quoted attributes.
export function esc(s: string): string {
  return s.replace(/[&'<>"]/g, (c) => htmlEsc[c]);
}

// hypot is sqrt(p²+q²) computed as p·sqrt(1+(q/p)²), whose last bit can
// differ from Math.hypot.
export function hypot(p: number, q: number): number {
  p = Math.abs(p);
  q = Math.abs(q);
  if (p === Infinity || q === Infinity) return Infinity;
  if (Number.isNaN(p) || Number.isNaN(q)) return NaN;
  if (p < q) [p, q] = [q, p];
  if (p === 0) return 0;
  q = q / p;
  return p * Math.sqrt(1 + q * q);
}

// compare orders numbers with NaN first, like a three-way float compare.
export function compare(a: number, b: number): number {
  const an = Number.isNaN(a);
  const bn = Number.isNaN(b);
  if (an || bn) return an && bn ? 0 : an ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
