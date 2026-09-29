import os from "node:os";
import path from "node:path";

export function expandHome(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\") || filePath === "~") {
    const subPath = filePath.slice(1).replace(/^[/\\]+/, "").replaceAll("\\", "/");
    return path.resolve(os.homedir(), subPath);
  }
  if (filePath.includes("%APPDATA%")) {
    const appdata = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.resolve(filePath.replaceAll("%APPDATA%", appdata));
  }
  return path.resolve(filePath);
}
