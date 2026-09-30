// tsc rewrites relative `.ts` imports to `.js` in emitted JavaScript but not in declaration files. This finishes the
// job for dist/*.d.ts so published types resolve under NodeNext and bundler resolution alike.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
for (const name of await readdir(dist)) {
  if (!name.endsWith(".d.ts")) continue;
  const path = join(dist, name);
  const source = await readFile(path, "utf8");
  const rewritten = source.replace(/(from\s+["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
  if (rewritten !== source) await writeFile(path, rewritten);
}
