# PSA-ALT barcode to summary

PSAバーコードのスキャンから、PSA公式情報の照合、ALTのSales History確認、指定日付の「まとめ」シートへの記入を行うApps Script Webアプリです。

## 重要: GitHub PagesではなくApps Script Webアプリとして動かします

GitHub Pagesは静的ファイルのホスティングです。Google Sheetsの認証済み書き込みを安全に行うため、このリポジトリはソース管理に使い、実際のサイトはGoogle Apps Script HTML Serviceで提供します。Apps Scriptの`google.script.run`経由で、ログイン中のユーザー権限を使ってシートを読み書きします。シートIDや認証情報はソースに含めません。

## フロー

1. 対象日付のまとめシートを選択
2. USBバーコードスキャナーでPSA証明番号を読み取り
3. PSAの公開証明ページからカード名・グレード・PSA画像を取得
4. ALTで同一カード・版・言語・グレードのResearchページを確認
5. Market transactionsを表示し、Tampermonkeyスクリプトで有効成約2件をコピー
6. サイトへ貼り付け、カード一致を確認して価格を記入

ALTはブラウザで描画された画面を読み取ります。Best OfferにListing Priceと表示される取引、Relisted、Not Paid、価格不明、ALT Valueは取り込みません。2件そろわない場合は記入を止めます。

## Google Apps Scriptへの配置

1. 価格調査スプレッドシートを開き、**拡張機能 → Apps Script** からコンテナバウンドのApps Scriptを作ります。
2. `apps-script/Code.gs`と`apps-script/Index.html`をそれぞれApps Scriptへコピーし、マニフェストを`appsscript.json`へ反映します。
3. **デプロイ → 新しいデプロイ → ウェブアプリ**を選びます。実行ユーザーを「ウェブアプリにアクセスしているユーザー」にし、アクセス範囲は社内アカウントまたは許可されたGoogleアカウントに限定します。匿名アクセスは使わないでください。
4. 対象スプレッドシートから開いたApps Scriptエディタで`initializeBoundSpreadsheet`を選んで一度実行します。これにより、そのコンテナのスプレッドシートIDをApps Scriptのプロパティに保存します。Webアプリ画面でIDを入力する必要はありません。
5. ウェブアプリを開きます。利用者には対象シートの編集権限が必要です。
6. 初回実行時にGoogle Sheetsと外部ページ取得の権限を承認します。

対象ブックには1行目に次の列見出しがある日付まとめシートを使います: `証明番号`, `名前`, `カード画像`, `価格 USD`, `ALTリンク`, `直前成約 USD`, `採用価格 USD`, `最新成約 USD`。既存の証明番号・行順を保ち、新しい番号は末尾へ追加します。

## ALT用ユーザースクリプト

`apps-script/ALT_sales_scraper.user.js`をTampermonkeyなどに登録します。ALTのResearchページでPSAグレードが合っていることを確認し、**Recent Transactions → VIEW ALL**を開いてから「ALT成約2件をコピー」を押します。サイトに戻り、クリップボードから貼り付けてください。

## GitHub Pagesについて

この構成ではGitHub Pagesを公開しません。GitHubリポジトリはソースの履歴管理に使い、Apps Script WebアプリURLをスタッフへ共有します。このWebアプリはApps Scriptを開いたコンテナのスプレッドシートを対象に設定します。公開GitHubリポジトリにはシートIDやWebアプリURLをコミットしないでください。
