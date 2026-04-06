// ============================================================
// Agentic File Service — Sandboxed File Operations
// ============================================================
// Provides file system primitives (read, write, edit, search,
// list) for AI-driven agentic coding loops.
//
// Security model:
//   - All paths are resolved to absolute canonical paths
//   - Only paths within ALLOWED_ROOTS are permitted
//   - Blocked patterns prevent access to sensitive files
//   - Size limits prevent resource exhaustion
// ============================================================

import { readFile, writeFile, stat, readdir, mkdir } from "node:fs/promises";
import { resolve, relative, extname, dirname } from "node:path";
import { existsSync } from "node:fs";

// ────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────

const ALLOWED_ROOTS = [
  resolve(process.env.HOME || "/home", "development/sun"),
];

const MAX_READ_BYTES = 1_048_576;      // 1 MB
const MAX_WRITE_BYTES = 5_242_880;     // 5 MB
const MAX_LINES_PER_READ = 800;        // Industry standard (Claude Code pattern)
const MAX_GREP_RESULTS = 50;           // Cap search results
const MAX_GLOB_RESULTS = 200;          // Cap glob results
const MAX_DIR_ENTRIES = 500;           // Cap directory listing

// Patterns that are always blocked — even within allowed roots
const BLOCKED_PATTERNS = [
  /node_modules\//,
  /\.git\/objects\//,
  /\.git\/hooks\//,
  /secrets\.js$/,
  /\.env$/,
  /\.env\..+$/,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
];

// Binary file extensions — return metadata only, no content
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".avi", ".mov",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib",
  ".wasm", ".pyc", ".class",
]);

// ────────────────────────────────────────────────────────────
// Path Validation
// ────────────────────────────────────────────────────────────

/**
 * Validate and resolve a path against the sandbox.
 * @param {string} inputPath - User-provided path
 * @returns {{ safe: boolean, resolved: string, error?: string }}
 */
function validatePath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    return { safe: false, resolved: "", error: "Path is required (string)" };
  }

  const resolved = resolve(inputPath);

  // Check against allowed roots
  const inAllowedRoot = ALLOWED_ROOTS.some((root) =>
    resolved.startsWith(root + "/") || resolved === root,
  );

  if (!inAllowedRoot) {
    return {
      safe: false,
      resolved,
      error: `Path '${resolved}' is outside allowed roots: ${ALLOWED_ROOTS.join(", ")}`,
    };
  }

  // Check against blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(resolved)) {
      return {
        safe: false,
        resolved,
        error: `Path '${resolved}' matches blocked pattern: ${pattern.source}`,
      };
    }
  }

  return { safe: true, resolved };
}

// ────────────────────────────────────────────────────────────
// File Operations
// ────────────────────────────────────────────────────────────

/**
 * Read file contents with optional line range.
 *
 * @param {string} filePath - Absolute path to file
 * @param {object} [options]
 * @param {number} [options.startLine] - 1-indexed start line (inclusive)
 * @param {number} [options.endLine] - 1-indexed end line (inclusive)
 * @returns {Promise<object>}
 */
export async function agenticReadFile(filePath, { startLine, endLine } = {}) {
  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const resolved = validation.resolved;

  try {
    const stats = await stat(resolved);
    if (stats.isDirectory()) {
      return { error: `'${resolved}' is a directory, not a file. Use list_directory instead.` };
    }
    if (stats.size > MAX_READ_BYTES) {
      return {
        error: `File is ${(stats.size / 1024).toFixed(1)} KB — exceeds max read size of ${(MAX_READ_BYTES / 1024).toFixed(0)} KB. Use startLine/endLine to read a portion.`,
      };
    }

    // Binary detection
    const ext = extname(resolved).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return {
        filePath: resolved,
        isBinary: true,
        extension: ext,
        sizeBytes: stats.size,
        message: `Binary file detected (${ext}). Content not returned.`,
      };
    }

    const raw = await readFile(resolved, "utf-8");
    const allLines = raw.split("\n");
    const totalLines = allLines.length;

    // Apply line range
    const start = startLine ? Math.max(1, startLine) : 1;
    let end = endLine ? Math.min(totalLines, endLine) : totalLines;

    // Enforce max lines per read
    if (end - start + 1 > MAX_LINES_PER_READ) {
      end = start + MAX_LINES_PER_READ - 1;
    }

    const selectedLines = allLines.slice(start - 1, end);
    const numberedContent = selectedLines
      .map((line, i) => `${start + i}: ${line}`)
      .join("\n");

    return {
      filePath: resolved,
      totalLines,
      totalBytes: stats.size,
      startLine: start,
      endLine: Math.min(end, totalLines),
      linesReturned: selectedLines.length,
      truncated: end < totalLines,
      content: numberedContent,
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { error: `File not found: ${resolved}` };
    }
    return { error: `Read failed: ${err.message}` };
  }
}

