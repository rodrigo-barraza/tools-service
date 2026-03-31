import { fetchNY511Cameras } from "./_ny511_helper.js";

export async function refreshSyracuseWebcams() {
  await fetchNY511Cameras({
    city: "Syracuse",
    idPrefix: "SYR",
    bounds: { minLat: 42.95, maxLat: 43.2, minLon: -76.3, maxLon: -76.0 },
  });
}
