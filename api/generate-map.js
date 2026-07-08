// Sample multiple points from a polygon to cover all zip codes it spans
function getSamplePoints(coords) {
  const points = [];
  const lats = coords.map(c => c[1]);
  const lngs = coords.map(c => c[0]);
  const centerLat = lats.reduce((a, b) => a + b) / lats.length;
  const centerLng = lngs.reduce((a, b) => a + b) / lngs.length;

  // Centroid
  points.push({ lat: centerLat, lng: centerLng });

  // Midpoint between centroid and each vertex
  for (let i = 0; i < coords.length - 1; i++) {
    points.push({
      lat: (coords[i][1] + centerLat) / 2,
      lng: (coords[i][0] + centerLng) / 2
    });
  }

  // Midpoint of each edge
  for (let i = 0; i < coords.length - 1; i++) {
    points.push({
      lat: (coords[i][1] + coords[i + 1][1]) / 2,
      lng: (coords[i][0] + coords[i + 1][0]) / 2
    });
  }

  return points;
}

// Look up zip code for a single lat/lng using Census Geocoder
async function getZipForPoint(lat, lng) {
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=86&format=json`;
    const response = await fetch(url);
    const data = await response.json();
    const zctas = data?.result?.geographies?.["ZIP Code Tabulation Areas"];
    if (zctas && zctas.length > 0) {
      return zctas[0].ZCTA5CE20 || zctas[0].ZCTA5CE10 || zctas[0].GEOID;
    }
    return null;
  } catch (e) {
    console.log("Geocoder point failed:", e.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { path, geojson } = req.body;

  if (!path || !geojson) {
    res.status(400).json({ error: "Missing path or geojson" });
    return;
  }

  try {
    // Step 1: Generate map image from Google Static Maps
    const googleUrl = `https://maps.googleapis.com/maps/api/staticmap?size=640x400&maptype=roadmap&path=${encodeURIComponent(path)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const googleResponse = await fetch(googleUrl);
    console.log("Google status:", googleResponse.status);
    const buffer = Buffer.from(await googleResponse.arrayBuffer());
    const base64Image = buffer.toString("base64");

    // Step 2: Look up zip codes using Census Geocoder with polygon sample points
    const coords = geojson.geometry.coordinates[0];
    const samplePoints = getSamplePoints(coords);
    console.log("Sampling", samplePoints.length, "points across polygon...");

    const zipResults = await Promise.all(
      samplePoints.map(({ lat, lng }) => getZipForPoint(lat, lng))
    );

    const zipCodes = [...new Set(zipResults.filter(Boolean))].sort();
    console.log("Zip codes found:", zipCodes.length, zipCodes);

    // Step 3: Store image in GitHub
    const timestamp = Date.now();
    const imagePath = `map-data/images/map-${timestamp}.png`;
    const jsonPath = `map-data/submissions/submission-${timestamp}.json`;

    const githubHeaders = {
      "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const repoBase = `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents`;

    // Upload image to GitHub
    console.log("Uploading image to GitHub...");
    const imageUpload = await fetch(`${repoBase}/${imagePath}`, {
      method: "PUT",
      headers: githubHeaders,
      body: JSON.stringify({
        message: `Add map image ${timestamp}`,
        content: base64Image
      })
    });
    const imageResult = await imageUpload.json();
    console.log("GitHub image upload status:", imageUpload.status);

    if (!imageResult.content || !imageResult.content.download_url) {
      console.error("GitHub image upload failed:", JSON.stringify(imageResult));
      res.status(500).json({ error: "Image upload failed: " + JSON.stringify(imageResult) });
      return;
    }

    const imageUrl = imageResult.content.download_url;

    // Upload submission JSON to GitHub
    const submissionData = { timestamp, imageUrl, zipCodes, geojson };
    const jsonUpload = await fetch(`${repoBase}/${jsonPath}`, {
      method: "PUT",
      headers: githubHeaders,
      body: JSON.stringify({
        message: `Add submission ${timestamp}`,
        content: Buffer.from(JSON.stringify(submissionData, null, 2)).toString("base64")
      })
    });
    console.log("GitHub JSON upload status:", jsonUpload.status);

    res.status(200).json({ imageUrl, zipCodes, geojson });

  } catch (error) {
    console.error("FULL ERROR:", error);
    res.status(500).json({ error: error.message });
  }
}
