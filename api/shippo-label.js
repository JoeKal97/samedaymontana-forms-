const SHIPPO_TOKEN = process.env.SHIPPO_TOKEN;

const FROM_ADDRESS = {
  name:    "5Star Registration",
  street1: "110 Ironwood Pl",
  city:    "Missoula",
  state:   "MT",
  zip:     "59803",
  country: "US",
  phone:   "4065406222",
  email:   "hello@5starregistration.com",
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!SHIPPO_TOKEN) return res.status(500).json({ error: "SHIPPO_TOKEN not configured" });

  const { shipments } = req.body || {};
  if (!shipments || !shipments.length) return res.status(400).json({ error: "No shipments provided" });

  try {
    const results = await Promise.all(shipments.map(s => createLabel(s)));
    return res.status(200).json({ labels: results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

async function createLabel(shipment) {
  const { llc_name, co_name, street1, street2, city, state, zip } = shipment;
  if (!llc_name || !street1 || !city || !state || !zip) {
    return { error: "Missing required fields", llc_name };
  }

  const shipmentResp = await shippoPost("shipments", {
    address_from: FROM_ADDRESS,
    address_to: {
      name:    llc_name,
      company: co_name || "",
      street1,
      street2: street2 || "",
      city, state, zip,
      country: "US",
      is_residential: true,
    },
    parcels: [{ length:"9", width:"6", height:"1", distance_unit:"in", weight:"4", mass_unit:"oz" }],
    async: false,
  });

  if (shipmentResp.status === "ERROR") {
    return { error: shipmentResp.messages?.[0]?.text || "Shipment failed", llc_name };
  }

  const rates = shipmentResp.rates || [];
  const rate = rates.find(r =>
    r.provider === "USPS" &&
    (r.servicelevel?.token === "usps_ground_advantage" ||
     r.servicelevel?.name?.toLowerCase().includes("ground advantage"))
  ) || rates.find(r => r.provider === "USPS") || rates[0];

  if (!rate) return { error: "No USPS rate available", llc_name };

  const tx = await shippoPost("transactions", {
    rate: rate.object_id,
    label_file_type: "PDF",
    async: false,
  });

  if (tx.status === "ERROR") return { error: tx.messages?.[0]?.text || "Label purchase failed", llc_name };

  return {
    llc_name, co_name: co_name || "",
    tracking_number: tx.tracking_number,
    label_url: tx.label_url,
    rate: rate.amount,
    carrier: rate.provider,
    service: rate.servicelevel?.name,
    status: "success",
  };
}

async function shippoPost(endpoint, body) {
  const resp = await fetch(`https://api.goshippo.com/${endpoint}/`, {
    method: "POST",
    headers: { Authorization: `ShippoToken ${SHIPPO_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}
