/*
 * End-to-end test.
 *   1. OCR the sample card image with the Tesseract CLI
 *   2. Parse the text into sheet fields
 *   3. Run apps-script/Code.gs against an in-memory fake spreadsheet (add, then update)
 *   4. Optional: if SHEET_URL is set, also POST the card to the real deployed web app
 *
 * Usage: node test/run-test.js            (or: npm test)
 *        SHEET_URL=https://script.google.com/macros/s/XXXX/exec [SHEET_TOKEN=...] node test/run-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const assert = require('assert');

const root = path.join(__dirname, '..');
const Parser = require(path.join(root, 'public', 'parser.js'));
let failures = 0;
function check(name, fn) {
  try { fn(); console.log('PASS  ' + name); } catch (e) { failures++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

/* ---- 0. Headers must match between the parser and the Apps Script ---- */
const gs = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');
check('Code.gs HEADERS match parser HEADERS', () => {
  const m = gs.match(/var HEADERS = \[([\s\S]*?)\];/);
  const gsHeaders = m[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepStrictEqual(gsHeaders, Parser.HEADERS);
});

/* ---- 1. OCR ---- */
const img = path.join(__dirname, 'sample-card.png');
if (!fs.existsSync(img)) execFileSync('python3', [path.join(__dirname, 'make-sample-card.py')], { stdio: 'inherit' });
let text = '';
check('OCR reads the sample card image', () => {
  text = execFileSync('tesseract', [img, 'stdout', '-l', 'eng', '--psm', '3'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.ok(/northwind/i.test(text), 'OCR text did not contain the company');
});
console.log('\n--- OCR text ---\n' + text.trim() + '\n----------------\n');

/* ---- 2. Parse ---- */
const rec = Parser.parse(text);
rec['Source'] = 'test';
console.log('Parsed record:');
Parser.FIELDS.filter(f => f !== 'Raw Text').forEach(f => console.log('  ' + f.padEnd(12) + ' ' + rec[f]));
console.log('');
check('Parser: name', () => assert.ok(/anna/i.test(rec['Full Name']) && /m(ü|u|ue)ller/i.test(rec['Full Name']), rec['Full Name']));
check('Parser: first and last name', () => { assert.strictEqual(rec['First Name'], 'Anna'); assert.ok(/^M(ü|u|ue)ller$/i.test(rec['Last Name'])); });
check('Parser: job title', () => assert.ok(/head of business development/i.test(rec['Job Title']), rec['Job Title']));
check('Parser: company', () => assert.ok(/northwind aerospace ag/i.test(rec['Company']), rec['Company']));
check('Parser: email', () => assert.strictEqual(rec['Email'], 'anna.mueller@northwind-aero.example'));
check('Parser: mobile', () => assert.strictEqual(rec['Mobile'].replace(/\s/g, ''), '+41791234567'));
check('Parser: phone', () => assert.strictEqual(rec['Phone'].replace(/\s/g, ''), '+41411234500'));
check('Parser: website', () => assert.ok(/northwind-aero\.example/.test(rec['Website']), rec['Website']));
check('Parser: address', () => {
  assert.ok(/bahnhofstr/i.test(rec['Street']), rec['Street']);
  assert.strictEqual(rec['Postal Code'], '6340');
  assert.strictEqual(rec['City'], 'Baar');
  assert.strictEqual(rec['Country'], 'Switzerland');
});

/* ---- 2b. Extra parser cases (no OCR, fixed text) ---- */
check('Parser: German card with comma name and Straße', () => {
  const r = Parser.parse('Müller GmbH\nMustermann, Max\nGeschäftsführer\nTel: +49 (0)89 123456-0\nMobil: 0171 2345678\nmax.mustermann@mueller-gmbh.de\nMusterstraße 5\n80331 München\nDeutschland');
  assert.strictEqual(r['Full Name'], 'Max Mustermann');
  assert.strictEqual(r['Company'], 'Müller GmbH');
  assert.ok(/geschäftsführer/i.test(r['Job Title']));
  assert.ok(/171/.test(r['Mobile']));
  assert.strictEqual(r['Postal Code'], '80331');
  assert.strictEqual(r['City'], 'München');
  assert.strictEqual(r['Country'], 'Germany');
});
check('Parser: US card with state and ZIP', () => {
  const r = Parser.parse('Jane Q. Doe\nVP of Sales\nAcme Inc.\n(512) 555-0134\njane@acme.com\nacme.com\n100 Congress Ave\nAustin, TX 78701');
  assert.strictEqual(r['Email'], 'jane@acme.com');
  assert.strictEqual(r['Company'], 'Acme Inc.');
  assert.strictEqual(r['City'], 'Austin, TX');
  assert.strictEqual(r['Postal Code'], '78701');
  assert.ok(/acme\.com/.test(r['Website']));
});
check('Parser: card with only an email and a name', () => {
  const r = Parser.parse('Luca Rossi\nluca.rossi@example.it');
  assert.strictEqual(r['Full Name'], 'Luca Rossi');
  assert.ok(r['Card ID']);
});
check('Parser: email with OCR space instead of dot is an email, not a street', () => {
  const r = Parser.parse('Jan Kakebeeke\n4 Klaas-jan@beephonix com\n9 Hazenkampseweg 95 &\n6531 ND Nijmegen d');
  assert.strictEqual(r['Email'], 'klaas-jan@beephonix.com');
  assert.strictEqual(r['Street'], 'Hazenkampseweg 95');
  assert.ok(!/@/.test(r['Street']), 'street contains @');
});
check('Parser: Dutch postcode, trailing junk and country', () => {
  const r = Parser.parse('9 Hazenkampseweg 95 &\n6531 ND Nijmegen d');
  assert.strictEqual(r['Postal Code'], '6531 ND');
  assert.strictEqual(r['City'], 'Nijmegen');
  assert.strictEqual(r['Country'], 'Netherlands');
});
check('Parser: "Chi of executive officer" becomes Chief executive officer', () => {
  const r = Parser.parse('Jan Kakebeeke\nChi of executive officer\nklaas-jan@beephonix.com');
  assert.strictEqual(r['Job Title'], 'Chief executive officer');
});
check('Parser: correct "Chief Executive Officer" stays unchanged', () => {
  const r = Parser.parse('Jan Kakebeeke\nChief Executive Officer\nklaas-jan@beephonix.com');
  assert.strictEqual(r['Job Title'], 'Chief Executive Officer');
});
check('Parser: dropped first name part is restored from a hyphenated email', () => {
  const r = Parser.parse('Jan Kakebeeke\nklaas-jan@beephonix.com');
  assert.strictEqual(r['Full Name'], 'Klaas-Jan Kakebeeke');
  assert.strictEqual(r['Last Name'], 'Kakebeeke');
});
check('Parser: normal email with dot is unaffected', () => {
  const r = Parser.parse('Anna Meier\nanna.meier@firma.ch\nTel +41 44 123 45 67');
  assert.strictEqual(r['Email'], 'anna.meier@firma.ch');
});
check('Parser: garbage text does not throw', () => {
  const r = Parser.parse('~~ ## !! \n 12 \n');
  assert.strictEqual(r['Full Name'], '');
});

/* ---- 3. Apps Script against a fake spreadsheet ---- */
function makeFakeSheet() {
  const grid = []; // grid[row-1][col-1]
  const sheet = {
    name: 'Sheet1', frozen: 0, formats: {},
    setName(n) { this.name = n; },
    getLastRow() { let last = 0; grid.forEach((r, i) => { if (r && r.some(v => v !== '' && v !== undefined)) last = i + 1; }); return last; },
    getMaxRows() { return 1000; },
    setFrozenRows(n) { this.frozen = n; },
    getFilter() { return this._filter; },
    setColumnWidth() {},
    deleteRow(n) { grid.splice(n - 1, 1); },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((grid[r - 1 + i] || [])[c - 1 + j]) ?? ''); out.push(row); } return out; },
        setValues(vals) { vals.forEach((row, i) => { grid[r - 1 + i] = grid[r - 1 + i] || []; row.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; }); }); return rng; },
        setNumberFormat(f) { sheet.formats[r + ':' + c] = f; return rng; },
        createFilter() { sheet._filter = {}; return rng; },
        sort() { return rng; },
      };
      return new Proxy(rng, { get(t, p) { return p in t ? t[p] : () => rng; } }); // other formatting calls are no-ops
    },
  };
  return { sheet, grid };
}
const fake = makeFakeSheet();
const sandbox = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: n => (fake.sheet.name === n ? fake.sheet : null), getSheets: () => [fake.sheet], insertSheet: () => fake.sheet }),
    WrapStrategy: { CLIP: 'CLIP' },
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }),
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return s; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'TOKEN' ? 'secret123' : null) }) },
  Utilities: { formatDate: () => '2026-10-25 17:30:00' },
  Session: { getScriptTimeZone: () => 'Europe/Zurich' },
  console,
};
vm.createContext(sandbox);
vm.runInContext(gs, sandbox);
const post = (obj) => JSON.parse(vm.runInContext('doPost', sandbox)({ postData: { contents: JSON.stringify(obj) } }).getContent());

