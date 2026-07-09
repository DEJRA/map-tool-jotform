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

  // Ray casting algorithm — returns true if point is inside polygon
  function pointInPolygon(lat, lng, coords) {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const xi = coords[i][0], yi = coords[i][1];
      const xj = coords[j][0], yj = coords[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Build a uniform grid of points inside the polygon
  // gridSpacing of 0.04 degrees ≈ 2.5 miles — fine enough to catch small urban zip codes
  function getGridPoints(coords, gridSpacing = 0.01) {
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    const points = [];
    for (let lat = minLat; lat <= maxLat; lat += gridSpacing) {
      for (let lng = minLng; lng <= maxLng; lng += gridSpacing) {
        if (pointInPolygon(lat, lng, coords)) {
          points.push({ lat, lng });
        }
      }
    }

    console.log(`Grid generated ${points.length} interior points`);
    return points;
  }

  async function getZipForPoint(lat, lng) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_SERVER_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== "OK" || !data.results || data.results.length === 0) {
        return null;
      }

      for (const result of data.results) {
        for (const component of result.address_components) {
          if (component.types.includes("postal_code")) {
            return component.long_name;
          }
        }
      }

      return null;
    } catch (e) {
      console.log("Geocoder point failed:", e.message);
      return null;
    }
  }

  try {
    // Build timestamp-based file ID for attribution
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const timePart = now.toISOString().slice(11, 19).replace(/:/g, "");
    const fileId = `map-${datePart}-${timePart}`;
    console.log("File ID:", fileId);

    // Step 1: Generate map image from Google Static Maps
    const googleUrl = `https://maps.googleapis.com/maps/api/staticmap?size=640x400&maptype=roadmap&path=${encodeURIComponent(path)}&key=${process.env.GOOGLE_SERVER_API_KEY}`;
    const googleResponse = await fetch(googleUrl);
    console.log("Google status:", googleResponse.status);
    const buffer = Buffer.from(await googleResponse.arrayBuffer());
    const base64Image = buffer.toString("base64");

    // Step 2: Look up zip codes using grid sampling
    const coords = geojson.geometry.coordinates[0];
    const gridPoints = getGridPoints(coords);

    // Batch requests in groups of 10 to avoid hitting rate limits
    const zipSet = new Set();
    const batchSize = 10;
    for (let i = 0; i < gridPoints.length; i += batchSize) {
      const batch = gridPoints.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(({ lat, lng }) => getZipForPoint(lat, lng))
      );
      results.filter(Boolean).forEach(z => zipSet.add(z));
    }

    const zipCodes = [...zipSet].sort();
    console.log("Zip codes found:", zipCodes.length, zipCodes);

    // Step 3: Store image and JSON in GitHub using fileId as shared key
    const imagePath = `map-data/images/${fileId}.png`;
    const jsonPath = `map-data/submissions/${fileId}.json`;

    const githubHeaders = {
      "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const repoBase = `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents`;

    // Upload image
    console.log("Uploading image to GitHub...");
    const imageUpload = await fetch(`${repoBase}/${imagePath}`, {
      method: "PUT",
      headers: githubHeaders,
      body: JSON.stringify({
        message: `Add map image ${fileId}`,
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

    // Upload submission JSON
    const submissionData = { fileId, imageUrl, zipCodes, geojson };
    const jsonUpload = await fetch(`${repoBase}/${jsonPath}`, {
      method: "PUT",
      headers: githubHeaders,
      body: JSON.stringify({
        message: `Add submission ${fileId}`,
        content: Buffer.from(JSON.stringify(submissionData, null, 2)).toString("base64")
      })
    });
    console.log("GitHub JSON upload status:", jsonUpload.status);

    res.status(200).json({ imageUrl, zipCodes, fileId });

  } catch (error) {
    console.error("FULL ERROR:", error);
    res.status(500).json({ error: error.message });
  }
}
