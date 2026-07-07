import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "node_modules/sql.js/dist");
const dest = resolve(root, "public");

if (!existsSync(src)) {
  console.error("[copy-wasm] sql.js dist not found at", src);
  process.exit(1);
}
if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

const files = ["sql-wasm.wasm", "sql-wasm-browser.wasm"];
for (const f of files) {
  copyFileSync(resolve(src, f), resolve(dest, f));
  console.log("[copy-wasm] copied", f);
}
