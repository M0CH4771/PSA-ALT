// ==UserScript==
// @name         PSA-ALT Cert Search and Sales Copier
// @namespace    M0CH4771.PSA-ALT
// @version      2.0.0
// @description  Searches ALT by PSA cert, selects the exact PSA grade, opens sales history, and copies two eligible sales.
// @match        https://alt.xyz/browse*
// @match        https://alt.xyz/itm/*/research*
// @run-at       document-idle
// @grant        none
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

  function captureSearchRequest() {
    if (!/^\/browse\/?$/.test(location.pathname)) return;
    const params = new URLSearchParams(location.search);
    const cert = String(params.get('query')||'').replace(/\D/g,'');
    const grade = String(params.get('psaGrade')||'').trim();
    if (!/^\d{6,12}$/.test(cert) || !/^\d+(?:\.5)?$/.test(grade)) return;
    const ctx = { cert, grade:`PSA ${Number(grade)}`, cardName:params.get('psaName')||'', createdAt:Date.now(), route:'browse' };
    saveContext(ctx);
    say(`鑑定番号 ${cert} でALT検索中です。候補カードを確認しています…`);
  }

  b.hidden=/^\/browse\/?$/.test(location.pathname);

  function candidateButtons() {
    const ignored = /^(?:view all|hide filters|show filters|sort by|sold listings|saved searches|save search|buy|buy \/ offer|all items|auctions|fixed price)$/i;
    const byText = new Map();
    for (const el of document.querySelectorAll('button')) {
      const text=(el.innerText||'').replace(/\s+/g,' ').trim();
      if (!text || text.length < 18 || ignored.test(text) || /listing|filter|marketplace|category|grade|price range|year range/i.test(text)) continue;
      if (el.closest('[role="menu"]')) continue;
      byText.set(text,el);
    }
    return [...byText.values()];
  }

  async function openSingleCertCandidate() {
    const ctx=readContext();
    if (!ctx || !/^\/browse\/?$/.test(location.pathname) || ctx.route!=='browse') return;
    if (runningFor===`browse:${ctx.cert}`) return;
    runningFor=`browse:${ctx.cert}`;
    const deadline=Date.now()+20000;
    while(Date.now()<deadline) {
      const candidates=candidateButtons();
      if(candidates.length===1) {
        const title=(candidates[0].innerText||'').replace(/\s+/g,' ').trim();
        ctx.altTitle=title; ctx.route='opening'; saveContext(ctx);
        say(`ALT候補を開きます: ${title}\nPSA公式のカード情報と一致するか確認してください。`);
        candidates[0].click();
        return;
      }
      if(candidates.length>1) {
        say(`ALT候補が${candidates.length}件あります。誤選択防止のため自動選択を止めました。検索結果から該当カードを選んでください。`);
        return;
      }
      await sleep(400);
    }
    say('ALTの候補を取得できませんでした。検索結果を画面で確認してください。');
  }

  function currentGradeButton() {
    return [...document.querySelectorAll('button')].find(el=>/^PSA\s+\d+(?:\.\d+)?$/i.test((el.innerText||'').trim()));
  }
  async function waitFor(fn, ms=12000) {
    const end=Date.now()+ms;
    while(Date.now()<end) { const v=fn(); if(v) return v; await sleep(250); }
    return null;
  }
  function recentTransactionsHeading() {
    return [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].find(el=>/recent transactions/i.test((el.innerText||'').trim()));
  }
  async function openTransactions() {
    const heading=recentTransactionsHeading();
    if(!heading) return false;
    let node=heading;
    for(let i=0;node&&i<8;i++,node=node.parentElement) {
      if(!/recent transactions/i.test(node.innerText||'')) continue;
      const button=[...node.querySelectorAll('button')].find(x=>(x.innerText||'').trim().toLowerCase()==='view all');
      if(button) { button.click(); return true; }
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
      const dateText=lines.find(x=>/^(?:[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})$/.test(x));
      const money=lines.find(x=>/^\$\s?[\d,]+(?:\.\d{1,2})?$/.test(x));
      if(!method||!dateText||!money) continue;
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
    if(!ctx || !/^\/itm\/[0-9a-f-]+\/research\/?$/i.test(location.pathname)) return;
    if(ctx.route==='browse') { ctx.route='opening'; saveContext(ctx); }
    if(ctx.route!=='opening' && ctx.route!=='research') return;
    if(ctx.route==='research' && ctx.researchPath!==location.pathname) return;
    if(ctx.route==='opening') { ctx.route='research'; ctx.researchPath=location.pathname; saveContext(ctx); }
    const key=`research:${location.pathname}:${ctx.grade}`;
    if(runningFor===key) return;
    runningFor=key;
    say(`ALTカード: ${ctx.altTitle||'鑑定番号検索結果'}\nPSA ${ctx.grade} の履歴を準備しています…`);

    let gradeButton=await waitFor(currentGradeButton);
    if(!gradeButton) { say('ALTのPSAグレード欄を確認できません。'); return; }
    if(norm(gradeButton.innerText)!==norm(ctx.grade)) {
      gradeButton.click();
      const menuItem=await waitFor(()=>[...document.querySelectorAll('[role="menuitem"]')].find(el=>norm(el.innerText)===norm(ctx.grade)));
      if(!menuItem) { say(`${ctx.grade}の選択肢がALTにありません。別グレードは使わず、価格入力を止めてください。`); return; }
      menuItem.click();
      gradeButton=await waitFor(()=>{ const el=currentGradeButton(); return el&&norm(el.innerText)===norm(ctx.grade)?el:null; });
      if(!gradeButton) { say('ALTの表示グレードが切り替わりませんでした。'); return; }
    }

    const opened=await waitFor(()=>{
      if(transactionsRoot()) return 'already-open';
      return recentTransactionsHeading()?'ready':null;
    });
    if(!opened) { say('ALTの成約履歴欄が見つかりません。'); return; }
    if(opened!=='already-open' && !(await openTransactions())) { say('ALTの「Recent Transactions → VIEW ALL」を見つけられませんでした。'); return; }
    const root=await waitFor(transactionsRoot,15000);
    if(!root) { say('Sales Historyを開けませんでした。ALTの画面構成を確認してください。'); return; }
    let rows=parseRows(root);
    for(let i=0;rows.length<2&&i<5;i++) {
      const more=[...root.querySelectorAll('button')].find(x=>(x.innerText||'').trim().toLowerCase()==='show more'&&!x.disabled);
      if(!more) break;
      more.click(); await sleep(700); rows=parseRows(root);
    }
    if(rows.length<2) { say(`同一条件の有効成約が${rows.length}件です。2件そろわないため、価格は採用しません。`); return; }
    b.dataset.payload=[
      ['#ALT_META',ctx.altTitle||document.querySelector('h1')?.innerText||document.title,ctx.grade,location.href].join('\t'),
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
      const payload=[['#ALT_META',title,grade,location.href].join('\t'),...rows.slice(0,2).map(x=>[x.date,x.price.toFixed(2),x.site,x.href].join('\t'))].join('\n');
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
