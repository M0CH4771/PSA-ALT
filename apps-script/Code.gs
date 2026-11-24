var PSA_ALT_PROPERTIES = {
  targetSpreadsheetId: 'TARGET_SPREADSHEET_ID'
};

var PSA_ALT_COLUMNS = {
  cert: 1,
  name: 2,
  image: 3,
  price: 4,
  alt: 5,
  previous: 6,
  adopted: 8,
  latest: 11,
  width: 11
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('PSA バーコード価格調査')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Run once from the Apps Script project opened through the target spreadsheet.
 * It saves this container-bound spreadsheet as the only write destination.
 */
function initializeBoundSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('対象スプレッドシートの「拡張機能 → Apps Script」から実行してください。');
  }
  PropertiesService.getScriptProperties().setProperty(
    PSA_ALT_PROPERTIES.targetSpreadsheetId,
    ss.getId()
  );
  return { saved: true, spreadsheetName: ss.getName() };
}

/**
 * Returns the browser URL. PSA data is read by the PSA Tampermonkey script,
 * not by UrlFetchApp, because PSA rejects server-side requests.
 */
function lookupPsaCert(certInput) {
  var cert = normalizeCert_(certInput);
  var nonce = Utilities.getUuid().replace(/-/g, '');
  // Keep app state in the URL fragment. PSA receives the clean canonical cert path,
  // while the userscript can still read the batch metadata from location.hash.
  var url = 'https://www.psacard.com/cert/' + encodeURIComponent(cert) +
    '/psa#psaBatch=1&psaCert=' + encodeURIComponent(cert) +
    '&psaNonce=' + encodeURIComponent(nonce);
  return { cert: cert, nonce: nonce, psaUrl: url };
}

function ensureSummarySheet(dateInput) {
  var ss = getBoundSpreadsheet_();
  var date = parseDateInput_(dateInput);
  var sheetName = Utilities.formatDate(
    date,
    ss.getSpreadsheetTimeZone(),
    'M/d'
  ) + ' まとめ';

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    setSummaryHeaders_(sheet);
  } else if (sheet.getLastRow() === 0 ||
             sheet.getRange(1, 1, 1, PSA_ALT_COLUMNS.width).getDisplayValues()[0].join('').trim() === '') {
    setSummaryHeaders_(sheet);
  }

  return { sheet: sheetName };
}

