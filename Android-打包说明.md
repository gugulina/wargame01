# Android 打包说明

> **v4.17–v4.26 之间没出过包**，versionCode 是手改的，从 10 一路涨到 18。
> v19 是第一个真正装着 4.27 引擎的包；它不是 v9 的下一版，中间隔了十个版本。

**当前包**：`dist/苍屿战役-v5.3-code32-debug.apk`（versionCode **32** / versionName **5.4**）· **8,253,124 字节 ≈ 7.57 MiB**（2026-11-13 构建：先出 code 24，UI 优化后重出 **code 26**，过程见 §零）
**上一版**：`苍屿战役-v19.apk`（versionCode 19 / versionName 4.27）· 7,849,232 字节 ≈ 7.49 MiB
**更早**：v9（code 9 / 4.15）· 7,743,691 ｜ v8 ｜ v7 ｜ v6 ｜ v5（26 MB——把开发 leftovers 打进了包）
**构建**：Capacitor 8.6.0 + Gradle 8.14.3 + JDK 21.0.2 + Android SDK 36（build-tools 35/36）

> 这份文档原先叫"测试报告"，里面有一批数对不上（写 Capacitor 7 实际是 8.5.3、写最低 API 21
> 实际 `minSdkVersion = 24`，还有几条本机无从复现的性能数字）。v6 重写：**能复现的流程写死，
> 没测过的明确标"未验证"**，不拿估计当结论。

---

## 零、2026-11-13 的 v5.3 包（code 24）

### 0.1 结论

| 项 | 值 |
|---|---|
| 产物 | `dist/苍屿战役-v5.3-code32-debug.apk` · 8,253,124 B（7.57 MiB） |
| 清单 | `package com.cangyu.wargame` · `versionCode 32` · `versionName 5.3` · `minSdk 24` · `targetSdk 36` · label **苍屿战役** |
| 包内引擎 | `#verTag` v5.3，且包含 2026-11-11 那批修复：C3 超额 35、存档 `turn` 校验、C9 编成文案、C7B「9 回合」、动态操作说明 |
| 签名 | **debug**（不可上架，只能自测/内部分发） |
| 真机 | **未验证**（本机无设备、无 adb 连接） |

### 0.2 这台机器上是从零搭的（原文档假设 Windows 上已有 JDK/SDK/Gradle）

工具链全部落在项目内、且**不进版本库**：

```
.tools/jdk/              OpenJDK 21.0.2（华为镜像，192 MB，19s）
.tools/android-sdk/      cmdline-tools + platforms;android-36 + build-tools 35.0.0/36.0.0 + platform-tools 37.0.3
.tools/gradle-8.14.3/    Gradle 发行版（华为镜像，131 MB，13s）
.tools/gradle-home/      GRADLE_USER_HOME（~99 MB 依赖缓存）
.tools/android-user/     ANDROID_USER_HOME（AGP 想写 ~/.android，这里给它一个能写的位置）
.tools/tmp/              java.io.tmpdir（AGP 的 CompressAssets 要写临时文件）
```

**为什么要这么摆**：本机是沙箱环境，Java 子进程只能写工作区内的路径。于是四个"默认在用户目录"的位置必须逐个改道——`GRADLE_USER_HOME`、`ANDROID_USER_HOME`、`java.io.tmpdir`、以及 SDK 本身。

### 0.3 四个坑（下次重搭会再踩）

1. **Gradle 需要 `~/.gradle`** → 报 `Could not initialize native services`。改道 `GRADLE_USER_HOME` 即可。
2. **AGP 需要 `~/.android`** → 报 `Failed to create service AndroidLocationsBuildService`。改道 `ANDROID_USER_HOME`；**不要同时设 `ANDROID_SDK_HOME`**，两个都设会报"Several environment variables contain different paths"。
3. **`sdkmanager` 连不上 Google 的仓库**（`Fetch remote repository` IO 异常）→ 直接按 `repository2-3.xml` 里的 URL 下 zip 手工铺目录：`platforms/android-36`、`build-tools/{35.0.0,36.0.0}`、`platform-tools`。还要手写 `licenses/android-sdk-license`（三行哈希），否则 AGP 拒绝。
4. **PowerShell 5.1 的 `Set-Content -Encoding utf8` 会写 BOM** → Groovy 报 `Unexpected character: '﻿'`。改 `build.gradle` 用 `[IO.File]::WriteAllText(..., UTF8Encoding($false))`。

