// ==UserScript==
// @name         PSA Cert Reader for PSA-ALT
// @namespace    M0CH4771.PSA-ALT
// @version      1.2.0
// @updateURL    https://raw.githubusercontent.com/M0CH4771/PSA-ALT/main/apps-script/PSA_cert_scraper.user.js
// @downloadURL  https://raw.githubusercontent.com/M0CH4771/PSA-ALT/main/apps-script/PSA_cert_scraper.user.js
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
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const cert = String(params.get('psaCert') || hashParams.get('psaCert') || '').replace(/\D/g, '');
  const nonce = String(params.get('psaNonce') || hashParams.get('psaNonce') || '');
  const batch = params.get('psaBatch') || hashParams.get('psaBatch');
  if (batch !== '1' || !/^\d{6,12}$/.test(cert) || !/^[\w-]{10,100}$/.test(nonce)) return;

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

    const gradeMatch = body.match(/Item\s*Grade\s*(?:\/\s*)?(GEM\s*MT|MINT|NM-MT|EX-MT|EX|VG-EX|VG|GOOD|FAIR|POOR)\s*(\d+(?:\.5)?)/i);
    const titles = [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
      .map(el => clean(el.innerText || ''))
      .filter(text => text && !/search|pedigree|cert verification/i.test(text) &&
        /\b(?:19|20)\d{2}\b/.test(text) && /#\s*0*\d{1,4}\b/.test(text));
    const title = titles.sort((a,b)=>b.length-a.length)[0] || '';
    if (!gradeMatch || !title || /no data found|not found|invalid cert/i.test(body)) return null;

    const numberMatch=title.match(/#\s*0*(\d{1,4})\b/);
    const tailMatch=numberMatch ? title.slice(numberMatch.index+numberMatch[0].length).trim() : '';
    let subject=tailMatch
      .replace(/^(?:FA|FULL\s*ART|ALT\s*ART|SPECIAL\s*ART)\s*\/\s*/i,'')
      .replace(/\s+(?:SPECIAL\s+ART\s+RARE|ILLUSTRATION\s+RARE|SUPER\s+RARE|ULTRA\s+RARE|HYPER\s+RARE|SECRET\s+RARE|DOUBLE\s+RARE|COMMON|UNCOMMON|RARE|PROMO).*$/i,'')
      .trim();
    const prefix=numberMatch ? title.slice(0,numberMatch.index) : '';
    const prefixWords=new Set((prefix.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]));
    subject=subject.split(/\s+/).filter(word=>!prefixWords.has(word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,''))).join(' ').trim();
    if (!subject) subject=tailMatch || title;

    const img = [...document.querySelectorAll('img[alt]')].find(el=>/^Cert image\s*1$/i.test(clean(el.alt)));
    let imageUrl = '';
    try {
      const candidate = new URL(img?.currentSrc || img?.src || '', location.href);
      if (candidate.protocol==='https:' && /(^|\.)psacard\.com$/i.test(candidate.hostname)) imageUrl=candidate.href;
    } catch (_) {}

    return {
      name:title,
      fullName:title,
      subject,
      grade:'PSA '+Number(gradeMatch[2]),
      imageUrl,
      url:'https://www.psacard.com/cert/'+cert+'/psa'
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
