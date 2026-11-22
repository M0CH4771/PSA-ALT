const PSA_ALT_PROPERTIES = {
  targetSpreadsheetId: 'TARGET_SPREADSHEET_ID'
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('PSA バーコード価格調査')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getAppState() {
  const id = PropertiesService.getScriptProperties().getProperty(PSA_ALT_PROPERTIES.targetSpreadsheetId);
  if (!id) return { configured: false, sheets: [] };
  const ss = SpreadsheetApp.openById(id);
  return {
    configured: true,
    sheets: ss.getSheets().map(s => s.getName()).filter(n => /\d{1,2}\/\d{1,2}\s*まとめ/.test(n))
  };
}

function ensureSummarySheet(dateInput) {
  const id = PropertiesService.getScriptProperties().getProperty(PSA_ALT_PROPERTIES.targetSpreadsheetId);
  if (!id) throw new Error('最初に対象スプレッドシートを設定してください。');
  const match = String(dateInput || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('対象日を選択してください。');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw new Error('対象日が正しくありません。');
  }
  const ss = SpreadsheetApp.openById(id);
  const name = Utilities.formatDate(date, ss.getSpreadsheetTimeZone(), 'M/d') + ' まとめ';
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 11).setValues([[
      '証明番号', 'カード名', 'カード画像', '価格 USD', 'ALTリンク', '前回成約 USD', '', '採用価格 USD', '', '', '最新成約 USD'
    ]]);
    sheet.setFrozenRows(1);
  }
  summaryColumns_(sheet);
  return { sheet: name };
}

/**
 * Run once from the Apps Script editor opened via this spreadsheet's
 * Extensions > Apps Script menu. This binds the web app to its container
 * spreadsheet without asking the user to copy or enter a spreadsheet ID.
 */
function initializeBoundSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('対象スプレッドシートから「拡張機能 → Apps Script」を開いて実行してください。');
  const summaryTabs = ss.getSheets().filter(s => /\d{1,2}\/\d{1,2}\s*まとめ/.test(s.getName()));
  PropertiesService.getScriptProperties().setProperty(PSA_ALT_PROPERTIES.targetSpreadsheetId, ss.getId());
  return { saved: true, sheets: summaryTabs.map(s => s.getName()) };
}

function lookupPsaCert(certInput, nonce) {
  const cert = normalizeCert_(certInput);
  const token = String(nonce || '');
  if (!/^[\w-]{10,100}$/.test(token)) throw new Error('調査セッションが無効です。最初からやり直してください。');
  const url = `https://www.psacard.com/cert/${encodeURIComponent(cert)}/psa?psaBatch=1&psaCert=${encodeURIComponent(cert)}&psaNonce=${encodeURIComponent(token)}`;
  return { cert, nonce: token, psaUrl: url };
}

