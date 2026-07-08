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

  function getSamplePoints(coords) {
    const points = [];
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    const centerLat = lats.reduce((a, b) => a + b) / lats.length;
    const centerLng = lngs.reduce((a, b) => a + b) / lngs.length;

    points.push({ lat: centerLat, lng: centerLng });

    for (let i = 0; i < coords.length - 1; i++) {
      points.push({
        lat: (coords[i][1] + centerLat) / 2,
        lng: (coords[i][0] + centerLng) / 2
      });
    }

    for (let i = 0; i < coords.length - 1; i++) {
      points.push({
        lat: (coords[i][1] + coords[i + 1][1]) / 2,
        lng: (coords[i][0] + coords[i + 1][0]) / 2
      });
    }

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
    // Build a human-readable timestamp for the filename: map-YYYYMMDD-HHMMSS
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

    // Step 2: Look up zip codes using Google Geocoding API
    const coords = geojson.geometry.coordinates[0];
    const samplePoints = getSamplePoints(coords);
    console.log("Sampling", samplePoints.length, "points across polygon...");

    const zipResults = await Promise.all(
      samplePoints.map(({ lat, lng }) => getZipForPoint(lat, lng))
    );

    const zipCodes = [...new Set(zipResults.filter(Boolean))].sort();
    console.log("Zip codes found:", zipCodes.length, zipCodes);

    // Step 3: Store in GitHub using fileId as the shared filename
    // Both the image and JSON use the same fileId so they are always matched
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

    // Upload submission JSON — includes the imageUrl so the JSON is self-contained
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

    // Return the imageUrl — the filename embedded in it IS the attribution link
    res.status(200).json({ imageUrl, zipCodes, fileId });

  } catch (error) {
    console.error("FULL ERROR:", error);
    res.status(500).json({ error: error.message });
  }
}
