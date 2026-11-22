# PSA-ALT barcode to summary

PSAバーコードのスキャンから、PSA公式情報の照合、ALTのSales History確認、指定日付の「まとめ」シートへの記入を行うApps Script Webアプリです。

## 重要: GitHub PagesではなくApps Script Webアプリとして動かします

GitHub Pagesは静的ファイルのホスティングです。Google Sheetsの認証済み書き込みを安全に行うため、このリポジトリはソース管理に使い、実際のサイトはGoogle Apps Script HTML Serviceで提供します。Apps Scriptの`google.script.run`経由で、ログイン中のユーザー権限を使ってシートを読み書きします。シートIDや認証情報はソースに含めません。

## フロー

1. 対象日付のまとめシートを選択
2. USBバーコードスキャナーでPSA証明番号を読み取り
3. PSAの公開証明ページからカード名・グレード・PSA画像を取得
4. PSA証明番号でALTを検索し、候補カードのResearchページを開く
5. ALTのPSAグレードを自動で選び、Sales Historyを表示
6. 対象カードの版・言語・型番が一致することを確認して、成約2件をコピー
7. サイトへ貼り付け、採用価格を計算して記入

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

`apps-script/ALT_sales_scraper.user.js`をTampermonkeyに登録します。PSA照合後、Webアプリの**ALTを自動検索**を押すと、ALTの鑑定番号検索結果から候補を開き、PSAグレードを選んでSales Historyまで進みます。ALT画面でカード名・セット・型番・版・言語がPSA公式情報と一致するか確認し、**条件を確認して2件コピー**を押してください。出力には検索した鑑定番号も含め、書き込み時にPSA番号・グレードとの一致を再確認します。Webアプリへ戻り、クリップボードから貼り付けます。

ALTの鑑定番号検索で候補が複数ある、PSAグレードが見つからない、または有効成約が2件ない場合は自動処理を止めます。条件違いの価格で補完しないでください。

## GitHub Pagesについて

この構成ではGitHub Pagesを公開しません。GitHubリポジトリはソースの履歴管理に使い、Apps Script WebアプリURLをスタッフへ共有します。このWebアプリはApps Scriptを開いたコンテナのスプレッドシートを対象に設定します。公開GitHubリポジトリにはシートIDやWebアプリURLをコミットしないでください。