function writePricedCard(payload) {
  if (!payload || !payload.cert || !payload.targetSheet) {
    throw new Error('鑑定番号と記入先シートを確認してください。');
  }

  var cert = normalizeCert_(payload.cert);
  var psa = payload.psa || {};
  var name = String(psa.name || '').trim();
  var grade = normalizeGrade_(psa.grade);
  var psaUrl = String(psa.url || '').trim();
  var imageUrl = String(psa.imageUrl || '').trim();

  if (!name || !grade || !isPsaCertUrl_(psaUrl, cert)) {
    throw new Error('PSA公式ページの番号・カード名・グレードが確認できません。');
  }
  if (imageUrl && !isPsaImageUrl_(imageUrl)) imageUrl = '';

  var altCert = normalizeCert_(payload.altCert);
  var altGrade = normalizeGrade_(payload.altGrade);
  var altUrl = String(payload.altUrl || '').trim();
  var altName = String(payload.altName || '').trim();
  if (altCert !== cert) throw new Error('ALT検索の鑑定番号が一致しません。');
  if (!altGrade || altGrade !== grade) throw new Error('PSAとALTのグレードが一致しません。');
  if (!isAltResearchUrl_(altUrl)) throw new Error('ALT ResearchページのURLが確認できません。');
  if (payload.matchConfirmed !== true) throw new Error('PSAとALTのカード条件が確認されていません。');

  var sales = normalizeSales_(payload.sales);
  if (sales.length < 2) throw new Error('同一条件の成約が2件そろわないため、価格は記入しません。');

  var latest = sales[0];
  var previous = sales[1];
  var adopted = adoptedPrice_(previous.price, latest.price);
  var ss = getBoundSpreadsheet_();
  var sheet = ss.getSheetByName(String(payload.targetSheet));
  if (!sheet || !/^\d{1,2}\/\d{1,2} まとめ$/.test(sheet.getName())) {
    throw new Error('指定した日付まとめシートがありません。もう一度処理してください。');
  }

  var lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    setSummaryHeaders_(sheet);
    lastRow = 1;
  }
  var existing = lastRow > 1
    ? sheet.getRange(2, PSA_ALT_COLUMNS.cert, lastRow - 1, 1).getDisplayValues()
    : [];
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i][0]).trim() === cert) {
      throw new Error('鑑定番号 ' + cert + ' はすでに「' + sheet.getName() + '」にあります。既存行は変更していません。');
    }
  }

  var row = Math.max(2, lastRow + 1);
  if (lastRow >= 2) {
    var formatWidth = Math.max(PSA_ALT_COLUMNS.width, sheet.getLastColumn());
    sheet.getRange(2, 1, 1, formatWidth)
      .copyTo(sheet.getRange(row, 1, 1, formatWidth), { formatOnly: true });
  }

  sheet.getRange(row, PSA_ALT_COLUMNS.cert).setValue(cert);
  sheet.getRange(row, PSA_ALT_COLUMNS.name).setValue(name);
  if (imageUrl) {
    sheet.getRange(row, PSA_ALT_COLUMNS.image).setFormula('=IMAGE("' + imageUrl.replace(/"/g, '') + '",1)');
  }
  sheet.getRange(row, PSA_ALT_COLUMNS.price).setValue(adopted.price);
  sheet.getRange(row, PSA_ALT_COLUMNS.alt).setValue(altUrl);
  sheet.getRange(row, PSA_ALT_COLUMNS.previous).setValue(previous.price);
  sheet.getRange(row, PSA_ALT_COLUMNS.adopted).setValue(adopted.price);
  sheet.getRange(row, PSA_ALT_COLUMNS.latest).setValue(latest.price);

  var checkedAt = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  var evidence = [
    '調査日時: ' + checkedAt,
    'PSA証明番号: ' + cert,
    'PSA公式ページ: ' + psaUrl,
    'PSAグレード: ' + grade,
    'PSA公式画像: ' + (imageUrl || 'なし'),
    'ALTカードページ: ' + altUrl,
    'ALT表示カード名: ' + altName,
    'ALT表示グレード: ' + altGrade,
    '',
    '最新成約: ' + latest.date + ' / $' + latest.price + ' / ' + latest.site + ' / ' + latest.url,
    '前回成約: ' + previous.date + ' / $' + previous.price + ' / ' + previous.site + ' / ' + previous.url,
    '採用価格: $' + adopted.price,
    '判定: ' + adopted.rule
  ].join('\n');

  sheet.getRange(row, PSA_ALT_COLUMNS.cert).setNote('PSA公式照合\n' + psaUrl + '\n' + grade);
  sheet.getRange(row, PSA_ALT_COLUMNS.previous).setNote(saleNote_('前回成約', previous, grade));
  sheet.getRange(row, PSA_ALT_COLUMNS.latest).setNote(saleNote_('最新成約', latest, grade));
  sheet.getRange(row, PSA_ALT_COLUMNS.price).setNote(evidence);
  sheet.getRange(row, PSA_ALT_COLUMNS.adopted).setNote(evidence);

  return {
    ok: true,
    row: row,
    sheet: sheet.getName(),
    cert: cert,
    name: name,
    grade: grade,
    previous: previous.price,
    latest: latest.price,
    adopted: adopted.price
  };
}

function getBoundSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(
    PSA_ALT_PROPERTIES.targetSpreadsheetId
  );
  if (!id) {
    throw new Error('対象スプレッドシートの紐づけがありません。対象シートから initializeBoundSpreadsheet を一度実行してください。');
  }
  return SpreadsheetApp.openById(id);
}

