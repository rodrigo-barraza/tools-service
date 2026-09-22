import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import { createTestApp } from "./testApp.ts";
import { readSpreadsheetUrl, type SpreadsheetJsonResponse } from "../src/fetchers/web/SpreadsheetFetcher.ts";
import type { Express } from "express";

describe("SpreadsheetFetcher & Web Spreadsheet Read Endpoint", () => {
  let expressApp: Express;

  beforeAll(async () => {
    const { default: router } = await import("../src/routes/AgenticRoutes.ts");
    expressApp = createTestApp("/agentic", router);
  });

  describe("Unit Tests — readSpreadsheetUrl", () => {
    it("successfully parses standard CSV with headers", async () => {
      const csvData = "Name,Age,IsActive\nAlice,30,true\nBob,25,false";
      
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "text/csv";
            if (normalized === "content-length") return String(csvData.length);
            return null;
          },
        },
        arrayBuffer: async () => {
          const encoder = new TextEncoder();
          return encoder.encode(csvData).buffer;
        },
      } as Response);

      const result = (await readSpreadsheetUrl("https://example.com/data.csv", {
        includeHeaders: true,
        outputFormat: "json",
      })) as SpreadsheetJsonResponse;

      expect(fetchSpy).toHaveBeenCalled();
      expect(result.format).toBe("csv");
      expect(result.sheetCount).toBe(1);
      expect(result.totalRowCount).toBe(3);
      expect(result.sheets[0].headers).toEqual(["Name", "Age", "IsActive"]);
      expect(result.sheets[0].rows).toEqual([
        { Name: "Alice", Age: 30, IsActive: true },
        { Name: "Bob", Age: 25, IsActive: false },
      ]);

      fetchSpy.mockRestore();
    });

    it("successfully parses standard CSV without headers as raw arrays", async () => {
      const csvData = "Name,Age,IsActive\nAlice,30,true\nBob,25,false";
      
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "text/csv";
            if (normalized === "content-length") return String(csvData.length);
            return null;
          },
        },
        arrayBuffer: async () => {
          const encoder = new TextEncoder();
          return encoder.encode(csvData).buffer;
        },
      } as Response);

      const result = (await readSpreadsheetUrl("https://example.com/data.csv", {
        includeHeaders: false,
        outputFormat: "json",
      })) as SpreadsheetJsonResponse;

      expect(fetchSpy).toHaveBeenCalled();
      expect(result.format).toBe("csv");
      expect(result.sheets[0].headers).toBeNull();
      expect(result.sheets[0].rows).toEqual([
        ["Name", "Age", "IsActive"],
        ["Alice", 30, true],
        ["Bob", 25, false],
      ]);

      fetchSpy.mockRestore();
    });

    it("successfully parses TSV data using custom delimiter", async () => {
      const tsvData = "Name\tAge\nAlice\t30\nBob\t25";

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "text/tab-separated-values";
            if (normalized === "content-length") return String(tsvData.length);
            return null;
          },
        },
        arrayBuffer: async () => {
          const encoder = new TextEncoder();
          return encoder.encode(tsvData).buffer;
        },
      } as Response);

      const result = (await readSpreadsheetUrl("https://example.com/data.tsv", {
        includeHeaders: true,
        outputFormat: "json",
      })) as SpreadsheetJsonResponse;

      expect(fetchSpy).toHaveBeenCalled();
      expect(result.format).toBe("tsv");
      expect(result.sheets[0].headers).toEqual(["Name", "Age"]);
      expect(result.sheets[0].rows).toEqual([
        { Name: "Alice", Age: 30 },
        { Name: "Bob", Age: 25 },
      ]);

      fetchSpy.mockRestore();
    });

    it("formats output as Markdown table", async () => {
      const csvData = "Name,Age\nAlice,30\nBob,25";

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "text/csv";
            return null;
          },
        },
        arrayBuffer: async () => {
          const encoder = new TextEncoder();
          return encoder.encode(csvData).buffer;
        },
      } as Response);

      const result = (await readSpreadsheetUrl("https://example.com/data.csv", {
        includeHeaders: true,
        outputFormat: "markdown",
      })) as { content: string };

      expect(result.content).toContain("## Sheet:");
      expect(result.content).toContain("| Name | Age |");
      expect(result.content).toContain("| Alice | 30 |");
      expect(result.content).toContain("| Bob | 25 |");

      fetchSpy.mockRestore();
    });

    it("respects maxRows parameter to truncate rows inside the sheet", async () => {
      const csvData = "Name,Age\nAlice,30\nBob,25\nCharlie,35";

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "text/csv";
            return null;
          },
        },
        arrayBuffer: async () => {
          const encoder = new TextEncoder();
          return encoder.encode(csvData).buffer;
        },
      } as Response);

      const result = (await readSpreadsheetUrl("https://example.com/data.csv", {
        includeHeaders: true,
        maxRows: 1,
      })) as SpreadsheetJsonResponse;

      expect(result.sheets[0].rows.length).toBe(1);
      expect(result.sheets[0].truncated).toBe(true);

      fetchSpy.mockRestore();
    });

    it("programmatically truncates JSON rows when maxChars is exceeded", async () => {
      const csvData = "Name,Age\nAlice,30\nBob,25\nCharlie,35";

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "text/csv";
            return null;
          },
        },
        arrayBuffer: async () => {
          const encoder = new TextEncoder();
          return encoder.encode(csvData).buffer;
        },
      } as Response);

      // Request limit low enough that Bob and Charlie will be programmatically popped from the rows array
      const result = (await readSpreadsheetUrl("https://example.com/data.csv", {
        includeHeaders: true,
        maxChars: 250,
      })) as SpreadsheetJsonResponse;

      expect(result.truncated).toBe(true);
      expect(result.sheets[0].rows.length).toBeLessThan(3);

      fetchSpy.mockRestore();
    });
  });

  describe("Integration Tests — Express /agentic/web/spreadsheet-read Endpoint", () => {
    it("returns 400 when url is missing", async () => {
      const response = await request(expressApp)
        .post("/agentic/web/spreadsheet-read")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Request body must include 'url'");
    });

    it("successfully calls route handler and extracts spreadsheet data", async () => {
      const csvData = "Name,Age\nAlice,30";

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        headers: {
          get: (headerName: string) => {
            const normalized = headerName.toLowerCase();
            if (normalized === "content-type") return "text/csv";
            return null;
          },
        },
        arrayBuffer: async () => {
          const encoder = new TextEncoder();
          return encoder.encode(csvData).buffer;
        },
      } as Response);

      const response = await request(expressApp)
        .post("/agentic/web/spreadsheet-read")
        .send({
          url: "https://example.com/data.csv",
          includeHeaders: true,
          outputFormat: "json",
        });

      expect(response.status).toBe(200);
      expect(response.body.format).toBe("csv");
      expect(response.body.sheets[0].rows).toEqual([
        { Name: "Alice", Age: 30 },
      ]);

      fetchSpy.mockRestore();
    });
  });
});
