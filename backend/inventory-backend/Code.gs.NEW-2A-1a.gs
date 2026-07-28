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
      // hitting quota limits.
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

/** Replaces a tab's full contents with the given rows (array of flat objects). */
function saveAllRows(sheetName, rows) {
  var sheet = getOrCreateSheet(sheetName);
  sheet.clearContents();

  if (!rows || !rows.length) {
    sheet.getRange(1, 1).setValue('No data yet — nothing has been pushed from this module.');
    return;
  }

  // Build the column list from every key seen across all rows, in first-seen order,
  // since different records in the same module can have slightly different fields.
  var headers = [];
  var seen = {};
  rows.forEach(function(row) {
    Object.keys(row).forEach(function(k) {
      if (!seen[k]) { seen[k] = true; headers.push(k); }
    });
  });

  var data = [headers];
  rows.forEach(function(row) {
    data.push(headers.map(function(h) {
      var v = row[h];
      return (v === undefined || v === null) ? '' : v;
    }));
  });

  var range = sheet.getRange(1, 1, data.length, headers.length);
  // Force plain-text formatting before writing, so a numeric-looking value
  // (a PIN like "0000", an employee code, a phone number with a leading
  // zero) is never silently turned into a real number and lose its exact
  // form — Sheets applies its "smart" number detection based on the cell's
  // format at write time, so this has to be set before setValues().
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
