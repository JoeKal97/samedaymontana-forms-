module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { file_ids, share_url } = req.body || {};
  const authHeader = req.headers.authorization;
  if (share_url && !file_ids) {
    try {
      const fileId = extractFileId(share_url);
      if (!fileId) return res.status(400).json({ error: "Could not extract file ID from URL" });
      const file = await fetchPublicFile(fileId);
      return res.status(200).json({ files: [file] });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }
  if (file_ids && file_ids.length) {
    if (!authHeader) return res.status(401).json({ error: "Missing authorization for private files" });
    try {
      const files = await Promise.all(file_ids.map(id => fetchAuthedFile(id, authHeader)));
      return res.status(200).json({ files });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }
  return res.status(400).json({ error: "Provide share_url or file_ids" });
};
function extractFileId(url) {
  const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/, /\/document\/d\/([a-zA-Z0-9_-]+)/, /\/folders\/([a-zA-Z0-9_-]+)/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}
async function fetchPublicFile(fileId) {
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const resp = await fetch(downloadUrl, { headers: { "User-Agent": "SameDayMontana/1.0" }, redirect: "follow" });
  if (!resp.ok) {
    const altResp = await fetch(`https://drive.google.com/uc?id=${fileId}&export=download`, { redirect: "follow" });
    if (!altResp.ok) throw new Error(`Could not fetch file (${resp.status}). Make sure sharing is set to "Anyone with the link can view".`);
    return processResponse(altResp, fileId);
  }
  return processResponse(resp, fileId);
}
async function fetchAuthedFile(fileId, authHeader) {
  const metaResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`, { headers: { Authorization: authHeader } });
  const meta = await metaResp.json();
  if (meta.error) throw new Error(meta.error.message);
  let downloadUrl, mimeType = meta.mimeType;
  if (meta.mimeType === "application/vnd.google-apps.document") {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
    mimeType = "application/pdf";
  } else {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }
  const resp = await fetch(downloadUrl, { headers: { Authorization: authHeader } });
  if (!resp.ok) throw new Error(`Could not download file: ${meta.name}`);
  const buffer = await resp.arrayBuffer();
  return { base64: Buffer.from(buffer).toString("base64"), mediaType: mimeType, name: meta.name };
}
async function processResponse(resp, fileId) {
  const contentType = resp.headers.get("content-type") || "application/pdf";
  if (contentType.includes("text/html")) {
    const html = await resp.text();
    const confirmMatch = html.match(/href="(\/uc\?export=download[^"]+confirm=[^"]+)"/);
    if (confirmMatch) {
      const confirmUrl = "https://drive.google.com" + confirmMatch[1].replace(/&amp;/g, "&");
      const confirmResp = await fetch(confirmUrl, { redirect: "follow" });
      if (!confirmResp.ok) throw new Error("Could not bypass Google download confirmation");
      const buffer = await confirmResp.arrayBuffer();
      return { base64: Buffer.from(buffer).toString("base64"), mediaType: "application/pdf", name: `file_${fileId}.pdf` };
    }
    throw new Error("Got HTML instead of PDF. Make sure sharing is set to 'Anyone with the link can view'.");
  }
  const buffer = await resp.arrayBuffer();
  return { base64: Buffer.from(buffer).toString("base64"), mediaType: contentType.split(";")[0] || "application/pdf", name: `file_${fileId}.pdf` };
}
