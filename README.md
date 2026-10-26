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
5. 続けて「4. 安全のための設定」の鍵（`ACCESS_KEY`）とログの設定をする。**鍵を設定するまで、Worker はすべてのアクセスを断ります**（設定を消してしまっても勝手に誰でも使える状態にならないように）
6. 確かめ方は「4. 安全のための設定」の「Worker の鍵」の手順5を見てください。Worker の URL はこの形です

   ```
   https://vrc-weather.<あなたのサブドメイン>.workers.dev/
   ```

無料枠（1日10万リクエスト）で十分です。同じ地域（約10km四方）の結果は30分キャッシュするので、Open-Meteo への問い合わせも少なく済みます。同じ IP アドレスからの連続アクセスは、10分間に20回を超えると断ります（429）。ただしこの回数は Worker のインスタンスごとに数えていて、Cloudflare はアクセスを複数のインスタンスに振り分けるので、確実な上限ではありません（実測では、同じ回線から38回続けても断られませんでした）。

断ったアクセス（403・429）も Cloudflare の1日10万回に数えられます。そのため、URL を知っている人がわざと大量にアクセスすると、その日の枠を使い切られることはあります（鍵がなくても同じです）。そうなってもワールドは地域データに切り替わるだけで、壊れません（日本時間の朝9時に枠が戻ります）。確実に防ぐ方法は「4. 安全のための設定」の「DoS（大量アクセス）への対策」にまとめています。

## 3. Unity に URL を設定する

1. Hierarchy で `WeatherSystem` → `Controller` を選ぶ
2. Inspector の `Weather Controller` で、次の2つを入力する
   - **Feed Url**：手順1の `weather.json` の URL
   - **City Url**：手順2の Worker の URL（使わない場合は空欄のまま）。鍵を使うときは末尾に `?k=<鍵>` を付けます（手順4）
3. シーンを保存し、いつもどおりワールドをアップロードする

`Tools > Weather System > Build In Scene` で作り直しても、入力した URL は引き継がれます。

## 4. 安全のための設定（公開ワールド向け）

### Worker の鍵（ワールド経由だけで使えるようにする）

Worker は、次の両方を満たすアクセスにだけ答え、ほかは理由を言わずに断ります（403）。

- URL の末尾に、シークレット `ACCESS_KEY` と同じ鍵（`?k=<鍵>`）が付いている。`ACCESS_KEY` が設定されていないときは、誰にも答えません
- VRChat の文字列の読み込みから来ている：User-Agent が `UnityPlayer/`（PC・Android）か `VRChat/`（iOS）で始まり、ブラウザが付ける情報（`Origin`、`Sec-Fetch-*`）がない。VRChat のログから鍵を拾った人が、ブラウザやほかのサイトからそのまま使うのを防ぎます。VRChat の User-Agent が変わって市区町村の天気が届かなくなったときは、Text の変数 `ALLOW_ANY_AGENT` に `1` を入れると、この確認だけを止められます

1. 鍵を用意する：`cloudflare-worker/ACCESS_KEY.txt`（このファイルは `.gitignore` で除外しているので、GitHub には上がりません）。なければ、英数字32文字くらいの長いランダムな文字列を作って保存します
2. Unity の **City Url** を `https://vrc-weather.<あなたのサブドメイン>.workers.dev/?k=<鍵>` にして、ワールドをアップロードする
3. Cloudflare で Worker を開き、「Settings」→「Variables and Secrets」→「Add」で次を入れて「Deploy」を押す
   - Type：**Secret**
   - Variable name：`ACCESS_KEY`
   - Value：`ACCESS_KEY.txt` の中身
