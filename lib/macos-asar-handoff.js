// macOS handoff: wait for the exact app to exit; never terminate or reopen it.
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { hostFs as fs } from "./extract-asar.js";
import { atomicWriteSync } from "./atomic-files.js";
const active = new Set(["starting", "ready", "waiting_for_quit", "moving"]);
export function readMacAsarHandoff(asar) {
  if (!asar) return null;
  try {
    const state = JSON.parse(
      fs.readFileSync(asar + ".purge-handoff.json", "utf8"),
    );
    if (!state || typeof state.phase !== "string" || !state.token)
      throw Error("Invalid handoff record.");
    if (state.phase === "complete") {
      if (fs.existsSync(asar))
        return {
          ...state,
          phase: "archive_reappeared",
          detail:
            "Archive exists again; the earlier handoff does not apply to this archive.",
        };
      if (!state.backup || !fs.existsSync(state.backup))
        return {
          ...state,
          phase: "backup_missing",
          detail:
            "Completed handoff backup is missing; inspect before recovery.",
        };
    }
    let alive = false;
    if (Number.isInteger(state.pid) && state.pid > 0) {
      try {
        process.kill(state.pid, 0);
        alive = true;
      } catch (e) {
        alive = e.code === "EPERM";
      }
    }
    if (
      active.has(state.phase) &&
      !alive &&
      Date.now() - Date.parse(state.updated_at) > 10000
    )
      return {
        ...state,
        phase: "helper_stopped",
        detail:
          "Helper stopped before completion; original archive may still be active.",
      };
    return state;
  } catch (e) {
    return e.code === "ENOENT"
      ? null
      : {
          phase: "unreadable",
          detail: "Cannot read handoff state: " + e.message,
        };
  }
}

// Serialized into a standalone .cjs file, so plugin replacement cannot strand it.
export async function macHandoffWorker() {
  let fs;
  try {
    fs = require("original-fs");
  } catch {
    fs = require("node:fs");
  }
  const path = require("node:path");
  const { createHash } = require("node:crypto"),
    { execFileSync } = require("node:child_process");
  const [statePath, token] = process.argv.slice(2);
  let state, lock;
  const read = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
  const hash = (file) =>
    createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const own = () => {
    const s = read();
    if (s.token !== token) throw Error("Handoff superseded.");
    return s;
  };
  const save = (phase, detail = "") => {
    own();
    state = {
      ...state,
      phase,
      detail,
      pid: process.pid,
      updated_at: new Date().toISOString(),
    };
    const tmp = statePath + "." + token + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, statePath);
  };
  const release = () => {
    try {
      if (fs.readFileSync(lock, "utf8").trim() === token) fs.unlinkSync(lock);
    } catch {}
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    state = own();
    lock = state.asar + ".rename-pending";
    save("ready");
    const app = path.join(path.dirname(state.asar), "app");
    const validate = () => {
      const meta = JSON.parse(
        fs.readFileSync(path.join(app, "package.json"), "utf8"),
      );
      const main = path.resolve(app, meta.main || "index.js");
      const rel = path.relative(app, main);
      if (
        rel.startsWith("..") ||
        path.isAbsolute(rel) ||
        !fs.statSync(main).isFile()
      )
        throw Error("Unpacked app main is missing or outside app.");
      const runtime = "runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs";
      if (
        fs.existsSync(path.join(path.dirname(app), runtime)) &&
        !fs.existsSync(path.join(app, runtime))
      )
        throw Error(
          "Unpacked app/runtime is unavailable; original archive retained.",
        );
    };
    validate();
    const deadline = Date.now() + state.timeoutMs;
    save("waiting_for_quit");
    while (Date.now() < deadline) {
      own();
      // comm is the executable path, not argv text containing prompts or filenames.
      const rows = execFileSync("/bin/ps", ["-axo", "pid=,comm="], {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 8 * 1024 * 1024,
      }).split("\n");
      const busy = rows.some((row) => {
        const m = row.trim().match(/^(\d+)\s+(.+)$/);
        if (!m || Number(m[1]) === process.pid) return false;
        return (
          m[2] === state.exe || m[2].startsWith(state.bundle + "/Contents/")
        );
      });
      if (busy) {
        await sleep(state.pollMs);
        continue;
      }
      validate();
      if (!fs.existsSync(state.asar))
        throw Error(
          "Archive disappeared outside this handoff; completion unverified.",
        );
      if (hash(state.asar) !== state.archive_sha256)
        throw Error("Archive changed while waiting; original retained.");
      save("moving");
      // Exclusive hard link preserves the original inode and never overwrites a backup.
      fs.linkSync(state.asar, state.backup);
      const a = fs.statSync(state.asar),
        b = fs.statSync(state.backup);
      if (
        a.ino !== b.ino ||
        a.dev !== b.dev ||
        hash(state.backup) !== state.archive_sha256
      )
        throw Error("Archive changed during backup; original retained.");
      own();
      fs.unlinkSync(state.asar);
      if (
        fs.existsSync(state.asar) ||
        hash(state.backup) !== state.archive_sha256
      )
        throw Error("Move verification failed; inspect preserved backup.");
      save("complete", "Archive preserved. Open DSH manually.");
      release();
      return;
    }
    save(
      "expired",
      "Timed out waiting for full quit; original archive retained.",
    );
    release();
    process.exitCode = 2;
  } catch (e) {
    try {
      if (state) save("failed", String(e.message || e));
    } catch {}
    release();
    process.exitCode = 1;
  }
}

