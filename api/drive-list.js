module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Missing authorization" });
  const { folder_id } = req.query;
  if (!folder_id) return res.status(400).json({ error: "Missing folder_id" });
  try {
    const query = encodeURIComponent(`'${folder_id}' in parents and trashed = false`);
    const fields = encodeURIComponent("files(id,name,mimeType,size,modifiedTime)");
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=name`;
    const driveResp = await fetch(url, { headers: { Authorization: authHeader } });
    const data = await driveResp.json();
    if (data.error) return res.status(driveResp.status).json({ error: data.error.message });
    const relevant = (data.files || []).filter(f =>
      f.mimeType === "application/pdf" || f.mimeType === "image/jpeg" ||
      f.mimeType === "image/png" || f.mimeType === "image/webp" ||
      f.mimeType === "application/vnd.google-apps.document" ||
      f.mimeType === "application/vnd.google-apps.folder"
    );
    return res.status(200).json({ files: relevant });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
