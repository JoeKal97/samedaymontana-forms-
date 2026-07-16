const Anthropic = require("@anthropic-ai/sdk");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { file_ids, share_url, text } = req.body || {};
  const authHeader = req.headers.authorization;

  try {
    // Fetch files server-side (no browser size limit)
    const files = [];

    if (share_url) {
      const fileId = extractFileId(share_url);
      if (fileId) files.push(await fetchPublicFile(fileId));
    }

    if (file_ids && file_ids.length && authHeader) {
      const authed = await Promise.all(file_ids.map(id => fetchAuthedFile(id, authHeader)));
      files.push(...authed);
    }

    if (!files.length && !text) {
      return res.status(400).json({ error: "No files or text provided" });
    }

    // Build Claude message content
    const userContent = [];
    for (const file of files) {
      const isPDF = file.mediaType === "application/pdf";
      userContent.push(isPDF ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: file.base64 }
      } : {
        type: "image",
        source: { type: "base64", media_type: file.mediaType, data: file.base64 }
      });
    }
    if (text) userContent.push({ type: "text", text: `Extract all vehicle and applicant fields from this input:\n\n${text}` });
    else userContent.push({ type: "text", text: `Extract all vehicle and applicant fields by combining information from all ${files.length} uploaded documents.` });

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const raw = message.content.filter(b => b.type === "text").map(b => b.text).join("");
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ data: parsed });

  } catch (err) {
    console.error("Drive extract error:", err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: "50mb" }, responseLimit: false } };

// ── Copy helper functions from drive-fetch.js ──
function extractFileId(url) {
  const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/, /\/document\/d\/([a-zA-Z0-9_-]+)/, /\/folders\/([a-zA-Z0-9_-]+)/];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}
async function fetchPublicFile(fileId) {
  const resp = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, { headers: { "User-Agent": "SameDayMontana/1.0" }, redirect: "follow" });
  return processResponse(resp, fileId);
}
async function fetchAuthedFile(fileId, authHeader) {
  const metaResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`, { headers: { Authorization: authHeader } });
  const meta = await metaResp.json();
  if (meta.error) throw new Error(meta.error.message);
  const isPDF = meta.mimeType === "application/pdf";
  const downloadUrl = meta.mimeType === "application/vnd.google-apps.document"
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const resp = await fetch(downloadUrl, { headers: { Authorization: authHeader } });
  if (!resp.ok) throw new Error(`Could not download: ${meta.name}`);
  const buffer = await resp.arrayBuffer();
  return { base64: Buffer.from(buffer).toString("base64"), mediaType: isPDF ? "application/pdf" : meta.mimeType, name: meta.name };
}
async function processResponse(resp, fileId) {
  const contentType = resp.headers.get("content-type") || "application/pdf";
  if (contentType.includes("text/html")) {
    const html = await resp.text();
    const m = html.match(/href="(\/uc\?export=download[^"]+confirm=[^"]+)"/);
    if (m) {
      const confirmResp = await fetch("https://drive.google.com" + m[1].replace(/&amp;/g, "&"), { redirect: "follow" });
      const buffer = await confirmResp.arrayBuffer();
      return { base64: Buffer.from(buffer).toString("base64"), mediaType: "application/pdf", name: `file_${fileId}.pdf` };
    }
    throw new Error("Got HTML instead of PDF — make sure sharing is set to 'Anyone with the link can view'");
  }
  const buffer = await resp.arrayBuffer();
  return { base64: Buffer.from(buffer).toString("base64"), mediaType: contentType.split(";")[0] || "application/pdf", name: `file_${fileId}.pdf` };
}

const SYSTEM_PROMPT = `You are a Montana vehicle registration assistant for Same Day Montana, a registered agent service.
Extract vehicle title and applicant information from whatever the user provides.
Return ONLY a valid JSON object. No markdown, no explanation, no code fences.
JSON schema:
{"applicant_name":"","applicant_id":"","applicant_jurisdiction":"MT","mailing_address":"","mailing_city":"","mailing_state":"MT","mailing_zip":"","mailing_county":"","phone":"","email":"","year":"","make":"","model":"","vin":"","color":"","fuel_type":"","style":"","msrp":"","sale_date":"","sold_new":false,"seller_name":"","seller_address":"","seller_id":"","odometer_reading":"","odometer_date":"","odometer_digits":6,"dealer_license":"","sale_price":"","license_plate":"","has_lien":false,"vehicle_leased":false,"business_name":"","applicant_signing_date":""}
Rules: VIN=17 chars all caps, dates=mm/dd/yyyy, LLC name goes in both applicant_name and business_name, mailing_state defaults MT, only return JSON.`;
