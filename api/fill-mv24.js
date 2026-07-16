const { PDFDocument, rgb, StandardFonts, PDFName, PDFBool } = require("pdf-lib");
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
    const templatePath = path.join(process.cwd(), "forms", "MV24.pdf");
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: "MV24.pdf not found" });

    const pdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const page = pdfDoc.getPages()[0];
    const pageHeight = page.getHeight();

    const PURCHASER_NAME = d.applicant_name || "";
    const PURCHASER_ID   = d.applicant_id   || "";

    function setText(id, val) { try { form.getTextField(id).setText(String(val||"")); } catch(_) {} }
    function setRadio(id, val) { try { form.getRadioGroup(id).select(val); } catch(_) {} }

    setText("Purchaser", PURCHASER_NAME);
    setText("DL/FEIN/Tribal ID/Corp. ID", PURCHASER_ID);
    setText("Address of Purchaser", "110 Ironwood Place, Missoula MT 59803");
    setText("Purchasers printed name", PURCHASER_NAME);
    setText("Year",  d.year);
    setText("Make",  d.make);
    setText("Model", d.model);
    setText("Style", d.style);
    setText("VehicleHull Identification No", d.vin);
    setText("License Plate Number", d.license_plate || "");
    setText("Sum Received", d.sale_price || "");
    setText("Date",   d.sale_date || "");
    setText("Date_2", d.sale_date || "");
    setText("Odometer Statement", d.odometer_reading || "");
    setText("Date Read", d.odometer_date || d.sale_date || "");
    setText("Sellers printed name", d.seller_name || "");
    setText("DL/FEIN/Tribal ID/Corp ID of Seller", d.seller_id || "");
    setText("Address of Seller", d.seller_address || "");
    setRadio("Salvage - 15 years old or Older?", "No");
    setRadio("Sold for Parts Only?", "No_2");
    setRadio("Title Available?", "Yes_2");
    setRadio("How Many Digits in Odometer?", (parseInt(d.odometer_digits) || 6) === 5 ? "Five" : "Six");

    const font = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    // Purchaser's Signature line — field rect x=146 y=327..353 (bottom-up)
    page.drawText("Joe Kalafat", {
      x: 150, y: pageHeight - 457,
      size: 16, font, color: rgb(0.05, 0.1, 0.5)
    });

    // NeedAppearances: let Acrobat regenerate field appearances instead of
    // flattening — pdf-lib's generated appearance streams corrupt page 1 in Acrobat
    // (same fix applied to MV1 in fill.js).
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    const filledBytes = await pdfDoc.save({ updateFieldAppearances: false });
    const safeName = PURCHASER_NAME.replace(/[^a-z0-9]/gi,"_").substring(0,30);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="MV24_${safeName}.pdf"`);
    return res.status(200).send(Buffer.from(filledBytes));

  } catch(err) {
    console.error("MV24 fill error:", err);
    return res.status(500).json({ error: err.message });
  }
};
