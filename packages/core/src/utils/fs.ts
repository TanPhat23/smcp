import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export interface AtomicWriteOptions {
  mode?: number;
}

export const DEFAULT_IGNORE_PATTERNS: string[] = [
  ".git",
  "node_modules",
  "dist",
  "build",
  ".cache",
  ".turbo",
  ".next",
  ".nuxt",
  ".output",
  ".DS_Store",
  "Thumbs.db",
  "*.pyc",
  "*.log",
  "*.tmp",
  "*.swp"
];

// Pre-compiled partitioned sets for O(1) ignore lookups
const DEFAULT_IGNORED_EXTENSIONS = new Set<string>();
const DEFAULT_IGNORED_SEGMENTS = new Set<string>();
const DEFAULT_IGNORED_PATHS: string[] = [];

for (const pattern of DEFAULT_IGNORE_PATTERNS) {
  if (pattern.startsWith("*.")) {
    DEFAULT_IGNORED_EXTENSIONS.add(pattern.slice(1));
  } else if (pattern.includes("/")) {
    DEFAULT_IGNORED_PATHS.push(pattern);
  } else {
    DEFAULT_IGNORED_SEGMENTS.add(pattern);
  }
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm"
]);

/**
 * High-performance path ignore filter using partitioned Set lookups.
 *
 * Checks file paths against ignored extensions (O(1)), exact directory/file segments (O(1)),
 * and multi-segment prefix paths. Avoids O(segments * patterns) quadratic nested loops and allocations.
 *
 * @param relPath - Relative file path to inspect.
 * @param customIgnores - Optional additional ignore rules.
 * @returns True if the path should be ignored.
 */
export function isIgnoredPath(relPath: string, customIgnores?: string[]): boolean {
  if (!relPath) return false;

  const normalized = relPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized) return false;

  let ignoredExtensions = DEFAULT_IGNORED_EXTENSIONS;
  let ignoredSegments = DEFAULT_IGNORED_SEGMENTS;
  let ignoredPaths = DEFAULT_IGNORED_PATHS;

  if (customIgnores && customIgnores.length > 0) {
    ignoredExtensions = new Set(DEFAULT_IGNORED_EXTENSIONS);
    ignoredSegments = new Set(DEFAULT_IGNORED_SEGMENTS);
    ignoredPaths = [...DEFAULT_IGNORED_PATHS];

    for (const pattern of customIgnores) {
      if (pattern.startsWith("*.")) {
        ignoredExtensions.add(pattern.slice(1));
      } else if (pattern.includes("/")) {
        ignoredPaths.push(pattern);
      } else {
        ignoredSegments.add(pattern);
      }
    }
  }

  // 1. Multi-segment prefix check (e.g. "path/to/folder")
  for (const p of ignoredPaths) {
    if (normalized === p || normalized.startsWith(p + "/")) {
      return true;
    }
  }

  // 2. Segment-level check in O(segments): exact name match & extension lookup
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (!seg) continue;

    // O(1) Set lookup for segment names (e.g. "node_modules", ".git", ".DS_Store")
    if (ignoredSegments.has(seg)) {
      return true;
    }

    // O(1) Set lookup for file extensions (e.g. ".log", ".tmp", ".pyc")
    const lastDot = seg.lastIndexOf(".");
    if (lastDot !== -1) {
      const ext = seg.slice(lastDot);
      if (ignoredExtensions.has(ext)) {
        return true;
      }
    }
  }

  return false;
}

export function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;

  const next = () => {
    active--;
    if (queue.length > 0) {
      const run = queue.shift()!;
      active++;
      run();
    }
  };

  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = () => {
        fn()
          .then((val) => {
            resolve(val);
            next();
          })
          .catch((err) => {
            reject(err);
            next();
          });
      };

      if (active < concurrency) {
        active++;
        execute();
      } else {
        queue.push(execute);
      }
    });
  };
}

export interface CollectFilesOptions {
  maxFileSize?: number; // bytes, defaults to 2MB (2 * 1024 * 1024)
  customIgnores?: string[];
  concurrency?: number;
}