4. 新しい `worker.js` をデプロイする（手順2の4。すでに鍵を設定してある Worker を新しい `worker.js` にするときは、この手順だけで済みます）
5. 確かめる
   - 鍵なしの URL、`?k=<鍵>` 付きの URL のどちらをブラウザで開いても `{"v":1,"src":"ip","error":"forbidden"}` になる（ブラウザは VRChat ではないので断られるのが正しい動きです）
   - ワールドに入り、VRChat のログ（`%USERPROFILE%\AppData\LocalLow\VRChat\VRChat\output_log_*.txt`）に `[Weather] Using city weather` が出れば完了です。`City download failed (forbidden)` が続くときは、鍵が合っていないか、VRChat の User-Agent が変わっています
   - パソコンから確かめたいときは、PowerShell で次を実行して天気の JSON が出れば答えています（`<鍵>` は自分で入れます。コマンドの履歴に鍵が残るので、終わったらウィンドウを閉じてください）

     ```
     curl.exe -A "UnityPlayer/2022.3.22f1-DWR (UnityWebRequest/1.0, libcurl/8.5.0-DEV)" "https://vrc-weather.<あなたのサブドメイン>.workers.dev/?k=<鍵>"
     ```

手順2のアップロードより先に鍵を設定すると、その間はワールドの市区町村データが断られ、地域データになります（壊れはしません）。鍵を設定すると、鍵の入っていない古いワールドの版も地域データになります。

鍵はワールドのデータと VRChat のログ（読み込んだ URL を書くため）に入り、User-Agent はまねできるので、どちらも完全な秘密ではありません。よそのサイトやワールドから気軽に使われるのを防ぐためのもので、わざと大量にアクセスされたときの対策にはなりません（手順2の最後を参照）。

**鍵を変えるとき**（鍵が出回ったと感じたときなど）は、古い鍵のワールドを止めずに切り替えられます。鍵は Worker・WAF の式（「DoS への対策」の3段目を設定したとき）・ワールドの3か所にあるので、3か所ともそろえて変えます。先に WAF と Worker を「古い鍵・新しい鍵のどちらでも通す」状態にしてからワールドを上げ、最後に古い鍵を外します。

1. 新しい鍵を作って `ACCESS_KEY.txt` を書き換える（古い鍵は、手順6が終わるまで控えておく）
2. **WAF**（設定しているとき）：そのドメインの「Security」→「WAF」→「Custom rules」で `VRChat 以外を止める` を開き、式の最後の `not http.request.uri.query contains "k=<鍵>"` を次の形に書き換えて「Deploy」（古い鍵・新しい鍵のどちらでも通ります）

   ```
   not (http.request.uri.query contains "k=<古い鍵>" or http.request.uri.query contains "k=<新しい鍵>")
   ```

3. **Worker**：今の `ACCESS_KEY` の値を、新しく作る Secret `ACCESS_KEY_PREVIOUS` に入れ、`ACCESS_KEY` を新しい鍵に変えて「Deploy」（この間は古い鍵・新しい鍵のどちらでも答えます）
4. 確かめる：「Worker の鍵」の手順5の `curl.exe` で（URL は今使っているもの）、古い鍵・新しい鍵のどちらでも天気の JSON が返ること
5. **ワールド**：Unity の **City Url** の鍵を新しいものにしてアップロードする（PC と Quest の両方に出しているときは、VRChat SDK の「Multi-Platform Build & Publish」で両方）
6. しばらくして（古い版のワールドにいる人が抜けたころ。数日が目安）、WAF の式を新しい鍵だけの形（`not http.request.uri.query contains "k=<新しい鍵>"`）に戻して「Deploy」し、Worker の `ACCESS_KEY_PREVIOUS` を消して「Deploy」
7. 確かめる：古い鍵では断られ（403）、新しい鍵では天気の JSON が返ること

手順5のアップロードを手順2・3より先にすると、新しい鍵が WAF か Worker に断られ、その間は市区町村の天気が届かずに地域データになります（壊れはしません）。

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

### DoS（大量アクセス）への対策

守りは3段になっています。