/**
 * Write (create or overwrite) a file.
 *
 * @param {string} filePath - Absolute path to file
 * @param {string} content - File contents
 * @param {object} [options]
 * @param {boolean} [options.createDirs=true] - Create parent directories if missing
 * @returns {Promise<object>}
 */
export async function agenticWriteFile(filePath, content, { createDirs = true } = {}) {
  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (typeof content !== "string") {
    return { error: "'content' must be a string" };
  }

  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > MAX_WRITE_BYTES) {
    return {
      error: `Content is ${(bytes / 1024).toFixed(1)} KB — exceeds max write size of ${(MAX_WRITE_BYTES / 1024).toFixed(0)} KB.`,
    };
  }

  const resolved = validation.resolved;

  try {
    if (createDirs) {
      const dir = dirname(resolved);
      await mkdir(dir, { recursive: true });
    }

    const existed = existsSync(resolved);
    await writeFile(resolved, content, "utf-8");

    const lines = content.split("\n").length;

    return {
      filePath: resolved,
      created: !existed,
      overwritten: existed,
      bytesWritten: bytes,
      linesWritten: lines,
    };
  } catch (err) {
    return { error: `Write failed: ${err.message}` };
  }
}

/**
 * Perform a targeted string replacement in a file.
 * The `oldStr` must match exactly (including whitespace).
 *
 * @param {string} filePath - Absolute path to file
 * @param {string} oldStr - Exact string to find and replace
 * @param {string} newStr - Replacement string
 * @param {object} [options]
 * @param {boolean} [options.allowMultiple=false] - Replace all occurrences
 * @returns {Promise<object>}
 */
export async function agenticStrReplace(filePath, oldStr, newStr, { allowMultiple = false } = {}) {
  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (!oldStr || typeof oldStr !== "string") {
    return { error: "'oldStr' is required and must be a non-empty string" };
  }
  if (typeof newStr !== "string") {
    return { error: "'newStr' must be a string" };
  }

  const resolved = validation.resolved;

  try {
    const content = await readFile(resolved, "utf-8");

    // Count occurrences
    let count = 0;
    let idx = -1;
    while ((idx = content.indexOf(oldStr, idx + 1)) !== -1) {
      count++;
    }

    if (count === 0) {
      return {
        error: "No match found for 'oldStr'. The exact string was not found in the file. Ensure whitespace and indentation match exactly.",
        filePath: resolved,
        matchCount: 0,
      };
    }

    if (count > 1 && !allowMultiple) {
      return {
        error: `Found ${count} occurrences of 'oldStr' but allowMultiple is false. Set allowMultiple=true to replace all, or provide more context to make the match unique.`,
        filePath: resolved,
        matchCount: count,
      };
    }

    // Perform replacement
    let updated;
    if (allowMultiple) {
      updated = content.split(oldStr).join(newStr);
    } else {
      updated = content.replace(oldStr, newStr);
    }

    await writeFile(resolved, updated, "utf-8");

    // Compute a simple diff summary
    const oldLines = oldStr.split("\n").length;
    const newLines = newStr.split("\n").length;

    return {
      filePath: resolved,
      matchCount: count,
      replacementsApplied: allowMultiple ? count : 1,
      oldLines,
      newLines,
      lineDelta: newLines - oldLines,
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { error: `File not found: ${resolved}` };
    }
    return { error: `str_replace failed: ${err.message}` };
  }
}

/**
 * Apply a unified diff patch to a file.
 *
 * @param {string} filePath - Absolute path to file
 * @param {string} patch - Unified diff string
 * @returns {Promise<object>}
 */
