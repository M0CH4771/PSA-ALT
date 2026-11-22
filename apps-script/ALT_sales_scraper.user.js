// ==UserScript==
// @name         PSA-ALT Sales Copier
// @namespace    M0CH4771.PSA-ALT
// @version      1.1.0
// @description  Copies the two newest valid ALT sales for the selected PSA grade.
// @match        https://alt.xyz/itm/*/research*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  if (window.__psaAltCopy) return;
  window.__psaAltCopy = true;
  const b=document.createElement('button'); b.textContent='ALT成約2件をコピー';
  Object.assign(b.style,{position:'fixed',right:'20px',bottom:'20px',zIndex:'2147483647',padding:'12px 16px',border:0,borderRadius:'8px',background:'#2654c7',color:'#fff',font:'700 14px system-ui',boxShadow:'0 3px 12px #0004',cursor:'pointer'}); document.body.appendChild(b);
  const toast=document.createElement('div'); Object.assign(toast.style,{position:'fixed',right:'20px',bottom:'72px',zIndex:'2147483647',maxWidth:'440px',padding:'10px 14px',borderRadius:'7px',background:'#13233a',color:'#fff',font:'14px/1.45 system-ui',whiteSpace:'pre-line',display:'none'}); document.body.appendChild(toast);
  let timer; const say=s=>{toast.textContent=s;toast.style.display='block';clearTimeout(timer);timer=setTimeout(()=>toast.style.display='none',6000);};
  function rootForTransactions(){
    const h=[...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].find(x=>(x.innerText||'').trim().toLowerCase()==='market transactions');
    if(!h)return null; let n=h;
    for(let i=0;n&&i<7;i++,n=n.parentElement){if(n.querySelectorAll('a[href*="/itm/"],a[href*="ebay.com"]').length>0&&/market transactions/i.test(n.innerText||''))return n;}
    return null;
  }
  function parseRows(root){
    const seen=new Set(),out=[];
    for(const a of root.querySelectorAll('a[href]')){
      const href=a.href||'', text=(a.innerText||'').replace(/\u00a0/g,' ').trim();
      if(!text||!/(?:\/itm\/|\/sold\/)/i.test(href)||/listing\s*price|relisted|not\s*paid|unsold|alt\s*value/i.test(text))continue;
      const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      const method=lines.find(x=>/^(auction|buy now|best offer|fixed price|sale)$/i.test(x));
      const dateText=lines.find(x=>/^(?:[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})$/.test(x));
      const money=lines.find(x=>/^\$\s?[\d,]+(?:\.\d{1,2})?$/.test(x));
      if(!method||!dateText||!money)continue;
      const d=new Date(dateText), price=Number(money.replace(/[$,\s]/g,'')); if(!Number.isFinite(d.getTime())||!Number.isFinite(price)||price<=0)continue;
      const ebayId=(href.match(/ebay\.com\/itm\/(\d{9,15})/i)||[])[1]; const key=ebayId?`e:${ebayId}`:href; if(seen.has(key))continue; seen.add(key);
      const site=a.querySelector('img[alt]')?.alt?.trim()||new URL(href).hostname.replace(/^www\./,'');
      out.push({date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,price,site,href,method});
    }
    return out.sort((a,b)=>b.date.localeCompare(a.date));
  }
  async function copy(text){
    try{await navigator.clipboard.writeText(text);}catch(_){const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.left='-10000px';document.body.appendChild(t);t.select();if(!document.execCommand('copy'))throw new Error('クリップボードにコピーできません。');t.remove();}
  }
  b.addEventListener('click',async()=>{
    b.disabled=true;b.textContent='成約確認中…';
    try{
      const root=rootForTransactions();if(!root)throw new Error('先に「Recent Transactions」の「VIEW ALL」を開いてください。');
      const gm=(document.body.innerText||'').match(/\bPSA\s*(\d+(?:\.5)?)\b/i);if(!gm)throw new Error('ALT画面のPSAグレードを確認できません。');
      const name=(document.querySelector('h1')?.innerText||document.title||'').trim();if(!name)throw new Error('ALTカード名を読み取れません。');
      let rows=parseRows(root);
      for(let i=0;rows.length<2&&i<5;i++){const more=[...root.querySelectorAll('button')].find(x=>(x.innerText||'').trim().toLowerCase()==='show more'&&!x.disabled);if(!more)break;more.click();await new Promise(r=>setTimeout(r,700));rows=parseRows(root);}
      if(rows.length<2)throw new Error(`有効成約が${rows.length}件しかありません。2件未満は価格を決められません。`);
      const meta=['#ALT_META',name,`PSA ${Number(gm[1])}`,location.href].join('\t');
      const payload=[meta,...rows.slice(0,2).map(x=>[x.date,x.price.toFixed(2),x.site,x.href].join('\t'))].join('\n');
      await copy(payload);say(`コピーしました（${`PSA ${Number(gm[1])}`}）\n${rows[0].date} $${rows[0].price} / ${rows[0].method}\n${rows[1].date} $${rows[1].price} / ${rows[1].method}\nシート画面に戻り「クリップボードから貼り付け」を押してください。\nカード名・版・言語も確認してください。`);
    }catch(e){say(e.message||String(e));}finally{b.disabled=false;b.textContent='ALT成約2件をコピー';}
  });
})();