check('Apps Script: setupSheet writes the header row', () => {
  vm.runInContext('setupSheet', sandbox)();
  assert.deepStrictEqual(fake.grid[0], Parser.HEADERS);
  assert.strictEqual(fake.sheet.name, 'Cards');
});
check('Apps Script: wrong token is rejected', () => {
  const r = post({ token: 'nope', record: rec });
  assert.strictEqual(r.ok, false);
});
check('Apps Script: card is added as a new row', () => {
  const r = post({ token: 'secret123', record: rec });
  assert.deepStrictEqual([r.ok, r.action, r.row], [true, 'added', 2]);
  const row = fake.grid[1];
  assert.strictEqual(row[0], '2026-10-25 17:30:00');
  assert.strictEqual(row[Parser.HEADERS.indexOf('Email')], 'anna.mueller@northwind-aero.example');
  assert.strictEqual(row[Parser.HEADERS.indexOf('Company')], rec['Company']);
  assert.strictEqual(fake.sheet.formats['2:1'], '@');
});
check('Apps Script: same card again updates the row, no duplicate', () => {
  const r = post({ token: 'secret123', record: Object.assign({}, rec, { 'Job Title': 'CEO' }) });
  assert.deepStrictEqual([r.ok, r.action, r.row], [true, 'updated', 2]);
  assert.strictEqual(fake.sheet.getLastRow(), 2);
  assert.strictEqual(fake.grid[1][Parser.HEADERS.indexOf('Job Title')], 'CEO');
});
check('Apps Script: a formula-like value is stored as text', () => {
  const r = post({ token: 'secret123', record: Object.assign({}, rec, { 'Full Name': '=1+1', 'Card ID': 'zzz' }) });
  assert.strictEqual(r.row, 3);
  assert.strictEqual(fake.grid[2][1], '=1+1');
  assert.strictEqual(fake.sheet.formats['3:1'], '@');
});

/* ---- 4. Optional: the real Google Sheet ---- */
(async () => {
  if (process.env.SHEET_URL) {
    try {
      const resp = await fetch(process.env.SHEET_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: process.env.SHEET_TOKEN || '', record: rec }) });
      const j = await resp.json();
      console.log('Live sheet response:', JSON.stringify(j));
      check('Live sheet accepted the card', () => assert.strictEqual(j.ok, true));
    } catch (e) { check('Live sheet reachable', () => { throw e; }); }
  } else {
    console.log('(Live sheet test skipped. Set SHEET_URL to the deployed web app URL to run it.)');
  }
  console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
  process.exit(failures ? 1 : 0);
})();