另外：**中文路径**。项目在 `Documents\兵棋游戏`，AGP 与 aapt2 对非 ASCII 路径并不稳。做法是建一个 ASCII 联接点：

```powershell
cmd /c mklink /J C:\dev\wargame "C:\Users\ASUS\Documents\兵棋游戏"
```

构建在 `C:\dev\wargame\android` 里跑，产物再拷回 `dist/`。**仓库内容没变**，只是给构建器一条纯 ASCII 的路。

### 0.4 复现（四个命令）

```powershell
$env:JAVA_HOME="C:\dev\wargame\.tools\jdk"
$env:ANDROID_HOME="C:\dev\wargame\.tools\android-sdk"
$env:ANDROID_USER_HOME="C:\dev\wargame\.tools\android-user"
$env:GRADLE_USER_HOME="C:\dev\wargame\.tools\gradle-home"
$env:GRADLE_OPTS="-Dorg.gradle.native=false -Djava.io.tmpdir=C:\dev\wargame\.tools\tmp"
$env:TMP=$env:TEMP="C:\dev\wargame\.tools\tmp"

cd C:\dev\wargame
node tools/build-www.js                       # 43 文件 4.44 MB
node node_modules\@capacitor\cli\bin\capacitor copy android
cd android; ..\.tools\gradle-8.14.3\bin\gradle.bat --no-daemon assembleDebug
```

版本号在 `android/app/build.gradle`（`versionCode 32` / `versionName "5.4"`）。**`android/` 不入库**，所以每台机器 `cap add android` 之后都要重新改一次——这正是"版本号没有单一真源"的老问题（见 `docs/30` §8.3）。

### 0.5 验收怎么做的

1. `aapt2 dump badging`：核对 package / versionCode / versionName / minSdk / targetSdk / label（结果见 0.1）。
2. 解包读 `assets/public/game/campaign.html`：确认 v5.3 与四处修复文案都在（不是拷了旧 `www`）。
3. 体积对比：v19 7.49 MiB → v26 7.57 MiB（+84 KB，来自新增的关卡文案与 UI 字号调整）。
4. **没做**：真机安装、WebView 音频自动播放、后台保活、存档持久化、横竖屏——仍然待验。

---


## 一、包体：22.5 MB → 4.00 MB

v5 的 `assets/public` 有 22.5 MB，其中只有 3.85 MB 该在：

| 内容 | v5 | v6 | 说明 |
|---|---|---|---|
| `game/_cand/` 候选毛料 | 16.61 MB | 0 | 82 个 wav/mp3，只给 `sfx-import` 当输入 |
| `game/audio-lab/` | 1.37 MB | 0 | 声音实验室，开发用试听页（含 1 MB 内嵌 base64） |
| 已删除的死素材 | 0.71 MB | 0 | 就是 `7eaaaef` 删的那五个，`www` 是删之前拷的 |
| 引擎 / 样式 / 关卡数据 / 在役素材 | 3.85 MB | 4.00 MB | 40 个文件（v9 起含 `data/notes.js`） |

APK 整体 26 MB → **7.4 MB**。剩下的主要是 `classes.dex`（约 8 MB，Capacitor + AndroidX，
debug 未 minify）和 web 资源。

再往下压的两条路（都没做）：release + minify（dex 能到 3～4 MB）、按 ABI 拆包。

---

## 二、可复现的构建流程

```bash
npm test                      # 七步 + www 发布物校验（www 不存在时跳过）
npm run www                   # 生成 www/：40 个文件，4.00 MB
npx cap copy android          # 拷进 android/app/src/main/assets/public
cd android && ./gradlew clean assembleDebug   # 发版加 clean
```

