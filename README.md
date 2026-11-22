# PSA-ALT barcode to summary

PSAバーコードのスキャンから、PSA公式情報の照合、ALTのSales History確認、指定日付の「まとめ」シートへの記入を行うApps Script Webアプリです。

## 重要: GitHub PagesではなくApps Script Webアプリとして動かします

GitHub Pagesは静的ファイルのホスティングです。Google Sheetsの認証済み書き込みを安全に行うため、このリポジトリはソース管理に使い、実際のサイトはGoogle Apps Script HTML Serviceで提供します。Apps Scriptの`google.script.run`経由で、ログイン中のユーザー権限を使ってシートを読み書きします。シートIDや認証情報はソースに含めません。

## 一括フロー

1. Webアプリで記入日を選択し、USBバーコードスキャナーで証明番号を続けて読み取る（スキャナーの末尾キーはEnter）。
2. 読み終えたら「検索して反映」を一度押す。
3. 選んだ日付の「M/d まとめ」シートがなければ作成し、PSA公式の証明情報を1件ずつ照合する。
4. ALTの鑑定番号検索をブラウザで開き、TampermonkeyがPSAグレードを合わせてSales Historyを取得する。
5. 一致する成約が2件あるカードだけ、採用価格を計算して記入する。条件確認できないカードは保留理由をリストに残し、次の番号へ進む。

日付まとめではD列とH列に同じ採用価格、E列にALT Researchリンク、F列に前回成約、K列に最新成約を書き、成約日時・取引サイト・元URLは価格セルや成約セルのメモに保存します。既存行と鑑定番号の順番は変えず、新しい番号を末尾へ追加します。

ALTはブラウザで描画された画面を読み取ります。Best Offer、Relisted、Not Paid、Listing Price、価格不明、ALT Valueは取り込みません。2件そろわない場合は記入を止めます。ALTの画面構成が変わった場合、ポップアップが閉じられた場合、Tampermonkeyが動かない場合は保留となります。

## Google Apps Scriptへの配置

1. 価格調査スプレッドシートを開き、**拡張機能 → Apps Script** からコンテナバウンドのApps Scriptを作ります。
2. `apps-script/Code.gs`と`apps-script/Index.html`をそれぞれApps Scriptへコピーし、マニフェストを`appsscript.json`へ反映します。
3. **デプロイ → 新しいデプロイ → ウェブアプリ**を選びます。実行ユーザーを「ウェブアプリにアクセスしているユーザー」にし、アクセス範囲は社内アカウントまたは許可されたGoogleアカウントに限定します。匿名アクセスは使わないでください。
4. 対象スプレッドシートから開いたApps Scriptエディタで`initializeBoundSpreadsheet`を選んで一度実行します。これにより、そのコンテナのスプレッドシートIDをApps Scriptのプロパティに保存します。Webアプリ画面でIDを入力する必要はありません。
5. ウェブアプリを開きます。利用者には対象シートの編集権限が必要です。
6. 初回実行時にGoogle Sheetsと外部ページ取得の権限を承認します。

日付まとめシートがまだない場合は、Webアプリが指定列の見出しを付けて作成します。既存のまとめシートを使う場合は、1行目に `証明番号`, `カード名`, `価格 USD`, `ALTリンク`, `前回成約 USD`, `採用価格 USD`, `最新成約 USD` に相当する見出しを置いてください。

## ALT用ユーザースクリプト

`apps-script/ALT_sales_scraper.user.js`をTampermonkeyに登録します。Webアプリの**検索して反映**を押すと、ALTの鑑定番号検索、PSAグレード選択、Sales History読取、書き込みをカードごとに自動で進めます。ブラウザがALTのポップアップをブロックした場合は許可してください。

ALTの鑑定番号検索で候補が複数ある、PSAグレードが見つからない、または有効成約が2件ない場合、そのカードは保留して次へ進みます。条件違いの価格で補完しません。

## GitHub Pagesについて

この構成ではGitHub Pagesを公開しません。GitHubリポジトリはソースの履歴管理に使い、Apps Script WebアプリURLをスタッフへ共有します。このWebアプリはApps Scriptを開いたコンテナのスプレッドシートを対象に設定します。公開GitHubリポジトリにはシートIDやWebアプリURLをコミットしないでください。
