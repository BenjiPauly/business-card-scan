(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var P = window.CardParser;

  var PRIMARY = ['Full Name', 'Job Title', 'Company', 'Email', 'Mobile', 'Phone', 'Website', 'Street', 'Postal Code', 'City', 'Country'];
  var SECONDARY = ['First Name', 'Last Name', 'Fax', 'LinkedIn', 'Notes', 'Raw Text'];
  var WIDE = { 'Full Name': 1, 'Email': 1, 'Street': 1, 'Website': 1, 'Notes': 1, 'Raw Text': 1, 'Job Title': 1, 'Company': 1 };

  var state = { cards: [], seq: 0, worker: null, workerLangs: '', busy: false, queue: [], currentCard: null, stream: null };

  /* ---------- Settings ---------- */
  function cfg() {
    var d = window.APP_CONFIG || {};
    return {
      url: localStorage.getItem('scriptUrl') || d.scriptUrl || '',
      token: localStorage.getItem('token') || d.token || '',
      langs: localStorage.getItem('langs') || d.langs || 'eng+deu'
    };
  }
  function openSettings() {
    var c = cfg();
    $('#setUrl').value = c.url; $('#setToken').value = c.token; $('#setLangs').value = c.langs; $('#setMsg').textContent = '';
    $('#settingsDlg').showModal();
  }
  $('#settingsBtn').onclick = openSettings;
  $('#settingsForm').addEventListener('submit', function (e) {
    var v = e.submitter && e.submitter.value;
    if (v === 'save') {
      localStorage.setItem('scriptUrl', $('#setUrl').value.trim());
      localStorage.setItem('token', $('#setToken').value);
      localStorage.setItem('langs', $('#setLangs').value.trim() || 'eng');
    }
  });
  $('#testBtn').onclick = function () {
    var url = $('#setUrl').value.trim();
    if (!url) { $('#setMsg').textContent = 'Enter the web app URL first.'; return; }
    $('#setMsg').textContent = 'Testing...';
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      $('#setMsg').textContent = j && j.ok ? 'Connected to sheet "' + j.sheet + '".' : 'Unexpected answer from the URL.';
    }).catch(function () { $('#setMsg').textContent = 'Could not reach the URL. Check the deployment access is set to Anyone.'; });
  };

  /* ---------- Input: files, camera, drop, paste ---------- */
  $('#fileBtn').onclick = function () { $('#fileInput').click(); };
  $('#fileInput').onchange = function (e) { addFiles(e.target.files); e.target.value = ''; };
  $('#captureInput').onchange = function (e) { addFiles(e.target.files, 'camera'); e.target.value = ''; };

  $('#cameraBtn').onclick = function () {
    var isTouch = matchMedia('(pointer: coarse)').matches;
    if (isTouch) { $('#captureInput').click(); return; } // phone: native camera app, best quality
    openLiveCamera();
  };

  var drop = $('#drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
  document.addEventListener('paste', function (e) {
    var files = [];
    Array.prototype.forEach.call((e.clipboardData && e.clipboardData.items) || [], function (it) {
      if (it.kind === 'file' && it.type.indexOf('image/') === 0) files.push(it.getAsFile());
    });
    if (files.length) addFiles(files);
  });

  function openLiveCamera() {
    var dlg = $('#cameraDlg'), video = $('#video');
    $('#camMsg').textContent = '';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('#fileInput').click(); return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then(function (stream) {
        state.stream = stream; video.srcObject = stream; video.play(); dlg.showModal();
      })
      .catch(function () {
        $('#fileInput').click(); // no camera or permission denied: fall back to file picker
      });
  }
  function closeCamera() {
    if (state.stream) state.stream.getTracks().forEach(function (t) { t.stop(); });
    state.stream = null; $('#video').srcObject = null;
    if ($('#cameraDlg').open) $('#cameraDlg').close();
  }
  $('#camCloseBtn').onclick = closeCamera;
  $('#cameraDlg').addEventListener('cancel', closeCamera);
  $('#snapBtn').onclick = function () {
    var v = $('#video');
    if (!v.videoWidth) return;
    var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(function (blob) {
      var f = new File([blob], 'camera-' + Date.now() + '.jpg', { type: 'image/jpeg' });
      addFiles([f], 'camera');
      $('#camMsg').textContent = 'Captured. Keep scanning or close.';
    }, 'image/jpeg', 0.92);
  };

  /* ---------- Cards ---------- */
  function addFiles(fileList, source) {
    Array.prototype.forEach.call(fileList, function (file) {
      var card = { id: ++state.seq, file: file, source: source || 'upload', status: 'queued', record: null, saved: false, els: {} };
      state.cards.push(card);
      mountCard(card);
      state.queue.push(card);
    });
    $('#toolbar').hidden = state.cards.length === 0;
    runQueue();
  }

  function setStatus(card, text, cls) {
    card.els.status.textContent = text;
    card.els.status.className = 'status ' + (cls || '');
  }

  function mountCard(card) {
    var el = document.createElement('article');
    el.className = 'card';
    var thumbUrl = URL.createObjectURL(card.file);
    el.innerHTML =
      '<div class="card-head"><img class="thumb" alt="">' +
      '<div class="meta"><div class="title">' + escapeHtml(card.file.name || 'Card') + '</div>' +
      '<div class="status">Waiting...</div><div class="bar"><i></i></div></div></div>' +
      '<div class="fields" hidden></div>' +
      '<div class="card-foot" hidden><button class="ghost remove">Remove</button><button class="primary save">Save to sheet</button></div>';
    el.querySelector('.thumb').src = thumbUrl;
    card.els = { root: el, status: el.querySelector('.status'), bar: el.querySelector('.bar > i'), fields: el.querySelector('.fields'),
      foot: el.querySelector('.card-foot'), title: el.querySelector('.title'), save: el.querySelector('.save') };
    el.querySelector('.remove').onclick = function () {
      state.cards = state.cards.filter(function (c) { return c !== card; });
      el.remove(); URL.revokeObjectURL(thumbUrl);
      $('#toolbar').hidden = state.cards.length === 0;
    };
    card.els.save.onclick = function () { saveCard(card); };
    $('#cards').prepend(el);
  }

  function renderFields(card) {
    var r = card.record;
    var box = card.els.fields;
    box.innerHTML = '';
    function field(name, parent) {
      var lab = document.createElement('label');
      if (WIDE[name]) lab.className = 'wide';
      lab.appendChild(document.createTextNode(name));
      var inp = document.createElement(name === 'Raw Text' || name === 'Notes' ? 'textarea' : 'input');
      if (inp.tagName === 'INPUT') inp.type = 'text';
      inp.value = r[name] || '';
      inp.oninput = function () { r[name] = inp.value; card.saved = false; card.els.save.textContent = 'Save to sheet'; };
      lab.appendChild(inp); parent.appendChild(lab);
    }
    PRIMARY.forEach(function (n) { field(n, box); });
    var det = document.createElement('details');
    det.innerHTML = '<summary>More fields</summary><div class="fields"></div>';
    var inner = det.querySelector('.fields');
    SECONDARY.forEach(function (n) { field(n, inner); });
    box.appendChild(det);
    box.hidden = false; card.els.foot.hidden = false;
    card.els.title.textContent = r['Full Name'] || card.file.name || 'Card';
  }

  /* ---------- OCR pipeline ---------- */
  function runQueue() {
    if (state.busy) return;
    var next = state.queue.shift();
    if (!next) return;
    if (!state.cards.includes(next)) { runQueue(); return; }
    state.busy = true;
    processCard(next).catch(function (err) {
      next.status = 'error';
      setStatus(next, 'Could not read this image: ' + (err && err.message ? err.message : err), 'err');
      next.els.bar.style.width = '0';
    }).then(function () { state.busy = false; runQueue(); });
  }

  function loadBitmap(file) {
    var opts = { imageOrientation: 'from-image' };
    return createImageBitmap(file, opts).catch(function () {
      var isHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
      if (!isHeic) throw new Error('unsupported image format');
      return loadScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js').then(function () {
        return window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
      }).then(function (blob) { return createImageBitmap(Array.isArray(blob) ? blob[0] : blob, opts); });
    });
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  // Scale to a good OCR size, grayscale, stretch contrast, invert light-on-dark cards.
  function preprocess(bmp) {
    var long = Math.max(bmp.width, bmp.height), scale = 1;
    if (long > 2200) scale = 2200 / long; else if (long < 1400) scale = 1400 / long;
    var w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    var img = ctx.getImageData(0, 0, w, h), d = img.data, hist = new Uint32Array(256), n = w * h, i;
    for (i = 0; i < d.length; i += 4) {
      var g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = g; hist[g]++;
    }
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    if (hi - lo < 30) { lo = 0; hi = 255; }
    var range = hi - lo, sum = 0, v;
    for (i = 0; i < d.length; i += 4) {
      v = Math.max(0, Math.min(255, ((d[i] - lo) * 255 / range) | 0));
      d[i] = d[i + 1] = d[i + 2] = v; sum += v;
    }
    if (sum / n < 110) { for (i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255 - d[i]; } }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function getWorker(langs, onProgress) {
    state.onProgress = onProgress;
    if (state.worker && state.workerLangs === langs) return Promise.resolve(state.worker);
    var old = state.worker; state.worker = null;
    return (old ? old.terminate() : Promise.resolve()).then(function () {
      return Tesseract.createWorker(langs.split('+'), 1, { logger: function (m) { if (state.onProgress) state.onProgress(m); } });
    }).then(function (w) { state.worker = w; state.workerLangs = langs; return w; });
  }

  function recognize(worker, canvas, psm) {
    return worker.setParameters({ tessedit_pageseg_mode: psm }).then(function () { return worker.recognize(canvas); })
      .then(function (r) { return r.data.text; });
  }

  function processCard(card) {
    card.status = 'reading';
    setStatus(card, 'Preparing image...');
    card.els.bar.style.width = '5%';
    var langs = cfg().langs;
    return loadBitmap(card.file).then(function (bmp) {
      var canvas = preprocess(bmp);
      if (bmp.close) bmp.close();
      setStatus(card, 'Loading OCR engine (first run downloads language data)...');
      return getWorker(langs, function (m) {
        if (m.status === 'recognizing text') { card.els.bar.style.width = (10 + m.progress * 85) + '%'; setStatus(card, 'Reading text...'); }
      }).then(function (worker) {
        return recognize(worker, canvas, '3').then(function (text) {
          var rec = P.parse(text);
          if (rec['Confidence'] >= 0.6) return { rec: rec, text: text };
          setStatus(card, 'Trying a second pass...');
          return recognize(worker, canvas, '11').then(function (text2) {
            var rec2 = P.parse(text2);
            return rec2['Confidence'] > rec['Confidence'] ? { rec: rec2, text: text2 } : { rec: rec, text: text };
          });
        });
      });
    }).then(function (res) {
      res.rec['Source'] = card.source;
      card.record = res.rec; card.status = 'ready';
      card.els.bar.style.width = '100%';
      var conf = res.rec['Confidence'];
      setStatus(card, conf >= 0.6 ? 'Ready. Check the fields, then save.' : 'Low confidence. Please check and fix the fields.', conf >= 0.6 ? 'ok' : 'warn');
      renderFields(card);
    });
  }

  /* ---------- Save to Google Sheet ---------- */
  function saveCard(card) {
    var c = cfg();
    if (!card.record) return Promise.resolve();
    if (!c.url) { openSettings(); $('#setMsg').textContent = 'Add your sheet web app URL to save.'; return Promise.resolve(); }
    card.els.save.disabled = true; setStatus(card, 'Saving...');
    // Refresh the de-dup key from the possibly edited fields.
    var r = card.record;
    var key = r['Email'] || (r['Mobile'] || r['Phone'] || '').replace(/\D/g, '') || (r['Full Name'] + r['Company']).toLowerCase().replace(/[^a-z0-9]/g, '');
    r['Card ID'] = key ? P.hash(String(key).toLowerCase()) : '';
    var body = JSON.stringify({ token: c.token, record: r });
    // text/plain avoids a CORS preflight, which Apps Script cannot answer.
    return fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
      .then(function (resp) { return resp.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || 'Sheet refused the data');
        card.saved = true;
        setStatus(card, j.action === 'updated' ? 'Already in sheet, row updated.' : 'Saved to sheet (row ' + j.row + ').', 'ok');
        card.els.save.textContent = 'Saved';
      })
      .catch(function (err) {
        setStatus(card, 'Not saved: ' + (err && err.message ? err.message : err) + '. You can download a CSV instead.', 'err');
      })
      .then(function () { card.els.save.disabled = false; });
  }
  $('#saveAllBtn').onclick = function () {
    var todo = state.cards.filter(function (c) { return c.record && !c.saved; });
    todo.reduce(function (p, c) { return p.then(function () { return saveCard(c); }); }, Promise.resolve());
  };

  /* ---------- CSV fallback and clear ---------- */
  $('#csvBtn').onclick = function () {
    var rows = state.cards.filter(function (c) { return c.record; }).map(function (c) { return c.record; });
    if (!rows.length) return;
    var esc = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = [P.HEADERS.join(',')].concat(rows.map(function (r) {
      return P.HEADERS.map(function (h) { return esc(h === 'Scanned At' ? new Date().toISOString() : r[h]); }).join(',');
    })).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'business-cards.csv'; a.click();
  };
  $('#clearBtn').onclick = function () {
    state.cards = []; state.queue = []; $('#cards').innerHTML = ''; $('#toolbar').hidden = true;
  };

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
})();