> **发版要 `clean`**：v9 出包时先跑了一次增量 `assembleDebug`，得到 7,786,391 字节；
> 紧接着 `clean assembleDebug` 只有 7,743,671 字节（同一份 `www`，最终包带后一次 README 微调，
> 7,743,691）。两个包的**文件清单（42 项）与内容逐字节相同**
> （`unzip` 解出来跟 `www/` 做 `diff -rq`，实质差异 0），差的 42 KB 是增量打包重新压缩时的
> 压缩比/对齐差异。所以：**体积只有在 clean 构建之间才可比**，验收看内容不看体积。

产物：`android/app/build/outputs/apk/debug/app-debug.apk`

**v19 的构建实测（2026-11-03）**：

- 耗时 `clean assembleDebug` 2 分 29 秒，97 个 task（88 执行 / 9 命中缓存）
- `aapt dump badging`：`versionCode='19' versionName='4.27'`、`sdkVersion:'24'`、`targetSdkVersion:'36'`、label `苍屿战役`
- 包内 `assets/public/game/campaign.html` 的 `#verTag` 是 `v4.27`（不是构建时读的 config，是拷进去的那份字节）
- 解包与 `www/` 逐文件 `diff -rq`：**实质差异 0**。
  只有三项在预期内——`www/.manifest.json` 不进包（构建清单）、包内多出 Capacitor 注入的
  `cordova.js` 与 `cordova_plugins.js`
- 45 个 web 文件 / 4.4 MB 目录；APK 7.49 MiB

环境（本机实测）：

- **JDK 21**：`C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot`
  Capacitor 8 要 JDK 21+，JDK 17 会报 `invalid target release: 21`
- **Android SDK**：`C:/Users/<用户名>/AppData/Local/Android/Sdk`（compileSdk / targetSdk 36，minSdk 24）
  光设 `ANDROID_HOME` 不一定够——Gradle 只认 `android/local.properties` 里的 `sdk.dir`。
  该文件**不入库**（`cap add android` 也不生成），换机器要手写一行：
  `sdk.dir=C\:\\Users\\<用户名>\\AppData\\Local\\Android\\Sdk`。缺它会直接停在
  `SDK location not found`，而那行报错看不出是"少了文件"而不是"没装 SDK"。
- **Gradle**：8.14.3，`distributionUrl` 走腾讯镜像；Maven 走阿里云（`~/.gradle/init.d/mirrors.gradle`）
- **中文路径**：项目路径含"军推"，`android/gradle.properties` 里要有 `android.overridePathCheck=true`
- **版本号**：`android/app/build.gradle` 的 `versionCode` 每发一版手工 +1（Android 靠它认新版本）；
  `versionName` 必须等于 `#verTag` 的 major.minor，`npm test` 里 `build-www --check` 会核这条

> `android/`、`www/`、`*.apk` 都在 `.gitignore` 里。换台机器要先 `npx cap add android`
> 再把上面这几项（minSdk、镜像、`overridePathCheck`、versionCode）改回去——
> **这是当前最大的复现缺口**，见第六节。

---

## 三、`www/` 是怎么来的

`tools/build-www.js`，两个模式：

```bash
npm run www                    # 重建，并写 www/.manifest.json
node tools/build-www.js --check   # 只校验（已挂进 npm test）
```

清单是**引用驱动**的，不维护排除名单：

1. `index.html` 本身就是入口
2. 解析 `index.html` 与 `game/campaign.html` 里所有 `href` / `src` 的本地路径
   → 自动带上 `data/levels.js`、`campaign.css`、`docs/*.md`、`README.md`
3. 引擎 `ASSETS` 里每个非 null 的路径 → 自动带上在役的 sfx / bgm / story
4. 加上 `game/assets/sfx/CREDITS.md`（CC-BY 4.0 要求分发时附授权声明）

所以 `_cand`、`audio-lab`、`prev/`、没被引用的 `*-synth.ogg` 天然进不来；
将来加素材也不用回来登记。

代价是**漏引用检测不到**（页面里没写的资源当然不会被拷），所以反向还有一条：
清单里出现 `/_cand/`、`/audio-lab/`、`/prev/`、`.embed.html` 任一片段就直接报错退出。

