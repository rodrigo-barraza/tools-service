import CONFIG from "../../config.ts";
import { type AirQuality } from "../../types/weather.ts";

// Built per call: server.ts applies the resolved location to CONFIG after
// this module is imported, so a module-level URL froze the 0,0/UTC defaults.
function airQualityUrl(): string {
  return (
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${CONFIG.LATITUDE}&longitude=${CONFIG.LONGITUDE}` +
    `&current=us_aqi,european_aqi,pm10,pm2_5,` +
    `carbon_monoxide,nitrogen_dioxide,ozone,dust,uv_index` +
    `&hourly=us_aqi,pm2_5,pm10,uv_index` +
    `&timezone=${CONFIG.TIMEZONE}` +
    `&forecast_hours=24`
  );
}

export async function fetchAirQuality(): Promise<AirQuality> {
  const response = await fetch(airQualityUrl());

  if (!response.ok) {
    throw new Error(`Air Quality API returned ${response.status}`);
  }

  const data = await response.json();
  const current = data.current;

  return {
    source: "airquality",
    timestamp: new Date(current.time),

    // Current air quality
    usAqi: current.us_aqi,
    europeanAqi: current.european_aqi,
    pm25: current.pm2_5,
    pm10: current.pm10,
    carbonMonoxide: current.carbon_monoxide,
    nitrogenDioxide: current.nitrogen_dioxide,
    ozone: current.ozone,
    dust: current.dust,
    uvIndex: current.uv_index,

    // Hourly AQ forecast
    hourlyAirQuality: data.hourly
      ? data.hourly.time.map((time: string, i: number) => ({
          time,
          usAqi: data.hourly.us_aqi[i],
          pm25: data.hourly.pm2_5[i],
          pm10: data.hourly.pm10[i],
          uvIndex: data.hourly.uv_index[i],
        }))
      : [],
  };
}
