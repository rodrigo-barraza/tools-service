import CONFIG from "../../config.ts";
import { WMO_WEATHER_CODES } from "../../constants.ts";
import {
  type OpenMeteoResponse,
  type OpenMeteoHourlyForecast,
  type OpenMeteoDailyForecast,
} from "../../types/weather.ts";

// ─── Hourly Variables ──────────────────────────────────────────────
const HOURLY_VARIABLES = [
  // Temperature & humidity
  "temperature_2m",
  "relative_humidity_2m",
  "dewpoint_2m",
  "apparent_temperature",

  // Precipitation
  "precipitation_probability",
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "snow_depth",

  // General
  "weather_code",

  // Pressure
  "pressure_msl",
  "surface_pressure",

  // Cloud cover
  "cloud_cover",
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",

  // Visibility & evapotranspiration
  "visibility",
  "evapotranspiration",
  "et0_fao_evapotranspiration",
  "vapour_pressure_deficit",

  // Wind (multi-level)
  "wind_speed_10m",
  "wind_speed_80m",
  "wind_speed_120m",
  "wind_speed_180m",
  "wind_direction_10m",
  "wind_direction_80m",
  "wind_direction_120m",
  "wind_direction_180m",
  "wind_gusts_10m",

  // Temperature (multi-level)
  "temperature_80m",
  "temperature_120m",
  "temperature_180m",

  // Soil temperature
  "soil_temperature_0cm",
  "soil_temperature_6cm",
  "soil_temperature_18cm",
  "soil_temperature_54cm",

  // Soil moisture
  "soil_moisture_0_to_1cm",
  "soil_moisture_1_to_3cm",
  "soil_moisture_3_to_9cm",
  "soil_moisture_9_to_27cm",
  "soil_moisture_27_to_81cm",

  // UV
  "uv_index",
];