function writePricedCard(payload) {
  if (!payload || !payload.cert || !payload.targetSheet || !payload.altData) {
    throw new Error('鑑定番号・まとめシート・ALT成約情報が必要です。');
  }
  if (!payload.matchConfirmed) {
    throw new Error('PSA公式ページとALTのカード名・言語・版が一致することを確認してください。');
  }

  const cert = normalizeCert_(payload.cert);
  const psa = payload.psa || {};
  psa.grade = String(psa.grade || '').trim();
  psa.name = String(psa.name || '').trim();
  psa.imageUrl = String(psa.imageUrl || '').trim();
  psa.url = String(psa.url || '').trim();
  if (!/^PSA \d+(?:\.5)?$/.test(psa.grade) || !psa.name || !isPsaCertUrl_(psa.url, cert)) {
    throw new Error('PSA公式ページからの鑑定情報を確認できません。番号を保留しました。');
  }
  if (psa.imageUrl && !/^https:\/\/www\.psacard\.com\//i.test(psa.imageUrl)) psa.imageUrl = '';
  const alt = parseAltPaste_(payload.altData);
  if (alt.cert !== cert) throw new Error('ALTを今回のPSA鑑定番号から検索した記録ではありません。一括処理からやり直してください。');
  if (alt.grade !== psa.grade) throw new Error(`グレード不一致です。PSA公式=${psa.grade} / ALT=${alt.grade}`);
  if (!isAltResearchUrl_(alt.url)) throw new Error('ALTの「/research」ページURLを確認してください。');
  if (alt.sales.length < 2) throw new Error('有効な成約を2件確認できません。価格は記入しません。');

  const previous = alt.sales[1];
  const latest = alt.sales[0];
  const adopted = adoptedPrice_(previous.price, latest.price);
  const id = PropertiesService.getScriptProperties().getProperty(PSA_ALT_PROPERTIES.targetSpreadsheetId);
  if (!id) throw new Error('最初に対象スプレッドシートを設定してください。');
  const ss = SpreadsheetApp.openById(id);
  const sheet = ss.getSheetByName(String(payload.targetSheet));
  if (!sheet || !/\d{1,2}\/\d{1,2}\s*まとめ/.test(sheet.getName())) throw new Error('指定した日付まとめシートが見つかりません。');

  const cols = summaryColumns_(sheet);
  const lastRow = sheet.getLastRow();
  const existingCerts = lastRow >= 2
    ? sheet.getRange(2, cols.cert, lastRow - 1, 1).getDisplayValues().flat().map(v => String(v).trim())
    : [];
  if (existingCerts.includes(cert)) throw new Error(`証明番号 ${cert} はすでに「${sheet.getName()}」にあります。既存行は変更していません。`);

  const row = Math.max(2, lastRow + 1);
  if (lastRow >= 2) sheet.getRange(2, 1, 1, sheet.getLastColumn()).copyTo(
    sheet.getRange(row, 1, 1, sheet.getLastColumn()), { formatOnly: true }
  );
  sheet.getRange(row, cols.cert).setValue(cert);
  sheet.getRange(row, cols.name).setValue(psa.name);
  if (cols.image && psa.imageUrl) sheet.getRange(row, cols.image).setFormula(`=IMAGE("${psa.imageUrl}",1)`);
  sheet.getRange(row, cols.price).setValue(adopted.price);
  sheet.getRange(row, cols.alt).setValue(alt.url);
  sheet.getRange(row, cols.previous).setValue(previous.price);
  sheet.getRange(row, cols.adopted).setValue(adopted.price);
  sheet.getRange(row, cols.latest).setValue(latest.price);

  const checkedAt = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const evidence = [
    `調査日時: ${checkedAt}`,
    `PSA証明番号: ${cert}`,
    `PSA公式ページ: ${psa.url}`,
    `PSAグレード: ${psa.grade}`,
    `PSA公式画像: ${psa.imageUrl || 'なし'}`,
    `ALTカードページ: ${alt.url}`,
    `ALT表示カード名: ${alt.name}`,
    `ALT表示グレード: ${alt.grade}`,
    '',
    `最新成約: ${latest.date} / $${latest.price} / ${latest.site} / ${latest.url}`,
    `前回成約: ${previous.date} / $${previous.price} / ${previous.site} / ${previous.url}`,
    `採用価格: $${adopted.price}`,
    `判定: ${adopted.rule}`,
    '除外: Listing Price・Relisted・Not Paid・未落札・ALT Value'
  ].join('\n');
  sheet.getRange(row, cols.cert).setNote(`PSA公式照合\n${psa.url}\n${psa.grade}`);
  sheet.getRange(row, cols.previous).setNote(saleNote_('前回成約', previous, psa.grade));
  sheet.getRange(row, cols.latest).setNote(saleNote_('最新成約', latest, psa.grade));
  sheet.getRange(row, cols.price).setNote(evidence);
  sheet.getRange(row, cols.adopted).setNote(evidence);

  return { ok: true, row, sheet: sheet.getName(), cert, grade: psa.grade, name: psa.name, previous: previous.price, latest: latest.price, adopted: adopted.price };
}

function parseAltPaste_(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const metaLine = lines.find(line => line.startsWith('#ALT_META\t'));
  if (!metaLine) throw new Error('ALTスクレイパーの出力（#ALT_META付き）を貼り付けてください。');
  const meta = metaLine.split('\t');
  const name = String(meta[1] || '').trim();
  const gradeMatch = String(meta[2] || '').match(/PSA\s*(\d+(?:\.5)?)/i);
  const grade = gradeMatch ? `PSA ${Number(gradeMatch[1])}` : '';
  const url = String(meta[3] || '').trim();
  const cert = String(meta[4] || '').replace(/\D/g, '');
  if (!name || !grade || !url || !cert) throw new Error('ALTカード名・表示グレード・ページURL・検索した鑑定番号が読み取れません。ALT自動検索からやり直してください。');

  const sales = [];
  const seen = new Set();
  for (const line of lines) {
    if (line.startsWith('#ALT_META\t')) continue;
    const p = line.split('\t');
    if (p.length < 4 || /listing\s*price|relisted|not\s*paid|unsold|alt\s*value/i.test(line)) continue;
    const date = normalizeSaleDate_(p[0]);
    const price = Number(String(p[1]).replace(/[$,\s]/g, ''));
    const site = String(p[2] || '').trim();
    const saleUrl = String(p[3] || '').trim();
    if (!date || !Number.isFinite(price) || price <= 0 || !saleUrl) continue;
    const ebayId = (saleUrl.match(/ebay\.com\/itm\/(\d{9,15})/i) || [])[1];
    const key = ebayId ? `ebay:${ebayId}` : saleUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    sales.push({ date, price: Math.round(price * 100) / 100, site: site || '不明', url: saleUrl });
  }
  sales.sort((a, b) => b.date.localeCompare(a.date));
  return { name, grade, url, cert, sales };
}

function summaryColumns_(sheet) {
  const heads = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(v => String(v).replace(/\s+/g, '').toLowerCase());
  const find = aliases => { const i = heads.findIndex(v => aliases.includes(v)); return i < 0 ? 0 : i + 1; };
  const c = {
    cert: find(['証明番号', '鑑定番号']), name: find(['名前', 'カード名']), image: find(['カード画像', '画像']),
    price: find(['価格usd', '価格']), alt: find(['altリンク', 'alturl']),
    previous: find(['直前成約usd', '前回成約usd']), adopted: find(['採用価格usd', '採用価格']),
    latest: find(['最新成約usd', '最新成約'])
  };
  const missing = Object.entries(c).filter(([k, v]) => k !== 'image' && !v).map(([k]) => k);
  if (missing.length) throw new Error(`まとめシートの見出しが不足しています: ${missing.join(', ')}`);
  return c;
}

function adoptedPrice_(previous, latest) {
  if (latest >= previous * 1.3) return { price: previous, rule: '最新 >= 前回×1.30 のため前回価格' };
  if (previous >= latest * 1.3) return { price: Math.round((latest * 1.3 + Number.EPSILON) * 100) / 100, rule: '前回 >= 最新×1.30 のため最新×1.30' };
  return { price: latest, rule: '30%以上の乖離なしのため最新価格' };
}

function normalizeCert_(value) {
  const cert = String(value || '').replace(/\D/g, '');
  if (!/^\d{6,12}$/.test(cert)) throw new Error('PSA証明番号を読み取れません。');
  return cert;
}

function isAltResearchUrl_(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'alt.xyz' && /\/itm\/[0-9a-f-]+\/research\/?$/i.test(u.pathname);
  } catch (_) { return false; }
}

function isPsaCertUrl_(value, cert) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'www.psacard.com' &&
      new RegExp(`^/cert/${cert}/psa/?$`, 'i').test(u.pathname);
  } catch (_) { return false; }
}

function normalizeSaleDate_(value) {
  const s = String(value || '').trim();
  let d;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Etc/UTC', 'yyyy-MM-dd');
}

function saleNote_(label, sale, grade) {
  return `${label}: $${sale.price}\n成約日: ${sale.date}\n取引サイト: ${sale.site}\n取引URL: ${sale.url}\nグレード: ${grade}`;
}

function decodeHtml_(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
