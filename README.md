# 天気データ配信（WeatherFeed）

VRChat ワールドの天気システムに、天気データを配る仕組みです。2つあります。

| 配信 | 精度 | 誰に効くか | 必要なもの |
|---|---|---|---|
| **GitHub Pages**（必須） | 国・地域（例：日本なら東京） | 来場者全員 | GitHub の無料アカウント |
| **Cloudflare Worker**（任意） | 市区町村レベル | VRChat の設定で「Allow Untrusted URLs」をオンにしている来場者だけ | Cloudflare の無料アカウント |

来場者に場所を尋ねることはありません。

- **GitHub Pages**：PC の時差と VRChat の表示言語から、地域を自動で推定します
- **Cloudflare Worker**：アクセス元のおおよその位置（Cloudflare が判定）を使います。位置も IP アドレスも記録しません（IP アドレスは回数制限のためだけに、元に戻せない形（ソルト付きハッシュ）にして数分間メモリに置きます）

天気データは [Open-Meteo.com](https://open-meteo.com/)（CC BY 4.0、非商用は無料・API キー不要）から取得します。ワールド内のパネルにクレジットを表示しています。

---

## 1. GitHub Pages（必須）

約1時間ごとに世界66地点の天気を取得し、`weather.json` として公開します。

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

以降は、ワークフローが10分おきに起動し、公開中の `weather.json` が50分以上古いときだけ新しく取得して公開します（だいたい1時間ごとの更新）。GitHub の定期実行は混雑していると遅れたり飛ばされたりしますが、起動の回数を多くしているので、いくつか飛ばされても1時間前後で更新されます。新しいときは何もせずに終わるので、Open-Meteo への問い合わせは多くても1時間に1回強です（無料枠の約2割）。すぐに更新したいときは、手順6と同じく「Run workflow」で手動実行してください（手動のときは古さに関係なく更新します）。

ただし実際には、GitHub の定期実行は数時間まったく動かないことがあります。公開ワールドでは、Cloudflare Worker から毎時確実に起動する設定（「4. 安全のための設定」の「定期更新を確実にする」）もしておくことをおすすめします。

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

6. 公開ワールドで使うときは、続けて「4. 安全のための設定」の鍵とログの設定をしてください

無料枠（1日10万リクエスト）で十分です。同じ地域（約10km四方）の結果は30分キャッシュするので、Open-Meteo への問い合わせも少なく済みます。1つの IP アドレスからは10分間に20回までしか答えないので（それ以上は 429）、1人に無料枠を使い切られることもありません。ワールドは1人につき約1時間に1回しか読まないので、同じ回線から何人か来ても届きます。

## 3. Unity に URL を設定する

1. Hierarchy で `WeatherSystem` → `Controller` を選ぶ
2. Inspector の `Weather Controller` で、次の2つを入力する
   - **Feed Url**：手順1の `weather.json` の URL
   - **City Url**：手順2の Worker の URL（使わない場合は空欄のまま）。鍵を使うときは末尾に `?k=<鍵>` を付けます（手順4）
3. シーンを保存し、いつもどおりワールドをアップロードする

`Tools > Weather System > Build In Scene` で作り直しても、入力した URL は引き継がれます。

## 4. 安全のための設定（公開ワールド向け）

### Worker の鍵（ワールド経由だけで使えるようにする）

Worker に鍵（シークレット `ACCESS_KEY`）を設定すると、URL の末尾に同じ鍵（`?k=<鍵>`）が付いたアクセスだけに答え、ほかは断ります（403）。

1. 鍵を用意する：`cloudflare-worker/ACCESS_KEY.txt`（このファイルは `.gitignore` で除外しているので、GitHub には上がりません）。なければ、英数字32文字くらいの長いランダムな文字列を作って保存します
2. Unity の **City Url** を `https://vrc-weather.<あなたのサブドメイン>.workers.dev/?k=<鍵>` にして、ワールドをアップロードする
3. 新しい `worker.js` をデプロイする（手順2の4。鍵を設定するまでは、これまでどおり誰でも使えます）
4. Cloudflare で Worker を開き、「Settings」→「Variables and Secrets」→「Add」で次を入れて「Deploy」を押す
   - Type：**Secret**
   - Variable name：`ACCESS_KEY`
   - Value：`ACCESS_KEY.txt` の中身
5. 確かめる：鍵なしの URL をブラウザで開くと `{"error":"forbidden"}`、`?k=<鍵>` 付きなら天気の JSON が出れば完了です

手順2のアップロードより先に鍵を設定すると、その間はワールドの市区町村データが断られ、地域データになります（壊れはしません）。鍵を設定すると、鍵の入っていない古いワールドの版も地域データになります。

鍵はワールドのデータと VRChat のログ（読み込んだ URL を書くため）に入るので、完全な秘密ではありません。よそのサイトやワールドから気軽に使われるのを防ぐためのもので、無料枠を守る本命は回数制限です。鍵を変えるときも、ワールドを先に更新してから `ACCESS_KEY` を変えます。

### Worker のログをオフにする

`worker.js` は自分では何もログに書きませんが、Cloudflare の「Workers Logs」がオンだと、リクエストの情報（URL、Cloudflare が推定した国・都市など）が Cloudflare 側に保存されます。

1. Worker の「Settings」→「Observability」を開く
2. **Workers Logs** をオフ（Disable）にする。**Traces** があればそれもオフにする
3. 「Logpush」を設定していないことを確かめる（初期状態では設定されていません）

「Real-time Logs（Log Stream）」は、ダッシュボードで開いている間だけ流れて保存されないので、そのままで構いません。

### 定期更新を確実にする（Cloudflare の Cron Trigger）

GitHub の定期実行（`schedule`）は混んでいると数時間遅れるため、Worker が10分ごとに `weather.json` の古さを確かめ、50分以上古ければ GitHub にワークフローの実行を頼みます（`workflow_dispatch`）。ワークフロー側でももう一度古さを確かめるので、GitHub 自身の定期実行と重なっても更新は1回だけです。Open-Meteo への問い合わせ回数は今までと同じ上限（多くても1時間に1回強）のままです。

1. 新しい `worker.js` をデプロイする（手順2の4。下の設定をするまでは、この機能は何もしません）
2. GitHub でトークンを作る：右上のアイコン →「Settings」→ 左下の「Developer settings」→「Personal access tokens」→「Fine-grained tokens」→「Generate new token」
   - Token name：わかる名前（例：`vrc-weather-feed-start`）
   - Expiration：選べる中で長め（例：1年）。期限の前に GitHub からメールが来ます
   - Repository access：**Only select repositories** で、このリポジトリだけを選ぶ
   - Permissions → Repository permissions → **Actions** を **Read and write** にする（ほかは触らない）
   - 「Generate token」を押し、表示されたトークンをコピーする（一度しか表示されません）
3. Cloudflare で Worker を開き、「Settings」→「Variables and Secrets」→「Add」で次の2つを入れて「Deploy」を押す
   - Type **Text**、Variable name `GITHUB_REPO`、Value `<GitHubのユーザー名>/<リポジトリ名>`（例：`someone/vrc-weather-feed`）
   - Type **Secret**、Variable name `GITHUB_TOKEN`、Value 手順2のトークン
4. 同じ「Settings」の「Trigger Events」（画面によっては「Triggers」）→「Add」→「Cron Triggers」で、`*/10 * * * *`（10分ごと）を追加する
5. 確かめる：1時間ほどで、GitHub の「Actions」タブに `workflow_dispatch` の実行が出てくれば完了です。Worker の Cron の過去の実行（Past cron events）で、失敗が続いていないかも見られます

- トークンでできるのは、このリポジトリの Actions（ワークフローの実行・取り消しなど）だけで、コードは変えられません。漏れたかもしれないときは、GitHub でそのトークンを削除してください
- トークンの期限が切れると Cron の実行が「失敗」になり、GitHub 自身の定期実行だけに戻ります。新しいトークンを作って `GITHUB_TOKEN` を入れ替えてください
- Worker の無料枠への影響は1日144回で、ほとんどありません。公開リポジトリなので Actions の実行も無料です
- 公開中の `weather.json` が GitHub Pages 以外の場所にあるときは、Text の `FEED_URL` にその URL を入れます。ワークフローが `main` 以外のブランチにあるときは `GITHUB_BRANCH` で指定します

### URL に出る名前

公開ワールドでは、次の名前が URL として VRChat のログに残り、誰でも見られます。気になる場合は変えられます（どちらも、変えたら新しい URL をワールドに入れてアップロードし直します）。

- **Cloudflare のサブドメイン**（`vrc-weather.<サブドメイン>.workers.dev`）：「Workers & Pages」の概要画面の右側にある「Subdomain」の「Change」で変えられます。アカウントのすべての Worker の URL が変わるので、先に新しい URL でワールドを更新するか、変えた直後にアップロードしてください
- **GitHub のユーザー名**（`<ユーザー名>.github.io`）：無料の Organization（例：ワールド名など、個人と結びつかない名前）を作り、その中に同じリポジトリを作り直して Pages を有効にします。新しい URL でワールドを更新したあと、古いリポジトリのワークフローを止めます（先に止めると、古い版のワールドが天気を読めなくなります）

---

## 仕組みのメモ

- VRChat のワールドは、許可されたドメイン（`*.github.io` など）からしか文字列データを読めません。そのため GitHub Pages を経由しています
- `*.workers.dev` は許可リストにありません。そのため Worker は「Allow Untrusted URLs」をオンにした人にだけ届きます。届かない人は、自動で GitHub Pages のデータを使います
- Worker の答えには、Cloudflare が推定した街の名前と、約10km単位に丸めた緯度・経度が入ります。ワールドはこれを各自の画面に出すだけで、ほかの人には送りません
- 地点の一覧を変えたいときは `scripts/build_weather.py` の `LOCATIONS` を編集します
  - 書式：`(名前, 緯度, 経度, 標準時差(分), 夏時間あり, 言語ヒント)`
  - 同じ時差の地点が複数あるときは、VRChat の表示言語が一致するものを優先し、なければ上にあるものを使います
