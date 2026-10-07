import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// These tests feed documents through a stubbed global fetch. The SSRF
// guard's own transport and rules are tested in ModelUrlGuard.test.ts.
vi.mock("../../fetchers/web/SsrfGuard.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../fetchers/web/SsrfGuard.ts")>()),
  fetchPublicOrOwnUrl: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}));
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  executePython,
  getInterpreterInfo,
  normalizeInputFileSources,
  sanitizeInputFilename,
  stageInputFiles,
} from "../PythonInterpreterService.ts";

// ═══════════════════════════════════════════════════════════════
//  Basic Execution
// ═══════════════════════════════════════════════════════════════

describe("executePython — basic execution", () => {
  it("executes simple print statement", async () => {
    const result = await executePython('print("hello from python")');
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello from python");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("executes arithmetic", async () => {
    const result = await executePython("print(2 ** 10)");
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("1024");
  });

  it("handles multi-line scripts", async () => {
    const code = `
items = [1, 2, 3, 4, 5]
total = sum(items)
print(f"Sum: {total}")
print(f"Count: {len(items)}")
`;
    const result = await executePython(code);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("Sum: 15");
    expect(result.stdout).toContain("Count: 5");
  });

  it("supports standard library imports (math, json)", async () => {
    const code = `
import math
import json
data = {"pi": round(math.pi, 4)}
print(json.dumps(data))
`;
    const result = await executePython(code);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('"pi": 3.1416');
  });

  it("supports list comprehensions and generators", async () => {
    const result = await executePython(
      "print([x**2 for x in range(5)])",
    );
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("[0, 1, 4, 9, 16]");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Sandbox Security
// ═══════════════════════════════════════════════════════════════

describe("executePython — sandbox security", () => {
  it("blocks network access via socket", async () => {
    const code = `
import socket
socket.socket(socket.AF_INET, socket.SOCK_STREAM)
`;
    const result = await executePython(code);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("PermissionError");
    expect(result.stderr).toContain("Network access is disabled");
  });

  it("blocks urllib requests", async () => {
    const code = `
import urllib.request
urllib.request.urlopen("https://evil.com")
`;
    const result = await executePython(code);
    expect(result.success).toBe(false);
    // urllib uses socket internally, which is blocked
    expect(result.stderr).toBeTruthy();
  });

  it("cannot access parent process environment directly", async () => {
    const code = `
import os
# os.environ should still work but secrets should not be leaked
# since we control the env in the preamble
print(type(os.environ).__name__)
`;
    const result = await executePython(code);
    expect(result.success).toBe(true);
    // Python's os.environ is type _Environ
    expect(result.stdout.trim()).toMatch(/[Ee]nviron/);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Error Handling
// ═══════════════════════════════════════════════════════════════

describe("executePython — error handling", () => {
  it("reports syntax errors", async () => {
    const result = await executePython("def incomplete(");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("SyntaxError");
    expect(result.exitCode).toBe(1);
  });

  it("reports runtime errors", async () => {
    const result = await executePython("undefined_variable + 1");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("NameError");
  });

  it("reports import errors for nonexistent modules", async () => {
    const result = await executePython("import this_does_not_exist_xyz");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("ModuleNotFoundError");
  });

  it("reports division by zero", async () => {
    const result = await executePython("print(1 / 0)");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("ZeroDivisionError");
  });

  it("preserves stdout even when script errors", async () => {
    const code = `
print("before error")
raise ValueError("deliberate failure")
`;
    const result = await executePython(code);
    expect(result.success).toBe(false);
    expect(result.stdout).toContain("before error");
    expect(result.stderr).toContain("ValueError");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Timeout Handling
// ═══════════════════════════════════════════════════════════════

describe("executePython — timeouts", () => {
  it("detects timeout on infinite loop", async () => {
    const result = await executePython("while True: pass", { timeout: 1500 });
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toContain("timed out");
    expect(result.exitCode).toBeNull();
  }, 10000);

  it("clamps timeout to minimum of 1000ms", async () => {
    const result = await executePython("print('fast')", { timeout: 100 });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("fast");
  });
});

// ═══════════════════════════════════════════════════════════════
//  getInterpreterInfo
// ═══════════════════════════════════════════════════════════════

describe("getInterpreterInfo", () => {
  it("returns interpreter metadata with version", async () => {
    const info = await getInterpreterInfo();
    expect(info.available).toBe(true);
    expect(info.version).toMatch(/\d+\.\d+/);
    expect(info.maxTimeoutMs).toBeGreaterThan(0);
    expect(info.maxOutputBytes).toBeGreaterThan(0);
    expect(info.memoryLimitMb).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Memory Limits — scientific stack (RLIMIT_DATA regression)
// ═══════════════════════════════════════════════════════════════
// The old RLIMIT_AS cap made "import matplotlib" hang/SIGKILL because
// numpy/OpenBLAS reserve virtual address space they never back with
// real memory. RLIMIT_DATA keeps the cap while letting the stack load.

describe("executePython — memory limits & scientific stack", () => {
  it("imports numpy and matplotlib under the memory cap", async () => {
    const result = await executePython(
      'import numpy, matplotlib\nprint("stack ok")',
      { timeout: 60_000 },
    );
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("stack ok");
  }, 70_000);

  it("still enforces the memory cap on runaway allocations", async () => {
    const code = `
try:
    x = bytearray(400 * 1024 * 1024)
    print("ALLOCATED")
except MemoryError:
    print("MEMORY_ERROR")
`;
    const result = await executePython(code, { timeout: 30_000 });
    expect(result.stdout).toContain("MEMORY_ERROR");
    expect(result.stdout).not.toContain("ALLOCATED");
  }, 40_000);
});

// ═══════════════════════════════════════════════════════════════
//  Figure Capture (rich results)
// ═══════════════════════════════════════════════════════════════

describe("executePython — figure capture", () => {
  it("auto-captures open matplotlib figures as PNG", async () => {
    const code = `
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()
print("plotted")
`;
    const result = await executePython(code, { timeout: 60_000 });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("plotted");
    // plt.show() under Agg must not pollute stderr with warnings
    expect(result.stderr).not.toContain("non-interactive");
    expect(result.figures).toHaveLength(1);
    const figure = result.figures![0];
    expect(figure.mimeType).toBe("image/png");
    expect(figure.bytes).toBeGreaterThan(1000);
    // PNG magic bytes survive the base64 round-trip
    const header = Buffer.from(figure.data, "base64").subarray(0, 4);
    expect(header.toString("hex")).toBe("89504e47");
  }, 70_000);

  it("collects files savefig'd to the working directory", async () => {
    const code = `
import matplotlib.pyplot as plt
plt.bar(["a", "b"], [3, 5])
plt.savefig("my_chart.png")
plt.close("all")
print("saved")
`;
    const result = await executePython(code, { timeout: 60_000 });
    expect(result.success).toBe(true);
    expect(
      result.figures?.some((figure) => figure.filename === "my_chart.png"),
    ).toBe(true);
  }, 70_000);

  it("captures multiple figures in order", async () => {
    const code = `
import matplotlib.pyplot as plt
plt.figure(); plt.plot([1, 2], [1, 2])
plt.figure(); plt.plot([2, 1], [1, 2])
`;
    const result = await executePython(code, { timeout: 60_000 });
    expect(result.success).toBe(true);
    expect(result.figures).toHaveLength(2);
    expect(result.figures![0].filename).toBe("_prism_figure_1.png");
    expect(result.figures![1].filename).toBe("_prism_figure_2.png");
  }, 70_000);

  it("omits figures for plain text scripts", async () => {
    const result = await executePython('print("no plots here")');
    expect(result.success).toBe(true);
    expect(result.figures).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
//  Input File Staging (inputFiles)
// ═══════════════════════════════════════════════════════════════

const SAMPLE_CSV = "name,score\nAda,90\nGrace,95";
const SAMPLE_CSV_DATA_URI = `data:text/csv;base64,${Buffer.from(
  SAMPLE_CSV,
  "utf-8",
).toString("base64")}`;
// 1x1 transparent PNG
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("normalizeInputFileSources", () => {
  it("returns an empty list for undefined/null", () => {
    expect(normalizeInputFileSources(undefined)).toEqual({ sources: [] });
    expect(normalizeInputFileSources(null)).toEqual({ sources: [] });
  });

  it("normalizes a single string to a one-element array", () => {
    const normalized = normalizeInputFileSources("https://example.com/a.csv");
    expect(normalized).toEqual({ sources: ["https://example.com/a.csv"] });
  });

  it("passes arrays through (trimmed)", () => {
    const normalized = normalizeInputFileSources([
      " https://example.com/a.csv ",
    ]);
    expect(normalized).toEqual({ sources: ["https://example.com/a.csv"] });
  });

  it("rejects non-string and empty entries", () => {
    for (const bad of [[42], [""], [{ url: "x" }], [null]]) {
      const normalized = normalizeInputFileSources(bad);
      expect("error" in normalized && normalized.error).toContain(
        "'inputFiles' must be",
      );
    }
  });

  it("caps the batch at 8 files", () => {
    const normalized = normalizeInputFileSources(
      Array.from({ length: 9 }, (_, index) => `https://example.com/${index}`),
    );
    expect("error" in normalized && normalized.error).toContain(
      "Too many input files: 9 (max 8)",
    );
  });

  it("returns the standard re-attach error for the unresolved sentinel", () => {
    for (const sentinel of ["attached", " Attached "]) {
      const normalized = normalizeInputFileSources([sentinel]);
      expect("error" in normalized && normalized.error).toContain(
        "No attached document was found",
      );
    }
  });
});

describe("sanitizeInputFilename", () => {
  it("keeps a plain safe basename", () => {
    expect(sanitizeInputFilename("/data/sales.csv")).toBe("sales.csv");
  });

  it("is basename-only — traversal segments are discarded", () => {
    expect(sanitizeInputFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeInputFilename("..\\..\\evil.exe")).toBe("evil.exe");
  });

  it("neutralizes encoded slashes after decoding", () => {
    // %2F decodes to "/" AFTER the path split — must not create a path
    expect(sanitizeInputFilename("a%2F..%2Fb.csv")).toBe("a_.._b.csv");
  });

  it("rejects dot-only and empty names", () => {
    expect(sanitizeInputFilename("..")).toBeNull();
    expect(sanitizeInputFilename(".")).toBeNull();
    expect(sanitizeInputFilename("")).toBeNull();
    expect(sanitizeInputFilename("///")).toBeNull();
  });

  it("strips leading dots (no hidden files)", () => {
    expect(sanitizeInputFilename(".bashrc")).toBe("bashrc");
  });

  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeInputFilename("my report (final).csv")).toBe(
      "my_report__final_.csv",
    );
  });

  it("refuses names reserved by the run itself", () => {
    expect(sanitizeInputFilename("script.py")).toBeNull();
    expect(sanitizeInputFilename("_prism_figure_1.png")).toBeNull();
  });
});

describe("stageInputFiles", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pyexec-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("decodes a data: URI to input_<n>.<ext> from the MIME type", async () => {
    const staged = await stageInputFiles(directory, [SAMPLE_CSV_DATA_URI]);
    expect(staged).toEqual({
      files: [
        {
          filename: "input_1.csv",
          bytes: SAMPLE_CSV.length,
          mimeType: "text/csv",
        },
      ],
    });
    const written = await readFile(join(directory, "input_1.csv"), "utf-8");
    expect(written).toBe(SAMPLE_CSV);
  });

  it("downloads a URL and names the file from the path basename", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "text/csv" : null,
      },
      arrayBuffer: async () => new TextEncoder().encode(SAMPLE_CSV).buffer,
    } as unknown as Response);

    const staged = await stageInputFiles(directory, [
      "https://example.com/reports/sales.csv?version=2",
    ]);
    expect("files" in staged && staged.files[0]).toEqual({
      filename: "sales.csv",
      bytes: SAMPLE_CSV.length,
      mimeType: "text/csv",
    });
    const written = await readFile(join(directory, "sales.csv"), "utf-8");
    expect(written).toBe(SAMPLE_CSV);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("falls back to input_<n>.<ext> when the URL has no usable basename", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type"
            ? "application/json; charset=utf-8"
            : null,
      },
      arrayBuffer: async () => new TextEncoder().encode("{}").buffer,
    } as unknown as Response);

    const staged = await stageInputFiles(directory, ["https://example.com/"]);
    expect("files" in staged && staged.files[0].filename).toBe("input_1.json");
  });

  it("de-duplicates colliding filenames within a batch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "text/csv" : null,
      },
      arrayBuffer: async () => new TextEncoder().encode(SAMPLE_CSV).buffer,
    } as unknown as Response);

    const staged = await stageInputFiles(directory, [
      "https://example.com/data.csv",
      "https://mirror.example.com/data.csv",
    ]);
    expect("files" in staged && staged.files.map((file) => file.filename)).toEqual(
      ["data.csv", "input_2_data.csv"],
    );
  });

  it("rejects file:// and other non-http(s) schemes", async () => {
    for (const source of ["file:///etc/passwd", "ftp://example.com/a.csv"]) {
      const staged = await stageInputFiles(directory, [source]);
      expect("error" in staged && staged.error).toContain("Unsupported scheme");
    }
  });

  it("rejects non-URL garbage sources", async () => {
    const staged = await stageInputFiles(directory, ["not a url"]);
    expect("error" in staged && staged.error).toContain(
      "must be an http(s) URL or a data: URI",
    );
  });

  it("enforces the 40 MB per-file cap via content-length", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-length" ? String(100 * 1024 * 1024) : null,
      },
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);

    const staged = await stageInputFiles(directory, [
      "https://example.com/huge.bin",
    ]);
    expect("error" in staged && staged.error).toContain("max: 40 MB");
  });

  it("fails fast with the entry index on the first bad source", async () => {
    const staged = await stageInputFiles(directory, [
      SAMPLE_CSV_DATA_URI,
      "file:///etc/passwd",
    ]);
    expect("error" in staged && staged.error).toContain("inputFiles[1]:");
  });
});

describe("executePython — inputFiles", () => {
  it("stages files before the code runs so open() works (single string form)", async () => {
    const result = await executePython(
      'print(open("input_1.csv").read().splitlines()[1])',
      { inputFiles: SAMPLE_CSV_DATA_URI },
    );
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("Ada,90");
    expect(result.inputFiles).toEqual([
      { filename: "input_1.csv", bytes: SAMPLE_CSV.length, mimeType: "text/csv" },
    ]);
  });

  it("does not echo staged image inputs back as figures", async () => {
    const result = await executePython('print("done")', {
      inputFiles: [`data:image/png;base64,${TINY_PNG_BASE64}`],
    });
    expect(result.success).toBe(true);
    expect(result.figures).toBeUndefined();
    expect(result.inputFiles?.[0].filename).toBe("input_1.png");
  });

  it("returns the standard sentinel error without executing the code", async () => {
    const result = await executePython('open("marker", "w").write("ran")', {
      inputFiles: ["attached"],
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.error).toContain("No attached document was found");
  });

  it("aborts the run (code not executed) when staging fails", async () => {
    const result = await executePython('print("should not run")', {
      inputFiles: ["file:///etc/passwd"],
    });
    expect(result.success).toBe(false);
    expect(result.stdout).toBe("");
    expect(result.error).toContain("code was not executed");
    expect(result.error).toContain("Unsupported scheme");
  });
});