`--check` 的五道闸（每条都反向验过，各自独立红）：

| 标记 | 抓什么 |
|---|---|
| `www/1` | 没有指纹清单（手 cp 出来的，来源不可追溯） |
| `www/3` | 真源改过但没重建（**v5 装旧引擎就是这一条**） |
| `www/4` | www 里有多余文件（`_cand`、删掉的素材） |
| `www/5` | 拷过去的字节与真源不一致（拷贝中途被打断） |
| `www/6` | 包里的 `#verTag` 与 `package.json` 版本不一致 |
| `www/7` | 安卓 `versionName` 与 `#verTag` 不一致 |

`--check` 的触发条件是 **www 存在**。没生成就跳过——不打包的人不该被它拦住。

---

## 四、已验证

在真实浏览器里跑生成出来的 `www/`（静态服务 + headless Edge），不是"看代码觉得没问题"：

- 菜单页：章节、关卡列表、开始战役按钮、版本号全部正常渲染
- `game/campaign.html?lv=C1` 进关：简报 → 跳过 → 棋盘 109 个元素 / 23 个兵牌，
  地图、兵牌番号、右侧战术卡与战报栏齐全，无破图
- **资源零 404**（服务端访问日志逐条核过）：进关时按关预载拉了 14 个音效 +
  `battle.ogg` + `amb-take1.ogg`，全部 200；只有浏览器自发的 `/favicon.ico` 404，无害

这一条比包大小重要：音效路径错了游戏不会报错（`FX` 内部空 catch），
只会静默无声——**必须靠请求日志验，不能靠肉眼看截图**。

---

## 五、未验证

- **真机 / 模拟器安装与启动**：本机 SDK 没装 emulator 组件，也没有连接设备。
  包能构建、能打出来，但"在 Android 上点开图标能玩"目前只有 v5 那一次的说法，v6 / v7 都没实测
- **WebView 内的音频自动播放**：浏览器里靠首次 `pointerdown`/`keydown` 解锁；
  Android WebView 的 `MediaPlaybackRequiresUserGesture` 默认值与浏览器不同，需真机确认
- **切后台 / 锁屏**：BGM 与底噪在 `onPause` 之后是否恢复
- **存档持久化**：localStorage 在 `https://localhost` 域下，卸载即丢。
  导出功能（HQ 存档页）能用，但"清数据就没了"这件事没在真机验证过
- 启动耗时、内存占用：v5 报告里那组数字（2–3 s / 80–250 MB）**没有测量依据，已作废**。
  要写就得上 `adb shell dumpsys meminfo` 实测

---

## 六、已知限制

1. **debug 签名，不能上架**。Play 与国内商店都拒 debug 包；发给别人装会触发"未知来源"提示。
   上架前要生成 release keystore 并配 `signingConfigs`
2. **存档域隔离**：`androidScheme: "https"` 让页面跑在 `https://localhost`，
   与线上 GitHub Pages、本地 `file://` 三个域互不相通。三个地方各有一份进度，测试时别误判"存档丢了"
3. **排障手段少**：`webContentsDebuggingEnabled: false`，又没有崩溃上报。
   现在只能靠 `<head>` 那段 `window.onerror` 把错误写进 localStorage。
   真要发给别人测，建议先临时开成 `true`，用 `chrome://inspect` 接上
4. **`android/` 不入库**：`cap add android` 会把 versionCode 重置成 1，
   minSdk / 镜像 / 中文路径开关全是手改。要么把这几项脚本化，要么把 `android/` 从 gitignore 里放出来
   （后者会把 111 MB 工程文件和 JDK 相关缓存一起带进仓库，要配更细的忽略规则）

---

## 七、下次发版的清单

1. `npm test` 全绿（含 `[www]` 那行）
2. `npm run www` 重建
3. `android/app/build.gradle` 里 `versionCode` +1、`versionName` 改成新版本号（build-www --check 会核）
4. `npx cap copy android && cd android && ./gradlew assembleDebug`
5. 装到真机，确认：能启动、有声音、能存档、切后台回来进度还在
