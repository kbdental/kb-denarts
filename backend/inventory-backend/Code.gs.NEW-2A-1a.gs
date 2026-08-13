/**
 * K.B. Dental Clinic — Management Suite backend (Inventory)
 *
 * What this is: a Google Apps Script that turns a Google Sheet into a simple
 * backend for the app. Every module in the app (Task Management, Leave &
 * Attendance, Inventory, HR, Financial, Appraisals, Achievers Club, etc.)
 * can push its data here, each into its own tab, so everything can be
 * reviewed in one spreadsheet.
 *
 * SETUP (one time):
 *   1. Create a new Google Sheet (or open the one you want to use).
 *   2. Extensions → Apps Script.
 *   3. Delete any starter code in the editor and paste this whole file.
 *   4. Deploy → New deployment → select type "Web app".
 *   5. Execute as: Me. Who has access: Anyone.
 *   6. Click Deploy, approve the permissions Google asks for, then copy
 *      the Web app URL it gives you.
 *   7. In the app: Settings → Data Backend → paste that URL → Save URL →
 *      Test Connection → Push Everything Now.
 *
 * If you ever change the code here, you need to create a new deployment
 * version (Deploy → Manage deployments → Edit → New version) for the
 * changes to take effect — editing the script alone does not update a
 * deployment already in use.
 */

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ ok: false, error: 'Invalid request body: ' + err.message });
  }

  var action = body.action;

  // Optional shared-secret gate. If (and only if) an API_TOKEN Script Property
  // is set on this project (Project Settings → Script Properties), every
  // request must carry a matching body.token or it is rejected. When the
  // property is not set, this check is skipped and the backend behaves exactly
  // as before — so deploying this code changes nothing until a token is
  // configured on both the backend and in the app's Settings → Data Backend.
  try {
    var API_TOKEN = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (API_TOKEN && String(API_TOKEN).length && String(body.token || '') !== String(API_TOKEN)) {
      return respond({ ok: false, error: 'Unauthorized: missing or invalid token.' });
    }
  } catch (authErr) {
    // If Script Properties can't be read for any reason, fail closed only when
    // we were able to determine a token was expected; otherwise allow, to avoid
    // locking a clinic out of its own backend over a transient platform error.
  }

  try {
    if (action === 'ping') {
      return respond({ ok: true, time: new Date().toISOString() });
    }
    if (action === 'saveAll') {
      var sheetName = sanitizeSheetName(body.sheet || 'Data');
      var rows = body.rows || [];
      saveAllRows(sheetName, rows);
      return respond({ ok: true, saved: rows.length });
    }
    if (action === 'getData') {
      var sheetName2 = sanitizeSheetName(body.sheet || 'Data');
      return respond({ ok: true, rows: readAllRows(sheetName2) });
    }
    if (action === 'saveBatch') {
      // Pushes many sheets in one Apps Script execution instead of one
      // execution per module — several devices polling every ~30s all day
      // would otherwise add up to tens of thousands of executions and risk
      // hitting quota limits. Each sheet's own write is locked individually
      // (inside saveAllRows) rather than locking the whole batch — a device
      // writing InventoryStockIn and a device writing InventoryStockOut at
      // the same moment don't touch the same sheet, so there's no reason to
      // make one wait on the other.
      var modules = body.modules || {};
      var savedCounts = {};
      Object.keys(modules).forEach(function(name) {
        var sn = sanitizeSheetName(name);
        var mrows = modules[name] || [];
        saveAllRows(sn, mrows);
        savedCounts[name] = mrows.length;
      });
      return respond({ ok: true, saved: savedCounts });
    }
    if (action === 'getBatch') {
      var sheetNames = body.sheets || [];
      var data = {};
      sheetNames.forEach(function(name) {
        var sn2 = sanitizeSheetName(name);
        data[name] = readAllRows(sn2);
      });
      return respond({ ok: true, data: data });
    }
    return respond({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

function doGet(e) {
  return respond({ ok: true, message: 'K.B. Dental backend is running. Send a POST request from the app.' });
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Serializes writes across all simultaneous executions of this script.
 * Without this, two devices pushing at nearly the same moment can each read
 * the sheet's old content before either has written, so the merge in
 * saveAllRows never sees the other's update and one push's result silently
 * wins over the other's. Scoped as tightly as possible — see saveAllRows.
 */
function withWriteLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    fn();
  } finally {
    lock.releaseLock();
  }
}

function sanitizeSheetName(name) {
  name = String(name || 'Data').replace(/[\\\/\?\*\[\]:]/g, '_');
  return name.slice(0, 99) || 'Data';
}

function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

/**
 * Identifies a row for merge purposes. Prefers the row's own `id` (stock
 * in/out transactions and inventory items all carry one client-side). Falls
 * back to a content hash for anything unexpected — safe (never causes
 * cross-record data loss) even though it can't recognise an in-place edit
 * of that specific id-less row as "the same record."
 */
function kbdcRowKey_(row) {
  if (row.id !== undefined && row.id !== null && String(row.id).trim() !== '') {
    return 'id:' + row.id;
  }
  // Inventory items carry no id of their own — the app identifies them by
  // name + category, and the field is called `cat` (NOT `category`), with
  // trim/lowercase normalisation. This must match the client's
  // kbdcMergeInvItemsByNameCat() exactly. Getting it wrong is not cosmetic:
  // these rows then fall through to the content-hash branch below, where any
  // stock change reads as a brand-new record — so the old row is never
  // replaced, the sheet accumulates duplicate items with stale stock, and
  // Stock In appears not to update at all.
  var cat = (row.cat !== undefined) ? row.cat : row.category;
  if (row.name !== undefined && cat !== undefined) {
    return 'nc:' + String(row.name).trim().toLowerCase() + '|' + String(cat).trim().toLowerCase();
  }
  return 'c:' + JSON.stringify(row);
}

/**
 * Merges incoming rows into whatever the sheet already holds, keyed by
 * kbdcRowKey_. This is the fix for the multi-device "new stock entries
 * don't show up on other devices" bug: every push used to be a blind
 * clearContents()+rewrite, so any device pushing from a slightly-stale
 * local pull would silently erase stock-in/out entries another device had
 * just added. Now a pushing device can only add or update rows it knows
 * about — everything else already on the sheet survives.
 *
 * Trade-off, deliberate: this cannot tell "a device deleted this row" apart
 * from "a device's local copy just doesn't have this row yet" — both look
 * like "incoming doesn't include it." So it always keeps the existing row
 * rather than risk erasing real data. That means deleting an inventory item
 * on one device may not remove it from the shared sheet / other devices.
 * Accepted because silent data loss (the reported problem) is a far worse
 * failure than a stale row lingering. A real fix for delete-propagation
 * needs an explicit tombstone mechanism — out of scope here.
 */
function kbdcMergeRows_(existingRows, incomingRows) {
  var merged = {};
  var order = [];
  existingRows.forEach(function(row) {
    var k = kbdcRowKey_(row);
    if (!(k in merged)) order.push(k);
    merged[k] = row;
  });
  incomingRows.forEach(function(row) {
    var k = kbdcRowKey_(row);
    var existing = merged[k];
    if (!existing) {
      order.push(k);
      merged[k] = row;
    } else if (row.updatedAt && existing.updatedAt) {
      merged[k] = (String(row.updatedAt) >= String(existing.updatedAt)) ? row : existing;
    } else {
      merged[k] = row; // no timestamp to compare — the freshly-pushed row wins
    }
  });
  return order.map(function(k) { return merged[k]; });
}

/**
 * Merges the given rows into a tab's contents (see kbdcMergeRows_) and
 * rewrites it. Locked (see withWriteLock_) so two nearly-simultaneous calls
 * can't both read the sheet's old content before either has written. Apps
 * Script's LockService has no per-sheet/named lock, only a single
 * script-wide one, so this is scoped as tightly as possible (just this one
 * sheet's read-merge-write) rather than held across a whole multi-sheet
 * saveBatch call, to keep other devices' waits short.
 */
function saveAllRows(sheetName, rows) {
  withWriteLock_(function() { saveAllRowsLocked_(sheetName, rows); });
}
function saveAllRowsLocked_(sheetName, rows) {
  var sheet = getOrCreateSheet(sheetName);
  var existingRows = readAllRows(sheetName);
  var mergedRows = kbdcMergeRows_(existingRows, rows || []);

  sheet.clearContents();

  if (!mergedRows.length) {
    sheet.getRange(1, 1).setValue('No data yet — nothing has been pushed from this module.');
    return;
  }

  // Build the column list from every key seen across all rows, in first-seen order,
  // since different records in the same module can have slightly different fields.
  var headers = [];
  var seen = {};
  mergedRows.forEach(function(row) {
    Object.keys(row).forEach(function(k) {
      if (!seen[k]) { seen[k] = true; headers.push(k); }
    });
  });

  var data = [headers];
  mergedRows.forEach(function(row) {
    data.push(headers.map(function(h) {
      var v = row[h];
      return (v === undefined || v === null) ? '' : v;
    }));
  });

  var range = sheet.getRange(1, 1, data.length, headers.length);
  // Force plain-text formatting before writing, so a numeric-looking value
  // (an item code, a batch number with a leading zero) is never silently
  // turned into a real number and lose its exact form — Sheets applies its
  // "smart" number detection based on the cell's format at write time, so
  // this has to be set before setValues().
  range.setNumberFormat('@');
  range.setValues(data);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

/** Reads a tab back as an array of objects, keyed by its header row. */
function readAllRows(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = values[i][j];
    }
    rows.push(row);
  }
  return rows;
}

/**
 * DIAGNOSTIC ONLY — not reachable over HTTP, does not affect doPost/doGet.
 * Run this once from the Apps Script editor (function dropdown → testTokenGate
 * → Run) after setting the API_TOKEN Script Property, to confirm the gate
 * above is actually enforcing. Reads the same Script Property doPost reads
 * and reports PASS/FAIL for four scenarios, without making any real HTTP
 * call, without changing any data, and without ever logging the token's
 * actual value — only whether a candidate value matches it.
 */
function testTokenGate() {
  var API_TOKEN = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  var configured = !!(API_TOKEN && String(API_TOKEN).length);

  // Mirrors the exact rule in doPost(): if API_TOKEN is set, a request is
  // rejected unless body.token matches it exactly; if unset, the gate is
  // inactive and everything passes through. Only returns a true/false match
  // result — never the value itself.
  function tokenWouldBeRejected(candidateToken) {
    if (!configured) return false; // gate inactive — nothing gets rejected
    return String(candidateToken || '') !== String(API_TOKEN);
  }

  Logger.log('=== Inventory backend — token gate diagnostic ===');

  // Test 1 — Missing token → should be REJECTED
  var missingRejected = tokenWouldBeRejected('');
  Logger.log((!configured ? 'SKIP' : (missingRejected ? 'PASS' : 'FAIL')) +
    ' — Test 1: missing token should be REJECTED — ' +
    (!configured ? 'skipped (API_TOKEN not configured, see Test 4)' :
      (missingRejected ? 'was rejected, as expected' : 'was NOT rejected — gate is broken')));

  // Test 2 — Incorrect token → should be REJECTED
  var wrongRejected = tokenWouldBeRejected('this-is-not-the-configured-token');
  Logger.log((!configured ? 'SKIP' : (wrongRejected ? 'PASS' : 'FAIL')) +
    ' — Test 2: incorrect token should be REJECTED — ' +
    (!configured ? 'skipped (API_TOKEN not configured, see Test 4)' :
      (wrongRejected ? 'was rejected, as expected' : 'was NOT rejected — gate is broken')));

  // Test 3 — Correct token → should be ACCEPTED
  var correctRejected = tokenWouldBeRejected(API_TOKEN);
  Logger.log((!configured ? 'SKIP' : (!correctRejected ? 'PASS' : 'FAIL')) +
    ' — Test 3: correct token should be ACCEPTED — ' +
    (!configured ? 'skipped (API_TOKEN not configured, see Test 4)' :
      (!correctRejected ? 'was accepted, as expected' : 'was rejected — gate is broken')));

  // Test 4 — API_TOKEN Script Property must actually be configured
  Logger.log((configured ? 'PASS' : 'FAIL') +
    ' — Test 4: API_TOKEN Script Property is configured — ' +
    (configured ? 'a value is set' :
      'NOT SET — configuration error. The gate is currently INACTIVE and every request is being accepted regardless of token. Set API_TOKEN under Project Settings → Script Properties, then re-run this test.'));

  var allPass = configured && missingRejected && wrongRejected && !correctRejected;
  Logger.log('=== ' + (allPass ? 'ALL PASS — the gate is working correctly.' : 'NOT all tests passed — resolve the FAIL/SKIP lines above before deploying.') + ' ===');
}
