const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

// Field mapping: our data keys → MV1 PDF field IDs
const TEXT_FIELDS = {
  applicant_name:        "Applicant Legal Name",
  applicant_id:          "Applicant DL/FEIN/Tribal ID/Corp ID",
  applicant_jurisdiction:"Applicant Jurisdiction",
  mailing_address:       "Mailing Address",
  mailing_city:          "Mailing City",
  mailing_state:         "Mail State",
  mailing_zip:           "Mail Zip",
  mailing_county:        "Mail County",
  phone:                 "Phone Number",
  email:                 "Email Address",
  year:                  "Year",
  make:                  "Make",
  model:                 "Model",
  vin:                   "VIN",
  color:                 "Color",
  fuel_type:             "Fuel Type",
  style:                 "Style",
  msrp:                  "Retail price when new",
  sale_date:             "Vehicle sold date",
  seller_name:           "Sellers Printed Name",
  seller_address:        "Sellers Address",
  odometer_reading:      "Odometer reading",
  odometer_date:         "Date odometer read",
  dealer_signing_date:   "Signing Odometer Date",
  dealer_license:        "Dealer License Number",
  applicant_printed:     "Applicants Printed Name",
  business_name:         "Business Name",
  applicant_signing_date:"Applicant signing date",
};

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  const d = req.body || {};
  const form_name = (d.form || "MV1").toUpperCase();

  // Load blank template from server — always available, no upload needed
  const templatePath = path.join(process.cwd(), "forms", `${form_name}.pdf`);
  if (!fs.existsSync(templatePath)) {
    return res.status(404).json({ error: `Template ${form_name}.pdf not found on server` });
  }

  try {
    const pdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();

    function setText(fieldId, value) {
      if (!value && value !== 0) return;
      try {
        form.getTextField(fieldId).setText(String(value));
      } catch (_) {
        // Field doesn't exist or wrong type — skip silently
      }
    }

    function setCheck(fieldId, checked) {
      try {
        const f = form.getCheckBox(fieldId);
        checked ? f.check() : f.uncheck();
      } catch (_) {}
    }

    // Fill all text fields
    Object.entries(TEXT_FIELDS).forEach(([key, fieldId]) => {
      const val = key === "applicant_printed" ? (d.applicant_name || d.business_name) :
                  key === "dealer_signing_date" ? (d.dealer_signing_date || d.sale_date) :
                  d[key];
      setText(fieldId, val);
    });

    // Defaults
    setText("Applicant Jurisdiction", d.applicant_jurisdiction || "MT");
    setText("Mail State", d.mailing_state || "MT");

    setText("Mailing Address",     "110 Ironwood Place");
    setText("Mailing City",        "Missoula");
    setText("Mail State",          "MT");
    setText("Mail Zip",            "59803");
    setText("Residential Address", "110 Ironwood Place");
    setText("Residential City",    "Missoula");
    setText("Residential State",   "MT");
    setText("Residential Zip",     "59803");
    setText("Email Address",       "joekalafat@gmail.com");
    setText("Phone Number",        "406-540-2941");
    setText("Applicants Printed Name", "Joe Kalafat - Agent");

    // Checkboxes — vehicle condition
    const soldNew = d.sold_new === true || d.sold_new === "true" || d.sold_new === "New";
    setCheck("Vehicle sold New - check", soldNew);
    setCheck("Vehicle sold Used - check", !soldNew);

    // Lien
    const hasLien = d.has_lien === true || d.has_lien === "true";
    // Section 3 always left blank
    setCheck("Security Lien - check No", false);
    setCheck("Security Lien - check Yes", false);

    // Leased
    const leased = d.vehicle_leased === true || d.vehicle_leased === "true";
    setCheck("Yes vehicle leased", leased);
    setCheck("No vehicle not leased", !leased);

    // Odometer digits
    const odoDigits = parseInt(d.odometer_digits) || 6;
    setCheck("Five digit odometer - check", odoDigits === 5);
    setCheck("Six digit odometer - check", odoDigits === 6);

    // Phone type
    const phoneType = (d.phone_type || "cell").toLowerCase();
    setCheck("Phone type cell",     phoneType === "cell");
    setCheck("Phone type home",     phoneType === "home");
    setCheck("Phone type business", phoneType === "business");

    // E-notice — default opt out
    setCheck("e-notice opt in",  false);
    setCheck("e-notice opt out", true);

    // Lienholder fields (if applicable)
    if (hasLien) {
      setText("Name of Security Party or Lienholder", d.lienholder_name);
      setText("Secured Party Lienholder DL/FEIN/Tribal ID/Corp ID/ELT", d.lienholder_id);
      setText("Mailing Address of Secured Party or Lienholder", d.lienholder_address);
      setText("Secured Party Lienholder City", d.lienholder_city);
      setText("Secured Party Lienholder State", d.lienholder_state);
      setText("Secured Party Lienholder Zip", d.lienholder_zip);
    }

    form.flatten();
    const filledBytes = await pdfDoc.save();

    const safeName = (d.applicant_name || "client")
      .replace(/[^a-z0-9]/gi, "_")
      .substring(0, 30);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${form_name}_${safeName}.pdf"`);
    res.setHeader("Content-Length", filledBytes.length);
    return res.status(200).send(Buffer.from(filledBytes));

  } catch (err) {
    console.error("Fill error:", err);
    return res.status(500).json({ error: err.message });
  }
};
