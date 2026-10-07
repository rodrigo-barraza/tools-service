import { describe, it, expect, vi, beforeAll } from "vitest";

// These tests feed documents through a stubbed global fetch. The SSRF
// guard's own transport and rules are tested in ModelUrlGuard.test.ts.
vi.mock("../src/fetchers/web/SsrfGuard.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/fetchers/web/SsrfGuard.ts")>()),
  fetchPublicOrOwnUrl: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}));
import request from "supertest";
import { createTestApp } from "./testApp.ts";
import { readDocxUrl } from "../src/fetchers/web/DocxFetcher.ts";
import mammoth from "mammoth";
import { Express } from "express";

interface MammothExtended {
  convertToMarkdown(
    input: { buffer: Buffer },
  ): Promise<{ value: string; messages: { type: string; message: string }[] }>;
  extractRawText(
    input: { buffer: Buffer },
  ): Promise<{ value: string; messages: { type: string; message: string }[] }>;
}

const mammothParser = mammoth as unknown as MammothExtended;

// Mock the mammoth dependency hermetically
vi.mock("mammoth", () => {
  return {
    default: {
      convertToMarkdown: vi.fn().mockResolvedValue({
        value: "# Mocked Document Heading\n\nThis is mocked docx content.",
        messages: [{ type: "warning", message: "Mocked conversion warning" }],
      }),
      extractRawText: vi.fn().mockResolvedValue({
        value: "Mocked Document Heading\n\nThis is mocked docx content.",
        messages: [],
      }),
    },
  };
});

describe("DocxFetcher & Web DOCX Read Endpoint", () => {
  let expressApp: Express;

  beforeAll(async () => {
    const { default: router } = await import("../src/routes/AgenticRoutes.ts");
    expressApp = createTestApp("/agentic", router);
  });

  describe("Unit Tests — readDocxUrl", () => {
    it("successfully parses DOCX as markdown by default", async () => {
      const mockDocxBytes = Buffer.from("mock-zip-docx-data");

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") {
              return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            }
            if (normalized === "content-length") {
              return String(mockDocxBytes.length);
            }
            return null;
          },
        },
        arrayBuffer: async () => {
          const arrayBuffer = new ArrayBuffer(mockDocxBytes.length);
          const view = new Uint8Array(arrayBuffer);
          view.set(mockDocxBytes);
          return arrayBuffer;
        },
      } as Response);

      const result = await readDocxUrl("https://example.com/document.docx");

      expect(fetchSpy).toHaveBeenCalled();
      expect(vi.mocked(mammothParser.convertToMarkdown)).toHaveBeenCalled();
      expect(result.url).toBe("https://example.com/document.docx");
      expect(result.content).toBe("# Mocked Document Heading\n\nThis is mocked docx content.");
      expect(result.outputFormat).toBe("markdown");
      expect(result.truncated).toBe(false);
      expect(result.warnings).toEqual(["Mocked conversion warning"]);

      fetchSpy.mockRestore();
    });

    it("successfully extracts raw text when requested", async () => {
      const mockDocxBytes = Buffer.from("mock-zip-docx-data");

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") {
              return "application/msword";
            }
            return null;
          },
        },
        arrayBuffer: async () => {
          const arrayBuffer = new ArrayBuffer(mockDocxBytes.length);
          const view = new Uint8Array(arrayBuffer);
          view.set(mockDocxBytes);
          return arrayBuffer;
        },
      } as Response);

      const result = await readDocxUrl("https://example.com/document.docx", {
        outputFormat: "text",
      });

      expect(fetchSpy).toHaveBeenCalled();
      expect(vi.mocked(mammothParser.extractRawText)).toHaveBeenCalled();
      expect(result.content).toBe("Mocked Document Heading\n\nThis is mocked docx content.");
      expect(result.outputFormat).toBe("text");

      fetchSpy.mockRestore();
    });

    it("respects maxChars parameter to truncate the output content", async () => {
      const mockDocxBytes = Buffer.from("mock-zip-docx-data");

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/octet-stream";
            return null;
          },
        },
        arrayBuffer: async () => {
          const arrayBuffer = new ArrayBuffer(mockDocxBytes.length);
          const view = new Uint8Array(arrayBuffer);
          view.set(mockDocxBytes);
          return arrayBuffer;
        },
      } as Response);

      const result = await readDocxUrl("https://example.com/document.docx", {
        maxChars: 15,
      });

      expect(result.content).toBe("# Mocked Docume\n\n... [truncated]");
      expect(result.truncated).toBe(true);

      fetchSpy.mockRestore();
    });

    it("rejects non-docx content types gracefully", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "text/html";
            return null;
          },
        },
      } as Response);

      const result = await readDocxUrl("https://example.com/not-a-docx.html");

      expect(result.error).toContain("does not point to a DOCX");

      fetchSpy.mockRestore();
    });

    it("enforces DOCX file size limits", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/octet-stream";
            if (normalized === "content-length") return "20000000"; // ~20MB (exceeds 10MB limit)
            return null;
          },
        },
      } as Response);

      const result = await readDocxUrl("https://example.com/large.docx");

      expect(result.error).toContain("too large");

      fetchSpy.mockRestore();
    });

    it("reads a DOCX from a base64 data: URI without any fetch", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const dataUri =
        "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64," +
        Buffer.from("mock docx bytes").toString("base64");

      const result = await readDocxUrl(dataUri);

      expect(result.error).toBeUndefined();
      expect(result.content).toContain("Mocked Document Heading");
      // Echoes a short label, never the base64 payload
      expect(result.url).toMatch(/^data: URI \(\d+ chars\)$/);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("rejects a malformed data: URI", async () => {
      const result = await readDocxUrl("data:application/msword-no-comma");
      expect(result.error).toContain("Invalid data URI");
    });

    it("returns the standard re-attach error for the unresolved 'attached' sentinel", async () => {
      const result = await readDocxUrl("attached");
      expect(result.error).toContain("No attached document was found");
      expect(result.error).toContain("re-)upload");
    });
  });

  describe("Integration Tests — Express /agentic/web/docx-read Endpoint", () => {
    it("returns 400 when url is missing", async () => {
      const response = await request(expressApp)
        .post("/agentic/web/docx-read")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Request body must include 'url'");
    });

    it("successfully runs route handler and returns parsed DOCX payload", async () => {
      const mockDocxBytes = Buffer.from("mock-zip-docx-data");

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/octet-stream";
            return null;
          },
        },
        arrayBuffer: async () => {
          const arrayBuffer = new ArrayBuffer(mockDocxBytes.length);
          const view = new Uint8Array(arrayBuffer);
          view.set(mockDocxBytes);
          return arrayBuffer;
        },
      } as Response);

      const response = await request(expressApp)
        .post("/agentic/web/docx-read")
        .send({
          url: "https://example.com/document.docx",
          maxChars: 100,
          outputFormat: "markdown",
        });

      expect(response.status).toBe(200);
      expect(response.body.url).toBe("https://example.com/document.docx");
      expect(response.body.content).toBe("# Mocked Document Heading\n\nThis is mocked docx content.");
      expect(response.body.truncated).toBe(false);
      expect(response.body.outputFormat).toBe("markdown");

      fetchSpy.mockRestore();
    });
  });
});