1. **Cloudflare 自体**：回線をあふれさせるような大きな攻撃（DDoS）は、無料プランでも Cloudflare が自動で吸収します
2. **Worker の中（`worker.js`）**
   - 断る確認は、手間のかからないもの（パス・User-Agent など）から先にして、断るときの負担を小さくしています
   - 同じアドレスからの回数制限（10分に20回）
   - **Open-Meteo を守る**：Open-Meteo への問い合わせは、Worker のインスタンスごとに1分30回まで。Open-Meteo が断ったり失敗したり（429・5xx・時間切れ）したら1分間は問い合わせない。あちこちの場所から一度に大量に来ても（約10km四方ごとに別の問い合わせになるのでキャッシュが効かない）、Open-Meteo の無料枠を使い切られません。その間の来場者には 503 を返し、ワールドは地域データを使います。キャッシュにある場所には今までどおり答えます
   - それでも、**Worker に届いたアクセスは、断ったものも1日10万回の枠に数えられます**。使い切られると、その日はワールドが地域データに切り替わります（壊れはしません。日本時間の朝9時に枠が戻ります）
3. **Worker の手前（本当の対策・独自ドメインが必要）**：Cloudflare の WAF で、鍵のないアクセスや VRChat 以外からのアクセス、同じアドレスからの連続アクセスを、Worker が動く前に止めます。止めたアクセスは Worker の枠を使いません

#### 3段目の設定（独自ドメインと WAF）

`*.workers.dev` には WAF のルールを付けられないため、Cloudflare に置いた自分のドメインが必要です。

1. **ドメインを用意する**：持っていなければ、Cloudflare の「Domain Registration」→「Register Domains」で買えます（年1,500円前後から。種類によって違います）。ほかで買ったドメインは、「Add a domain」で Cloudflare に追加し（Free プラン）、案内どおりネームサーバーを切り替えます
2. **Worker にドメインを付ける**：Worker の「Settings」→「Domains & Routes」→「Add」→「Custom domain」で、`weather.<あなたのドメイン>` のような名前を付ける
3. **WAF のカスタムルール**（無料で5つまで）：そのドメインの「Security」→「WAF」→「Custom rules」→「Create rule」
   - Rule name：`VRChat 以外を止める`
   - 「Edit expression」を開き、次を貼り付けて、`weather.<あなたのドメイン>` と `<鍵>` を自分のものに書き換える

     ```
     (http.host eq "weather.<あなたのドメイン>" and (http.request.method ne "GET" or http.request.uri.path ne "/" or not (starts_with(http.user_agent, "UnityPlayer/") or starts_with(http.user_agent, "VRChat/")) or not http.request.uri.query contains "k=<鍵>"))
     ```

   - 画面が式を受け付けないときは、`starts_with(http.user_agent, "UnityPlayer/")` を `http.user_agent contains "UnityPlayer/"` に（VRChat/ も同じように）書き換えてください（無料プランは正規表現が使えません）
   - Action：**Block** →「Deploy」
4. **レート制限ルール**（無料で1つ）：同じ「WAF」→「Rate limiting rules」→「Create rule」
   - Rule name：`連続アクセスを止める`
   - If incoming requests match：Field `URI Path`、Operator `equals`、Value `/`（無料プランは Hostname を選べず、パスなどしか使えません。ワールドが使うのは `/` だけです）
   - With the same characteristics：IP（無料プランはこれだけ）
   - When rate exceeds：Requests **10**、Period **10 seconds**（来場者は1時間に1回ほどなので、同じ回線から何人か同時に入っても十分な余裕です）
   - Then take action：**Block**、Duration **10 seconds** →「Deploy」
5. **ワールドの URL を変える**：Unity の **City Url** を `https://weather.<あなたのドメイン>/?k=<鍵>` にしてアップロードする
6. **workers.dev を止める**：古い版のワールドにいる人が抜けたころ（数日後）、Worker の「Settings」→「Domains & Routes」で **workers.dev** と **Preview URLs** を Disable にする。オンのままだと、WAF のない workers.dev の URL に直接アクセスされて、手前の守りを回り道されます

注意：

