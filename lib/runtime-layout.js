import path from "node:path";
import { randomUUID } from "node:crypto";
import { hostFs as fs } from "./extract-asar.js";

export const PNPM_ENTRY = "primary-runtime/dependencies/pnpm/bin/pnpm.mjs";

/** Preserve broken links; never delete a runtime directory or its contents. */
export function ensureAppRuntimeLink(resources, platform = process.platform) {
  const app = path.join(resources, "app"), runtime = path.join(resources, "runtime");
  const link = path.join(app, "runtime");
  if (!fs.existsSync(app) || !fs.existsSync(path.join(runtime, PNPM_ENTRY))) {
    return { ok: false, reason: "missing_runtime", error: "The unpacked app and official pnpm runtime must both exist." };
  }
  let previous;
  try { previous = fs.lstatSync(link); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (previous && !previous.isSymbolicLink()) {
    return fs.existsSync(path.join(link, PNPM_ENTRY))
      ? { ok: true, already: true, type: "directory" }
      : { ok: false, reason: "runtime_conflict", error: "Existing app/runtime is incomplete and was retained." };
  }
  const canonical = file => {
    const resolved = path.normalize(fs.realpathSync(file));
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (previous) {
    try {
      if (canonical(link) === canonical(runtime)) return { ok: true, already: true };
      if (fs.existsSync(path.join(link, PNPM_ENTRY))) return { ok: false, reason: "runtime_conflict", error: "A different working app/runtime link was retained." };
    } catch { /* a dangling link can be preserved and repaired */ }
  }
  const backup = previous ? `${link}.dshpurge-link-${randomUUID()}.bak` : "";
  if (backup) fs.renameSync(link, backup);
  try {
    // Windows junction targets resolve against cwd, not the link's parent.
    fs.symlinkSync(platform === "win32" ? path.resolve(runtime) : "../runtime", link, platform === "win32" ? "junction" : "dir");
    if (canonical(link) !== canonical(runtime) || !fs.existsSync(path.join(link, PNPM_ENTRY))) throw Error("Runtime link verification failed.");
    return { ok: true, created: true, type: platform === "win32" ? "junction" : "dir", ...(backup ? { backup } : {}) };
  } catch (error) {
    try {
      fs.lstatSync(link);
      fs.renameSync(link, `${link}.dshpurge-failed-${randomUUID()}.bak`);
    } catch { /* creation may have failed before creating a link */ }
    if (backup) try { fs.renameSync(backup, link); } catch { /* backup remains recoverable */ }
    return { ok: false, error: String(error.message || error), ...(backup ? { backup } : {}) };
  }
}

export function repairRuntimeForCli(cli) {
  const match = String(cli).replaceAll("\\", "/").match(/^(.*\/resources)\/app\/dsh\/node_modules\/@deepseek-ai\/dsh-desktop-host\/lib\/cli\.js$/i);
  if (!match) return { ok: true, skipped: "not_unpacked_desktop" };
  return ensureAppRuntimeLink(match[1]);
}
