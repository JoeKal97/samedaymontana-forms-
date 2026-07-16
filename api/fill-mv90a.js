const { PDFDocument, PDFName, PDFBool } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const d = req.body || {};
    const templatePath = path.join(process.cwd(), "forms", "MV90A.pdf");
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "MV90A.pdf not found" });

    const pdfDoc = await PDFDocument.load(fs.readFileSync(templatePath), { ignoreEncryption: true });
    const form = pdfDoc.getForm();

    function setText(id, val) { try { form.getTextField(id).setText(String(val || "")); } catch (_) {} }
    function setCheck(id, checked) { try { const f = form.getCheckBox(id); checked ? f.check() : f.uncheck(); } catch (_) {} }

    // Vehicle
    setText("Year",  d.year);
    setText("Make",  d.make);
    setText("Model", d.model);
    setText("Style", d.style);
    setText("VIN",   d.vin);

    // Odometer
    setText("Odometer miles", d.odometer_reading || "");
    setText("Date Odometer Read", d.odometer_date || d.sale_date || "");
    const odoDigits = parseInt(d.odometer_digits) || 6;
    setCheck("Five digit odometer", odoDigits === 5);
    setCheck("Six digit odometer", odoDigits === 6);
    // Discrepancy boxes always left unchecked
    setCheck("Odometer in excess of limits", false);
    setCheck("Odometer not actual", false);

    // Transferor = seller
    setText("Transferor Name",    d.seller_name || "");
    setText("Transferor Address", d.seller_address || "");
    setText("Transferor City",    d.seller_city || "");
    setText("Transferor State",   d.seller_state || "");
    setText("Transferor Zip",     d.seller_zip || "");
    setText("Transferor Date",    d.sale_date || "");

    // Transferee = buyer (applicant) — agent mailing address
    setText("Transferee Name",    d.applicant_name || "");
    setText("Transferee Address", "110 Ironwood Place");
    setText("Transferee City",    "Missoula");
    setText("Transferee State",   "MT");
    setText("Transferee Zip",     "59803");
    setText("Transferee Date",    d.sale_date || "");

    // Signatures left blank for wet signature.
    // NeedAppearances so Acrobat regenerates field appearances (see fill.js)
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    const filledBytes = await pdfDoc.save({ updateFieldAppearances: false });

    const safeName = (d.applicant_name || "client").replace(/[^a-z0-9]/gi, "_").substring(0, 30);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="MV90A_${safeName}.pdf"`);
    res.setHeader("Content-Length", filledBytes.length);
    return res.status(200).send(Buffer.from(filledBytes));

  } catch (err) {
    console.error("MV90A fill error:", err);
    return res.status(500).json({ error: err.message });
  }
};
