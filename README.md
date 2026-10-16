# 天気データ配信（WeatherFeed）

VRChat ワールドの天気システムに、天気データを配る仕組みです。2つあります。

| 配信 | 精度 | 誰に効くか | 必要なもの |
|---|---|---|---|
| **GitHub Pages**（必須） | 国・地域（例：日本なら東京） | 来場者全員 | GitHub の無料アカウント |
| **Cloudflare Worker**（任意） | 市区町村レベル | VRChat の設定で「Allow Untrusted URLs」をオンにしている来場者だけ | Cloudflare の無料アカウント |

来場者に場所を尋ねることはありません。

- **GitHub Pages**：PC の時差と VRChat の表示言語から、地域を自動で推定します
- **Cloudflare Worker**：アクセス元のおおよその位置（Cloudflare が判定）を使います。IP アドレスは読み取らず、記録もしません

天気データは [Open-Meteo.com](https://open-meteo.com/)（CC BY 4.0、非商用は無料・API キー不要）から取得します。ワールド内のパネルにクレジットを表示しています。

---

## 1. GitHub Pages（必須）

1時間に2回、世界66地点の天気を取得し、`weather.json` として公開します。

1. GitHub にログインし、右上の「＋」→「New repository」を開く
2. 名前を入力（例：`vrc-weather-feed`）し、**Public** を選んで「Create repository」を押す
   - 無料プランの GitHub Pages は Public リポジトリでしか使えません
3. このフォルダ（`WeatherFeed`）の中身をアップロードする
   - 中身は `.github`、`scripts`、`cloudflare-worker`、`README.md` です
   - ブラウザから入れる場合：リポジトリ画面の「uploading an existing file」にフォルダごとドラッグ＆ドロップして「Commit changes」
   - `.github` フォルダは隠しフォルダです。表示されない場合はエクスプローラーの「表示」→「隠しファイル」をオンにしてください
4. リポジトリの「Settings」→「Pages」→「Build and deployment」の Source を **GitHub Actions** にする
5. 「Actions」タブを開き、ワークフローの有効化を求められたら有効にする
6. 左の「Update weather feed」→「Run workflow」で1回手動実行する（1〜2分で完了）
7. 次の URL をブラウザで開き、JSON が表示されれば完了です

   ```
   https://<GitHubのユーザー名>.github.io/<リポジトリ名>/weather.json
   ```

以降は毎時23分と53分ごろに自動で更新されます。ただし GitHub の定期実行は、混雑していると遅れたり飛ばされたりすることがあり、数時間更新されないこともあります（特に混雑する毎時0分付近は避けています）。すぐに更新したいときは、手順6と同じく「Run workflow」で手動実行してください。

GitHub は60日間動きのないリポジトリの定期実行を止めますが、このワークフローは50日ごとに空のコミットをして止まらないようにしています。

## 2. Cloudflare Worker（任意・市区町村レベル）

1. [Cloudflare](https://dash.cloudflare.com/sign-up) に無料登録してログインする
2. 左メニューの「Workers & Pages」→「Create」→「Create Worker」を開く
3. 名前を入力（例：`vrc-weather`）して「Deploy」を押す
4. 「Edit code」を開き、中身をすべて `cloudflare-worker/worker.js` の内容に置き換えて「Deploy」を押す
5. 表示される URL をブラウザで開き、自分の地域の天気の JSON が表示されれば完了です

   ```
   https://vrc-weather.<あなたのサブドメイン>.workers.dev/
   ```

無料枠（1日10万リクエスト）で十分です。同じ地域（約10km四方）の結果は30分キャッシュするので、Open-Meteo への問い合わせも少なく済みます。

## 3. Unity に URL を設定する

1. Hierarchy で `WeatherSystem` → `Controller` を選ぶ
2. Inspector の `Weather Controller` で、次の2つを入力する
   - **Feed Url**：手順1の `weather.json` の URL
   - **City Url**：手順2の Worker の URL（使わない場合は空欄のまま）
3. シーンを保存し、いつもどおりワールドをアップロードする

`Tools > Weather System > Build In Scene` で作り直しても、入力した URL は引き継がれます。

---

## 仕組みのメモ

- VRChat のワールドは、許可されたドメイン（`*.github.io` など）からしか文字列データを読めません。そのため GitHub Pages を経由しています
- `*.workers.dev` は許可リストにありません。そのため Worker は「Allow Untrusted URLs」をオンにした人にだけ届きます。届かない人は、自動で GitHub Pages のデータを使います
- 地点の一覧を変えたいときは `scripts/build_weather.py` の `LOCATIONS` を編集します
  - 書式：`(名前, 緯度, 経度, 標準時差(分), 夏時間あり, 言語ヒント)`
  - 同じ時差の地点が複数あるときは、VRChat の表示言語が一致するものを優先し、なければ上にあるものを使います
