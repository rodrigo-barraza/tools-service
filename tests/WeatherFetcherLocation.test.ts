import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import CONFIG, { applyLocation, type LocationData } from "../src/config.ts";
import { fetchOpenMeteoWeather } from "../src/fetchers/weather/OpenMeteoFetcher.ts";
import { fetchAirQuality } from "../src/fetchers/weather/AirQualityFetcher.ts";
import {
  fetchTomorrowIORealtime,
  fetchTomorrowIODailyForecast,
} from "../src/fetchers/weather/TomorrowIOFetcher.ts";

// ─── Weather fetchers follow the location applied at startup ─────────
// The fetchers are imported (above) before applyLocation() runs, exactly as
// in server.ts. Capturing CONFIG at import pinned every home-weather fetch
// to the 0,0/UTC defaults: on 2026-09-29 /weather/weather/current reported
// 25 °C and night at 11:30 in Vancouver — the Gulf of Guinea's weather.

const VANCOUVER: LocationData = {
  latitude: 49.2497,
  longitude: -123.1193,
  radiusMiles: 25,
  timezone: "America/Vancouver",
  tideStationId: null,
};

const defaults: LocationData = {
  latitude: CONFIG.LATITUDE,
  longitude: CONFIG.LONGITUDE,
  radiusMiles: CONFIG.RADIUS_MILES,
  timezone: CONFIG.TIMEZONE,
  tideStationId: CONFIG.TIDE_STATION_ID,
};

/** Run `fetcher` against a failing fetch and return the URL it asked for. */
async function requestedUrl(fetcher: () => Promise<unknown>): Promise<URL> {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("offline"));
  await expect(fetcher()).rejects.toThrow("offline");
  return new URL(String(fetchSpy.mock.calls[0][0]));
}

describe("weather fetchers use the location applied after import", () => {
  beforeAll(() => applyLocation(VANCOUVER));
  afterAll(() => applyLocation(defaults));
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["Open-Meteo forecast", fetchOpenMeteoWeather],
    ["Open-Meteo air quality", fetchAirQuality],
  ])(
    "%s asks for the applied location and timezone",
    async (_name, fetcher) => {
      const url = await requestedUrl(fetcher);
      expect(url.searchParams.get("latitude")).toBe("49.2497");
      expect(url.searchParams.get("longitude")).toBe("-123.1193");
      expect(url.searchParams.get("timezone")).toBe("America/Vancouver");
    },
  );

  it.each([
    ["Tomorrow.io realtime", fetchTomorrowIORealtime],
    ["Tomorrow.io daily forecast", fetchTomorrowIODailyForecast],
  ])("%s asks for the applied location", async (_name, fetcher) => {
    const url = await requestedUrl(fetcher);
    expect(url.searchParams.get("location")).toBe("49.2497,-123.1193");
  });
});
