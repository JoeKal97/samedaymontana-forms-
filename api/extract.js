const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a Montana vehicle registration assistant for Same Day Montana, a registered agent service.

Extract vehicle title and applicant information from whatever the user provides — pasted text, notes, emails, or image content from a title scan.

Return ONLY a valid JSON object. No markdown, no explanation, no code fences. Just the raw JSON.

JSON schema — only include fields you actually found data for:
{
  "applicant_name": "Full legal name or LLC name",
  "applicant_id": "DL, FEIN, or Corp ID number",
  "applicant_jurisdiction": "MT",
  "mailing_address": "Street address",
  "mailing_city": "City",
  "mailing_state": "MT",
  "mailing_zip": "Zip code",
  "mailing_county": "County name",
  "phone": "Phone number",
  "email": "Email address",
  "year": "4-digit vehicle year",
  "make": "Vehicle make",
  "model": "Vehicle model",
  "vin": "17-character VIN all caps",
  "color": "Color",
  "fuel_type": "Gas / Diesel / Electric / Hybrid",
  "style": "Pickup / SUV / Sedan / Van / Truck / etc",
  "msrp": "MSRP dollar amount digits only",
  "sale_date": "mm/dd/yyyy",
  "sold_new": false,
  "seller_name": "Seller printed name",
  "seller_address": "Seller full address",
  "odometer_reading": "Mileage digits only",
  "odometer_date": "mm/dd/yyyy",
  "odometer_digits": 6,
  "dealer_license": "Dealer license number",
  "has_lien": false,
  "vehicle_leased": false,
  "business_name": "Full business name if signing as entity",
  "applicant_signing_date": "mm/dd/yyyy"
}

Rules:
- VIN is always 17 characters, all caps, no spaces
- All dates must be mm/dd/yyyy
- If the applicant is an LLC or corporation, copy the entity name into both applicant_name and business_name
- sold_new is a boolean: true = new vehicle, false = used
- mailing_state defaults to "MT" if not specified
- applicant_jurisdiction defaults to "MT"
- odometer_digits is 5 or 6
- Only return the JSON — nothing else`;

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { text, imageBase64, imageMediaType } = req.body || {};

  if (!text && !imageBase64) {
    return res.status(400).json({ error: "Provide text or an image" });
  }

  const userContent = [];

  if (imageBase64) {
    const isPDF = imageMediaType === "application/pdf";
    if (isPDF) {
      userContent.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: imageBase64 },
      });
    } else {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: imageMediaType || "image/jpeg", data: imageBase64 },
      });
    }
  }

  const inputText = text
    ? `Extract all vehicle and applicant fields from this input:\n\n${text}`
    : "Extract all vehicle and applicant fields from the uploaded file.";

  userContent.push({ type: "text", text: inputText });

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const raw = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({ data: parsed });
  } catch (err) {
    console.error("Extract error:", err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};
