import os from "node:os";
import path from "node:path";

export function expandHome(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\") || filePath === "~") {
    return path.join(os.homedir(), filePath.slice(1));
  }
  if (filePath.includes("%APPDATA%")) {
    const appdata = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.resolve(filePath.replace(/%APPDATA%/g, appdata));
  }
  return path.resolve(filePath);
}
