import { fetchNY511Cameras } from "./_ny511_helper.js";

export async function refreshAlbanyWebcams() {
  await fetchNY511Cameras({
    city: "Albany",
    idPrefix: "ALB",
    bounds: { minLat: 42.55, maxLat: 42.85, minLon: -74.0, maxLon: -73.6 },
  });
}
