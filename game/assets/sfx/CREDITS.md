# 音效来源与授权

12 个音效全部免费可商用，版权状态干净。三个来源，逐文件记录在下面。

**2026-10-22 更新（v2）**：`fire / shell / hit / kill / alarm` 五个换成实弹录音与影视拟音重制版。
换的原因写在最后一节。旧版归档在 `prev/`，只作对比，不进游戏。

---

## 一、OpenGameArt · kurt「gunshots」（1 个）

- 页面：https://opengameart.org/content/gunshots
- 作者：kurt（2017-02-10 上传）
- 授权：**CC0 1.0 公有领域**，页面原文 `Copyright/Attribution Notice: None needed.`
- 素材性质：**实弹录音**，96 kHz / 立体声 / 16 bit 原始采样，枪口冲击波与场地混响都是真的

| 本地文件 | 原始文件 | 时长 | 用途 |
|---|---|---|---|
| `fire-v2.mp3` | `22 Magnum.wav` | 0.63s | 直射开火。原文件录了三声（0.23 / 0.93 / 1.66 秒），裁出第一声 + 混响尾 |

裁切参数：起 200ms、止 780ms、35Hz 一阶高通去次声、峰值归一到 −1.5 dBFS、头 2ms / 尾 35ms 淡入淡出。

原文件采样率 96 kHz 这件事有意义：一般素材库为了省体积是 44.1 kHz，96 kHz 说明这条是直接从录音设备导出的，
没有经过二次压缩。起振时间实测 0.2ms —— 真实枪响就是这个量级，合成音做不到。

## 二、Mixkit（4 个）

- 站点：https://mixkit.co/free-sound-effects/
- 运营方：Envato
- 授权：**Mixkit Sound Effects Free License**
- 条款要点（原文摘录）：
  - `Items under the Mixkit Sound Effects Free License can be used in your commercial and non-commercial projects for free.`
  - 明确列出的允许场景包含 **Video games**、YouTube、广告、影视、播客
  - **无需署名**
  - 禁止：`You can't redistribute the Item on its own, as stock, in a tool or template, or with source files.`
    也就是说 **随游戏一起发布可以，把音效单独抽出来当素材包传播不行**
  - 禁止登记到 Content ID 等权利管理系统
- 注意：Mixkit 的音效**不是现场实录**，是影视拟音（foley）。听感上"像电影里的炮"，但不是真炮。

| 本地文件 | 原始文件 | 时长 | 用途 |
|---|---|---|---|
| `shell-v2.mp3` | `sfx/1696` | 2.43s | 炮击。低频冲击占 40%，同时只允许响一个 |
| `hit-v2.mp3` | `sfx/1674` | 0.21s | 命中。极短，连续命中不糊 |
| `kill-v2.mp3` | `sfx/1693` | 1.65s | 歼灭。多爆点，像弹药殉爆 |
| `alarm-v2.mp3` | `sfx/1679` | 1.83s | 敌方增援。连续嚎叫式警报，辨识度高 |

原始直链形如 `https://assets.mixkit.co/active_storage/sfx/<编号>/<编号>-preview.mp3`。
页面上的 `-preview.mp3` 是完整长度、完整内容的低码率版本，不是试听片段。

## 三、Kenney（7 个）

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

---

## 四、为什么换掉 v1（五个军事音效）

v1 用的是小森平の効果音工場（`taira-komori.net`）的「兵器·爆炸」分类。
授权本身没问题（允许商用、可加工、随作品发布、免署名），但**音色不对**。

拿四个客观指标一测就很清楚。前两个是判断"像不像真枪"的关键：

- **起振时间**：从峰值 10% 到 99% 的耗时。真枪的枪口冲击波是毫秒级，超过 10ms 就不像枪了。
- **峰值因子**（crest factor = 峰值/有效值，dB）：动态范围。压缩得越狠越小，听感越"扁"。
- **频谱平坦度**：噪声性（宽频）还是音调性（窄带）。枪声是宽频噪声。
- **低频占比**：200Hz 以下的能量，反映有没有"冲击"。

| 音效 | 版本 | 起振 | 峰值因子 | 判读 |
|---|---|---|---|---|
| fire | v1 小森平 shoot3 | 20.0ms | 14.0dB | 起振太慢，窄带有音调 → 像"biu"，不像枪 |
| fire | **v2 实弹 .22 Magnum** | **0.2ms** | **26.0dB** | 瞬态陡、动态大 → 真枪 |
| shell | v1 小森平 cannon1 | 140.0ms | 12.2dB | 起振极慢，75% 能量在 200Hz 以下 → 闷雷，没有爆裂 |
| shell | **v2 Mixkit** | **4.0ms** | **20.1dB** | 有冲击也有爆裂 |
| hit | v1 short_bomb | 2.2ms | 11.3dB | 压缩太重，打上去不"实" |
| hit | **v2 Mixkit** | **2.7ms** | **22.6dB** | 短促有力 |
| kill | v1 game_explosion1 | 44.0ms | 16.2dB | 偏软 |
| kill | **v2 Mixkit** | **12.3ms** | **20.7dB** | 多爆点，有份量 |
| alarm | v1 launcher1 | 8.0ms | 16.5dB | 像导弹发射，不像警报 |
| alarm | **v2 Mixkit** | **3.3ms** | **16.1dB** | 真的是警报声 |

**没有换成"更响"，换的是瞬态和动态。** 音量在 `FX.vol` 里统一调，音色才是这里要解决的。

### 一个反直觉的坑：mp3 编码不会拖钝起振

改之前担心 mp3 的编码器延迟会在音效前面塞十几毫秒静音，把枪声的"啪"变成"噗"。
实测（112kbps 单声道，编码后再解码测起振）：4 个样本全部一致，1.5ms→1.5ms、2.9ms→2.9ms，毫无变化。
现代解码器会读 LAME 写入的 delay 信息并跳过。**所以体积从 1818KB 压到 297KB，瞬态零损失。**

（真正会拖钝瞬态的是**降采样到 22.05kHz**：`fire_a` 从 1.5ms 变成 2.9ms，被插值抹平了一档。
所以最终交付统一 44.1kHz。）

---

## 五、目录

```
game/assets/sfx/
  ui-click.ogg  ui-select.ogg  ui-move.ogg  build.ogg  event.ogg  win.ogg  lose.ogg   ← Kenney
  fire-v2.mp3  shell-v2.mp3  hit-v2.mp3  kill-v2.mp3  alarm-v2.mp3                     ← 本版换的
  prev/           v1 的五个原文件，只作对比，游戏不引用
  preview.html    12 个槽位逐个试听
  CREDITS.md      本文件
```

## 六、换素材

把新文件按同名覆盖，**代码不用动**。想换名字或加槽位，改 `campaign.html` 里 `const ASSETS` 的 `sfx` 一段。

**文件名带 `-v2` 是故意的**：`ASSETS` 里的路径是相对地址，换内容不改名的话，
浏览器会拿缓存的旧音频，本地听着"没变化"能查半天。改内容就顺手改个后缀。

## 七、还没配的

`bgm`（4 首循环音乐：menu / battle / tension / result）还没找。

三个原因：单曲 1–3MB，仓库体积涨得快；选曲纯主观，得你听了才算；
**浏览器不允许无交互自动播放**，没有开始页的话放了也是静音。

候选：Mixkit Music（同一套授权，明确允许游戏）、Incompetech（CC-BY，需署名）、
Free Music Archive（逐个看授权）。Pixabay 虽然免费但站内反爬 403，只能浏览器手动下。
