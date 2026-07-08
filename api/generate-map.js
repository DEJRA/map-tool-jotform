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
    console.log("Image size:", base64Image.length);

    // Step 2: Look up zip codes using Census TIGERweb
    // Use actual polygon geometry instead of bounding box for accuracy
    const coords = geojson.geometry.coordinates[0];
    const esriRings = [coords.map(c => [c[0], c[1]])];
    const esriGeometry = JSON.stringify({ rings: esriRings });

    const tigerUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/2/query?geometry=${encodeURIComponent(esriGeometry)}&geometryType=esriGeometryPolygon&spatialRel=esriSpatialRelIntersects&outFields=ZCTA5CE20,ZCTA5CE10&returnGeometry=false&f=json`;

    console.log("Querying TIGERweb...");
    const tigerResponse = await fetch(tigerUrl);
    const tigerData = await tigerResponse.json();
    console.log("TIGERweb raw response:", JSON.stringify(tigerData).substring(0, 500));

    let zipCodes = [];
    if (tigerData.features && tigerData.features.length > 0) {
      zipCodes = tigerData.features
        .map(f => f.attributes.ZCTA5CE20 || f.attributes.ZCTA5CE10)
        .filter(Boolean)
        .sort();
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
    const submissionData = {
      timestamp,
      imageUrl,
      zipCodes,
      geojson
    };

    console.log("Uploading submission JSON to GitHub...");
    const jsonUpload = await fetch(`${repoBase}/${jsonPath}`, {
      method: "PUT",
      headers: githubHeaders,
      body: JSON.stringify({
        message: `Add submission ${timestamp}`,
        content: Buffer.from(JSON.stringify(submissionData, null, 2)).toString("base64")
      })
    });
    const jsonResult = await jsonUpload.json();
    console.log("GitHub JSON upload status:", jsonUpload.status);

    res.status(200).json({
      imageUrl,
      zipCodes,
      geojson
    });

  } catch (error) {
    console.error("FULL ERROR:", error);
    res.status(500).json({ error: error.message });
  }
}
