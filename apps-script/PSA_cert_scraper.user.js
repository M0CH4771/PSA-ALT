// ==UserScript==
// @name         PSA Cert Reader for PSA-ALT
// @namespace    M0CH4771.PSA-ALT
// @version      1.0.0
// @description  Reads the visible PSA certification page and returns its cert, subject, grade, and official image to the batch app.
// @match        https://www.psacard.com/cert/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  if (window.__psaAltCertReader) return;
  window.__psaAltCertReader = true;

  const params = new URLSearchParams(location.search);
  const cert = String(params.get('psaCert') || '').replace(/\D/g, '');
  const nonce = String(params.get('psaNonce') || '');
  if (params.get('psaBatch') !== '1' || !/^\d{6,12}$/.test(cert) || !/^[\w-]{10,100}$/.test(nonce)) return;

  const box = document.createElement('div');
  Object.assign(box.style, {position:'fixed',right:'18px',bottom:'18px',zIndex:'2147483647',maxWidth:'420px',padding:'12px 16px',borderRadius:'8px',background:'#13233a',color:'#fff',font:'14px/1.5 system-ui',boxShadow:'0 3px 12px #0005'});
  box.textContent = `PSA鑑定番号 ${cert} の公式情報を読み取っています…`;
  document.body.appendChild(box);

  const clean = s => String(s || '').replace(/\u00a0/g,' ').replace(/\r/g,'').replace(/[ \t]+/g,' ').trim();
  const report = (ok, fields={}, reason='') => {
    box.textContent = ok ? `PSA照合完了: ${fields.name} / ${fields.grade}` : `PSA照合を保留: ${reason}`;
    if (!window.opener) { box.textContent += '（Webアプリへ戻れません。ポップアップを許可してやり直してください）'; return; }
    window.opener.postMessage({type:'PSA_CERT_RESULT',nonce,cert,ok,reason,...fields}, '*');
  };

  function readPage() {
    const pathCert = (location.pathname.match(/\/cert\/(\d+)/i) || [])[1] || '';
    if (pathCert !== cert) return null;
    const body = clean(document.body?.innerText || '').replace(/\n{2,}/g,'\n');
    if (!body.includes(cert)) return null;
    const gradeMatch = body.match(/Item\s+Grade\s+(GEM\s*MT|MINT|NM-MT|EX-MT|EX|VG-EX|VG|GOOD|FAIR|POOR)\s*(\d+(?:\.5)?)/i);
    const subjectMatch = body.match(/(?:^|\n)Subject\s*\n\s*([^\n]+)/i) || body.match(/Subject\s+([^\n]+)/i);
    let name = subjectMatch ? clean(subjectMatch[1]) : '';
    if (!name) {
      const h = clean(document.querySelector('h1')?.innerText || '');
      if (h && !/cert verification/i.test(h) && !new RegExp(`^#?${cert}$`).test(h)) name=h.replace(/^#\s*/,'');
    }
    if (!gradeMatch || !name || /no data found|not found|invalid cert/i.test(body)) return null;
    const img = [...document.querySelectorAll('img[alt]')].find(el=>/^Cert image\s*1$/i.test(clean(el.alt)));
    let imageUrl = '';
    try {
      const candidate = new URL(img?.currentSrc || img?.src || '', location.href);
      if (candidate.protocol==='https:' && /(^|\.)psacard\.com$/i.test(candidate.hostname)) imageUrl=candidate.href;
    } catch (_) {}
    return {
      name,
      grade:`PSA ${Number(gradeMatch[2])}`,
      imageUrl,
      url:`https://www.psacard.com/cert/${cert}/psa`
    };
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    const result = readPage();
    if (result) { clearInterval(timer); report(true,result); return; }
    if (attempts >= 30) {
      clearInterval(timer);
      report(false,{},'PSAページから証明番号・Subject・グレードを読み取れませんでした。PSAページが表示できているか確認してください。');
    }
  },1000);
})();