export async function agenticPatchFile(filePath, patch) {
  const validation = validatePath(filePath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (!patch || typeof patch !== "string") {
    return { error: "'patch' is required and must be a string (unified diff format)" };
  }

  const resolved = validation.resolved;

  try {
    const { applyPatch } = await import("diff");
    const content = await readFile(resolved, "utf-8");
    const patched = applyPatch(content, patch);

    if (patched === false) {
      return {
        error: "Patch could not be applied — the file content does not match the diff context. Ensure the patch was generated against the current file version.",
        filePath: resolved,
      };
    }

    await writeFile(resolved, patched, "utf-8");

    const oldLines = content.split("\n").length;
    const newLines = patched.split("\n").length;

    return {
      filePath: resolved,
      success: true,
      oldLines,
      newLines,
      lineDelta: newLines - oldLines,
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { error: `File not found: ${resolved}` };
    }
    return { error: `patch_file failed: ${err.message}` };
  }
}

/**
 * List directory contents with metadata.
 *
 * @param {string} dirPath - Absolute path to directory
 * @param {object} [options]
 * @param {boolean} [options.recursive=false] - List recursively
 * @param {number} [options.maxDepth=3] - Max recursion depth
 * @returns {Promise<object>}
 */
export async function agenticListDirectory(dirPath, { recursive = false, maxDepth = 3 } = {}) {
  const validation = validatePath(dirPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  const resolved = validation.resolved;

  try {
    const stats = await stat(resolved);
    if (!stats.isDirectory()) {
      return { error: `'${resolved}' is a file, not a directory. Use read_file instead.` };
    }

    const entries = [];

    async function walk(dir, depth) {
      if (entries.length >= MAX_DIR_ENTRIES) return;
      if (depth > maxDepth) return;

      const dirEntries = await readdir(dir, { withFileTypes: true });

      for (const entry of dirEntries) {
        if (entries.length >= MAX_DIR_ENTRIES) break;

        const fullPath = resolve(dir, entry.name);
        const relPath = relative(resolved, fullPath);

        // Skip blocked paths
        const pathValidation = validatePath(fullPath);
        if (!pathValidation.safe) continue;

        if (entry.isDirectory()) {
          entries.push({
            name: entry.name,
            path: relPath,
            isDir: true,
          });
          if (recursive && depth < maxDepth) {
            await walk(fullPath, depth + 1);
          }
        } else {
          try {
            const fileStat = await stat(fullPath);
            entries.push({
              name: entry.name,
              path: relPath,
              isDir: false,
              sizeBytes: fileStat.size,
            });
          } catch {
            entries.push({
              name: entry.name,
              path: relPath,
              isDir: false,
            });
          }
        }
      }
    }

    await walk(resolved, 1);

    return {
      directory: resolved,
      totalEntries: entries.length,
      truncated: entries.length >= MAX_DIR_ENTRIES,
      entries,
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { error: `Directory not found: ${resolved}` };
    }
    return { error: `list_directory failed: ${err.message}` };
  }
}

/**
 * Search for pattern matches within files (ripgrep-style).
 *
 * @param {string} pattern - Search pattern (literal or regex)
 * @param {string} searchPath - Directory or file to search
 * @param {object} [options]
 * @param {boolean} [options.isRegex=false] - Treat pattern as regex
 * @param {string[]} [options.includes] - Glob patterns to filter files (e.g. "*.js")
 * @param {boolean} [options.caseInsensitive=false]
 * @param {boolean} [options.matchPerLine=true] - Return line matches vs file-only
 * @returns {Promise<object>}
 */
export async function agenticGrepSearch(pattern, searchPath, {
  isRegex = false,
  includes = [],
  caseInsensitive = false,
  matchPerLine = true,
} = {}) {
  const validation = validatePath(searchPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (!pattern || typeof pattern !== "string") {
    return { error: "'pattern' is required and must be a non-empty string" };
  }

  const resolved = validation.resolved;

  try {
    let regex;
    try {
      regex = isRegex
        ? new RegExp(pattern, caseInsensitive ? "gi" : "g")
        : new RegExp(escapeRegex(pattern), caseInsensitive ? "gi" : "g");
    } catch (err) {
      return { error: `Invalid regex pattern: ${err.message}` };
    }

    const results = [];
    const fileMatches = new Set();

    async function searchFile(filePath) {
      if (results.length >= MAX_GREP_RESULTS) return;

      const ext = extname(filePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) return;

      // Check blocked patterns
      const pathCheck = validatePath(filePath);
      if (!pathCheck.safe) return;

      try {
        const fileStat = await stat(filePath);
        if (fileStat.size > MAX_READ_BYTES) return;

        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= MAX_GREP_RESULTS) break;

          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            fileMatches.add(filePath);
            if (matchPerLine) {
              results.push({
                file: filePath,
                line: i + 1,
                content: lines[i].length > 500 ? lines[i].slice(0, 500) + "..." : lines[i],
              });
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    async function walkDir(dir) {
      if (results.length >= MAX_GREP_RESULTS) return;

      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= MAX_GREP_RESULTS) break;

          const fullPath = resolve(dir, entry.name);

          if (entry.isDirectory()) {
            // Skip node_modules, .git
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            await walkDir(fullPath);
          } else {
            // Apply include filters
            if (includes.length > 0) {
              const name = entry.name;
              const matched = includes.some((glob) => {
                if (glob.startsWith("*.")) {
                  return name.endsWith(glob.slice(1));
                }
                return name === glob;
              });
              if (!matched) continue;
            }
            await searchFile(fullPath);
          }
        }
      } catch {
        // Skip unreadable directories
      }
    }

    const stats_ = await stat(resolved);
    if (stats_.isFile()) {
      await searchFile(resolved);
    } else {
      await walkDir(resolved);
    }

    if (!matchPerLine) {
      return {
        pattern,
        searchPath: resolved,
        matchingFiles: [...fileMatches],
        totalFiles: fileMatches.size,
        truncated: fileMatches.size >= MAX_GREP_RESULTS,
      };
    }

    return {
      pattern,
      searchPath: resolved,
      totalMatches: results.length,
      truncated: results.length >= MAX_GREP_RESULTS,
      results,
    };
  } catch (err) {
    return { error: `grep_search failed: ${err.message}` };
  }
}

/**
 * Find files by glob pattern.
 *
 * @param {string} pattern - Glob pattern (e.g. "**\/*.test.js")
 * @param {string} searchPath - Root directory to search
 * @returns {Promise<object>}
 */
export async function agenticGlobFiles(pattern, searchPath) {
  const validation = validatePath(searchPath);
  if (!validation.safe) {
    return { error: validation.error };
  }

  if (!pattern || typeof pattern !== "string") {
    return { error: "'pattern' is required and must be a non-empty string" };
  }

  const resolved = validation.resolved;
  const matches = [];

  // Convert simple glob to regex
  const globRegex = globToRegex(pattern);

  async function walk(dir) {
    if (matches.length >= MAX_GLOB_RESULTS) return;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (matches.length >= MAX_GLOB_RESULTS) break;

        const fullPath = resolve(dir, entry.name);
        const relPath = relative(resolved, fullPath);

        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          await walk(fullPath);
        } else {
          if (globRegex.test(relPath) || globRegex.test(entry.name)) {
            const pathCheck = validatePath(fullPath);
            if (!pathCheck.safe) continue;

            try {
              const fileStat = await stat(fullPath);
              matches.push({
                path: fullPath,
                relativePath: relPath,
                name: entry.name,
                sizeBytes: fileStat.size,
              });
            } catch {
              matches.push({
                path: fullPath,
                relativePath: relPath,
                name: entry.name,
              });
            }
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  try {
    await walk(resolved);

    return {
      pattern,
      searchPath: resolved,
      totalMatches: matches.length,
      truncated: matches.length >= MAX_GLOB_RESULTS,
      matches,
    };
  } catch (err) {
    return { error: `glob_files failed: ${err.message}` };
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(glob) {
  // Convert glob pattern to regex
  // Supports: * (any except /), ** (any including /), ? (single char)
  const regex = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*")
    .replace(/\?/g, ".");

  return new RegExp(`(^|/)${regex}$`, "i");
}

/**
 * Get the file service metadata (for health checks).
 */
export function getAgenticFileHealth() {
  return {
    allowedRoots: ALLOWED_ROOTS,
    maxReadBytes: MAX_READ_BYTES,
    maxWriteBytes: MAX_WRITE_BYTES,
    maxLinesPerRead: MAX_LINES_PER_READ,
    maxGrepResults: MAX_GREP_RESULTS,
    maxGlobResults: MAX_GLOB_RESULTS,
    maxDirEntries: MAX_DIR_ENTRIES,
  };
}
