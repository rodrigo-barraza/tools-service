import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import CONFIG from "../../../config.ts";
import {
  fetchServiceStatuses,
  fetchContainerStats,
  fetchContainerMetrics,
  fetchContainerLogs,
  isPortalConfigured,
} from "../../PortalFetcher.ts";

describe("PortalFetcher & SSE Log Parser", () => {
  const originalPortalUrl = CONFIG.PORTAL_SERVICE_URL;

  beforeAll(() => {
    CONFIG.PORTAL_SERVICE_URL = "http://192.168.86.2:4001";
  });

  afterAll(() => {
    CONFIG.PORTAL_SERVICE_URL = originalPortalUrl;
  });

  describe("Configuration checks", () => {
    it("isPortalConfigured returns true when PORTAL_SERVICE_URL is set", () => {
      CONFIG.PORTAL_SERVICE_URL = "http://192.168.86.2:4001";
      expect(isPortalConfigured()).toBe(true);
    });

    it("isPortalConfigured returns false when PORTAL_SERVICE_URL is falsy", () => {
      CONFIG.PORTAL_SERVICE_URL = "";
      expect(isPortalConfigured()).toBe(false);
    });
  });

  describe("API Proxy Endpoints", () => {
    beforeAll(() => {
      CONFIG.PORTAL_SERVICE_URL = "http://192.168.86.2:4001";
    });

    it("fetchServiceStatuses hits /services", async () => {
      const mockResponse = { services: [{ id: "test", name: "test-service", healthy: true }] };
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await fetchServiceStatuses(true);
      expect(fetchSpy).toHaveBeenCalledWith("http://192.168.86.2:4001/services?refresh=true", expect.any(Object));
      expect(result).toEqual(mockResponse);
      fetchSpy.mockRestore();
    });

    it("fetchContainerStats filters by device", async () => {
      const mockResponse = { containers: [] };
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await fetchContainerStats("synology");
      expect(fetchSpy).toHaveBeenCalledWith("http://192.168.86.2:4001/stats/containers?device=synology", expect.any(Object));
      expect(result).toEqual(mockResponse);
      fetchSpy.mockRestore();
    });

    it("fetchContainerMetrics supports range and limit", async () => {
      const mockResponse = { metrics: [] };
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await fetchContainerMetrics({
        container: "prism-service",
        device: "synology",
        range: "6h",
        limit: 50,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://192.168.86.2:4001/stats/containers/metrics?container=prism-service&device=synology&range=6h&limit=50",
        expect.any(Object)
      );
      expect(result).toEqual(mockResponse);
      fetchSpy.mockRestore();
    });
  });

  describe("fetchContainerLogs SSE Parsing Logic", () => {
    beforeAll(() => {
      CONFIG.PORTAL_SERVICE_URL = "http://192.168.86.2:4001";
    });

    function createMockStream(chunks: string[]) {
      const encoder = new TextEncoder();
      const encodedChunks = chunks.map((chunk) => encoder.encode(chunk));
      let index = 0;

      return {
        getReader: () => ({
          read: async () => {
            if (index >= encodedChunks.length) {
              return { done: true, value: undefined };
            }
            return { done: false, value: encodedChunks[index++] };
          },
          cancel: async () => {},
        }),
      };
    }

    it("filters out connected metadata event and collects standard log lines", async () => {
      const sseChunks = [
        "event: connected\ndata: {\"container\":\"prism-service\",\"device\":\"synology\",\"deviceName\":\"Synology NAS\",\"tail\":200,\"follow\":false}\n\n",
        "data: {\"line\":\"2026-06-22T20:10:00.123Z Actual log line 1\",\"stream\":\"stdout\"}\n\n",
        "data: {\"line\":\"2026-06-22T20:10:01.456Z Actual log line 2\",\"stream\":\"stdout\"}\n\n",
      ];

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        body: createMockStream(sseChunks),
      } as unknown as Response);

      const result = await fetchContainerLogs("prism-service", { tail: 10 });

      expect(fetchSpy).toHaveBeenCalled();
      expect(result.container).toBe("prism-service");
      expect(result.lines).toEqual([
        { line: "2026-06-22T20:10:00.123Z Actual log line 1", stream: "stdout" },
        { line: "2026-06-22T20:10:01.456Z Actual log line 2", stream: "stdout" },
      ]);
      expect(result.lineCount).toBe(2);
      expect(result.truncated).toBe(false);

      fetchSpy.mockRestore();
    });

    it("terminates parsing early upon event: end sentinel", async () => {
      const sseChunks = [
        "data: {\"line\":\"2026-06-22T20:10:00.123Z Log 1\",\"stream\":\"stdout\"}\n\n",
        "event: end\ndata: {\"code\":0}\n\n",
        "data: {\"line\":\"2026-06-22T20:10:01.456Z Log 2\",\"stream\":\"stdout\"}\n\n", // Should be ignored since stream ended
      ];

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        body: createMockStream(sseChunks),
      } as unknown as Response);

      const result = await fetchContainerLogs("prism-service", { tail: 10 });

      expect(result.lines).toEqual([
        { line: "2026-06-22T20:10:00.123Z Log 1", stream: "stdout" },
      ]);
      expect(result.lineCount).toBe(1);
      expect(result.truncated).toBe(false);

      fetchSpy.mockRestore();
    });

    it("terminates parsing early upon event: error sentinel", async () => {
      const sseChunks = [
        "data: {\"line\":\"2026-06-22T20:10:00.123Z Log 1\",\"stream\":\"stdout\"}\n\n",
        "event: error\ndata: {\"error\":\"Docker API down\"}\n\n",
      ];

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        body: createMockStream(sseChunks),
      } as unknown as Response);

      const result = await fetchContainerLogs("prism-service", { tail: 10 });

      expect(result.lines).toEqual([
        { line: "2026-06-22T20:10:00.123Z Log 1", stream: "stdout" },
      ]);
      expect(result.lineCount).toBe(1);
      expect(result.truncated).toBe(false);

      fetchSpy.mockRestore();
    });

    it("throws appropriate error when endpoint responds with non-200", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Container not found details",
      } as Response);

      await expect(fetchContainerLogs("invalid-container")).rejects.toThrow(
        "Portal logs API 404: Container not found details"
      );

      fetchSpy.mockRestore();
    });
  });
});
