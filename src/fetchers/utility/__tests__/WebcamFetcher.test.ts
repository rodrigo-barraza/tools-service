import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPublicWebcams } from "../WebcamFetcher.ts";
import { getWebcams, getWebcamsLastUpdatedByKey } from "../../../models/Webcam.ts";
import { WEBCAM_REGISTRY } from "../webcams/WebcamRegistry.ts";

vi.mock("../../../models/Webcam.ts", () => ({
  getWebcams: vi.fn(),
  getWebcamsLastUpdatedByKey: vi.fn(),
}));

vi.mock("../webcams/WebcamRegistry.ts", () => ({
  WEBCAM_REGISTRY: {
    vancouver: vi.fn(),
    california: vi.fn(),
    quebec: vi.fn(),
    germany: vi.fn(),
    "long-island": vi.fn(),
  },
}));

describe("WebcamFetcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should query webcams by city (defaulting to Vancouver if no filters provided)", async () => {
    vi.mocked(getWebcamsLastUpdatedByKey).mockResolvedValue(new Date());
    vi.mocked(getWebcams).mockResolvedValue([{ id: "vancam", name: "Vancouver Cam", city: "Vancouver" }]);

    const results = await getPublicWebcams();

    expect(results).toHaveLength(1);
    expect(results[0].city).toBe("Vancouver");
    expect(getWebcamsLastUpdatedByKey).toHaveBeenCalledWith("vancouver");
    expect(getWebcams).toHaveBeenCalledWith({ city: { $regex: /^vancouver$/i } }, 100);
  });

  it("should query webcams specifically by city when city filter is provided", async () => {
    vi.mocked(getWebcamsLastUpdatedByKey).mockResolvedValue(new Date());
    vi.mocked(getWebcams).mockResolvedValue([{ id: "seacam", name: "Seattle Cam", city: "Seattle" }]);

    await getPublicWebcams({ city: "seattle" });

    expect(getWebcams).toHaveBeenCalledWith({ city: { $regex: /^seattle$/i } }, 100);
  });

  it("should query webcams by state", async () => {
    vi.mocked(getWebcamsLastUpdatedByKey).mockResolvedValue(new Date());
    vi.mocked(getWebcams).mockResolvedValue([{ id: "cacam", name: "California Cam", state: "California" }]);

    await getPublicWebcams({ state: "California" });

    expect(getWebcamsLastUpdatedByKey).toHaveBeenCalledWith("california");
    expect(getWebcams).toHaveBeenCalledWith({ state: { $regex: /^California$/i } }, 100);
  });

  it("should query webcams by province", async () => {
    vi.mocked(getWebcamsLastUpdatedByKey).mockResolvedValue(new Date());
    vi.mocked(getWebcams).mockResolvedValue([{ id: "qbcam", name: "Quebec Cam", province: "Quebec" }]);

    await getPublicWebcams({ province: "Quebec" });

    expect(getWebcamsLastUpdatedByKey).toHaveBeenCalledWith("quebec");
    expect(getWebcams).toHaveBeenCalledWith({ province: { $regex: /^Quebec$/i } }, 100);
  });

  it("should query webcams by region", async () => {
    vi.mocked(getWebcamsLastUpdatedByKey).mockResolvedValue(new Date());
    vi.mocked(getWebcams).mockResolvedValue([{ id: "licam", name: "Long Island Cam", region: "Long Island" }]);

    await getPublicWebcams({ region: "long-island" });

    expect(getWebcamsLastUpdatedByKey).toHaveBeenCalledWith("long-island");
    expect(getWebcams).toHaveBeenCalledWith({ region: { $regex: /^long-island$/i } }, 100);
  });

  it("should query webcams by country (with name to code mapping)", async () => {
    vi.mocked(getWebcamsLastUpdatedByKey).mockResolvedValue(new Date());
    vi.mocked(getWebcams).mockResolvedValue([{ id: "decam", name: "Germany Cam", country: "DE" }]);

    await getPublicWebcams({ country: "Germany" });

    expect(getWebcamsLastUpdatedByKey).toHaveBeenCalledWith("germany");
    expect(getWebcams).toHaveBeenCalledWith({ country: "DE" }, 100);
  });

  it("should trigger refresh if the source data is stale or missing", async () => {
    vi.mocked(getWebcamsLastUpdatedByKey).mockResolvedValue(null);
    vi.mocked(getWebcams).mockResolvedValue([{ id: "vancam", name: "Vancouver Cam", city: "Vancouver" }]);

    await getPublicWebcams({ city: "vancouver" });

    expect(WEBCAM_REGISTRY.vancouver).toHaveBeenCalled();
    expect(getWebcams).toHaveBeenCalled();
  });

  it("should throw an error if no sources match the filters", async () => {
    await expect(getPublicWebcams({ city: "NonExistentCity" })).rejects.toThrow(
      "No supported public webcam sources matched filters: city='NonExistentCity'"
    );
  });
});
