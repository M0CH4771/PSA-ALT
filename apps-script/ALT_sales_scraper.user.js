// ==UserScript==
// @name         PSA-ALT Cert Search and Sales Copier
// @namespace    M0CH4771.PSA-ALT
// @version      3.12.0
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
    const cert = String(params.get('psaCert')||params.get('query')||'').trim();
    const grade = String(params.get('psaGrade')||'').trim();
    if (!/^\d{6,12}$/.test(cert) || !/^\d+(?:\.5)?$/.test(grade)) return;
    const nonce=String(params.get('psaNonce')||'');
    const batch=params.get('psaBatch')==='1' && /^[\w-]{10,100}$/.test(nonce);
    const ctx = { cert, grade:`PSA ${Number(grade)}`, cardName:params.get('psaName')||'', subject:params.get('psaSubject')||'', nonce, batch, createdAt:Date.now(), route:'browse' };
    saveContext(ctx);
    say(`ALT検索準備: ${ctx.cardName||ctx.subject}`);
  }

  b.hidden=/^\/browse\/?$/.test(location.pathname);

  function compact(value) {
    return norm(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}#]+/gu,'');
  }
  function coreSubject(label) {
    const text=String(label||'').trim();
    const number=text.match(/#\s*0*\d{1,4}\b/);
    if(!number) return '';
    const prefix=text.slice(0,number.index);
    let tail=text.slice(number.index+number[0].length).trim()
      .replace(/^(?:FA|FULL\s*ART|ALT\s*ART|SPECIAL\s*ART)\s*\/\s*/i,'')
      .replace(/\s+(?:SPECIAL\s+ART\s+RARE|ILLUSTRATION\s+RARE|SUPER\s+RARE|ULTRA\s+RARE|HYPER\s+RARE|SECRET\s+RARE|DOUBLE\s+RARE|COMMON|UNCOMMON|RARE|PROMO).*$/i,'');
    const stop=new Set((prefix.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]));
    return tail.split(/\s+/).filter(word=>!stop.has(word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,''))).join(' ').trim();
  }
  function visible(el) {
    return !!el && el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none';
  }
  // PSA groups some Asian cards into one label. Only override a cert whose
  // Japanese printed card and JPN. slab label were both manually verified.
  function identityTitle(ctx) {
    const title=String(ctx.cardName||'');
    if(ctx.cert==='99528219' && /2021 POKEMON ASIA 25TH ANNIVERSARY PROMO #001 FA\/PIKACHU V 25TH ANNIV-GOLDEN BOX/i.test(title))
      return '2021 POKEMON JAPANESE 25TH ANNIVERSARY GOLDEN BOX #001 PIKACHU V';
    return title;
  }
  function identityMatches(raw,ctx) {
    const title=identityTitle(ctx);
    const subject=coreSubject(title)||String(ctx.subject||'').trim();
    const number=(title.match(/#\s*0*(\d{1,4})\b/i)||[])[1];
    const year=(title.match(/\b(?:19|20)\d{2}\b/)||[])[0];
    const language=(title.match(/\b(japanese|korean|english|chinese|mandarin|cantonese|thai|indonesian|german|french|italian|spanish)\b/i)||[])[1];
    if(!subject||!number||!year) return false;
    if(!new RegExp('#\\s*0*'+number+'\\b','i').test(raw)||!raw.includes(year)) return false;
    if(language&&!new RegExp('\\b'+language+'\\b','i').test(raw)) return false;
    const words=value=>norm(value).match(/[\p{L}\p{N}]+/gu)||[];
    const actual=new Set(words(raw));
    if(norm(language)==='japanese' && /\b(korean|chinese|thai|indonesian|indonesia|cantonese|mandarin)\b/i.test(raw)) return false;
    if(!words(subject).every(w=>actual.has(w))) return false;
    const edition=/\b(?:1st|first)\s+edition\b/i;
    const unlimited=/\bunlimited\b/i;
    if(edition.test(title)!==edition.test(raw)||unlimited.test(title)!==unlimited.test(raw)) return false;
    const prefix=title.split(/#\s*\d/)[0];
    const setWords=words(prefix).filter(w=>! /^(pokemon|japanese|english|korean|chinese|tcg|card|and|sword|shield|\d{4}|sv\d+[a-z]?|s\d+[a-z]?)$/.test(w));
    return setWords.every(w=>actual.has(w));
  }

  function candidateItems(ctx) {
    const found=new Map();
    for(const el of document.querySelectorAll('a[href*="/itm/"],button,[role="button"],[role="row"],[role="option"],[tabindex],div,tr')) {
      if(!visible(el)||el===b||el.closest('header,nav,aside,footer')) continue;
      const raw=[el.innerText,el.getAttribute('aria-label'),el.title,...[...el.querySelectorAll('img[alt]')].map(img=>img.alt)].filter(Boolean).join(' ').trim();
      if(!raw||raw.length>500||!identityMatches(raw,ctx)) continue;
      let path='';
      const anchor=el.matches('a[href]')?el:el.querySelector('a[href*="/itm/"]');
      if(anchor) {
        try {
          const u=new URL(anchor.href);
          if(u.origin!==location.origin||!/^\/itm\/[0-9a-f-]+\/(?:external|research)\/?$/i.test(u.pathname)) continue;
          path=u.pathname;
        } catch (_) { continue; }
      }
      if(!path && (!/^(?:19|20)\d{2}\b/.test(String(el.innerText||'').trim()) || (!el.matches('button,[role="button"],[role="row"],[role="option"],[tabindex],tr') && getComputedStyle(el).cursor!=='pointer'))) continue;
      const key=path?path.replace(/\/(?:external|research)\/?$/,''):norm(raw);
      const previous=found.get(key);
      if(!previous||previous.link.contains(el)||(path && identityMatches(String(el.innerText||''),ctx) && !identityMatches(String(previous.link.innerText||''),ctx))) found.set(key,{link:el,title:raw,path,numberVerified:true});
    }
    const items=[...found.values()].filter((item,_,all)=>!all.some(other=>other!==item && item.link.contains(other.link)));
    // Individual listing UUIDs are alternative routes to the same graded card.
    // Keep them for fallback, but prefer an exact PSA grade over text-only rows.
    const gradeRe=new RegExp('\\b'+ctx.grade.replace(/\s+/g,'\\s+')+'(?![.\\d])','i');
    const results=new Map();
    for(const item of items) {
      const label=String(item.link.innerText||'').replace(/\s+/g,' ').trim();
      if(item.path && (!gradeRe.test(label)||!identityMatches(label,ctx))) continue;
      if(!item.path && !item.link.matches('button,[role="button"],[role="option"],[role="row"],tr,[tabindex]')) continue;
      const key=item.path||'text:'+compact(label.replace(/#\s*0+(?=\d)/g,'#'));
      if(!results.has(key)) results.set(key,{...item,key});
    }
    return [...results.values()].sort((a,b)=>Number(!!b.path)-Number(!!a.path));
  }

  function candidateKey(item) {
    return item.key||item.path||'text:'+compact(item.title);
  }
  function canRetry(ctx) {
    return (ctx.attempted||[]).length<5 && Date.now()-ctx.createdAt<48000;
  }
  function openCandidate(ctx,candidate) {
    const key=candidateKey(candidate);
    ctx.attempted=[...new Set([...(ctx.attempted||[]),key])];
    ctx.altTitle=candidate.title;
    ctx.numberVerified=true;
    ctx.route='opening';
    delete ctx.researchPath;
    saveContext(ctx);
    say('ALT一致候補を開きます ('+ctx.attempted.length+'件目): '+candidate.title);
    if(candidate.path) {
      location.assign(new URL(candidate.path,location.origin).href);
    } else if(candidate.link) {
      candidate.link.click();
      setTimeout(()=>{
        const current=readContext();
        if(current?.nonce===ctx.nonce && current.route==='opening' && current.attempted?.at(-1)===key && /^\/browse\/?$/.test(location.pathname))
          retryCandidate(current,'文字候補から詳細ページを開けませんでした。');
      },6000);
    }
  }
  function retryCandidate(ctx,reason) {
    const current=readContext();
    if(!current || current.nonce!==ctx.nonce) return;
    ctx.lastFailure=reason;
    if(!canRetry(ctx)) { report(ctx,false,reason); return; }
    const remaining=(ctx.candidates||[]).filter(item=>!(ctx.attempted||[]).includes(candidateKey(item)));
    const next=remaining.find(item=>item.path);
    if(next) { openCandidate(ctx,next); return; }
    if(!remaining.length) { report(ctx,false,reason); return; }
    // Text rows need a fresh DOM element after navigation.
    ctx.route='name-search'; delete ctx.researchPath; saveContext(ctx);
    const url=new URL('/browse',location.origin);
    url.searchParams.set('query',ctx.query);
    location.assign(url.href);
  }


  function browseSearchInput() {
    const exact=document.querySelector('#universal-search-autocomplete');
    if(visible(exact)&&!exact.disabled&&!exact.readOnly) return exact;
    const inputs=[...document.querySelectorAll('input')].filter(el=>visible(el)&&!el.disabled&&!el.readOnly&&
      /search\s+by\s+name\s+or\s+cert/i.test([el.placeholder,el.getAttribute('aria-label')].join(' ')));
    return inputs.length===1?inputs[0]:null;
  }
  async function submitSearch(input,query) {
    input.focus();
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(setter) setter.call(input,query); else input.value=query;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    await sleep(700);
    const actual=browseSearchInput();
    if(!actual||norm(actual.value)!==norm(query)) return false;
    // The real ALT combobox searches on input after debounce; Enter is unnecessary.
    return true;
  }

  async function openSingleCertCandidate() {
    const ctx=readContext();
    if(!ctx||!/^\/browse\/?$/.test(location.pathname)||!['browse','name-search'].includes(ctx.route)) return;
    const runKey='browse:'+ctx.nonce+':'+ctx.route;
    if(runningFor===runKey) return;
    runningFor=runKey;
    const full=identityTitle(ctx).trim();
    const subject=coreSubject(full);
    const number=(full.match(/#\s*0*(\d{1,4})\b/)||[])[1];
    const year=(full.match(/\b(?:19|20)\d{2}\b/)||[])[0];
    if(!subject||!number||!year) { report(ctx,false,'PSAカード名・年・型番を取得できません。'); return; }
    // Full PSA labels contain PSA-only codes and repeated variety names.
    const query=/25TH ANNIVERSARY GOLDEN BOX/i.test(full) ? subject+' Golden Box' : subject+' '+number.padStart(3,'0');
    const input=await waitFor(browseSearchInput,15000);
    if(!input) { report(ctx,false,'ALTの「Search by name or cert #」入力欄が見つかりません。'); return; }
    if(ctx.route==='browse') {
      ctx.route='name-search'; ctx.query=query; saveContext(ctx); runningFor='browse:'+ctx.nonce+':name-search';
      say('ALT検索欄に入力: '+query);
      // Navigate via the same query parameter ALT's visible search uses.
      // Avoid relying on synthetic Enter during React's initial rerender.
      const url=new URL('/browse',location.origin);
      url.searchParams.set('query',query);
      location.assign(url.href);
      return;
    }
    const verified=await waitFor(()=>{
      const el=browseSearchInput();
      return el&&norm(el.value)===norm(query)&&norm(new URLSearchParams(location.search).get('query'))===norm(query);
    },2500);
    if(!verified) { 
      const field=browseSearchInput();
      let applied=false;
      for(let attempt=0;attempt<3&&!applied;attempt++) {
        const current=browseSearchInput();
        if(current) applied=await submitSearch(current,query);
        if(!applied) await sleep(500);
      }
      if(!field || !applied) { report(ctx,false,'ALTの検索欄と検索URLがカード名に一致しません: '+query); return; }
      if(!await waitFor(()=>norm(browseSearchInput()?.value)===norm(query)&&norm(new URLSearchParams(location.search).get('query'))===norm(query),12000)) { report(ctx,false,'ALT検索の反映を確認できません: '+query); return; }
    }
    say('ALT検索確認済み: '+query);
    const deadline=Date.now()+25000;
    let candidates=[], signature='', stable=0;
    while(Date.now()<deadline) {
      const current=candidateItems(ctx).filter(item=>!(ctx.attempted||[]).includes(candidateKey(item)));
      const next=current.map(item=>item.path||norm(item.title)).sort().join('|');
      stable=next&&next===signature?stable+1:0;
      signature=next; candidates=current;
      if(candidates.length&&stable>=3) break;
      await sleep(400);
    }
    if(!candidates.length) {
      report(ctx,false,ctx.lastFailure||'検索は実行済みですが、カード条件が一致する画像付き商品・文字候補を取得できません。'); return;
    }
    ctx.candidates=candidates.map(({key,path,title})=>({key,path,title}));
    openCandidate(ctx,candidates[0]);
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
    const titlePattern = /market\s+transactions/i;
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
        if(titlePattern.test(node.innerText||'') && isVisible(node) && /\$\s?[\d,]+/.test(node.innerText||'') && node.querySelector('a[href]')) return node;
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
      if(!method) return null;
      if(/^best offer$/i.test(method) && /listing\s*price/i.test(text)) return null;
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

    const titleText=await waitFor(()=>[...document.querySelectorAll('h1,h2,[role="heading"]')].map(el=>String(el.innerText||'')).find(t=>identityMatches(t,ctx)),15000);
    if(!titleText) { retryCandidate(ctx,'ALTカード詳細でカード名・型番・セット・言語・版を照合できません。'); return; }
    const subject=coreSubject(identityTitle(ctx))||String(ctx.subject||ctx.cardName||'').trim();
    const subjectTerms=norm(subject).replace(/[^\p{L}\p{N}#']+/gu,' ').split(/\s+/).filter(x=>x.length>1&&!/^(pokemon|japanese|english|card|psa|gem|mt|super|rare|ultra|full|art)$/i.test(x));
    const titleCompact=compact(titleText);
    if(subjectTerms.length&&!subjectTerms.every(term=>titleCompact.includes(compact(term)))) {
      retryCandidate(ctx,'開いたALT商品名がPSA公式のカード名と一致しません。');
      return;
    }
    const expectedNumber=(ctx.cardName.match(/#\s*0*(\d{1,4})/i)||[])[1]||'';
    const titleNumbers=[...titleText.matchAll(/#\s*0*(\d{1,4})\b/g)].map(m=>String(Number(m[1])));
    if(expectedNumber && titleNumbers.length && !titleNumbers.includes(String(Number(expectedNumber)))) {
      retryCandidate(ctx,'開いたALT商品とPSA公式のカード番号が一致しません。');
      return;
    }
    if(expectedNumber && !titleNumbers.length && !ctx.numberVerified) {
      retryCandidate(ctx,'ALT商品ページでカード番号を確認できません。誤入力防止のため保留しました。');
      return;
    }
    // External listing pages expose PSA and grade as adjacent visible text,
    // whereas research pages expose a PSA grade dropdown button.
    function displayedGrade() {
      const button=currentGradeButton();
      if(button) return norm(button.innerText);
      const main=document.querySelector('main');
      const beforePopulation=String(main?.innerText||'').split(/PSA population/i)[0];
      const match=beforePopulation.match(/\b(PSA|CGC|BGS)\s+(\d+(?:\.\d+)?)\b/i);
      return match?norm(match[0]):'';
    }
    const gradeState=await waitFor(displayedGrade);
    const gradeButton=currentGradeButton();
    if(!gradeButton && gradeState!==norm(ctx.grade)) { retryCandidate(ctx,'ALT商品詳細のPSAグレードが一致しません。'); return; }
    if(gradeButton && norm(gradeButton.innerText)!==norm(ctx.grade)) {
      gradeButton.click();
      const menuItem=await waitFor(()=>[...document.querySelectorAll('[role="menuitem"],button,[role="option"]')].find(el=>norm(el.innerText)===norm(ctx.grade)));
      if(!menuItem) { retryCandidate(ctx,ctx.grade+'の選択肢がALTにありません。'); return; }
      menuItem.click();
      const selected=await waitFor(()=>{ const el=currentGradeButton(); return el&&norm(el.innerText)===norm(ctx.grade)?el:null; });
      if(!selected) { retryCandidate(ctx,'ALTでPSA '+ctx.grade+'を選択できませんでした。'); return; }
    }

    const opened=await waitFor(()=>{
      if(transactionsRoot()) return 'already-open';
      return recentTransactionsHeading()?'ready':null;
    },25000);
    if(!opened) { retryCandidate(ctx,'ALTの成約履歴欄が見つかりません。'); return; }
    if(opened!=='already-open' && !(await openTransactions())) { retryCandidate(ctx,'ALTの「Recent Transactions → VIEW ALL」を見つけられませんでした。'); return; }
    const root=await waitFor(transactionsRoot,30000);
    if(!root) { retryCandidate(ctx,'Market transactionsを開けませんでした。'); return; }
    let rows=await waitFor(()=>{ const parsed=parseRows(root); return parsed.length?parsed:null; },8000)||[];
    for(let i=0;rows.length<2&&i<5;i++) {
      const more=[...root.querySelectorAll('button')].find(x=>(x.innerText||'').trim().toLowerCase()==='show more'&&!x.disabled);
      if(!more) break;
      more.click(); await sleep(700); rows=parseRows(root);
    }
    if(rows.length<2) { retryCandidate(ctx,`同一条件の有効成約が${rows.length}件です。2件そろわないため価格を記入しません。`); return; }
    if(displayedGrade()!==norm(ctx.grade)) { retryCandidate(ctx,'成約取得後のPSAグレードが一致しません。'); return; }
    ctx.altTitle=titleText;
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
