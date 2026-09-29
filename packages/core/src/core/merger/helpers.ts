import path from "node:path";

export function isStrictlyInside(baseDir: string, targetPath: string): boolean {
  const rel = path.relative(baseDir, targetPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return false;
  }
  const normalizedBase = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  return targetPath.startsWith(normalizedBase);
}
