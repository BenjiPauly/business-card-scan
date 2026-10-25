/**
 * Business Card Scanner: Google Sheets backend and macros.
 *
 * Install: open the sheet > Extensions > Apps Script > paste this file > Save.
 * Run setupSheet() once, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone). Copy the Web app URL into the scanner app.
 * Optional: Project Settings > Script properties > add TOKEN to require a shared secret.
 */

var SHEET_NAME = 'Cards';

// Keep identical to HEADERS in public/parser.js (npm test checks this).
var HEADERS = [
  'Scanned At', 'Full Name', 'First Name', 'Last Name', 'Job Title', 'Company',
  'Email', 'Mobile', 'Phone', 'Fax', 'Website', 'LinkedIn', 'Street',
  'Postal Code', 'City', 'Country', 'Notes', 'Raw Text', 'Source',
  'Confidence', 'Card ID'
];
var KEY_HEADER = 'Card ID';

/* ---------- Web endpoint ---------- */

function doGet() {
  return json_({ ok: true, status: 'ready', sheet: SHEET_NAME });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (expected && body.token !== expected) return json_({ ok: false, error: 'Invalid token' });
    if (!body.record) return json_({ ok: false, error: 'Missing record' });
    var result = saveCard_(body.record);
    return json_({ ok: true, action: result.action, row: result.row });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* not held */ }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Core: insert or update a card ---------- */

function saveCard_(record) {
  var sheet = getSheet_();
  var keyCol = HEADERS.indexOf(KEY_HEADER);
  var row = HEADERS.map(function (h) {
    if (h === 'Scanned At') return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    var v = record[h];
    return v === undefined || v === null ? '' : String(v);
  });

  var existingRow = 0;
  var key = row[keyCol];
  var last = sheet.getLastRow();
  if (key && last > 1) {
    var keys = sheet.getRange(2, keyCol + 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === key) { existingRow = i + 2; break; }
    }
  }

  var target = existingRow || last + 1;
  var range = sheet.getRange(target, 1, 1, HEADERS.length);
  range.setNumberFormat('@'); // plain text: keeps +41 numbers and leading zeros, blocks formulas
  range.setValues([row]);
  return { action: existingRow ? 'updated' : 'added', row: target };
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    var sheets = ss.getSheets();
    // Reuse the first sheet if it is still empty, otherwise add a new one.
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      sheet = sheets[0];
      sheet.setName(SHEET_NAME);
    } else {
      sheet = ss.insertSheet(SHEET_NAME);
    }
  }
  if (sheet.getLastRow() === 0) writeHeader_(sheet);
  return sheet;
}

function writeHeader_(sheet) {
  var r = sheet.getRange(1, 1, 1, HEADERS.length);
  r.setValues([HEADERS]);
  r.setFontWeight('bold');
  r.setBackground('#1f3a5f');
  r.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

/* ---------- Macros (run from the Card Scanner menu) ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Card Scanner')
    .addItem('Set up sheet', 'setupSheet')
    .addItem('Add test card', 'addTestCard')
    .addSeparator()
    .addItem('Remove duplicates', 'removeDuplicates')
    .addItem('Sort by company', 'sortByCompany')
    .addItem('Highlight low confidence', 'highlightLowConfidence')
    .addToUi();
}

/** Creates the header row, formatting, filter and column widths. Safe to run again. */
function setupSheet() {
  var sheet = getSheet_();
  var n = HEADERS.length;
  writeHeader_(sheet);
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), n).setNumberFormat('@');
  if (!sheet.getFilter()) sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), n).createFilter();
  var widths = { 'Scanned At': 140, 'Full Name': 170, 'Job Title': 200, 'Company': 180, 'Email': 220,
    'Mobile': 130, 'Phone': 130, 'Website': 180, 'Notes': 200, 'Raw Text': 260 };
  HEADERS.forEach(function (h, i) { sheet.setColumnWidth(i + 1, widths[h] || 110); });
  sheet.getRange(1, HEADERS.indexOf('Raw Text') + 1, sheet.getMaxRows(), 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  return 'Sheet ready';
}

/** Writes one fake card through the same path the web app uses. */
function addTestCard() {
  var res = saveCard_({
    'Full Name': 'Dr. Anna Mueller', 'First Name': 'Anna', 'Last Name': 'Mueller',
    'Job Title': 'Head of Business Development', 'Company': 'Northwind Aerospace AG',
    'Email': 'anna.mueller@northwind-aero.example', 'Mobile': '+41 79 123 45 67',
    'Phone': '+41 41 123 45 00', 'Website': 'https://www.northwind-aero.example',
    'Street': 'Bahnhofstrasse 21', 'Postal Code': '6340', 'City': 'Baar', 'Country': 'Switzerland',
    'Source': 'test', 'Confidence': 1, 'Card ID': 'test0001'
  });
  return res;
}

/** Keeps the first row per Card ID and deletes later duplicates. */
function removeDuplicates() {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 3) return 0;
  var keyCol = HEADERS.indexOf(KEY_HEADER) + 1;
  var keys = sheet.getRange(2, keyCol, last - 1, 1).getValues();
  var seen = {};
  var del = [];
  for (var i = 0; i < keys.length; i++) {
    var k = String(keys[i][0]);
    if (!k) continue;
    if (seen[k]) del.push(i + 2); else seen[k] = true;
  }
  for (var j = del.length - 1; j >= 0; j--) sheet.deleteRow(del[j]);
  return del.length;
}

function sortByCompany() {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 3) return;
  sheet.getRange(2, 1, last - 1, HEADERS.length).sort({ column: HEADERS.indexOf('Company') + 1, ascending: true });
}

/** Marks rows where parsing was unsure (confidence below 0.6) so you can review them. */
function highlightLowConfidence() {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return;
  var col = HEADERS.indexOf('Confidence') + 1;
  var vals = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var low = parseFloat(vals[i][0]) < 0.6;
    sheet.getRange(i + 2, 1, 1, HEADERS.length).setBackground(low ? '#fff3cd' : null);
  }
}
