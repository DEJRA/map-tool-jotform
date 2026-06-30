export default async function handler(req, res) {
  const { path } = req.query;

  if (!path) {
    res.status(400).send("Missing path parameter");
    return;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/staticmap?size=640x400&maptype=roadmap&path=${path}&key=${apiKey}`;

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();

  res.setHeader("Content-Type", "image/png");
  res.status(200).send(Buffer.from(buffer));
}
