export default async function handler(req, res) {
  const { path } = req.query;

  if (!path) {
    res.status(400).send("Missing path parameter");
    return;
  }

  try {
    const googleUrl = `https://maps.googleapis.com/maps/api/staticmap?size=640x400&maptype=roadmap&path=${path}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const googleResponse = await fetch(googleUrl);
    console.log("Google status:", googleResponse.status);

    const buffer = Buffer.from(await googleResponse.arrayBuffer());
    const base64Image = buffer.toString("base64");
    console.log("Base64 length:", base64Image.length);

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    console.log("Cloud name:", cloudName);
    console.log("API key exists:", !!apiKey);
    console.log("API secret exists:", !!apiSecret);

    const timestamp = Math.floor(Date.now() / 1000);

    const signatureString = `folder=map-submissions&timestamp=${timestamp}${apiSecret}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(signatureString);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    console.log("Signature generated:", signature.substring(0, 10) + "...");

    const formData = new FormData();
    formData.append("file", `data:image/png;base64,${base64Image}`);
    formData.append("api_key", apiKey);
    formData.append("timestamp", timestamp);
    formData.append("signature", signature);
    formData.append("folder", "map-submissions");

    console.log("Sending to Cloudinary...");
    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: "POST", body: formData }
    );

    console.log("Cloudinary response status:", uploadResponse.status);
    const result = await uploadResponse.json();
    console.log("Cloudinary result:", JSON.stringify(result));

    if (result.secure_url) {
      res.status(200).send(result.secure_url);
    } else {
      res.status(500).send("Upload failed: " + JSON.stringify(result));
    }

  } catch (error) {
    console.error("FULL ERROR:", error);
    res.status(500).send("Error: " + error.message);
  }
}
