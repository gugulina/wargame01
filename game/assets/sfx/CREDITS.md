# 音效来源与授权

12 个音效全部免费可商用，版权状态干净。分两个来源。

## 小森平の効果音工場（5 个）

- 站点：https://taira-komori.net/ （2025-08 起从 `taira-komori.jpn.org` 迁到这个域名）
- 作者：小森平（Taira Komori，日本福冈）
- 分类页：https://taira-komori.net/arms01tw.html 「兵器·爆炸」
- 授权：自订条款，非 Creative Commons，但实际自由度接近 CC0
  - 允许：商业使用、加工、应用、随游戏/影片/软体发布，**无需署名**
  - 禁止四件事：① 以自己的名义重新配布音效 ② 贩卖音效素材本身
    ③ 直接转载音效网址 ④ 说小森的坏话
  - 换言之：**音效作为作品的一部分发布没问题，把音效本身当素材包转售或转发不行**

| 本地文件 | 原始文件 | 时长 | 用途 |
|---|---|---|---|
| `fire.mp3` | `arms01/shoot3.mp3` | 0.26s | 直射开火（单发，不要用 machinegun 那种 3 秒连发，会盖住整个回合） |
| `shell.mp3` | `arms01/cannon1.mp3` | 2.35s | 炮击（带尾音，所以同时只允许一个） |
| `hit.mp3` | `arms01/short_bomb.mp3` | 0.61s | 命中 |
| `kill.mp3` | `arms01/game_explosion1.mp3` | 1.15s | 歼灭 |
| `alarm.mp3` | `arms01/launcher1.mp3` | 1.31s | 敌方增援 |

原始直链前缀：`https://taira-komori.net/sound_os2/arms01/<文件名>.mp3`

## Kenney（7 个）

- 站点：https://kenney.nl/
- 授权：**CC0 1.0 公有领域**，可商用、可修改、无需署名
- 用到的包：UI Audio、Interface Sounds、Impact Sounds、Music Jingles
  （包内 `License.txt` 随 zip 分发，可留档）

| 本地文件 | 原包 · 原文件 | 用途 |
|---|---|---|
| `ui-click.ogg` | UI Audio · `click1.ogg` | 按钮 |
| `ui-select.ogg` | Interface Sounds · `select_001.ogg` | 选中兵牌 |
| `ui-move.ogg` | Impact Sounds · `impactSoft_medium_000.ogg` | 移动 |
| `build.ogg` | Impact Sounds · `impactMining_000.ogg` | 构筑工事 / 布雷 / 架桥 |
| `event.ogg` | Interface Sounds · `confirmation_001.ogg` | 剧情事件 |
| `win.ogg` | Music Jingles · `Steel jingles/jingles_STEEL16.ogg` | 达成 |
| `lose.ogg` | Music Jingles · `Steel jingles/jingles_STEEL00.ogg` | 失败 |

## 换素材

想换某个音效，把新文件按同样名字覆盖即可，**不用改代码**。
想换名字或加槽位，改 `campaign.html` 里 `const ASSETS` 的 `sfx` 一段。

试听全部音效：打开 `game/assets/sfx/preview.html`。

## 还没配的

`bgm`（4 首循环音乐）还没找。音乐体积大、选曲主观，等定下开始页再做。
候选：Pixabay Music（免费商用免署名，但站内 403 反爬，要浏览器手动下）、
Kenney Music Jingles（只有短乐句，不是循环曲）、Incompetech（CC-BY，要署名）。
