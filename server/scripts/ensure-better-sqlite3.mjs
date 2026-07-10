import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const currentAbi = process.versions.modules;

function loadable() {
  try {
    require("better-sqlite3");
    return true;
  } catch {
    return false;
  }
}

if (loadable()) {
  console.log(`[ensure-better-sqlite3] native module ABI ${currentAbi} OK`);
  process.exit(0);
}

console.log(`[ensure-better-sqlite3] native module missing/ABI mismatch — rebuilding for Node ABI ${currentAbi}...`);
execSync("npm rebuild better-sqlite3", { stdio: "inherit" });
console.log("[ensure-better-sqlite3] rebuild done");
