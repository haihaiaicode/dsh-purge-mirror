import {
  scheduleWindowsAsarHandoff,
  readWindowsAsarHandoff,
} from "./windows-asar-handoff.js";
import {
  scheduleMacAsarHandoff,
  readMacAsarHandoff,
} from "./macos-asar-handoff.js";
export function scheduleDesktopHandoff(target, platform = process.platform) {
  if (platform === "darwin") return scheduleMacAsarHandoff(target);
  if (platform === "win32") return scheduleWindowsAsarHandoff(target);
  throw Error("Manual desktop handoff is not supported on this platform.");
}
export function readDesktopHandoff(asar, platform = process.platform) {
  return platform === "darwin"
    ? readMacAsarHandoff(asar)
    : readWindowsAsarHandoff(asar);
}