- このドメインでは **Bot Fight Mode** と **I'm Under Attack Mode** をオンにしないでください。ブラウザ向けの確認画面が出るので、VRChat の読み込みも止まってしまいます
- 独自ドメインも VRChat の許可リストにはないので、届くのは今までどおり「Allow Untrusted URLs」をオンにした人だけです
- Cron Trigger（定期更新の起動）は URL を使わないので、workers.dev を止めても動き続けます

#### 攻撃されているかの見方と、急いで止めたいとき

**見方**

- Worker の「Metrics」：1日のリクエスト数が急に増えていないか
- そのドメインの「Security」→「Events」：WAF が止めたアクセスの数と、どこから来ているか。鍵のないアクセスが WAF で止まっているだけなら、Worker も料金も使っていないので様子見で構いません
- 「Manage Account」→「Billing」の使用量と、予算アラートのメール（Workers Paid のとき）

**プランによる違い**

- **無料プラン**：Worker に届いたアクセスが1日10万回を超えると、Cloudflare が error 1027 を返し、ワールドは地域データに切り替わります（日本時間の朝9時に枠が戻ります）。お金はかかりません
- **Workers Paid**：1日の上限がなく止まらない代わりに、月1,000万回を超えた分は100万回ごとに 0.30 ドルかかります。使った量で自動的に止める設定はなく、予算アラートは知らせるだけなので、低い金額（1ドルほど）で設定しておきます

**急いで止めたいとき（独自ドメインと WAF があるとき）**

WAF で全部止めるのがいちばん早く、元にも戻しやすい方法です。止めたアクセスでは Worker が動かないので、料金も無料枠も使いません。ワールドは地域データに切り替わるだけで壊れず、定期更新の起動（Cron Trigger）も URL を使わないので動き続けます。

1. そのドメインの「Security」→「WAF」→「Custom rules」→「Create rule」
2. Rule name：`緊急停止`、「Edit expression」に次を貼り付けて `weather.<あなたのドメイン>` を書き換え、Action：**Block** →「Deploy」

   ```
   (http.host eq "weather.<あなたのドメイン>")
   ```

3. 落ち着いたら、ルールの一覧で `緊急停止` のスイッチをオフにする（消さずに残しておくと、次はスイッチ1つで止められます。無料プランのカスタムルールは5つまで）

止めた原因が鍵の出回りなら、止めている間に「鍵を変えるとき」の手順で鍵を変えてから、スイッチをオフにします。

**独自ドメインがまだないとき**：Worker の「Settings」→「Domains & Routes」で **workers.dev** を Disable にします。アクセスが Worker に届かなくなるので枠を使わず、ワールドは地域データに切り替わります（定期更新の起動は続きます）。落ち着いたら Enable に戻します

### Worker のその他の守り

`worker.js` は次のこともしています。

- 答えは、キャッシュされない・ページとして表示されない・ほかのサイトに埋め込まれたり読まれたりしない・検索に載らない設定（`no-store`、`nosniff`、`Content-Security-Policy`、`Cross-Origin-Resource-Policy` など）
- `/` 以外の道（パス）は 404、GET 以外は 405
- Open-Meteo と GitHub への問い合わせは、8〜10秒で返事がなければあきらめる
- Open-Meteo の値が範囲外（気温 −90〜60°など）や壊れた形のときは、使わずキャッシュもしない（502）
- 地名は、タグ・記号の `<` `>`・制御文字を取り除き、40文字までにしてから返す
- 鍵は SHA-256 にしてから一定時間で比べるので、断るまでの時間から鍵（の長さも）を探れない
- Cron の設定（`GITHUB_BRANCH`・`FEED_URL`・`GITHUB_REPO`）がおかしな形なら使わない。トークンは `api.github.com` にだけ送り、失敗の記録には状態の番号だけを書く

### GitHub のワークフローの守り

