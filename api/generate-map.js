export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
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
    const buffer = Buffer.from(await googleResponse.arrayBuffer());
    const base64Image = buffer.toString("base64");

    // Step 2: Upload to Cloudinary via REST API
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    const timestamp = Math.floor(Date.now() / 1000);
    const signatureString = `folder=map-submissions&timestamp=${timestamp}${apiSecret}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(signatureString));
    const signature = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    const formData = new FormData();
    formData.append("file", `data:image/png;base64,${base64Image}`);
    formData.append("api_key", apiKey);
    formData.append("timestamp", timestamp);
    formData.append("signature", signature);
    formData.append("folder", "map-submissions");

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: "POST", body: formData }
    );
    const uploadResult = await uploadResponse.json();

    if (!uploadResult.secure_url) {
      console.error("Cloudinary error:", JSON.stringify(uploadResult));
      res.status(500).json({ error: "Image upload failed: " + JSON.stringify(uploadResult) });
      return;
    }

    const imageUrl = uploadResult.secure_url;

    // Step 3: Look up zip codes using Census TIGERweb API
    // Build a bounding box from the polygon coordinates for the query
    const coords = geojson.geometry.coordinates[0];
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    // Query Census TIGERweb for ZCTAs intersecting the bounding box
    const tigerUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/2/query?geometry=${minLng},${minLat},${maxLng},${maxLat}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=ZCTA5CE10&returnGeometry=false&f=json`;

    const tigerResponse = await fetch(tigerUrl);
    const tigerData = await tigerResponse.json();

    let zipCodes = [];
    if (tigerData.features && tigerData.features.length > 0) {
      zipCodes = tigerData.features
        .map(f => f.attributes.ZCTA5CE10)
        .filter(Boolean)
        .sort();
    }

    console.log("Image URL:", imageUrl);
    console.log("Zip codes found:", zipCodes.length);

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
