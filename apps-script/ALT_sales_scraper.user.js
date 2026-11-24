// ==UserScript==
// @name         PSA-ALT Cert Search and Sales Copier
// @namespace    M0CH4771.PSA-ALT
// @version      3.5.0
// @description  Searches ALT by the PSA card title, selects a matching item, and returns confirmed sales to the batch app.
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

  function candidateItems(ctx) {
    const subject=norm(ctx.subject||'').replace(/^(?:fa|full art)\s*\/\s*/,'');
    const grade=norm(ctx.grade).replace(/\s+/g,'');
    const number=(ctx.cardName.match(/#\s*0*(\d{1,4})/i)||[])[1]||'';
    const language=(ctx.cardName.match(/\b(japanese|korean|english|chinese|mandarin|cantonese|thai|indonesian|german|french|italian|spanish)\b/i)||[])[1]||'';
    const byPath=new Map();
    for(const link of document.querySelectorAll('a[href*="/itm/"]')) {
      let url;
      try { url=new URL(link.href); } catch (_) { continue; }
      if(!/^\/itm\/[0-9a-f-]+\/external\/?$/i.test(url.pathname)) continue;
      const imageText=[...link.querySelectorAll('img[alt]')].map(img=>img.alt||'').join(' ');
      const raw=[link.innerText,link.getAttribute('aria-label'),link.title,imageText].join(' ');
      const text=norm(raw);
      if(subject&&!text.includes(subject)) continue;
      if(grade&&!text.replace(/\s+/g,'').includes(grade)) continue;
      if(number&&!new RegExp('#\\s*0*'+number+'(?:\\D|$)','i').test(raw)) continue;
      if(language&&!text.includes(language.toLowerCase())) continue;
      const path=url.pathname;
      const previous=byPath.get(path);
      if(!previous || String(link.innerText||'').length>String(previous.link.innerText||'').length) {
        byPath.set(path,{link,title:String(link.innerText||imageText||'').trim(),path});
      }
    }
    return [...byPath.values()];
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
    if (!ctx || !/^\/browse\/?$/.test(location.pathname) || ctx.route!=='browse') return;
    if (runningFor==='browse:'+ctx.cert) return;
    runningFor='browse:'+ctx.cert;

    const searchInput=await waitFor(browseSearchInput,10000);
    if(!searchInput) { report(ctx,false,'ALTの検索欄が見つからず、カードを検索できませんでした。'); return; }

    let candidates=[];
    if(ctx.cardName) {
      await submitSearch(searchInput,ctx.cardName);
      say('PSA公式のカード名でALT検索しています…');
      candidates=await waitForCandidates(10000,ctx);
    }
    if(!candidates.length) {
      await submitSearch(searchInput,ctx.cert);
      say('カード名で一致候補がないため、鑑定番号で再検索しています…');
      candidates=await waitForCandidates(10000,ctx);
    }

    if(candidates.length) {
      const candidate=candidates[0];
      ctx.altTitle=candidate.title||candidate.path;
      ctx.route='opening'; saveContext(ctx);
      say('ALTの一致カードを開きます: '+ctx.altTitle);
      candidate.link.click();
      return;
    }
    report(ctx,false,'カード名・セット・言語・番号・グレードが一致するALT候補を取得できませんでした。');
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
    const candidates=[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],button,[role="button"],a,span,p,div')]
      .filter(el=>/recent transactions/i.test(norm(el.innerText||el.getAttribute('aria-label'))))
      .sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length);
    for(const candidate of candidates) {
      let node=candidate;
      for(let i=0;node&&i<10;i++,node=node.parentElement) {
        if(/recent transactions/i.test(norm(node.innerText||'')) && viewAllControls(node).length) return node;
      }
    }
    return candidates[0]||null;
  }
  async function openTransactions(timeoutMs=10000) {
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline) {
      const direct=viewAllControls(document);
      for(const control of direct) {
        let node=control;
        for(let i=0;node&&i<10;i++,node=node.parentElement) {
          if(/recent transactions/i.test(norm(node.innerText||''))) {
            control.click();
            return true;
          }
        }
      }
      const heading=recentTransactionsHeading();
      if(heading) {
        let node=heading;
        for(let i=0;node&&i<10;i++,node=node.parentElement) {
          if(!/recent transactions/i.test(norm(node.innerText||''))) continue;
          const control=viewAllControls(node)[0];
          if(control) { control.click(); return true; }
        }
      }
      await sleep(250);
    }
    return false;
  }
  function transactionsRoot() {
    const h=[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].find(x=>(x.innerText||'').trim().toLowerCase()==='market transactions');
    if(!h) return null;
    let n=h;
    for(let i=0;n&&i<9;i++,n=n.parentElement) {
      if(/market transactions/i.test(n.innerText||'') && n.querySelectorAll('a[href*="/itm/"],a[href*="ebay.com"]').length) return n;
    }
    return null;
  }
  function parseRows(root) {
    const seen=new Set(), out=[];
    for(const a of root.querySelectorAll('a[href]')) {
      const href=a.href||'', text=(a.innerText||'').replace(/\u00a0/g,' ').trim();
      if(!text||!/(?:\/itm\/|\/sold\/|ebay\.com\/itm\/)/i.test(href)||/listing\s*price|relisted|not\s*paid|unsold|alt\s*value/i.test(text)) continue;
      const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      const method=lines.find(x=>/^(auction|buy now|best offer|fixed price|sale)$/i.test(x));
      // Best Offer rows do not reliably expose the accepted offer amount; never use a displayed listing amount.
      if(!method || /^best offer$/i.test(method)) continue;
      const dateText=lines.find(x=>/^(?:[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})$/.test(x));
      const money=lines.find(x=>/^\$\s?[\d,]+(?:\.\d{1,2})?$/.test(x));
      if(!dateText||!money) continue;
      const d=new Date(dateText), price=Number(money.replace(/[$,\s]/g,''));
      if(!Number.isFinite(d.getTime())||!Number.isFinite(price)||price<=0) continue;
      const ebayId=(href.match(/ebay\.com\/itm\/(\d{9,15})/i)||[])[1];
      const key=ebayId?`ebay:${ebayId}`:href;
      if(seen.has(key)) continue;
      seen.add(key);
      let site='ALT'; try { site=a.querySelector('img[alt]')?.alt?.trim()||new URL(href).hostname.replace(/^www\./,''); } catch (_) {}
      out.push({ date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, price, site, href, method });
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

    let gradeButton=await waitFor(currentGradeButton);
    if(!gradeButton) { report(ctx,false,'ALTのPSAグレード欄を確認できません。'); return; }
    if(norm(gradeButton.innerText)!==norm(ctx.grade)) {
      gradeButton.click();
      const menuItem=await waitFor(()=>[...document.querySelectorAll('[role="menuitem"]')].find(el=>norm(el.innerText)===norm(ctx.grade)));
      if(!menuItem) { report(ctx,false,`${ctx.grade}の選択肢がALTにありません。`); return; }
      menuItem.click();
      gradeButton=await waitFor(()=>{ const el=currentGradeButton(); return el&&norm(el.innerText)===norm(ctx.grade)?el:null; });
      if(!gradeButton) { report(ctx,false,'ALTの表示グレードが切り替わりませんでした。'); return; }
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
    say(`ALT検索とグレード設定が完了しました。\n候補: ${ctx.altTitle||document.querySelector('h1')?.innerText}\nグレード: ${ctx.grade}\n最新: ${rows[0].date} $${rows[0].price} (${rows[0].method})\n前回: ${rows[1].date} $${rows[1].price} (${rows[1].method})\nカードの版・言語・番号がPSA公式と一致することを確認してから、右下のボタンでコピーしてください。`);
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
