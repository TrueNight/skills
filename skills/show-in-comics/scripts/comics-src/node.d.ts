// The few Node and web APIs the renderer uses, so type checking needs no
// @types/node.

declare var process: {
  argv: string[];
  env: Record<string, string | undefined>;
  chdir(dir: string): void;
  cwd(): string;
  exit(code: number): never;
};

declare class URL {
  constructor(url: string, base?: string | URL);
}

declare class TextEncoder {
  encode(s: string): Uint8Array;
}

interface ImportMeta {
  url: string;
}

declare module "node:fs" {
  export function readFileSync(path: string | URL): Uint8Array;
  export function readFileSync(path: string | URL, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function writeSync(fd: number, data: string): number;
  export function statSync(path: string): { dev: number; ino: number };
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
}