function parseDateInput_(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('記入する日付を選択してください。');
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('選択した日付が正しくありません。');
  }
  return date;
}

function setSummaryHeaders_(sheet) {
  sheet.getRange(1, 1, 1, PSA_ALT_COLUMNS.width).setValues([[
    '証明番号',
    'カード名',
    'カード画像',
    '価格 USD',
    'ALTリンク',
    '前回成約 USD',
    '',
    '採用価格 USD',
    '',
    '',
    '最新成約 USD'
  ]]);
  sheet.setFrozenRows(1);
}

function normalizeSales_(input) {
  if (!Array.isArray(input)) throw new Error('ALT成約データがありません。');
  var sales = [];
  var seen = {};
  for (var i = 0; i < input.length; i++) {
    var item = input[i] || {};
    var method = String(item.method || '').toLowerCase();
    var status = String(item.status || '').toLowerCase();
    if (/best offer|listing|relisted|not paid|unsold|alt value/.test(method + ' ' + status)) continue;

    var date = String(item.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    var price = Number(String(item.price || '').replace(/[$,\s]/g, ''));
    var site = String(item.site || '').trim();
    var url = String(item.url || '').trim();
    if (!isFinite(price) || price <= 0 || !site || !/^https?:\/\//i.test(url)) continue;

    var ebayId = (url.match(/ebay\.com\/itm\/(\d{9,15})/i) || [])[1];
    var key = ebayId ? 'ebay:' + ebayId : url;
    if (seen[key]) continue;
    seen[key] = true;
    sales.push({
      date: date,
      price: Math.round(price * 100) / 100,
      site: site,
      url: url
    });
  }
  sales.sort(function(a, b) {
    return b.date.localeCompare(a.date);
  });
  return sales;
}

function normalizeCert_(value) {
  var cert = String(value || '').replace(/\D/g, '');
  if (!/^\d{6,12}$/.test(cert)) throw new Error('PSA証明番号が6〜12桁ではありません。');
  return cert;
}

function normalizeGrade_(value) {
  var match = String(value || '').match(/PSA\s*(\d+(?:\.5)?)/i);
  return match ? 'PSA ' + Number(match[1]) : '';
}

function adoptedPrice_(previous, latest) {
  if (latest >= previous * 1.3) {
    return { price: previous, rule: '最新 >= 前回×1.30 のため前回価格' };
  }
  if (previous >= latest * 1.3) {
    return {
      price: Math.round((latest * 1.3 + Number.EPSILON) * 100) / 100,
      rule: '前回 >= 最新×1.30 のため最新×1.30'
    };
  }
  return { price: latest, rule: '30%以上の乖離なしのため最新価格' };
}

function isPsaCertUrl_(value, cert) {
  // Apps Script V8 does not provide the browser URL constructor.
  var match = /^https:\/\/www\.psacard\.com\/cert\/(\d{6,12})\/psa\/?(?:[?#].*)?$/i.exec(String(value || '').trim());
  return !!match && match[1] === String(cert);
}

function isPsaImageUrl_(value) {
  // Allow only HTTPS URLs whose host is psacard.com or one of its subdomains.
  return /^https:\/\/(?:[a-z0-9-]+\.)*psacard\.com(?:[/:?#]|$)/i.test(String(value || '').trim());
}

function isAltResearchUrl_(value) {
  // Current ALT product pages may use either the research or external route.
  return /^https:\/\/alt\.xyz\/itm\/[0-9a-f-]+\/(?:research|external)\/?(?:[?#].*)?$/i.test(String(value || '').trim());
}

function saleNote_(label, sale, grade) {
  return label + ': $' + sale.price +
    '\n成約日: ' + sale.date +
    '\n取引サイト: ' + sale.site +
    '\n取引URL: ' + sale.url +
    '\nグレード: ' + grade;
}
