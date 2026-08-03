// Writes Shippo tracking numbers back into the registrations sheet.
//
// Matching is deliberately conservative. A tracking number is written only when
// the target row is unambiguous and its tracking cell is still empty. When an
// LLC has several rows for the same vehicle (a title and a registration, say),
// an already-filled tracking cell rules that row out; if that still leaves more
// than one candidate the row is never guessed at — the candidates come back as
// `needs_choice` for the operator to pick from. A wrong tracking number on a
// row is worse than a missing one.

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
    const cols = await readColumns(token, sheetTitle);
    const { llc, vin, tracking } = cols;

    const written = [];
    const skipped = [];
    const writes = [];
    const claimedRows = new Set();

    // A row is writable only if its tracking cell is empty and nothing earlier
    // in this same batch already claimed it (the read is a single snapshot).
    const isFree = idx => !String(tracking[idx] || "").trim() && !claimedRows.has(idx + 1);

    const queueWrite = (label, llcName, rowNumber) => {
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
    };

    for (const label of labels) {
      const llcName = String(label.llc_name || "").trim();

      // ── Targeted write: the operator already picked the row. ──
      if (label.row !== undefined && label.row !== null && label.row !== "") {
        const rowNumber = Number(label.row);
        const idx = rowNumber - 1;
        // Row 1 is headers; refuse anything outside the rows actually read so a
        // bad row number can't write into empty space far below the data.
        if (!Number.isInteger(rowNumber) || rowNumber < 2 || idx >= llc.length) {
          skipped.push({ llc_name: llcName, vin: label.vin, reason: "no_match" });
          continue;
        }
        if (!isFree(idx)) {
          skipped.push({ llc_name: llcName, vin: label.vin, row: rowNumber, reason: "already_has_tracking" });
          continue;
        }
        queueWrite(label, llcName, rowNumber);
        continue;
      }

      // ── Matched write. ──
      const vinLast4 = last4(label.vin);
      if (!vinLast4) {
        skipped.push({ llc_name: llcName, vin: label.vin || "", reason: "missing_vin" });
        continue;
      }

      // Row 1 holds the column headers, so data starts at row 2.
      const candidates = [];
      for (let i = 1; i < llc.length; i++) {
        if (normName(llc[i]) !== normName(llcName)) continue;
        if (last4(vin[i]) !== vinLast4) continue;
        candidates.push(i);
      }

      if (candidates.length === 0) {
        skipped.push({ llc_name: llcName, vin: label.vin, reason: "no_match" });
        continue;
      }

      // An already-tracked row is not a real contender — this is what lets an
      // LLC with a title row and a registration row resolve on its own.
      const free = candidates.filter(isFree);

      if (free.length === 1) {
        queueWrite(label, llcName, free[0] + 1);
        continue;
      }
      if (free.length === 0) {
        skipped.push({ llc_name: llcName, vin: label.vin, reason: "all_candidates_have_tracking" });
        continue;
      }
      skipped.push({
        llc_name: llcName,
        vin: label.vin,
        tracking_number: label.tracking_number,
        reason: "needs_choice",
        candidates: free.map(i => describeRow(cols, i)),
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

// Reads A–G so `needs_choice` can describe each candidate row well enough for
// the operator to tell two rows of the same vehicle apart.
async function readColumns(token, sheetTitle) {
  const range = `${quoteTitle(sheetTitle)}!${COL_LLC}:${COL_TRACKING}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?majorDimension=COLUMNS`;
  const json = await sheetsGet(token, url);
  const col = i => (json.values?.[i]) || [];
  return {
    llc: col(0), vin: col(1), type: col(2), date: col(3),
    amount: col(4), where: col(5), tracking: col(6),
  };
}

function describeRow(cols, idx) {
  return {
    row: idx + 1,
    type: String(cols.type[idx] || ""),
    date_registered: String(cols.date[idx] || ""),
    where: String(cols.where[idx] || ""),
  };
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
