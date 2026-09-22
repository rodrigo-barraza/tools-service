import { buildScraperHeaders } from "../../../../utilities.ts";
import {
  upsertWebcams,
  type WebcamDocument,
} from "../../../../models/Webcam.ts";

/**
 * Shared fetcher for ArcGIS Feature Server camera layers.
 * Many DOTs (Florida, DC, Iowa, Caltrans) expose traffic camera
 * data through Esri ArcGIS REST services with a standardized
 * query interface.
 */
interface FetchArcGISCamerasParams {
  serviceUrl: string;
  city: string;
  country: string;
  source: string;
  idPrefix: string;
  fieldMappings: {
    id: string;
    name: string;
    url?: string;
    latitude?: string;
    longitude?: string;
    area?: string;
  };
  bounds?: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: {
    x?: number;
    y?: number;
  };
}

interface ArcGISResponse {
  features?: ArcGISFeature[];
  exceededTransferLimit?: boolean;
}

export async function fetchArcGISCameras({
  serviceUrl,
  city,
  country,
  source,
  idPrefix,
  fieldMappings,
  bounds,
}: FetchArcGISCamerasParams) {
  const allParsedWebcams: WebcamDocument[] = [];
  let resultOffset = 0;
  const resultRecordCount = 1000;
  let hasMore = true;

  while (hasMore) {
    const queryParameters = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      outSR: "4326",
      f: "json",
      resultOffset: String(resultOffset),
      resultRecordCount: String(resultRecordCount),
    });

    const url = `${serviceUrl}/query?${queryParameters.toString()}`;
    const response = await fetch(url, {
      headers: buildScraperHeaders(),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ArcGIS cameras for ${city}: ${response.status}`,
      );
    }

    const data = (await response.json()) as ArcGISResponse;
    if (!data.features || data.features.length === 0) {
      break;
    }

    for (const feature of data.features) {
      const attributes = feature.attributes;
      const latitude =
        fieldMappings.latitude
          ? (attributes[fieldMappings.latitude] as number | null)
          : feature.geometry?.y ?? null;
      const longitude =
        fieldMappings.longitude
          ? (attributes[fieldMappings.longitude] as number | null)
          : feature.geometry?.x ?? null;

      if (bounds && latitude != null && longitude != null) {
        if (
          latitude < bounds.minLat ||
          latitude > bounds.maxLat ||
          longitude < bounds.minLon ||
          longitude > bounds.maxLon
        ) {
          continue;
        }
      }

      const cameraId = attributes[fieldMappings.id];
      const cameraName = attributes[fieldMappings.name];
      const cameraUrl = fieldMappings.url
        ? (attributes[fieldMappings.url] as string | null)
        : null;
      const cameraArea = fieldMappings.area
        ? (attributes[fieldMappings.area] as string | null)
        : null;

      allParsedWebcams.push({
        id: `${idPrefix}-${cameraId}`,
        name: String(cameraName || `Camera ${cameraId}`),
        url: cameraUrl || "",
        area: String(cameraArea || city),
        latitude,
        longitude,
        city,
        country,
        source,
      });
    }

    if (data.exceededTransferLimit) {
      resultOffset += resultRecordCount;
    } else {
      hasMore = false;
    }
  }

  const validWebcams = allParsedWebcams.filter(
    (webcam) => webcam.url || (webcam.latitude && webcam.longitude),
  );

  if (validWebcams.length > 0) {
    await upsertWebcams(validWebcams);
  }
}
