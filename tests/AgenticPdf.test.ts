import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { createTestApp } from "./testApp.ts";
import { readPdfUrl } from "../src/fetchers/web/PdfFetcher.ts";
import { Express } from "express";

vi.mock("pdf-parse", () => {
  const mockGetText = vi.fn().mockImplementation(async (params) => {
    if (params?.partial) {
      return { text: `Extracting pages: ${params.partial.join(",")}`, total: 10 };
    }
    if (params?.first && params?.last) {
      return { text: `Extracting range: ${params.first}..${params.last}`, total: 10 };
    }
    if (params?.first) {
      return { text: `Extracting first N pages: ${params.first}`, total: 10 };
    }
    return { text: "Mocked PDF content text.", total: 10 };
  });

  const mockGetInfo = vi.fn().mockResolvedValue({
    numPages: 10,
    info: {
      Title: "Mocked Title",
      Author: "Mocked Author",
      Subject: "Mocked Subject",
      Creator: "Mocked Creator",
      Producer: "Mocked Producer",
      CreationDate: "D:20260608200000Z",
    },
  });

  return {
    PDFParse: class MockPDFParse {
      constructor(_params: unknown) {}
      load = vi.fn().mockResolvedValue(undefined);
      getInfo = mockGetInfo;
      getText = mockGetText;
      destroy = vi.fn().mockResolvedValue(undefined);
    }
  };
});

