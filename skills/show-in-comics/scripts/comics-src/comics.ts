// Command comics validates a C4-like change model and renders it as one
// self-contained HTML page of drill-down SVG diagrams.
import { readFileSync, statSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { parse, validate, type Doc } from "./model.ts";
import { render } from "./render.ts";

const usage = `usage:
  comics validate <model.json>
  comics render <model.json> -o <page.html>`;

function main(argv: string[]): void {
  const wd = process.env["COMICS_CWD"];
  if (wd) {
    try {
      process.chdir(wd);
    } catch (e) {
      fatal(2, `chdir to COMICS_CWD ${wd}: ${sysError(e, "chdir", wd)}`);
    }
  }
  if (argv.length < 1) fatal(2, usage);
  const [cmd, ...args] = argv;
  let model = "";
  let out = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" && i + 1 < args.length) out = args[++i];
    else if (model === "" && args[i] !== "-o") model = args[i];
    else fatal(2, usage);
  }
  if (model === "") fatal(2, usage);

  switch (cmd) {
    case "validate":
      if (out !== "") fatal(2, usage);
      load(model);
      print("ok");
      return;
    case "render": {
      if (out === "") fatal(2, usage);
      let page: string;
      try {
        page = render(load(model));
      } catch (e) {
        fatal(1, `render: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        writeFileSync(out, page);
      } catch (e) {
        fatal(1, sysError(e, "open", out));
      }
      print(resolve(getwd(), out));
      return;
    }
  }
  fatal(2, usage);
}

// load parses and validates the model, exiting 1 with one line per problem.
function load(path: string): Doc {
  let data: Uint8Array;
  try {
    data = readFileSync(path);
  } catch (e) {
    fatal(1, sysError(e, "open", path));
  }
  const { draft, problems } = parse(data);
  const checked = draft ? validate(draft) : { problems: [] };
  const all = [...problems, ...("problems" in checked ? checked.problems : [])];
  if (all.length > 0 || !("doc" in checked)) {
    for (const p of all) print(p);
    process.exit(1);
  }
  return checked.doc;
}

// getwd is the working directory as the shell names it: $PWD when that is
// the current directory, so a path through a symlink stays as typed.
function getwd(): string {
  const pwd = process.env["PWD"];
  if (pwd?.startsWith("/")) {
    try {
      const [a, b] = [statSync("."), statSync(pwd)];
      if (a.dev === b.dev && a.ino === b.ino) return pwd;
    } catch {
      // fall back to the resolved directory
    }
  }
  return process.cwd();
}

const errnoText: Record<string, string> = {
  ENOENT: "no such file or directory",
  EACCES: "permission denied",
  EISDIR: "is a directory",
  ENOTDIR: "not a directory",
  ELOOP: "too many levels of symbolic links",
  ENAMETOOLONG: "file name too long",
  EROFS: "read-only file system",
  ENOSPC: "no space left on device",
};

// sysError words a failed file operation as "<op> <path>: <reason>".
function sysError(e: unknown, op: string, path: string): string {
  const err = e as { code?: string; syscall?: string; message?: string };
  const reason = (err.code && errnoText[err.code]) || (err.message ?? String(e)).replace(/^[A-Z]+: /, "");
  return `${err.syscall ?? op} ${path}: ${reason}`;
}

function print(line: string): void {
  writeSync(1, line + "\n");
}

function fatal(code: number, msg: string): never {
  writeSync(2, msg + "\n");
  process.exit(code);
}

main(process.argv.slice(2));
