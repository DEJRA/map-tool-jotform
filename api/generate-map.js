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

    // Step 2: Look up zip codes using Census TIGERweb
    const coords = geojson.geometry.coordinates[0];
    const esriRings = [coords.map(c => [c[0], c[1]])];
    const esriGeometry = JSON.stringify({ rings: esriRings, spatialReference: { wkid: 4326 } });

    // inSR=4326 tells TIGERweb our coordinates are standard lat/lng (WGS84)
    const tigerUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/2/query?geometry=${encodeURIComponent(esriGeometry)}&geometryType=esriGeometryPolygon&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;

    console.log("Querying TIGERweb...");
    const tigerResponse = await fetch(tigerUrl);
    const tigerData = await tigerResponse.json();

    // Log the full response so we can see field names and values
    console.log("TIGERweb status:", tigerResponse.status);
    console.log("TIGERweb error:", JSON.stringify(tigerData.error));
    console.log("TIGERweb feature count:", tigerData.features?.length);
    if (tigerData.features?.length > 0) {
      console.log("First feature attributes:", JSON.stringify(tigerData.features[0].attributes));
    }
    if (tigerData.fields) {
      console.log("Available fields:", tigerData.fields.map(f => f.name).join(", "));
    }

    // Try every possible ZCTA field name Census has used across versions
    let zipCodes = [];
    if (tigerData.features && tigerData.features.length > 0) {
      zipCodes = tigerData.features.map(f => {
        const a = f.attributes;
        return a.ZCTA5CE20 || a.ZCTA5CE10 || a.ZCTA5 || a.GEOID20 || a.GEOID10 || a.GEOID || a.ZIP;
      }).filter(Boolean).sort();
    }
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
