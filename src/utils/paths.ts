import os from "node:os";
import path from "node:path";

export function expandHome(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return path.join(os.homedir(), filePath.slice(1));
  }
  if (process.platform === "win32" && filePath.includes("%APPDATA%")) {
    const appdata = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return filePath.replace(/%APPDATA%/g, appdata);
  }
  return path.resolve(filePath);
}
