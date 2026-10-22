#!/usr/bin/env node
// 统计拒绝率：扫 audit.jsonl 的 refusal_retry + 最近会话里的拒绝式回答。
// 用法：node scripts/refusal-report.mjs [--days 7] [--home ~/.dsh]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { REFUSAL_PATTERNS } from "../lib/refusal-retry.js";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const home = opt("home", path.join(os.homedir(), ".dsh"));
const days = Number(opt("days", "7"));
const since = Date.now() - days * 86400000;

function readAudit() {
  const file = path.join(home, "dsh-purge-community", "audit.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((row) => Date.parse(row.at || 0) >= since);
}

function sessionFiles() {
  const root = path.join(home, "sessions");
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      if (!entry.name.startsWith("session") || !entry.name.endsWith(".jsonl.zstd")) continue;
      try {
        if (fs.statSync(abs).mtimeMs < since) continue;
      } catch {
        continue;
      }
      out.push(abs);
    }
  };
  walk(root, 0);
  return out;
}

function assistantTexts(file) {
  let raw = "";
  try {
    raw = execFileSync("zstd", ["-dc", file], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return [];
  }
  const texts = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type !== "assistant/message") continue;
    const parts = row.data?.message?.content || row.data?.content || [];
    const text = Array.isArray(parts)
      ? parts.filter((p) => p?.type === "text").map((p) => p.text).join("")
      : String(parts || "");
    if (text) texts.push(text);
  }
  return texts;
}

const audit = readAudit();
const retries = audit.filter((row) => row.event === "refusal_retry");
const files = sessionFiles();
let answers = 0;
let refusals = 0;
const perSession = [];
for (const file of files) {
  const texts = assistantTexts(file);
  const hit = texts.filter((t) => REFUSAL_PATTERNS.some((re) => re.test(t.slice(0, 600)))).length;
  answers += texts.length;
  refusals += hit;
  if (texts.length) perSession.push({ file: path.basename(path.dirname(file)), answers: texts.length, refusals: hit });
}
const rate = answers ? ((refusals / answers) * 100).toFixed(2) : "0.00";
console.log(`窗口：最近 ${days} 天 · 会话 ${files.length} 个 · 助手回答 ${answers} 条 · 拒绝式 ${refusals} 条 → 拒绝率 ${rate}%`);
console.log(`重试事件（audit refusal_retry）：${retries.length} 次`);
if (retries.length) console.log("最近一次：", JSON.stringify(retries[retries.length - 1]).slice(0, 200));
if (perSession.length) {
  console.log("\n按会话（有拒绝的才列出）：");
  for (const s of perSession.filter((x) => x.refusals > 0).slice(-10)) {
    console.log(`  ${s.file}: ${s.refusals}/${s.answers}`);
  }
}