export async function collectDirectoryFilesAsync(
  rootDir: string,
  options?: CollectFilesOptions
): Promise<Record<string, string>> {
  const resolvedRoot = path.resolve(rootDir);
  const maxFileSize = options?.maxFileSize ?? 2 * 1024 * 1024;
  const limiter = pLimit(options?.concurrency ?? 16);
  const result: Record<string, string> = {};

  if (!fs.existsSync(resolvedRoot)) {
    return result;
  }

  const stat = await fsp.stat(resolvedRoot);
  if (stat.isFile()) {
    const content = await fsp.readFile(resolvedRoot, "utf8");
    result[path.basename(resolvedRoot)] = content;
    return result;
  }

  // Find optional .gitignore in rootDir
  const customIgnores = [...(options?.customIgnores || [])];
  const gitignorePath = path.join(resolvedRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    try {
      const gi = await fsp.readFile(gitignorePath, "utf8");
      const lines = gi
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      customIgnores.push(...lines);
    } catch {
      // Ignore reading error
    }
  }

  const tasks: Promise<void>[] = [];

  async function walkDir(currentDir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(resolvedRoot, fullPath).replaceAll("\\", "/");

      if (isIgnoredPath(relPath, customIgnores)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          continue;
        }

        // Pipelined: dispatch file reading immediately while walkDir continues traversing
        tasks.push(
          limiter(async () => {
            try {
              const fileStat = await fsp.stat(fullPath);
              if (fileStat.size > maxFileSize) {
                return;
              }

              const buf = await fsp.readFile(fullPath);
              // Check for null byte indicating binary
              if (buf.includes(0)) {
                return;
              }

              result[relPath] = buf.toString("utf8");
            } catch {
              // Skip unreadable files
            }
          })
        );
      }
    }
  }

  await walkDir(resolvedRoot);
  await Promise.all(tasks);

  return result;
}

export async function atomicWriteFileAsync(
  filePath: string,
  content: string,
  options?: AtomicWriteOptions
): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fsp.mkdir(dir, { recursive: true });
  }
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );

  let targetMode = options?.mode;
  if (targetMode === undefined && fs.existsSync(filePath)) {
    try {
      const s = await fsp.stat(filePath);
      targetMode = s.mode & 0o777;
    } catch {
      targetMode = undefined;
    }
  }

  try {
    if (targetMode !== undefined) {
      await fsp.writeFile(tempFile, content, { mode: targetMode });
      try {
        await fsp.chmod(tempFile, targetMode);
      } catch {
        // Non-POSIX platforms
      }
    } else {
      await fsp.writeFile(tempFile, content, "utf8");
    }

    await fsp.rename(tempFile, filePath);

    if (targetMode !== undefined) {
      try {
        await fsp.chmod(filePath, targetMode);
      } catch {
        // Non-POSIX platforms
      }
    }
  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) {
        await fsp.unlink(tempFile);
      }
    } catch {
      // Ignore cleanup error
    }
    throw error;
  }
}

export function atomicWriteFileSync(
  filePath: string,
  content: string,
  options?: AtomicWriteOptions
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );

  let targetMode = options?.mode;
  if (targetMode === undefined && fs.existsSync(filePath)) {
    try {
      targetMode = fs.statSync(filePath).mode & 0o777;
    } catch {
      targetMode = undefined;
    }
  }

  try {
    if (targetMode !== undefined) {
      fs.writeFileSync(tempFile, content, { mode: targetMode });
      try {
        fs.chmodSync(tempFile, targetMode);
      } catch {
        // Non-POSIX platforms
      }
    } else {
      fs.writeFileSync(tempFile, content, "utf8");
    }

    fs.renameSync(tempFile, filePath);

    if (targetMode !== undefined) {
      try {
        fs.chmodSync(filePath, targetMode);
      } catch {
        // Non-POSIX platforms
      }
    }
  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup error
    }
    throw error;
  }
}
