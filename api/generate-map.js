import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default async function handler(req, res) {
  const { path } = req.query;

  if (!path) {
    res.status(400).send("Missing path parameter");
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const googleUrl = `https://maps.googleapis.com/maps/api/staticmap?size=640x400&maptype=roadmap&path=${path}&key=${apiKey}`;

  try {
    console.log("Fetching from Google...");
    const response = await fetch(googleUrl);
    console.log("Google response status:", response.status);

    const buffer = Buffer.from(await response.arrayBuffer());
    console.log("Buffer size:", buffer.length);

    const base64Image = `data:image/png;base64,${buffer.toString("base64")}`;
    console.log("Uploading to Cloudinary...");
    console.log("Cloud name:", process.env.CLOUDINARY_CLOUD_NAME);
    console.log("API key exists:", !!process.env.CLOUDINARY_API_KEY);
    console.log("API secret exists:", !!process.env.CLOUDINARY_API_SECRET);

    const uploadResult = await cloudinary.uploader.upload(base64Image, {
      folder: "map-submissions",
    });

    console.log("Upload success:", uploadResult.secure_url);
    res.status(200).send(uploadResult.secure_url);

  } catch (error) {
    console.error("FULL ERROR:", error);
    res.status(500).send("Error: " + error.message);
  }
}