// Built per call: server.ts applies the resolved location to CONFIG after
// this module is imported, so a module-level URL froze the 0,0/UTC defaults.
function forecastUrl(): string {
  return (
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${CONFIG.LATITUDE}&longitude=${CONFIG.LONGITUDE}` +
    `&current=weather_code,temperature_2m,apparent_temperature,` +
    `relative_humidity_2m,precipitation,rain,showers,snowfall,` +
    `cloud_cover,wind_speed_10m,wind_direction_10m,` +
    `wind_gusts_10m,surface_pressure,is_day,uv_index` +
    `&hourly=${HOURLY_VARIABLES.join(",")}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,` +
    `sunrise,sunset,daylight_duration,uv_index_max,` +
    `precipitation_sum,wind_speed_10m_max` +
    `&timezone=${CONFIG.TIMEZONE}` +
    `&forecast_days=2`
  );
}

interface RawOpenMeteoResponse {
  timezone: string;
  current: {
    time: string;
    weather_code: number;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    cloud_cover: number;
    precipitation: number;
    rain: number;
    showers: number;
    snowfall: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
    surface_pressure: number;
    is_day: number;
    uv_index: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise: string[];
    sunset: string[];
    daylight_duration: number[];
    uv_index_max: number[];
    precipitation_sum: number[];
    wind_speed_10m_max: number[];
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    relative_humidity_2m: number[];
    dewpoint_2m: number[];
    apparent_temperature: number[];
    precipitation_probability: number[];
    precipitation: number[];
    rain: number[];
    showers: number[];
    snowfall: number[];
    snow_depth: number[];
    weather_code: number[];
    pressure_msl: number[];
    surface_pressure: number[];
    cloud_cover: number[];
    cloud_cover_low: number[];
    cloud_cover_mid: number[];
    cloud_cover_high: number[];
    visibility: number[];
    evapotranspiration: number[];
    et0_fao_evapotranspiration: number[];
    vapour_pressure_deficit: number[];
    wind_speed_10m: number[];
    wind_speed_80m: number[];
    wind_speed_120m: number[];
    wind_speed_180m: number[];
    wind_direction_10m: number[];
    wind_direction_80m: number[];
    wind_direction_120m: number[];
    wind_direction_180m: number[];
    wind_gusts_10m: number[];
    temperature_80m: number[];
    temperature_120m: number[];
    temperature_180m: number[];
    soil_temperature_0cm: number[];
    soil_temperature_6cm: number[];
    soil_temperature_18cm: number[];
    soil_temperature_54cm: number[];
    soil_moisture_0_to_1cm: number[];
    soil_moisture_1_to_3cm: number[];
    soil_moisture_3_to_9cm: number[];
    soil_moisture_9_to_27cm: number[];
    soil_moisture_27_to_81cm: number[];
    uv_index: number[];
  };
}

export async function fetchOpenMeteoWeather(): Promise<OpenMeteoResponse> {
  const response = await fetch(forecastUrl());

  if (!response.ok) {
    throw new Error(`Open-Meteo returned ${response.status}`);
  }

  const data = (await response.json()) as RawOpenMeteoResponse;
  const current = data.current;
  const daily = data.daily;
  const hourly = data.hourly;

  // Find today's daily data
  const todayIndex = 0;
  const weatherDescription =
    (WMO_WEATHER_CODES as Record<number, string>)[current.weather_code] ||
    "Unknown";

  return {
    source: "openmeteo",
    timestamp: new Date(current.time),

    // Current conditions
    weatherCode: current.weather_code,
    weatherDescription,
    temperature: current.temperature_2m,
    apparentTemperature: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    cloudCover: current.cloud_cover,
    precipitation: current.precipitation,
    rain: current.rain,
    showers: current.showers,
    snowfall: current.snowfall,
    windSpeed: current.wind_speed_10m,
    windDirection: current.wind_direction_10m,
    windGust: current.wind_gusts_10m,
    pressure: current.surface_pressure,
    isDay: Boolean(current.is_day),
    uvIndex: current.uv_index,

    // Daylight from daily
    sunrise: daily.sunrise?.[todayIndex] || null,
    sunset: daily.sunset?.[todayIndex] || null,
    daylightDuration: daily.daylight_duration?.[todayIndex] || null,

    // Hourly forecast (all variables)
    hourlyForecast: hourly
      ? hourly.time.map(
          (time, i): OpenMeteoHourlyForecast => ({
            time,

            // Temperature & humidity
            temperature: hourly.temperature_2m[i],
            relativeHumidity: hourly.relative_humidity_2m[i],
            dewpoint: hourly.dewpoint_2m[i],
            apparentTemperature: hourly.apparent_temperature[i],

            // Precipitation
            precipitationProbability: hourly.precipitation_probability[i],
            precipitation: hourly.precipitation[i],
            rain: hourly.rain[i],
            showers: hourly.showers[i],
            snowfall: hourly.snowfall[i],
            snowDepth: hourly.snow_depth[i],

            // General
            weatherCode: hourly.weather_code[i],

            // Pressure
            seaLevelPressure: hourly.pressure_msl[i],
            surfacePressure: hourly.surface_pressure[i],

            // Cloud cover
            cloudCover: hourly.cloud_cover[i],
            cloudCoverLow: hourly.cloud_cover_low[i],
            cloudCoverMid: hourly.cloud_cover_mid[i],
            cloudCoverHigh: hourly.cloud_cover_high[i],

            // Visibility & evapotranspiration
            visibility: hourly.visibility[i],
            evapotranspiration: hourly.evapotranspiration[i],
            referenceEvapotranspiration: hourly.et0_fao_evapotranspiration[i],
            vapourPressureDeficit: hourly.vapour_pressure_deficit[i],

            // Wind (multi-level)
            windSpeed10m: hourly.wind_speed_10m[i],
            windSpeed80m: hourly.wind_speed_80m[i],
            windSpeed120m: hourly.wind_speed_120m[i],
            windSpeed180m: hourly.wind_speed_180m[i],
            windDirection10m: hourly.wind_direction_10m[i],
            windDirection80m: hourly.wind_direction_80m[i],
            windDirection120m: hourly.wind_direction_120m[i],
            windDirection180m: hourly.wind_direction_180m[i],
            windGusts10m: hourly.wind_gusts_10m[i],

            // Temperature (multi-level)
            temperature80m: hourly.temperature_80m[i],
            temperature120m: hourly.temperature_120m[i],
            temperature180m: hourly.temperature_180m[i],

            // Soil temperature
            soilTemperature0cm: hourly.soil_temperature_0cm[i],
            soilTemperature6cm: hourly.soil_temperature_6cm[i],
            soilTemperature18cm: hourly.soil_temperature_18cm[i],
            soilTemperature54cm: hourly.soil_temperature_54cm[i],

            // Soil moisture
            soilMoisture0to1cm: hourly.soil_moisture_0_to_1cm[i],
            soilMoisture1to3cm: hourly.soil_moisture_1_to_3cm[i],
            soilMoisture3to9cm: hourly.soil_moisture_3_to_9cm[i],
            soilMoisture9to27cm: hourly.soil_moisture_9_to_27cm[i],
            soilMoisture27to81cm: hourly.soil_moisture_27_to_81cm[i],

            // UV
            uvIndex: hourly.uv_index[i],
          }),
        )
      : [],

    // Daily forecast
    dailyForecast: daily.time
      ? daily.time.map(
          (time, i): OpenMeteoDailyForecast => ({
            time,
            weatherCode: daily.weather_code[i],
            temperatureMax: daily.temperature_2m_max[i],
            temperatureMin: daily.temperature_2m_min[i],
            sunrise: daily.sunrise[i],
            sunset: daily.sunset[i],
            daylightDuration: daily.daylight_duration[i],
            uvIndexMax: daily.uv_index_max[i],
            precipitationSum: daily.precipitation_sum[i],
            windSpeedMax: daily.wind_speed_10m_max[i],
          }),
        )
      : [],
  };
}
