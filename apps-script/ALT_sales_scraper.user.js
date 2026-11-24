// ==UserScript==
// @name         PSA-ALT Cert Search and Sales Copier
// @namespace    M0CH4771.PSA-ALT
// @version      3.9.4
// @updateURL    https://raw.githubusercontent.com/M0CH4771/PSA-ALT/main/apps-script/ALT_sales_scraper.user.js
// @downloadURL  https://raw.githubusercontent.com/M0CH4771/PSA-ALT/main/apps-script/ALT_sales_scraper.user.js
// @description  Searches ALT by PSA card name, confirms exact card number and grade, and copies only verified sales.
// @match        https://alt.xyz/browse*
// @match        https://alt.xyz/itm/*/research*
// @match        https://alt.xyz/itm/*/external*
// @run-at       document-idle
// @grant        GM_setValue
// ==/UserScript==
(() => {
  'use strict';
  if (window.__psaAltAuto) return;
  window.__psaAltAuto = true;

  const STORAGE_KEY = 'PSA_ALT_AUTO_CONTEXT';
  const b = document.createElement('button');
  b.textContent = 'ALT成約2件をコピー';
  Object.assign(b.style, { position:'fixed', right:'20px', bottom:'20px', zIndex:'2147483647', padding:'12px 16px', border:0, borderRadius:'8px', background:'#2654c7', color:'#fff', font:'700 14px system-ui', boxShadow:'0 3px 12px #0004', cursor:'pointer' });
  document.body.appendChild(b);
  const toast = document.createElement('div');
  Object.assign(toast.style, { position:'fixed', right:'20px', bottom:'72px', zIndex:'2147483647', maxWidth:'460px', padding:'10px 14px', borderRadius:'7px', background:'#13233a', color:'#fff', font:'14px/1.45 system-ui', whiteSpace:'pre-line', display:'none' });
  document.body.appendChild(toast);
  let timer;
  let runningFor = '';
  const say = s => { toast.textContent=s; toast.style.display='block'; clearTimeout(timer); timer=setTimeout(()=>toast.style.display='none',10000); };
  const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const norm = s => String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const readContext = () => { try { const c=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null'); return c&&Date.now()-c.createdAt<10*60*1000?c:null; } catch (_) { return null; } };
  const saveContext = c => sessionStorage.setItem(STORAGE_KEY,JSON.stringify(c));
  function report(ctx, ok, reason='', sales=[]) {
    say(ok ? `ALT成約をWebアプリへ返しました (${sales.length}件)。` : `保留: ${reason}`);
    if (!ctx?.batch || !ctx.nonce) return;
    const message = {
      type:'PSA_ALT_BATCH_RESULT', nonce:ctx.nonce, cert:ctx.cert, grade:ctx.grade,
      ok, reason, title:ctx.altTitle||document.querySelector('h1')?.innerText||document.title,
      url:location.href,
      sales:sales.map(x=>({date:x.date,price:x.price,site:x.site,url:x.href}))
    };
    try { GM_setValue('PSA_ALT_BATCH_RESULT',{id:Date.now(),message}); } catch (_) {}
    try { if(window.opener) window.opener.postMessage(message,'*'); } catch (_) {}
  }

  function captureSearchRequest() {
    if (!/^\/browse\/?$/.test(location.pathname)) return;
    const params = new URLSearchParams(location.search);
    const cert = String(params.get('query')||'').replace(/\D/g,'');
    const grade = String(params.get('psaGrade')||'').trim();
    if (!/^\d{6,12}$/.test(cert) || !/^\d+(?:\.5)?$/.test(grade)) return;
    const nonce=String(params.get('psaNonce')||'');
    const batch=params.get('psaBatch')==='1' && /^[\w-]{10,100}$/.test(nonce);
    const ctx = { cert, grade:`PSA ${Number(grade)}`, cardName:params.get('psaName')||'', subject:params.get('psaSubject')||'', nonce, batch, createdAt:Date.now(), route:'browse' };
    saveContext(ctx);
    say(`鑑定番号 ${cert} でALT検索中です。候補カードを確認しています…`);
  }

  b.hidden=/^\/browse\/?$/.test(location.pathname);

  function compact(value) {
    return norm(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9#]+/g,'');
  }
  function candidateItems(ctx) {
    const subject=String(ctx.subject||ctx.cardName||'').trim();
    const subjectTerms=norm(subject).replace(/[^\p{L}\p{N}#']+/gu,' ').split(/\s+/).filter(x=>x.length>1&&!/^(pokemon|japanese|english|card|psa|gem|mt|super|rare|ultra|full|art)$/i.test(x));
    const number=(ctx.cardName.match(/#\s*0*(\d{1,4})/i)||[])[1]||'';
    const language=(ctx.cardName.match(/\b(japanese|korean|english|chinese|mandarin|cantonese|thai|indonesian|german|french|italian|spanish)\b/i)||[])[1]||'';
    const byPath=new Map();
    for(const link of document.querySelectorAll('a[href*="/itm/"]')) {
      let url;
      try { url=new URL(link.href); } catch (_) { continue; }
      if(!/^\/itm\/[0-9a-f-]+\/external\/?$/i.test(url.pathname)) continue;
      const imageText=[...link.querySelectorAll('img[alt]')].map(img=>img.alt||'').join(' ');
      const raw=[link.innerText,link.getAttribute('aria-label'),link.title,imageText].join(' ');
      const compactText=compact(raw);
      if(subjectTerms.length && !subjectTerms.every(term=>compactText.includes(compact(term)))) continue;
      const numbers=[...raw.matchAll(/#\s*0*(\d{1,4})\b/g)].map(m=>String(Number(m[1])));
      if(number && numbers.length && !numbers.includes(String(Number(number)))) continue;
      const languages=[...raw.matchAll(/\b(japanese|korean|english|chinese|mandarin|cantonese|thai|indonesian|german|french|italian|spanish)\b/ig)].map(m=>m[1].toLowerCase());
      if(language && languages.length && !languages.includes(language.toLowerCase())) continue;
      const path=url.pathname;
      const score=(number && numbers.includes(String(Number(number)))?4:0)+(language && languages.includes(language.toLowerCase())?2:0);
      const previous=byPath.get(path);
      if(!previous || score>previous.score || String(link.innerText||'').length>String(previous.link.innerText||'').length) {
        byPath.set(path,{link,title:String(link.innerText||link.getAttribute('aria-label')||link.title||imageText||'').trim(),path,score,numberVerified:!!(number&&numbers.includes(String(Number(number))))});
      }
    }
    return [...byPath.values()].sort((a,b)=>b.score-a.score);
  }

  function browseSearchInput() {
    return document.querySelector('#universal-search-autocomplete') ||
      [...document.querySelectorAll('input')].find(el =>
        /search/i.test((el.getAttribute('aria-label')||'')+' '+(el.placeholder||'')+' '+(el.id||'')));
  }

  async function submitSearch(input, query) {
    query=String(query||'').trim();
    if(norm(input.value)!==norm(query)) {
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      if(setter) setter.call(input,query); else input.value=query;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    input.focus();
    const key={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};
    input.dispatchEvent(new KeyboardEvent('keydown',key));
    input.dispatchEvent(new KeyboardEvent('keypress',key));
    input.dispatchEvent(new KeyboardEvent('keyup',key));
  }

  async function waitForCandidates(timeoutMs,ctx) {
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline) {
      const candidates=candidateItems(ctx);
      if(candidates.length) return candidates;
      if(/couldn't find any results|no results found/i.test(document.body.innerText||'')) return [];
      await sleep(350);
    }
    return [];
  }

  async function openSingleCertCandidate() {
    const ctx=readContext();
    if (!ctx || !/^\/browse\/?$/.test(location.pathname)) return;
    const route=ctx.route||'browse';
    if(!['browse','name-search'].includes(route)) return;
    const runKey='browse:'+ctx.cert+':'+route;
    if(runningFor===runKey) return;
    runningFor=runKey;

    function navigateSearch(query,message) {
      ctx.route='name-search';
      saveContext(ctx);
      const url=new URL('/browse',location.origin);
      url.searchParams.set('query',query);
      say(message);
      location.assign(url.href);
    }

    if(route==='browse') {
      const query=String(ctx.cardName||ctx.subject||'').trim();
      if(!query) {
        report(ctx,false,'PSA公式からカード名を取得できないため、ALT検索を開始できません。');
        return;
      }
      navigateSearch(query,'PSA公式のカード名でALT検索しています…鑑定番号では検索しません。');
      return;
    }

    const candidates=await waitForCandidates(15000,ctx);
    if(candidates.length) {
      const bestScore=candidates[0].score;
      const best=candidates.filter(item=>item.score===bestScore);
      if(best.length!==1) {
        report(ctx,false,'カード名検索で候補が複数あります。誤ったカードを選ばないよう保留しました。候補を手動で確認してください。');
        return;
      }
      const candidate=best[0];
      ctx.altTitle=candidate.title||candidate.path;
      ctx.numberVerified=candidate.numberVerified;
      ctx.route='opening';
      saveContext(ctx);
      say('ALT候補を開き、カード番号とPSAグレードを確認します: '+ctx.altTitle);
      candidate.link.click();
      return;
    }
    report(ctx,false,'カード名検索で一致候補が見つかりませんでした。鑑定番号検索へは切り替えず保留しました。カード名をALTで手動確認してください。');
  }

  function currentGradeButton() {
    return [...document.querySelectorAll('button')].find(el=>/^PSA\s+\d+(?:\.\d+)?$/i.test((el.innerText||'').trim()));
  }
  async function waitFor(fn, ms=12000) {
    const end=Date.now()+ms;
    while(Date.now()<end) { const v=fn(); if(v) return v; await sleep(250); }
    return null;
  }
  function viewAllControls(root) {
    return [...root.querySelectorAll('button,[role="button"],a')]
      .filter(el=>/^(view all|see all|view all transactions|see all transactions)$/i.test(norm(el.innerText||el.getAttribute('aria-label'))));
  }
  function recentTransactionsHeading() {
    return [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
      .filter(el=>/recent transactions/i.test(norm(el.innerText||el.getAttribute('aria-label'))))
      .sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length)[0]||null;
  }
  function distanceTo(ancestor, el) {
    let depth=0;
    for(let node=el;node;node=node.parentElement,depth++) if(node===ancestor) return depth;
    return Infinity;
  }
  function closestCommonAncestor(a,b,maxDepth=12) {
    let node=a;
    for(let i=0;node&&i<maxDepth;i++,node=node.parentElement) if(node.contains(b)) return node;
    return null;
  }
  async function openTransactions(timeoutMs=12000) {
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline) {
      const headings=[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
        .filter(el=>/recent transactions/i.test(norm(el.innerText||el.getAttribute('aria-label'))));
      const controls=viewAllControls(document);
      let best=null;
      for(const heading of headings) for(const control of controls) {
        const common=closestCommonAncestor(heading,control);
        if(!common || !/recent transactions/i.test(norm(common.innerText||''))) continue;
        const distance=distanceTo(common,heading)+distanceTo(common,control);
        if(!best || distance<best.distance) best={control,distance};
      }
      if(best) { best.control.click(); return true; }
      await sleep(300);
    }
    return false;
  }
  function transactionsRoot() {
    const titlePattern = /market\s+transactions|sales\s+history/i;
    const isVisible = el => {
      const style=getComputedStyle(el);
      return style.display!=='none' && style.visibility!=='hidden' && el.getClientRects().length>0;
    };

    // ALT opens Sales History as a drawer. Do not require transaction links:
    // on some item pages, transaction rows are clickable divs rather than anchors.
    const overlays=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.MuiDrawer-paper,.MuiDrawer-root,aside')]
      .filter(isVisible);
    for(const overlay of overlays) {
      if(titlePattern.test(overlay.innerText||'')) return overlay;
    }

    const headings=[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
      .filter(el=>titlePattern.test((el.innerText||'').replace(/\s+/g,' ').trim()));
    for(const heading of headings) {
      let node=heading;
      for(let depth=0;node&&depth<14;depth++,node=node.parentElement) {
        if(titlePattern.test(node.innerText||'') && isVisible(node)) return node;
      }
    }
    return null;
  }
  function parseRows(root) {
    const seen=new Set(), out=[];
    const methodRe=/^(auction|buy now|best offer|fixed price|sale)$/i;
    const dateRe=/^(?:[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})$/;
    const moneyRe=/^\$\s?[\d,]+(?:\.\d{1,2})?$/;
    const rowData=el=>{
      const text=(el.innerText||el.textContent||'').replace(/\u00a0/g,' ').trim();
      if(!text||/listing\s*price|relisted|not\s*paid|unsold|alt\s*value/i.test(text)) return null;
      const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      const methodLine=lines.find(x=>methodRe.test(x));
      const methodMatch=text.match(/\b(auction|buy now|best offer|fixed price|sale)\b/i);
      const method=methodLine||methodMatch?.[1]||'';
      // Best Offer is excluded unless ALT exposes a distinct confirmed sale amount.
      if(!method||/^best offer$/i.test(method)) return null;
      const dateLine=lines.find(x=>dateRe.test(x));
      const dateMatch=text.match(/\b(?:[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\b/);
      const dateText=dateLine||dateMatch?.[0]||'';
      const moneyLine=lines.find(x=>moneyRe.test(x));
      const moneyMatch=text.match(/\$\s?[\d,]+(?:\.\d{1,2})?/);
      const money=moneyLine||moneyMatch?.[0]||'';
      if(!dateText||!money) return null;
      const d=new Date(dateText), price=Number(money.replace(/[$,\s]/g,''));
      if(!Number.isFinite(d.getTime())||!Number.isFinite(price)||price<=0) return null;
      return {date:d,price,method,text};
    };
    const candidates=[...root.querySelectorAll('a[href],[role="link"],li,article,button,div')];
    const valid=candidates.filter(el=>el.getClientRects().length&&rowData(el));
    // Use the innermost element that contains a complete sale record to avoid
    // counting the drawer and its row wrappers as separate transactions.
    const rows=valid.filter(el=>![...el.querySelectorAll('a[href],[role="link"],li,article,button,div')].some(child=>rowData(child)));
    for(const el of rows) {
      const parsed=rowData(el);
      if(!parsed) continue;
      const a=el.closest('a[href]')||(el.matches('a[href]')?el:el.querySelector('a[href]'));
      const href=a?.href||'';
      const ebayId=(href.match(/ebay\.com\/itm\/(\d{9,15})/i)||[])[1];
      const key=ebayId?'ebay:'+ebayId:href?href:el;
      if(seen.has(key)) continue;
      seen.add(key);
      const imgAlt=el.querySelector('img[alt]')?.alt?.trim()||'';
      let site=imgAlt||(/card\s*hobby/i.test(parsed.text)?'Card Hobby':/ebay/i.test(parsed.text)?'eBay':'ALT');
      if(!imgAlt&&href) { try { site=new URL(href).hostname.replace(/^www\./,''); } catch (_) {} }
      out.push({date:parsed.date.toISOString().slice(0,10),price:parsed.price,site,href,method:parsed.method});
    }
    return out.sort((a,b)=>b.date.localeCompare(a.date));
  }

  async function autoResearch() {
    const ctx=readContext();
    if(!ctx || !/^\/itm\/[0-9a-f-]+\/(?:research|external)\/?$/i.test(location.pathname)) return;
    if(ctx.route==='browse') { ctx.route='opening'; saveContext(ctx); }
    if(ctx.route!=='opening' && ctx.route!=='research') return;
    if(ctx.route==='research' && ctx.researchPath!==location.pathname) return;
    if(ctx.route==='opening') { ctx.route='research'; ctx.researchPath=location.pathname; saveContext(ctx); }
    const key=`research:${location.pathname}:${ctx.grade}`;
    if(runningFor===key) return;
    runningFor=key;
    say(`ALTカード: ${ctx.altTitle||'鑑定番号検索結果'}\nPSA ${ctx.grade} の履歴を準備しています…`);

    const titleText=String(document.querySelector('h1')?.innerText||document.title||ctx.altTitle||'');
    const subject=String(ctx.subject||ctx.cardName||'').trim();
    const subjectTerms=norm(subject).replace(/[^\p{L}\p{N}#']+/gu,' ').split(/\s+/).filter(x=>x.length>1&&!/^(pokemon|japanese|english|card|psa|gem|mt|super|rare|ultra|full|art)$/i.test(x));
    const titleCompact=compact(titleText);
    if(subjectTerms.length&&!subjectTerms.every(term=>titleCompact.includes(compact(term)))) {
      report(ctx,false,'開いたALT商品名がPSA公式のカード名と一致しません。');
      return;
    }
    const expectedNumber=(ctx.cardName.match(/#\s*0*(\d{1,4})/i)||[])[1]||'';
    const titleNumbers=[...titleText.matchAll(/#\s*0*(\d{1,4})\b/g)].map(m=>String(Number(m[1])));
    if(expectedNumber && titleNumbers.length && !titleNumbers.includes(String(Number(expectedNumber)))) {
      report(ctx,false,'開いたALT商品とPSA公式のカード番号が一致しません。');
      return;
    }
    if(expectedNumber && !titleNumbers.length && !ctx.numberVerified) {
      report(ctx,false,'ALT商品ページでカード番号を確認できません。誤入力防止のため保留しました。');
      return;
    }
    const gradeButton=await waitFor(currentGradeButton);
    if(!gradeButton) { report(ctx,false,'ALTのPSAグレード欄を確認できません。'); return; }
    if(norm(gradeButton.innerText)!==norm(ctx.grade)) {
      gradeButton.click();
      const menuItem=await waitFor(()=>[...document.querySelectorAll('[role="menuitem"],button,[role="option"]')].find(el=>norm(el.innerText)===norm(ctx.grade)));
      if(!menuItem) { report(ctx,false,ctx.grade+'の選択肢がALTにありません。'); return; }
      menuItem.click();
      const selected=await waitFor(()=>{ const el=currentGradeButton(); return el&&norm(el.innerText)===norm(ctx.grade)?el:null; });
      if(!selected) { report(ctx,false,'ALTでPSA '+ctx.grade+'を選択できませんでした。'); return; }
    }

    const opened=await waitFor(()=>{
      if(transactionsRoot()) return 'already-open';
      return recentTransactionsHeading()?'ready':null;
    });
    if(!opened) { report(ctx,false,'ALTの成約履歴欄が見つかりません。'); return; }
    if(opened!=='already-open' && !(await openTransactions())) { report(ctx,false,'ALTの「Recent Transactions → VIEW ALL」を見つけられませんでした。'); return; }
    const root=await waitFor(transactionsRoot,15000);
    if(!root) { report(ctx,false,'Sales Historyを開けませんでした。'); return; }
    let rows=parseRows(root);
    for(let i=0;rows.length<2&&i<5;i++) {
      const more=[...root.querySelectorAll('button')].find(x=>(x.innerText||'').trim().toLowerCase()==='show more'&&!x.disabled);
      if(!more) break;
      more.click(); await sleep(700); rows=parseRows(root);
    }
    if(rows.length<2) { report(ctx,false,`同一条件の有効成約が${rows.length}件です。2件そろわないため価格を記入しません。`); return; }
    if(ctx.batch) { report(ctx,true,'',rows.slice(0,2)); sessionStorage.removeItem(STORAGE_KEY); b.hidden=true; return; }
    b.dataset.payload=[
      ['#ALT_META',ctx.altTitle||document.querySelector('h1')?.innerText||document.title,ctx.grade,location.href,ctx.cert].join('\t'),
      ...rows.slice(0,2).map(x=>[x.date,x.price.toFixed(2),x.site,x.href].join('\t'))
    ].join('\n');
    b.textContent='条件を確認して2件コピー';
    say(`ALTの商品タイトルとグレード照合が完了しました。\n候補: ${ctx.altTitle||document.querySelector('h1')?.innerText}\nグレード: ${ctx.grade}\n最新: ${rows[0].date} $${rows[0].price} (${rows[0].method})\n前回: ${rows[1].date} $${rows[1].price} (${rows[1].method})\nカードの版・言語・番号がPSA公式と一致することを確認してから、右下のボタンでコピーしてください。`);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const t=document.createElement('textarea'); t.value=text; t.style.position='fixed'; t.style.left='-10000px'; document.body.appendChild(t); t.select();
      if(!document.execCommand('copy')) throw new Error('クリップボードにコピーできません。'); t.remove();
    }
  }
  b.addEventListener('click',async()=>{
    const ctx=readContext();
    try {
      if(b.dataset.payload) {
        await copy(b.dataset.payload);
        say('有効成約2件をコピーしました。PSA公式ページとALTカードの版・言語・番号が一致するか確認し、Webアプリに戻って貼り付けてください。');
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      const root=transactionsRoot();
      if(!root) throw new Error('Sales Historyが開いていません。ALT Researchページで「Recent Transactions → VIEW ALL」を開いてください。');
      const grade=currentGradeButton()?.innerText?.trim()||'';
      let rows=parseRows(root);
      for(let i=0;rows.length<2&&i<5;i++) { const more=[...root.querySelectorAll('button')].find(x=>(x.innerText||'').trim().toLowerCase()==='show more'&&!x.disabled); if(!more) break; more.click(); await sleep(700); rows=parseRows(root); }
      if(rows.length<2) throw new Error(`有効成約が${rows.length}件しかありません。2件未満は価格を決められません。`);
      const title=document.querySelector('h1')?.innerText||document.title||'';
      const payload=[['#ALT_META',title,grade,location.href,ctx?.cert||''].join('\t'),...rows.slice(0,2).map(x=>[x.date,x.price.toFixed(2),x.site,x.href].join('\t'))].join('\n');
      await copy(payload); say(`コピーしました (${grade})\n${rows[0].date} $${rows[0].price} / ${rows[0].method}\n${rows[1].date} $${rows[1].price} / ${rows[1].method}`);
      if(ctx) sessionStorage.removeItem(STORAGE_KEY);
    } catch(e) { say(e.message||String(e)); }
  });

  captureSearchRequest();
  let lastPath=location.pathname;
  setInterval(()=>{
    if(location.pathname!==lastPath) { lastPath=location.pathname; runningFor=''; b.hidden=/^\/browse\/?$/.test(location.pathname); }
    if(/^\/browse\/?$/.test(location.pathname)) openSingleCertCandidate();
    else autoResearch();
  },500);
})();
