// Presence evidence for an optional third-party preset, scoped to the selected home.
import fs from "node:fs";
import path from "node:path";
export function liangshenRoots(home, reader = fs) {
  const roots = [path.join(home, ".agent-presets/liangshen")];
  let profiles = [];
  try {
    profiles = reader.readdirSync(path.join(home, "profiles"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  for (const name of profiles) {
    const profile = path.join(home, "profiles", name);
    roots.push(
      path.join(
        profile,
        "node_modules/@linxin666/dsh-liangshen/presets/liangshen",
      ),
      path.join(
        profile,
        ".dsh-module-fallback/node_modules/@linxin666/dsh-liangshen/presets/liangshen",
      ),
      path.join(
        profile,
        "node_modules/@linxin666/dsh-web-all/node_modules/@linxin666/dsh-liangshen/presets/liangshen",
      ),
    );
  }
  return roots;
}
export function liangshenPresence(home, reader = fs) {
  try {
    for (const root of liangshenRoots(home, reader)) {
      // An existing package, preset directory or broken link is installation evidence.
      const candidates = [root];
      if (root.includes("node_modules"))
        candidates.push(path.dirname(path.dirname(root)));
      for (const p of candidates) {
        try {
          reader.lstatSync(p);
          return "present";
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
    }
    let names = [];
    try {
      names = reader.readdirSync(path.join(home, "profiles"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    for (const name of names) {
      let data;
      try {
        data = JSON.parse(
          reader.readFileSync(
            path.join(home, "profiles", name, "package.json"),
            "utf8",
          ),
        );
      } catch (e) {
        if (e.code === "ENOENT") continue;
        throw e;
      }
      for (const group of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ])
        if (Object.hasOwn(data[group] || {}, "@linxin666/dsh-liangshen"))
          return "present";
    }
    return "absent";
  } catch {
    return "unknown";
  }
}
