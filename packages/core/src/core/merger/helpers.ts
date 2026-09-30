import path from "node:path";

export function isStrictlyInside(baseDir: string, targetPath: string): boolean {
  const isWindows = process.platform === "win32" || /^[a-zA-Z]:[\\/]/.test(baseDir);
  const p = isWindows ? path.win32 : path;
  const rel = p.relative(baseDir, targetPath);
  if (!rel || rel.startsWith("..") || p.isAbsolute(rel)) {
    return false;
  }
  const sep = isWindows ? "\\" : p.sep;
  const normBase = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
  if (isWindows) {
    return targetPath.toLowerCase().replace(/\//g, "\\").startsWith(normBase.toLowerCase().replace(/\//g, "\\"));
  }
  return targetPath.startsWith(normBase);
}
