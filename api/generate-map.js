import { v2 as cloudinary } from "cloudinary";

export default async function handler(req, res) {
  const { path } = req.query;

  if (!path) {
    res.status(400).send("Missing path parameter");
    return;
  }

  try {
    const googleUrl = `https://maps.googleapis.com/maps/api/staticmap?size=640x400&maptype=roadmap&path=${path}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

    const response = await fetch(googleUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const base64Image = `data:image/png;base64,${buffer.toString("base64")}`;

    const uploadResult = await cloudinary.uploader.upload(base64Image, {
      folder: "map-submissions",
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    });

    res.status(200).send(uploadResult.secure_url);

  } catch (error) {
    console.error("FULL ERROR:", error);
    res.status(500).send("Error: " + error.message);
  }
}
