const BASE_ID = "appI9OhdUL1pd2pnZ";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Only allow requests from our own frontend
  const origin = req.headers.origin || req.headers.referer || '';
  const allowed = ['samedaymontana-forms.vercel.app', 'localhost'];
  if (!allowed.some(h => origin.includes(h))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return res.status(500).json({ error: "AIRTABLE_TOKEN not configured" });

  if (req.body?.test) {
    try {
      const resp = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await resp.json();
      return res.status(resp.status).json(data);
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const { applicant_name, vin, year, make, model } = req.body || {};
  if (!vin) return res.status(400).json({ error: "VIN is required" });

  const TABLE_NAME = process.env.AIRTABLE_TABLE || "Vehicles";

  try {
    const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          "Processing Type": "Title & Reg",
          "Year":       year  || "",
          "Make":       make  || "",
          "Model":      model || "",
          "VIN":        vin   || "",
          "Owner Name": applicant_name || "",
          "Client":     "Same Day Montana LLC",
        }
      })
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data.error?.message || JSON.stringify(data) });
    return res.status(200).json({ success: true, id: data.id });

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
