import CONFIG from "../../config.ts";
import { TOMORROWIO_WEATHER_CODES } from "../../constants.ts";
import {
  type TomorrowIORealtimeResponse,
  type TomorrowIODailyForecastResponse,
  type TomorrowIODailyForecast,
} from "../../types/weather.ts";

// Built per call: server.ts applies the resolved location to CONFIG after
// this module is imported, so a module-level URL froze the 0,0/UTC defaults.
function realtimeUrl(): string {
  return (
    `https://api.tomorrow.io/v4/weather/realtime` +
    `?location=${CONFIG.LATITUDE},${CONFIG.LONGITUDE}` +
    `&apikey=${CONFIG.TOMORROWIO_API_KEY}`
  );
}

function dailyForecastUrl(): string {
  return (
    `https://api.tomorrow.io/v4/weather/forecast` +
    `?location=${CONFIG.LATITUDE},${CONFIG.LONGITUDE}` +
    `&timesteps=1d` +
    `&apikey=${CONFIG.TOMORROWIO_API_KEY}`
  );
}

interface RawTomorrowRealtimeData {
  data: {
    time: string;
    values: {
      weatherCode: number;
      temperature: number;
      temperatureApparent: number;
      humidity: number;
      cloudCover: number;
      cloudBase: number | null;
      cloudCeiling: number | null;
      dewPoint: number;
      precipitationProbability: number;
      rainIntensity: number;
      snowIntensity: number;
      sleetIntensity: number;
      freezingRainIntensity: number;
      windSpeed: number;
      windDirection: number;
      windGust: number;
      visibility: number;
      uvIndex: number;
      uvHealthConcern: number;
      pressureSeaLevel: number;
    };
  };
}

interface RawTomorrowDailyForecastDay {
  time: string;
  values: {
    temperatureMax: number;
    temperatureMin: number;
    temperatureAvg: number;
    precipitationProbabilityAvg: number;
    precipitationProbabilityMax: number;
    rainAccumulationSum: number;
    snowAccumulationSum: number;
    windSpeedAvg: number;
    windSpeedMax: number;
    windGustMax: number;
    visibilityAvg: number;
    visibilityMin: number;
    uvIndexMax: number;
    cloudCoverAvg: number;
    humidityAvg: number;
    sunriseTime: string | null;
    sunsetTime: string | null;
    moonriseTime: string | null;
    moonsetTime: string | null;
    weatherCodeMax: number;
  };
}

interface RawTomorrowDailyForecastResponse {
  timelines?: {
    daily?: RawTomorrowDailyForecastDay[];
  };
}

export async function fetchTomorrowIORealtime(): Promise<TomorrowIORealtimeResponse> {
  const response = await fetch(realtimeUrl());

  if (!response.ok) {
    throw new Error(`Tomorrow.io realtime returned ${response.status}`);
  }

  const data = (await response.json()) as RawTomorrowRealtimeData;
  const values = data.data.values;
  const weatherDescription =
    (TOMORROWIO_WEATHER_CODES as Record<number, string>)[values.weatherCode] ||
    "Unknown";

  return {
    source: "tomorrowio",
    timestamp: new Date(data.data.time),

    // Core weather
    weatherCode: values.weatherCode,
    weatherDescription,
    temperature: values.temperature,
    apparentTemperature: values.temperatureApparent,
    humidity: values.humidity,
    cloudCover: values.cloudCover,
    cloudBase: values.cloudBase,
    cloudCeiling: values.cloudCeiling,
    dewPoint: values.dewPoint,
    precipitationProbability: values.precipitationProbability,
    rainIntensity: values.rainIntensity,
    snowIntensity: values.snowIntensity,
    sleetIntensity: values.sleetIntensity,
    freezingRainIntensity: values.freezingRainIntensity,
    windSpeed: values.windSpeed,
    windDirection: values.windDirection,
    windGust: values.windGust,
    visibility: values.visibility,
    uvIndex: values.uvIndex,
    uvHealthConcern: values.uvHealthConcern,
    pressure: values.pressureSeaLevel,
  };
}

export async function fetchTomorrowIODailyForecast(): Promise<TomorrowIODailyForecastResponse> {
  const response = await fetch(dailyForecastUrl());

  if (!response.ok) {
    throw new Error(`Tomorrow.io daily forecast returned ${response.status}`);
  }

  const data = (await response.json()) as RawTomorrowDailyForecastResponse;
  const days = data.timelines?.daily || [];

  // Extract today's daylight data
  const today = days[0]?.values || {};

  return {
    source: "tomorrowio_daily",
    timestamp: new Date(),

    // Daylight
    sunrise: today.sunriseTime || null,
    sunset: today.sunsetTime || null,
    moonrise: today.moonriseTime || null,
    moonset: today.moonsetTime || null,

    // Daily forecast array
    dailyForecast: days.map(
      (day): TomorrowIODailyForecast => ({
        time: day.time,
        temperatureMax: day.values.temperatureMax,
        temperatureMin: day.values.temperatureMin,
        temperatureAvg: day.values.temperatureAvg,
        precipitationProbabilityAvg: day.values.precipitationProbabilityAvg,
        precipitationProbabilityMax: day.values.precipitationProbabilityMax,
        rainAccumulationSum: day.values.rainAccumulationSum,
        snowAccumulationSum: day.values.snowAccumulationSum,
        windSpeedAvg: day.values.windSpeedAvg,
        windSpeedMax: day.values.windSpeedMax,
        windGustMax: day.values.windGustMax,
        visibilityAvg: day.values.visibilityAvg,
        visibilityMin: day.values.visibilityMin,
        uvIndexMax: day.values.uvIndexMax,
        cloudCoverAvg: day.values.cloudCoverAvg,
        humidityAvg: day.values.humidityAvg,
        sunriseTime: day.values.sunriseTime,
        sunsetTime: day.values.sunsetTime,
        moonriseTime: day.values.moonriseTime,
        moonsetTime: day.values.moonsetTime,
        weatherCodeMax: day.values.weatherCodeMax,
      }),
    ),
  };
}
