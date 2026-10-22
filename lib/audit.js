// 审计日志：插件自己做的每一次"改变宿主/预设/开关"的动作都留一条记录。
//
// 注意边界：宿主补丁是**写进 DSH 源码**的，插件运行时看不到"某次工具调用被哪条补丁放行"。
// 这里记录的是可观测的部分——谁在什么时候改了什么、结果如何——排查时足够定位
// "是不是这次应用没生效"、"是不是有人把 boost 关了"。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AUDIT_FILE = "audit.jsonl";
export const AUDIT_MAX_BYTES = 1024 * 1024;
export const AUDIT_KEEP = 2;

function dshHome(explicit) {
  const env = String(process.env.DSH_HOME || "").trim();
  if (env) return env;
  return path.join(os.homedir(), ".dsh");
}

function auditPath(home) {
  return path.join(home || dshHome(), "dsh-purge-community", AUDIT_FILE);
}

// Operate only on known audit files, never recursively on backup/config directories.
function fileHandle(file, flags, owner) {
  try { if (fs.lstatSync(file).isSymbolicLink()) throw Error('审计文件不能是符号链接'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const fd = fs.openSync(file, flags | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0), 0o600);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) throw Error('审计文件必须是普通文件且不能是硬链接');
    if (owner && st.uid !== owner.uid) {
      if (st.uid !== 0) throw Error('审计文件属主不匹配，未自动修改');
      fs.fchownSync(fd, owner.uid, owner.gid);
    }
    return fd;
  } catch (e) { fs.closeSync(fd); throw e; }
}
function checkExisting(file, owner) {
  try { fs.closeSync(fileHandle(file, fs.constants.O_RDONLY, owner)); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
function rotate(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (st.size < AUDIT_MAX_BYTES) return;
  for (let i = AUDIT_KEEP; i >= 1; i -= 1) {
    const from = i === 1 ? file : `${file}.${i - 1}`;
    try { fs.renameSync(from, `${file}.${i}`); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
/**
 * 追加一条审计记录。写入失败绝不打断主流程（审计不能变成可用性风险）。
 * @param event - 事件名，如 apply/revert/uninstall/boost/probe/preset/reanchor
 * @param data - 附加字段（会原样入库，别放密钥）
 */
let warnedAuditFailure = false;

function auditOwner(home) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  const st = fs.statSync(home);
  const uidText = process.env.PURGE_AUDIT_UID, gidText = process.env.PURGE_AUDIT_GID;
  if (uidText !== undefined || gidText !== undefined) {
    if (![uidText, gidText].every(v => /^\d+$/.test(v || '') && Number(v) > 0 && Number(v) < 2 ** 32 - 1))
      throw Error('PURGE_AUDIT_UID / PURGE_AUDIT_GID 必须同时指定有效的非 root 数字 ID');
    if (st.uid !== 0 && st.uid !== Number(uidText)) throw Error('审计运行用户与 DSH_HOME 属主不一致');
    return { uid: Number(uidText), gid: Number(gidText) };
  }
  // A root-owned container mount is ambiguous: keep ownership, do not guess a user.
  return { uid: st.uid, gid: st.gid };
}
function openAuditDir(file) {
  const home = fs.realpathSync(path.dirname(path.dirname(file)));
  const dir = path.join(home, 'dsh-purge-community');
  const owner = auditOwner(home);
  if (owner && owner.uid !== 0 && process.platform !== 'linux')
    throw Error('跨用户审计修复目前仅支持 Linux，请由运行用户管理目录和日志');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink()) throw Error('审计目录不能是符号链接');
  if (process.platform === 'win32') return { fd: null, file: path.join(dir, AUDIT_FILE), owner: null };
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0));
  try {
    const st = fs.fstatSync(fd);
    if (!st.isDirectory()) throw Error('审计路径不是目录');
    if (owner && st.uid !== owner.uid) {
      if (process.platform !== 'linux') throw Error('跨用户审计目录修复目前仅支持 Linux，请由运行用户管理目录');
      if (st.uid !== 0) throw Error('审计目录属主不匹配，未自动修改');
      fs.fchownSync(fd, owner.uid, owner.gid);
    }
    // Pin Linux operations to the opened directory even if its pathname is replaced.
    const base = process.platform === 'linux' ? `/proc/self/fd/${fd}` : dir;
    return { fd, file: path.join(base, AUDIT_FILE), owner };
  } catch (e) { fs.closeSync(fd); throw e; }
}

export function logAudit(event, data = {}, home) {
  try {
    const store = openAuditDir(auditPath(home));
    try {
      for (let i = 0; i <= AUDIT_KEEP; i++) checkExisting(store.file + (i ? `.${i}` : ''), store.owner);
      rotate(store.file);
      const fd = fileHandle(store.file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT, store.owner);
      try {
        const row = { at: new Date().toISOString(), event, pid: process.pid, ...data };
        fs.writeFileSync(fd, JSON.stringify(row) + "\n");
      } finally { fs.closeSync(fd); }
    } finally { if (store.fd !== null) fs.closeSync(store.fd); }
    return true;
  } catch (e) {
    // 审计写不进去不致命，但不能无声：调用方看到 false 才发现"最近动作"是空的。
    if (!warnedAuditFailure) {
      warnedAuditFailure = true;
      try {
        console.error(`[dsh-purge] 审计写入失败：${e && e.message ? e.message : e}`);
      } catch {
        /* stderr 都不可用时只能放弃 */
      }
    }
    return false;
  }
}

export function readAudit({ limit = 50, home } = {}) {
  const file = auditPath(home);
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw Error(`审计日志读取失败（${e.code || 'unknown'}）；请核对 DSH 运行用户与审计文件属主`);
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* 半行（写入中断）直接跳过 */
    }
  }
  const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 50;
  return rows.slice(-n).reverse();
}
