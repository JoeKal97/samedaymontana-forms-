// Writes Shippo tracking numbers back into the registrations sheet.
//
// Matching is deliberately conservative: a tracking number is written only when
// exactly one row matches on both LLC name and VIN last-4, and that row's
// tracking cell is still empty. Anything else is reported back for Joe to
// handle by hand rather than guessed at — a wrong tracking number on a row is
// worse than a missing one.

const SHEET_ID = "1O3mI4i465BqJABKKq9ljeMynRUqTHhgruI0xZim2Xrk";

// 1-based column layout of the target sheet:
// A LLC Name | B VIN | C Type | D Date Registered | E Amount |
// F Where Registered | G Tracking # | H Done | I Invoiced Date |
// J Invoiced | K Paid Date | L Paid
const COL_LLC = "A";
const COL_VIN = "B";
const COL_TRACKING = "G";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Missing Authorization bearer token" });

  const { labels, dry_run } = req.body || {};
  if (!Array.isArray(labels) || !labels.length) {
    return res.status(400).json({ error: "No labels provided" });
  }

  try {
    const sheetTitle = await getFirstSheetTitle(token);
    const { llc, vin, tracking } = await readColumns(token, sheetTitle);

    const written = [];
    const skipped = [];
    const writes = [];
    const claimedRows = new Set();

    for (const label of labels) {
      const llcName = String(label.llc_name || "").trim();
      const vinLast4 = last4(label.vin);
      if (!vinLast4) {
        skipped.push({ llc_name: llcName, vin: label.vin || "", reason: "missing_vin" });
        continue;
      }

      // Row 1 holds the column headers, so data starts at row 2.
      const matches = [];
      for (let i = 1; i < llc.length; i++) {
        if (normName(llc[i]) !== normName(llcName)) continue;
        if (last4(vin[i]) !== vinLast4) continue;
        matches.push(i);
      }

      if (matches.length === 0) {
        skipped.push({ llc_name: llcName, vin: label.vin, reason: "no_match" });
        continue;
      }
      if (matches.length > 1) {
        skipped.push({ llc_name: llcName, vin: label.vin, reason: "multiple_matches" });
        continue;
      }

      const idx = matches[0];
      const rowNumber = idx + 1;
      // A row already targeted earlier in this same batch counts as taken —
      // otherwise two labels could both write to it on the stale read.
      if (String(tracking[idx] || "").trim() || claimedRows.has(rowNumber)) {
        skipped.push({ llc_name: llcName, vin: label.vin, reason: "already_has_tracking" });
        continue;
      }

      claimedRows.add(rowNumber);
      writes.push({
        range: `${quoteTitle(sheetTitle)}!${COL_TRACKING}${rowNumber}`,
        values: [[String(label.tracking_number || "")]],
      });
      written.push({
        llc_name: llcName,
        vin: label.vin,
        tracking_number: label.tracking_number,
        row: rowNumber,
      });
    }

    const request = writes.length
      ? { valueInputOption: "RAW", data: writes }
      : null;

    // dry_run returns the exact payload that would be sent, without sending it.
    if (dry_run) {
      return res.status(200).json({
        dry_run: true,
        written: [],
        planned: written,
        skipped,
        sheet_title: sheetTitle,
        sheets_request: request
          ? { method: "POST", url: valuesBatchUpdateUrl(), body: request }
          : null,
      });
    }

    if (request) await sheetsPost(token, valuesBatchUpdateUrl(), request);

    return res.status(200).json({ written, skipped });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// ── Google Sheets ──────────────────────────────────────────

function valuesBatchUpdateUrl() {
  return `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`;
}

async function getFirstSheetTitle(token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`;
  const json = await sheetsGet(token, url);
  const title = json.sheets?.[0]?.properties?.title;
  if (!title) throw httpError(502, "Could not read sheet title");
  return title;
}

async function readColumns(token, sheetTitle) {
  const t = quoteTitle(sheetTitle);
  const ranges = [`${t}!${COL_LLC}:${COL_LLC}`, `${t}!${COL_VIN}:${COL_VIN}`, `${t}!${COL_TRACKING}:${COL_TRACKING}`];
  const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join("&");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${qs}&majorDimension=COLUMNS`;
  const json = await sheetsGet(token, url);
  const col = i => (json.valueRanges?.[i]?.values?.[0]) || [];
  return { llc: col(0), vin: col(1), tracking: col(2) };
}

async function sheetsGet(token, url) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return handleSheetsResponse(resp);
}

async function sheetsPost(token, url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleSheetsResponse(resp);
}

async function handleSheetsResponse(resp) {
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw httpError(resp.status, json.error?.message || `Sheets API error ${resp.status}`);
  }
  return json;
}

function httpError(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

// ── Matching helpers ───────────────────────────────────────

// "Big Sky Holdings, LLC" and "big sky holdings llc" must collapse to the same key.
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b(llc|inc|corp|ltd)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function last4(v) {
  const s = String(v || "").trim().toUpperCase();
  return s.length >= 4 ? s.slice(-4) : "";
}

// Sheet titles with an apostrophe need it doubled inside a quoted A1 range.
function quoteTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}
