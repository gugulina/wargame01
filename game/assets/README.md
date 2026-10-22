# 素材目录

这里放游戏用到的图片、音频、字体。目前是空目录（只有这份说明），
`game/campaign.html` 里的 `ASSETS` 表已经按下面的结构写好了槽位，
把文件按名字丢进来、再在 `ASSETS` 里填上文件名就能生效，**不需要改任何游戏逻辑**。

## 目录结构

```
game/assets/
  ui/       六角格贴图、要点徽标、按钮图标
  unit/     兵种图标（按 TYPE 的 key 命名）
  fort/     工事图标（H/B/P/A/F）
  sfx/      短音效
  bgm/      循环音乐
  story/    剧情背景图与立绘
```

目录现在不存在是正常的——Git 不跟踪空目录。放第一个文件时顺手建即可。

## 五条硬规矩

1. **路径相对 `game/campaign.html`，不带前导斜杠**。
   GitHub Pages 部署在 `/wargame01/` 子目录下，`/assets/x.png` 会 404；
   以后打成 exe 时也是相对路径才找得到。

2. **文件名全小写 ASCII + 连字符，禁止中文、空格、大写**。
   Windows 不区分大小写，Pages 的 Linux 区分。`Cannon.PNG` 本地能跑、线上必 404。
   正确：`unit/arm.png`、`sfx/fort-build.mp3`

3. **一个槽位一个文件，不在代码里拼字符串**。
   每个槽位在 `ASSETS` 里都有确定的名字，加素材 = 把 `null` 换成文件名。

4. **体积按移动端算**。
   全部素材加起来控制在 8 MB 以内，否则手机 4G 首屏会等。
   单条音效 < 60 KB，单曲 < 3 MB。

5. **素材缺失必须是可接受的**。
   任何一个槽位为空，游戏都要能正常玩。这是下面所有规格的前提。

## 规格建议

| 类别 | 目录 | 建议尺寸 | 格式 | 单件体积 | 备注 |
|---|---|---|---|---|---|
| 六角格贴图 | `ui/` | 96×110 | WebP（回退 PNG） | < 20 KB | 与格子同比例，透明边 |
| 要点徽标 | `ui/` | 32×32 | PNG 透明底 | < 6 KB | |
| 兵种图标 | `unit/` | 64×64 | WebP/PNG 透明底 | < 10 KB | 21 个兵种 |
| 工事图标 | `fort/` | 28×28 | PNG 透明底 | < 4 KB | 5 个 |
| 短音效 | `sfx/` | — | mp3 单声道 64 kbps | < 60 KB | 12 个槽位 |
| 音乐 | `bgm/` | — | ogg 96 kbps 或 mp3 128 kbps | < 3 MB | 4 首，1~3 分钟 |
| 立绘 | `story/` | 300×400 | WebP 透明底 | < 80 KB | 竖构图，半身 |
| 剧情背景 | `story/` | 1600×900 | WebP | < 250 KB | 16:9 |

## 当前槽位清单

打开 `game/campaign.html` 搜 `const ASSETS`，全部槽位都在那一张表里，带注释。
`sfx` 十二个槽位：`uiClick select move fire shell hit kill build alarm event win lose`。
`bgm` 四首：`menu battle tension result`。
`fort` 五个：`H B P A F`。
`unit` 二十一个，键名与 `TYPE` 表严格对齐（自测会校验这一点）。

## 加素材的完整流程

1. 把文件放进对应目录，按规矩命名，例：`game/assets/sfx/fire.mp3`
2. 打开 `ASSETS`，把 `sfx.fire: null` 改成 `sfx.fire: 'sfx/fire.mp3'`
3. 刷新页面。没有第 3 步。

## 还没做的部分

图片素材真正接进来之前，有一个必须先改的地方：现在 `renderBoard()` 每帧
`innerHTML` 全量重建整张棋盘。加 `<img>` 之后会导致图片节点反复重建、闪烁、
手机上掉帧。**接图片前要先把棋盘拆成「静态地形层」（只画一次）+「动态兵牌层」**，
这个改动不适合提前做——它现在没有收益，只会增加回归风险。详见
`docs/08-表现层接入.md` 第六节。