describe("PdfFetcher & Web PDF Read Endpoint", () => {
  let expressApp: Express;

  beforeAll(async () => {
    const { default: router } = await import("../src/routes/AgenticRoutes.ts");
    expressApp = createTestApp("/agentic", router);
  });

  describe("Unit Tests — readPdfUrl", () => {
    it("successfully parses PDF and extracts metadata and text", async () => {
      const mockPdfBytes = Buffer.from("%PDF-1.4 mock pdf data");

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/pdf";
            if (normalized === "content-length") return String(mockPdfBytes.length);
            return null;
          },
        },
        arrayBuffer: async () => {
          const arrayBuffer = new ArrayBuffer(mockPdfBytes.length);
          const view = new Uint8Array(arrayBuffer);
          view.set(mockPdfBytes);
          return arrayBuffer;
        },
      } as Response);

      const result = await readPdfUrl("https://example.com/document.pdf");
      console.log("RESULT IS", result);

      expect(fetchSpy).toHaveBeenCalled();
      expect(result.url).toBe("https://example.com/document.pdf");
      expect(result.pageCount).toBe(10);
      expect(result.info.title).toBe("Mocked Title");
      expect(result.info.author).toBe("Mocked Author");
      expect(result.text).toBe("Mocked PDF content text.");
      expect(result.truncated).toBe(false);

      fetchSpy.mockRestore();
    });

    it("respects maxPages by requesting first N pages via pdf-parse", async () => {
      const mockPdfBytes = Buffer.from("%PDF-1.4 mock pdf data");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/pdf";
            return null;
          },
        },
        arrayBuffer: async () => new Uint8Array(mockPdfBytes).buffer,
      } as Response);

      const result = await readPdfUrl("https://example.com/document.pdf", {
        maxPages: 5,
      });

      expect(result.text).toBe("Extracting first N pages: 5");
      fetchSpy.mockRestore();
    });

    it("respects partial pages array parameter", async () => {
      const mockPdfBytes = Buffer.from("%PDF-1.4 mock pdf data");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/pdf";
            return null;
          },
        },
        arrayBuffer: async () => new Uint8Array(mockPdfBytes).buffer,
      } as Response);

      const result = await readPdfUrl("https://example.com/document.pdf", {
        pages: [1, 3, 5],
      });

      expect(result.text).toBe("Extracting pages: 1,3,5");
      fetchSpy.mockRestore();
    });

    it("respects startPage and endPage range parameter", async () => {
      const mockPdfBytes = Buffer.from("%PDF-1.4 mock pdf data");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/pdf";
            return null;
          },
        },
        arrayBuffer: async () => new Uint8Array(mockPdfBytes).buffer,
      } as Response);

      const result = await readPdfUrl("https://example.com/document.pdf", {
        startPage: 3,
        endPage: 7,
      });

      expect(result.text).toBe("Extracting range: 3..7");
      fetchSpy.mockRestore();
    });

    it("defaults endPage to total pages when only startPage is provided", async () => {
      const mockPdfBytes = Buffer.from("%PDF-1.4 mock pdf data");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/pdf";
            return null;
          },
        },
        arrayBuffer: async () => new Uint8Array(mockPdfBytes).buffer,
      } as Response);

      const result = await readPdfUrl("https://example.com/document.pdf", {
        startPage: 4,
      });

      expect(result.text).toBe("Extracting range: 4..10");
      fetchSpy.mockRestore();
    });

    it("defaults startPage to 1 when only endPage is provided", async () => {
      const mockPdfBytes = Buffer.from("%PDF-1.4 mock pdf data");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/pdf";
            return null;
          },
        },
        arrayBuffer: async () => new Uint8Array(mockPdfBytes).buffer,
      } as Response);

      const result = await readPdfUrl("https://example.com/document.pdf", {
        endPage: 6,
      });

      expect(result.text).toBe("Extracting range: 1..6");
      fetchSpy.mockRestore();
    });

    it("rejects non-pdf content types", async () => {
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

      const result = await readPdfUrl("https://example.com/index.html");

      expect(result.error).toContain("does not point to a PDF");
      fetchSpy.mockRestore();
    });

    it("enforces PDF file size limits", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/pdf";
            if (normalized === "content-length") return "30000000"; // ~30MB (cap is 25MB)
            return null;
          },
        },
      } as Response);

      const result = await readPdfUrl("https://example.com/large.pdf");

      expect(result.error).toContain("PDF too large");
      fetchSpy.mockRestore();
    });

    it("reads a PDF from a base64 data: URI without any fetch", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const dataUri = `data:application/pdf;base64,${Buffer.from(
        "%PDF-1.4 mock pdf data",
      ).toString("base64")}`;

      const result = await readPdfUrl(dataUri);

      expect(result.error).toBeUndefined();
      expect(result.text).toBe("Mocked PDF content text.");
      // Echoes a short label, never the base64 payload
      expect(result.url).toMatch(/^data: URI \(\d+ chars\)$/);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("rejects a malformed data: URI", async () => {
      const result = await readPdfUrl("data:application/pdf-no-comma");
      expect(result.error).toContain("Invalid data URI");
    });

    it("returns the standard re-attach error for the unresolved 'attached' sentinel", async () => {
      const result = await readPdfUrl("attached");
      expect(result.error).toContain("No attached document was found");
      expect(result.error).toContain("re-)upload");
    });
  });

  describe("Integration Tests — Express /agentic/web/pdf-read Endpoint", () => {
    it("returns 400 when url is missing", async () => {
      const response = await request(expressApp)
        .post("/agentic/web/pdf-read")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Request body must include 'url'");
    });

    it("successfully runs route handler and returns PDF contents", async () => {
      const mockPdfBytes = Buffer.from("%PDF-1.4 mock pdf data");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "application/pdf";
            return null;
          },
        },
        arrayBuffer: async () => new Uint8Array(mockPdfBytes).buffer,
      } as Response);

      const response = await request(expressApp)
        .post("/agentic/web/pdf-read")
        .send({
          url: "https://example.com/document.pdf",
          pages: [2, 4],
          maxChars: 50,
        });

      expect(response.status).toBe(200);
      expect(response.body.url).toBe("https://example.com/document.pdf");
      expect(response.body.text).toBe("Extracting pages: 2,4");
      expect(response.body.pageCount).toBe(10);

      fetchSpy.mockRestore();
    });
  });
});