export function scheduleMacAsarHandoff({ exe, asar }, io = {}) {
  exe = fs.realpathSync(exe);
  asar = path.resolve(asar);
  const marker = "/Contents/MacOS/";
  const at = exe.lastIndexOf(marker);
  if (at < 0) throw Error("Expected a macOS app executable.");
  const bundle = exe.slice(0, at);
  if (
    fs.realpathSync(path.dirname(asar)) !==
    fs.realpathSync(path.join(bundle, "Contents/Resources"))
  )
    throw Error("Archive and executable must belong to the same app.");
  const current = readMacAsarHandoff(asar);
  if (active.has(current?.phase))
    return {
      scheduled: true,
      pending: true,
      already: true,
      manualQuit: true,
      restarting: false,
      handoff: current,
    };
  if (current?.phase === "unreadable") throw Error(current.detail);
  const token = randomUUID(),
    statePath = asar + ".purge-handoff.json",
    lock = asar + ".rename-pending";
  // Unknown locks are not owned by us. Preserve them instead of starting competing movers.
  if (fs.existsSync(lock)) {
    if (
      !current?.token ||
      fs.readFileSync(lock, "utf8").trim() !== current.token
    )
      throw Error(
        "Another or legacy handoff lock exists; inspect it before retrying.",
      );
    fs.unlinkSync(lock);
  }
  fs.writeFileSync(lock, token + "\n", { flag: "wx", mode: 0o600 });
  const state = {
    token,
    phase: "starting",
    updated_at: new Date().toISOString(),
    exe,
    bundle,
    asar,
    backup: asar + ".purge-" + token + ".bak",
    archive_sha256: "",
    timeoutMs: io.timeoutMs ?? 1800000,
    pollMs: io.pollMs ?? 500,
  };
  const fail = (e) => {
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (saved.token === token)
        atomicWriteSync(
          statePath,
          JSON.stringify({
            ...saved,
            phase: "failed",
            detail: e.message,
            updated_at: new Date().toISOString(),
          }),
        );
    } catch {}
    try {
      if (fs.readFileSync(lock, "utf8").trim() === token) fs.unlinkSync(lock);
    } catch {}
  };
  try {
    state.archive_sha256 = createHash("sha256")
      .update(fs.readFileSync(asar))
      .digest("hex");
    atomicWriteSync(statePath, JSON.stringify(state));
    const script = path.join(
      os.tmpdir(),
      "purge-macos-handoff-" + token + ".cjs",
    );
    fs.writeFileSync(script, "(" + macHandoffWorker.toString() + ")();\n", {
      mode: 0o600,
      flag: "wx",
    });
    const child = (io.spawn || spawn)(
      io.execPath || process.execPath,
      [script, statePath, token],
      {
        detached: true,
        stdio: "ignore",
        cwd: os.tmpdir(),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
    );
    child.on("error", fail);
    child.unref();
    return {
      scheduled: true,
      pending: true,
      manualQuit: true,
      restarting: false,
      handoff: state,
    };
  } catch (e) {
    fail(e);
    throw e;
  }
}