- 権限は最初は何もなしにして、仕事ごとに必要なものだけ（古さの確認：空のコミット用の書き込みだけ。公開：読み取りと Pages への公開だけ）
- 使っている Actions（`actions/checkout` など）は、タグではなくコミットの番号（SHA）で固定。タグは後から別のコードに付け替えられますが、SHA は変えられません。新しい版は Dependabot（`.github/dependabot.yml`）が月に1回、プルリクエストで知らせます。中身を見て「Merge」すれば更新されます
- イベントの値は環境変数で渡し、スクリプトの中に直接埋め込まない
- `scripts/build_weather.py` は、値が範囲外なら公開をやめる（前の `weather.json` が残る）

### アカウント側でしておくこと（おすすめ）

コードでは守れない部分です。どれも一度設定すれば済みます。

- **GitHub と Cloudflare の2段階認証**：アカウントを乗っ取られると、ここに書いた守りは全部意味がなくなります。GitHub は「Settings」→「Password and authentication」、Cloudflare は「My Profile」→「Authentication」
- **GitHub の Actions の初期権限を読み取りだけに**：リポジトリの「Settings」→「Actions」→「General」→「Workflow permissions」を **Read repository contents and packages permissions** にし、「Allow GitHub Actions to create and approve pull requests」をオフにする（このワークフローは必要な権限を自分で書いているので、そのまま動きます）
- **GitHub のシークレットの検出**：「Settings」→「Code security」（または「Security」）で **Secret scanning** と **Push protection** がオンか確かめる（鍵やトークンをうっかりコミットしようとすると止めてくれます）
- **Cloudflare の Preview URLs をオフに**：Worker の「Settings」→「Domains & Routes」で **Preview URLs** を Disable にする。オンのままだと、古い版の Worker（鍵の確認がない版など）を版ごとの URL で呼べることがあります
- **GitHub のトークン**：今のトークンは「このリポジトリの Actions だけ」の権限のまま、期限が来たら作り直す（「定期更新を確実にする」の注意を参照）

### URL に出る名前

公開ワールドでは、次の名前が URL として VRChat のログに残り、誰でも見られます。気になる場合は変えられます（どちらも、変えたら新しい URL をワールドに入れてアップロードし直します）。

- **Cloudflare のサブドメイン**（`vrc-weather.<サブドメイン>.workers.dev`）：「Workers & Pages」の概要画面の右側にある「Subdomain」の「Change」で変えられます。アカウントのすべての Worker の URL が変わるので、先に新しい URL でワールドを更新するか、変えた直後にアップロードしてください
- **GitHub のユーザー名**（`<ユーザー名>.github.io`）：無料の Organization（例：ワールド名など、個人と結びつかない名前）を作り、その中に同じリポジトリを作り直して Pages を有効にします。新しい URL でワールドを更新したあと、古いリポジトリのワークフローを止めます（先に止めると、古い版のワールドが天気を読めなくなります）

---

## 仕組みのメモ

- VRChat のワールドは、許可されたドメイン（`*.github.io` など）からしか文字列データを読めません。そのため GitHub Pages を経由しています
- `*.workers.dev` は許可リストにありません。そのため Worker は「Allow Untrusted URLs」をオンにした人にだけ届きます。届かない人は、自動で GitHub Pages のデータを使います
- Worker の答えには、Cloudflare が推定した街の名前と、約10km単位に丸めた緯度・経度が入ります。ワールドはこれを各自の画面に出すだけで、ほかの人には送りません
- 街の名前の細かさは、Cloudflare が接続元（プロバイダーの回線）をどこまで知っているかで決まります。街まで分からない回線では、都道府県などの名前（それもなければ国の記号）になります。来場者に場所を尋ねない限り、これより細かくはできません
- 地点の一覧を変えたいときは `scripts/build_weather.py` の `LOCATIONS` を編集します
  - 書式：`(名前, 緯度, 経度, 標準時差(分), 夏時間あり, 言語ヒント)`
  - 同じ時差の地点が複数あるときは、VRChat の表示言語が一致するものを優先し、なければ上にあるものを使います
