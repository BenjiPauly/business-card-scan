/*
 * Business card text parser.
 * Takes raw OCR text, returns a record keyed by the sheet column names.
 * Works in the browser (window.CardParser) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Column order. Must match HEADERS in apps-script/Code.gs (a test checks this).
  var HEADERS = [
    'Scanned At', 'Full Name', 'First Name', 'Last Name', 'Job Title', 'Company',
    'Email', 'Mobile', 'Phone', 'Fax', 'Website', 'LinkedIn', 'Street',
    'Postal Code', 'City', 'Country', 'Notes', 'Raw Text', 'Source',
    'Confidence', 'Card ID'
  ];
  var FIELDS = HEADERS.slice(1); // everything except the server-side timestamp

  var TITLE_RE = new RegExp(
    '\\b(ceo|cto|cfo|coo|cio|cmo|cso|chief|president|vice president|vp|svp|evp|director|' +
    'managing|manager|head of|head|lead|leader|principal|partner|founder|co-founder|cofounder|owner|' +
    'engineer|developer|architect|designer|consultant|advisor|adviser|analyst|specialist|' +
    'officer|executive|representative|associate|sales|business development|marketing|' +
    'account|attorney|lawyer|counsel|professor|researcher|scientist|technician|' +
    'geschaeftsfuehrer|geschäftsführer|leiter|leiterin|leitung|inhaber|inhaberin|berater|beraterin|' +
    'direktor|direktorin|vorstand|vorsitzender|projektleiter|projektleiterin|ingenieur|ingenieurin|' +
    'prokurist|abteilungsleiter|verkauf|vertrieb|gesch\\.?\\s*f\\.?|directeur|directrice|gerant|gérant|' +
    'responsable|ingénieur|ingeniero|gerente|director[a]?)\\b', 'i');

  var LEGAL_RE = /(\b(gmbh|ag|sa|sarl|sas|ltd|limited|llc|llp|inc|corp|corporation|co\.|plc|bv|b\.v\.|nv|n\.v\.|oy|ab|as|a\/s|aps|kg|ug|e\.v\.|ohg|se|spa|s\.p\.a\.|srl|s\.r\.l\.|pty|pte|gmbh & co\. kg|kft|sp\. z o\.o\.)(\s|$|[.,])|\bgroup\b|\bholding\b|\btechnologies\b|\bsystems\b|\bsolutions\b|\bindustries\b|\blabs?\b|\bstudio\b)/i;

  var PARTICLES = { von: 1, van: 1, de: 1, der: 1, den: 1, di: 1, da: 1, zu: 1, le: 1, la: 1, del: 1, bin: 1, al: 1, dos: 1, du: 1, ten: 1, ter: 1 };
  var HONORIFIC_RE = /^(dr|prof|mr|mrs|ms|mag|dipl|ing|eng|herr|frau|mba|phd|msc|bsc|dr\.-ing|ra|rae)\.?$/i;

  var COUNTRIES = {
    'switzerland': 'Switzerland', 'schweiz': 'Switzerland', 'suisse': 'Switzerland', 'svizzera': 'Switzerland',
    'germany': 'Germany', 'deutschland': 'Germany', 'austria': 'Austria', 'österreich': 'Austria', 'oesterreich': 'Austria',
    'france': 'France', 'italy': 'Italy', 'italia': 'Italy', 'united kingdom': 'United Kingdom', 'uk': 'United Kingdom',
    'great britain': 'United Kingdom', 'england': 'United Kingdom', 'usa': 'United States', 'u.s.a.': 'United States',
    'united states': 'United States', 'united states of america': 'United States', 'netherlands': 'Netherlands',
    'nederland': 'Netherlands', 'belgium': 'Belgium', 'belgique': 'Belgium', 'spain': 'Spain', 'españa': 'Spain',
    'sweden': 'Sweden', 'sverige': 'Sweden', 'finland': 'Finland', 'suomi': 'Finland', 'norway': 'Norway', 'norge': 'Norway',
    'denmark': 'Denmark', 'danmark': 'Denmark', 'poland': 'Poland', 'polska': 'Poland', 'ukraine': 'Ukraine',
    'taiwan': 'Taiwan', 'singapore': 'Singapore', 'uae': 'United Arab Emirates', 'united arab emirates': 'United Arab Emirates',
    'liechtenstein': 'Liechtenstein', 'luxembourg': 'Luxembourg', 'canada': 'Canada', 'australia': 'Australia',
    'japan': 'Japan', 'india': 'India', 'israel': 'Israel', 'czech republic': 'Czech Republic', 'portugal': 'Portugal',
    'ireland': 'Ireland', 'greece': 'Greece', 'turkey': 'Turkey', 'türkiye': 'Turkey', 'estonia': 'Estonia',
    'latvia': 'Latvia', 'lithuania': 'Lithuania', 'romania': 'Romania', 'hungary': 'Hungary'
  };
  var COUNTRY_PREFIX = {
    CH: 'Switzerland', D: 'Germany', DE: 'Germany', A: 'Austria', AT: 'Austria', F: 'France', FR: 'France',
    I: 'Italy', IT: 'Italy', NL: 'Netherlands', B: 'Belgium', BE: 'Belgium', L: 'Luxembourg', LU: 'Luxembourg',
    FL: 'Liechtenstein', LI: 'Liechtenstein', GB: 'United Kingdom', UK: 'United Kingdom', E: 'Spain', ES: 'Spain',
    S: 'Sweden', SE: 'Sweden', FI: 'Finland', N: 'Norway', NO: 'Norway', DK: 'Denmark', PL: 'Poland'
  };

  var GLUED_STREET = /(str\.|strasse|straße|weg|platz|allee|gasse|damm|ufer|chaussee)\s*\d/i;
  var WORD_STREET = /\b(road|rd|street|st|avenue|ave|lane|ln|boulevard|blvd|drive|way|rue|via|calle|plaza|quai|strada|place|court|suite|floor|po box|p\.o\. box|postfach|case postale)\b\.?/i;

  var TLDS = 'com|net|org|info|biz|eu|ch|de|at|nl|be|fr|it|es|se|no|fi|dk|pl|uk|co|io|ai|us|tech|app|dev|aero|tw|sg|jp|ca|au';
  // The last dot is often read as a space or comma ("name@firm com"), so that is accepted too.
  var EMAIL_RE = new RegExp('(?:\\b(?:e-?mail|mail|e)\\s*[:.]?\\s*)?([A-Z0-9._%+\\-]+@[A-Z0-9\\-]+(?:\\.[A-Z0-9\\-]+)*(?:\\.[A-Z]{2,}|[ ,](?:' + TLDS + ')\\b))', 'gi');
  // Anything starting with http(s):// or www. is a URL; bare domains need a well-known TLD.
  var URL_RE = /(?:\b(?:web|url|w|site)\s*[:.]\s*)?((?:https?:\/\/|www\.)[a-z0-9\-._~%\/?#=&+:]+[a-z0-9\/]|(?:[a-z0-9][a-z0-9\-]*\.)+(?:com|ch|de|at|io|net|org|eu|co|uk|ai|fr|it|es|nl|se|no|fi|dk|us|info|biz|tech|app|dev|aero|defense|swiss|pl|ua|tw|sg|jp|ca|au)\b(?:\/[^\s,;]*)?)/gi;
  var PHONE_RE = /(?:\b(tel(?:ephone|efon)?|phone|ph|mobile|mob|mobil|cell|handy|fax|mo|m|t|f|p|o|d|direct|office|dw)\b\.?\s*[:.\-]?\s*)?((?:\+|00)?\(?\d[\d\s().\-\/]{5,}\d)/gi;

  function ascii(s) {
    return String(s).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  }
  function asciiPlain(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
  }
  function letters(s) { return (String(s).match(/[\p{L}]/gu) || []).length; }
  function alnum(s) { return (String(s).match(/[\p{L}\p{N}]/gu) || []).length; }
  function tidy(s) { return String(s).replace(/\s+/g, ' ').replace(/^[\s,;:|\-•·]+|[\s,;:|\-•·]+$/g, '').trim(); }

  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function prepare(raw) {
    var lines = String(raw || '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]/g, ' ')
      .replace(/[|¦]/g, ' ')
      .replace(/[“”„]/g, '"')
      .split('\n')
      .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
      .filter(function (l) { return alnum(l) >= 2; });
    return lines.map(function (t) { return { text: t, used: false }; });
  }

  function consume(line) {
    line.text = tidy(line.text);
    if (alnum(line.text) < 2) line.used = true;
  }

  function cleanPhone(p) {
    var s = p.replace(/\(0\)/g, ' ').replace(/^00/, '+').replace(/[^\d+\s\-\/]/g, ' ');
    s = s.replace(/\s*[\/]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return s;
  }
  function looksMobile(p) {
    var d = p.replace(/[^\d+]/g, '');
    return /^\+417[5-9]/.test(d) || /^\+491[567]/.test(d) || /^\+447/.test(d) || /^\+436[4-9]/.test(d) ||
      /^\+3376|^\+3366|^\+3367/.test(d) || /^\+3906|^\+393/.test(d) || /^\+316/.test(d) || /^\+3706|^\+3584|^\+3585|^\+467/.test(d) ||
      /^07[5-9]|^015|^016|^017/.test(d);
  }

  function splitName(full) {
    var tokens = full.split(' ').filter(Boolean);
    while (tokens.length > 1 && HONORIFIC_RE.test(tokens[0])) tokens.shift();
    while (tokens.length > 1 && HONORIFIC_RE.test(tokens[tokens.length - 1])) tokens.pop();
    if (tokens.length === 0) return { first: '', last: '' };
    if (tokens.length === 1) return { first: '', last: tokens[0] };
    var lastStart = tokens.length - 1;
    while (lastStart > 1 && PARTICLES[tokens[lastStart - 1].toLowerCase()]) lastStart--;
    return { first: tokens.slice(0, lastStart).join(' '), last: tokens.slice(lastStart).join(' ') };
  }

  // Card icons (pin, phone) are often read as a lone digit or symbol at the line start or end.
  function cleanStreet(t) {
    var s = t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.]+$/u, '');
    var rest = s.replace(/^\d\s+(?=\p{L})/u, '');
    if (rest !== s && /\d/.test(rest)) s = rest; // keep real "5 Main Street"? only when a number remains elsewhere
    return tidy(s);
  }

  function nameCandidate(text) {
    if (/[\d@]/.test(text) || text.length > 45) return null;
    var t = text.replace(/,\s*(mba|phd|msc|bsc|dipl\.?.*)$/i, '');
    var comma = t.match(/^([\p{Lu}][\p{L}'’\-]+),\s*([\p{Lu}][\p{L}'’\- ]+)$/u);
    if (comma) t = comma[2] + ' ' + comma[1];
    var tokens = t.split(' ').filter(Boolean);
    if (tokens.length < 2 || tokens.length > 5) return null;
    var okCount = 0;
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (/^[\p{Lu}][\p{L}'’\-\.]*$/u.test(tk) || PARTICLES[tk.toLowerCase()] || HONORIFIC_RE.test(tk)) okCount++;
      else if (/^[\p{Lu}]\.$/u.test(tk)) okCount++;
      else return null;
    }
    var core = tokens.filter(function (x) { return !HONORIFIC_RE.test(x) && !PARTICLES[x.toLowerCase()]; });
    if (core.length < 2) return null;
    return t;
  }

  // Common OCR slips in titles, e.g. "Chief" read as "Chi of" or "Chi ef".
  function fixTitle(t) {
    return t.replace(/\bchi\s?(?:of|ef|ei|et|cf|ee)\b/i, function (m) { return m.charAt(0) === 'C' ? 'Chief' : 'chief'; })
      .replace(/\bexecutive\s+offlcer\b/i, 'Executive Officer');
  }

  function parse(rawText) {
    var lines = prepare(rawText);
    var out = {};
    FIELDS.forEach(function (f) { out[f] = ''; });
    out['Raw Text'] = String(rawText || '').trim();
    var notes = [];

    // 1) Emails
    var emails = [];
    lines.forEach(function (ln) {
      ln.text = ln.text.replace(EMAIL_RE, function (m, addr) { emails.push(addr.toLowerCase().replace(/[ ,](?=[a-z]+$)/, '.').replace(/\s+/g, '')); return ' '; });
      consume(ln);
    });
    if (emails.length) out['Email'] = emails[0];
    if (emails.length > 1) notes.push('Other emails: ' + emails.slice(1).join(', '));

    // 2) URLs (after emails are gone, so email domains are not mistaken for websites)
    var site = '', linkedin = '';
    lines.forEach(function (ln) {
      ln.text = ln.text.replace(URL_RE, function (m, u) {
        var url = /^https?:\/\//i.test(u) ? u : 'https://' + u;
        if (/linkedin\.com/i.test(u)) { if (!linkedin) linkedin = url; }
        else if (!site) site = url;
        return ' ';
      });
      consume(ln);
    });
    out['Website'] = site;
    out['LinkedIn'] = linkedin;

    // 3) Phones
    var extraPhones = [];
    lines.forEach(function (ln) {
      ln.text = ln.text.replace(PHONE_RE, function (m, label, num) {
        var digits = num.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) return m;
        var phone = cleanPhone(num);
        var lab = (label || '').toLowerCase();
        var slot;
        if (/^(fax|f)$/.test(lab)) slot = 'Fax';
        else if (/^(m|mo|mob|mobil|mobile|cell|handy)$/.test(lab)) slot = 'Mobile';
        else if (!lab && looksMobile(phone)) slot = 'Mobile';
        else slot = 'Phone';
        if (!out[slot]) out[slot] = phone;
        else if (slot === 'Phone' && !out['Mobile'] && looksMobile(phone)) out['Mobile'] = phone;
        else extraPhones.push(phone);
        return ' ';
      });
      consume(ln);
    });
    if (extraPhones.length) notes.push('Other phones: ' + extraPhones.join(', '));

    // 4) Address: postal code + city, country, street
    lines.forEach(function (ln) {
      if (ln.used) return;
      var t = ln.text;
      var low = t.toLowerCase().replace(/[.,]$/, '');
      if (COUNTRIES[low]) { if (!out['Country']) out['Country'] = COUNTRIES[low]; ln.used = true; return; }

      var us = t.match(/([\p{Lu}][\p{L}\. ]+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b(.*)$/u);
      if (us && !out['City']) {
        out['City'] = us[1].trim() + ', ' + us[2]; out['Postal Code'] = us[3];
        if (/usa|united states/i.test(us[4])) out['Country'] = 'United States';
        ln.used = true; return;
      }
      var nl = t.match(/\b(\d{4})\s?([A-Z]{2})\s+([\p{Lu}][\p{L}\-' ]{1,40})$/u);
      if (nl && !out['Postal Code']) {
        out['Postal Code'] = nl[1] + ' ' + nl[2];
        out['City'] = tidy(nl[3].replace(/\s+\p{Ll}$/u, '')); out['Country'] = out['Country'] || 'Netherlands';
        ln.used = true; return;
      }
      var m = t.match(/(?:\b([A-Z]{1,2})\s*[-–]\s*)?\b(\d{4,5})\s+([\p{Lu}][\p{L}\-\.' ]{1,40}?)(?:\s*[,;]\s*(.+))?$/u);
      if (m && !out['Postal Code']) {
        out['Postal Code'] = m[2];
        out['City'] = tidy(m[3].replace(/\s+\p{Ll}$/u, ''));
        if (m[1] && COUNTRY_PREFIX[m[1]]) out['Country'] = COUNTRY_PREFIX[m[1]];
        if (m[4]) {
          var c = COUNTRIES[m[4].toLowerCase().replace(/[.,]$/, '')];
          if (c) out['Country'] = c;
        }
        // Prefix before the postal code on the same line may be a street
        var before = t.slice(0, m.index).replace(/[,;\s]+$/, '');
        if (before && !out['Street'] && /\d/.test(before)) out['Street'] = tidy(before);
        ln.used = true; return;
      }
      var uk = t.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
      if (uk && !out['Postal Code']) {
        out['Postal Code'] = uk[1]; out['City'] = tidy(t.replace(uk[1], ''));
        out['Country'] = out['Country'] || 'United Kingdom';
        ln.used = true; return;
      }
    });
    lines.forEach(function (ln) {
      if (ln.used || out['Street']) return;
      var t = ln.text;
      if (/\d/.test(t) && (GLUED_STREET.test(t) || WORD_STREET.test(t) || /^\d{1,4}\s+\p{L}/u.test(t))) {
        // Do not mistake a title line like "Head of Sales 2" for a street
        if (TITLE_RE.test(t) && !GLUED_STREET.test(t) && !WORD_STREET.test(t)) return;
        out['Street'] = cleanStreet(t); ln.used = true;
      }
    });

    // 5) Job title
    var titleParts = [];
    lines.forEach(function (ln) {
      if (ln.used) return;
      if (TITLE_RE.test(ln.text) && ln.text.length <= 70 && !/\d/.test(ln.text)) {
        // Allow two stacked title lines (e.g. "Head of" / "Business Development")
        titleParts.push(ln.text); ln.used = true;
      }
    });
    if (titleParts.length) out['Job Title'] = fixTitle(titleParts.slice(0, 2).join(', '));
    if (titleParts.length > 2) notes.push('More titles: ' + titleParts.slice(2).join(', '));

    // 6) Name
    var emailLocal = out['Email'] ? out['Email'].split('@')[0] : '';
    var localParts = emailLocal.split(/[._\-]/).filter(function (p) { return p.length > 1; }).map(asciiPlain);
    var bestName = null, bestScore = -1e9;
    lines.forEach(function (ln, idx) {
      if (ln.used) return;
      var cand = nameCandidate(ln.text);
      if (!cand) return;
      var score = 10 - idx * 1.5;
      if (LEGAL_RE.test(ln.text)) score -= 40;
      var a = ascii(cand), b = asciiPlain(cand);
      var hits = localParts.filter(function (p) { return p && (a.indexOf(p) >= 0 || b.indexOf(p) >= 0); }).length;
      if (localParts.length && hits) score += 12 * hits;
      if (emailLocal && localParts.length === 0 && (a.indexOf(asciiPlain(emailLocal)) >= 0)) score += 10;
      var tokens = cand.split(' ');
      if (tokens.length === 2 || tokens.length === 3) score += 4;
      if (score > bestScore) { bestScore = score; bestName = { line: ln, text: cand }; }
    });
    if (bestName) {
      var nm = bestName.text;
      var hy = emailLocal.match(/^([a-z]+)-([a-z]+)(?:[._]|$)/i);
      var firstTok = nm.split(' ')[0];
      if (hy && asciiPlain(firstTok) === asciiPlain(hy[2]) && nm.split(' ').length >= 2) {
        nm = hy[1].charAt(0).toUpperCase() + hy[1].slice(1).toLowerCase() + '-' + nm;
      }
      out['Full Name'] = nm;
      var sp = splitName(nm);
      out['First Name'] = sp.first; out['Last Name'] = sp.last;
      bestName.line.used = true;
    }

    // 7) Company
    var company = '';
    var companyLine = null;
    lines.forEach(function (ln) {
      if (company || ln.used) return;
      if (LEGAL_RE.test(ln.text) && ln.text.length <= 60) { company = ln.text; companyLine = ln; }
    });
    if (!company && out['Email']) {
      var domain = out['Email'].split('@')[1] || '';
      var label = asciiPlain(domain.split('.')[0].replace(/^(mail|info|web)$/, ''));
      if (label.length >= 3) {
        lines.forEach(function (ln) {
          if (company || ln.used) return;
          var a = asciiPlain(ln.text);
          if (a.length >= 3 && (a.indexOf(label) >= 0 || label.indexOf(a) >= 0)) { company = ln.text; companyLine = ln; }
        });
      }
    }
    if (!company) {
      lines.forEach(function (ln) {
        if (company || ln.used) return;
        if (letters(ln.text) >= 3 && ln.text.length <= 50 && !/[@]/.test(ln.text)) { company = ln.text; companyLine = ln; }
      });
    }
    if (company) { out['Company'] = tidy(company); companyLine.used = true; }

    // 8) Leftovers become notes
    lines.forEach(function (ln) { if (!ln.used && alnum(ln.text) >= 3) notes.push(ln.text); });
    out['Notes'] = notes.join(' | ');

    // 9) Confidence and de-duplication key
    var conf = 0;
    if (out['Full Name']) conf += 0.3;
    if (out['Email']) conf += 0.25;
    if (out['Mobile'] || out['Phone']) conf += 0.2;
    if (out['Company']) conf += 0.15;
    if (out['Job Title']) conf += 0.1;
    out['Confidence'] = Math.round(conf * 100) / 100;

    var key = out['Email'] || (out['Mobile'] || out['Phone']).replace(/\D/g, '') ||
      asciiPlain(out['Full Name'] + out['Company']);
    out['Card ID'] = key ? hash(String(key).toLowerCase()) : '';
    return out;
  }

  return { HEADERS: HEADERS, FIELDS: FIELDS, parse: parse, hash: hash };
});
