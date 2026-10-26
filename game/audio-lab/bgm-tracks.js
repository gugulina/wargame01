/* 苍屿战役 · BGM 编曲谱
   ------------------------------------------------------------------
   一份数据，两端播放：
     - tools/bgm-render.js（Node）渲染成 ogg
     - game/audio-lab/bgm-demo.html（浏览器）试听

   为什么不用页面里硬编码：五首曲子如果各写一份，改一个参数就要改两处，
   迟早出现"试听一个样、导出另一个样"。事件只有 t / inst / f / dur / vel
   五个字段，渲染器不懂乐理，只按时间把音符放进去。

   inst 对照（渲染器与试听页必须一致）：
     pulse  低音脉冲    三角波 + 低通，短促，节拍器但不出拍子感
     bass   低音持续    锯齿 + 重低通，慢起音，撑住和声
     piano  钢琴        正弦叠泛音，长衰减
     cello  大提琴      锯齿失谐，慢起音，中低音区
     pad    弦乐垫      更薄更宽的锯齿，铺空间
     air    高音薄雾    高频正弦，几乎听不见，只让空间有天花板
     timp   定音鼓      正弦扫频 + 皮膜瞬态
     snare  小军鼓      噪声带通 + 腔体，力度封在 0.7（避开枪声频段）
     tick   秒表滴答    极短高频脉冲，紧张曲专用
     bell   钟/泛音     非整数倍泛音，长衰减
     amb    环境噪      持续层，渲染器单独处理
   ------------------------------------------------------------------ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BGM_TRACKS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const F = {
    D2:73.42, Eb2:77.78, E2:82.41, F2:87.31, G2:98.00, A2:110.00, Bb2:116.54, B2:123.47,
    C3:130.81, D3:146.83, Eb3:155.56, E3:164.81, F3:174.61, G3:196.00, A3:220.00, Bb3:233.08,
    B3:246.94, C4:261.63, D4:293.66, Eb4:311.13, E4:329.63, F4:349.23, G4:392.00, A4:440.00,
    Bb4:466.16, B4:493.88, C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99,
    A5:880.00, B5:987.77, D6:1174.66
  };

  /* 一个短音符。dur 只是"建议时长"，实际衰减由乐器决定 */
  function n(ev, t, inst, f, dur, vel) {
    ev.push({ t: +t.toFixed(6), inst, f, dur, vel: vel === undefined ? 1 : vel });
  }

  /* ══════════════════════════════════════════════════════════
     1. battle —— 第 1 章「艰难时刻」战斗底噪
     D 小调 / 96 BPM / 24 小节 / 60.000 秒
     定位：守不住也得守。和声不解决，定音鼓是心跳不是炮击。
     ══════════════════════════════════════════════════════════ */
  function buildBattle() {
    const bpm = 96, bars = 24;
    const bar = 60 / bpm * 4;              // 2.500
    const e8 = bar / 8;
    const ev = [];

    const root = b => (b < 8 ? F.D3 : b < 12 ? F.Bb2 : b < 16 ? F.G2 : F.D3);

    /* 低音脉冲：八分音符连打，第 3、7 个留空（一直连打会变成节拍器） */
    for (let b = 0; b < bars; b++) {
      for (let i = 0; i < 8; i++) {
        if (i === 2 || i === 6) continue;
        if ((b === 7 || b === 15) && i >= 6) continue;   // 呼吸口
        n(ev, b * bar + i * e8, 'pulse', root(b), 0.3, 1);
      }
    }

    /* 钢琴散音：故意落在第 2 拍后半，制造犹豫 */
    const PNO = [null,null,null,null,'D4',null,'A4',null, 'F5',null,'Bb3',null,
                 'G3',null,'D4',null, 'F5',null,'A4',null, 'D4',null,'A4',null];
    PNO.forEach((k, b) => { if (k) n(ev, b * bar + e8 * 3, 'piano', F[k], 2.6, 0.85); });

    /* 大提琴：只在 9–20 小节，每 4 小节一个音 */
    [8, 12, 16].forEach(b => {
      n(ev, b * bar, 'cello', b < 12 ? F.Bb2 : b < 16 ? F.G2 : F.D3, bar * 4, 0.85);
    });

    /* 打击：13–16 小节。默认小军鼓，军乐动机——flam → 单击 → 十六分 → 滚奏 */
    const spb = bar / 4;
    n(ev, 12 * bar, 'snare', 0, 0.2, 0.62);                    // flam 主击
    n(ev, 12 * bar - 0.026, 'snare', 0, 0.2, 0.26);            // flam 装饰
    n(ev, 12 * bar + spb * 2, 'snare', 0, 0.2, 0.34);
    n(ev, 12 * bar + spb * 2 + spb / 4, 'snare', 0, 0.2, 0.30);
    n(ev, 13 * bar, 'snare', 0, 0.2, 0.42);
    n(ev, 14 * bar, 'snare', 0, 0.2, 0.55);
    n(ev, 14 * bar - 0.026, 'snare', 0, 0.2, 0.23);
    n(ev, 14 * bar + spb * 1.5, 'snare', 0, 0.2, 0.36);
    for (let i = 0; i < 25; i++){                              // 第 15 小节后半：滚奏
      n(ev, 15 * bar + spb * 2 + i * 0.05, 'snare', 0, 0.2, 0.28 + 0.34 * (i / 24));
    }

    /* 高音薄雾 */
    n(ev, 12 * bar, 'air', F.D5, bar * 4, 0.6);
    n(ev, 16 * bar, 'air', F.A5, bar * 4, 0.6);

    /* 环境：电报键，位置不对齐小节线 */
    const morse = [0.6,1.9,3.4,5.1,7.2,9.8,11.3,13.9,15.2,17.8,19.1,21.4,22.9];
    morse.forEach(b => n(ev, b * bar + 0.3, 'tick', 0, 0.08, 0.45));

    return {
      id:'battle', label:'战斗', bpm, bars, barLen: bar,
      segs: [
        { from:0,  name:'A 引' }, { from:4,  name:'A 主' },
        { from:8,  name:'B 沉' }, { from:12, name:'B 顶' },
        { from:16, name:'C 撤' }, { from:20, name:'A′ 归' }
      ],
      chord: b => (b < 8 ? 'Dm' : b < 12 ? 'B♭' : b < 16 ? 'Gm' : 'Dm'),
      layers: ['pulse','piano','cello','snare','air','amb'],
      amb: { type:'room', level:0.55 },
      events: ev
    };
  }

  /* ══════════════════════════════════════════════════════════
     2. tension —— 组织度崩溃 / 敌方增援
     D 小调 / 80 BPM / 16 小节 / 48.000 秒
     定位：不是"更激烈的战斗"，是"越来越不对劲"。
     手法：上方和弦不动，低音半音往上爬（D→E♭→E→F），
           加上秒表滴答——回合在走，而你在丢地。
     比 battle 慢 16 BPM，所以硬切过去像"时间被拉长了"。
     ══════════════════════════════════════════════════════════ */
  function buildTension() {
    const bpm = 80, bars = 16;
    const bar = 60 / bpm * 4;              // 3.000
    const ev = [];

    /* 半音上行低音：4 小节一轮，爬四轮。不解决，第四轮到头直接掉回 D */
    const climb = [F.D2, F.Eb2, F.E2, F.F2];
    for (let b = 0; b < bars; b++) {
      n(ev, b * bar, 'bass', climb[b % 4], bar * 1.05, 0.9);
    }

    /* 上方保持 Dm 的三个音，不跟着低音走 —— 这是"不对"的来源 */
    const upper = [F.A3, F.D4, F.F4];
    for (let b = 0; b < bars; b += 2) {
      n(ev, b * bar + 0.4, 'cello', upper[(b / 2) % 3], bar * 2, 0.55);
    }

    /* 秒表滴答：前 12 小节每 2 拍一下，最后 4 小节加密到每拍 */
    for (let b = 0; b < 12; b++) {
      n(ev, b * bar + 0.1, 'tick', 0, 0.07, 0.40);
      n(ev, b * bar + bar / 2, 'tick', 0, 0.07, 0.30);
    }
    for (let b = 12; b < bars; b++) {
      for (let i = 0; i < 4; i++) n(ev, b * bar + i * bar / 4 + 0.1, 'tick', 0, 0.07, 0.38 + i * 0.06);
    }

    /* 心跳闷响：每小节一次，位置故意错开拍点（规律就是安全感的来源） */
    const off = [0.35, 1.80, 0.90, 2.35, 1.20, 0.60, 2.10, 1.55];
    for (let b = 0; b < bars; b++) {
      n(ev, b * bar + off[b % 8], 'timp', F.D2, 1.1, 0.42);
    }

    /* 耳鸣：一个很高的音全程压在底下 */
    n(ev, 0, 'air', F.A5, bar * bars, 0.30);
    n(ev, 8 * bar, 'air', F.B5, bar * 8, 0.22);

    return {
      id:'tension', label:'紧张', bpm, bars, barLen: bar,
      segs: [
        { from:0,  name:'A 起' }, { from:4,  name:'A 爬' },
        { from:8,  name:'B 紧' }, { from:12, name:'B 逼' }
      ],
      chord: b => ['Dm','E♭m','Em','Fm'][b % 4],
      layers: ['bass','cello','tick','timp','air','amb'],
      amb: { type:'dry', level:0.30 },     // 更干更窄 = 窒息
      events: ev
    };
  }

  /* ══════════════════════════════════════════════════════════
     3. result 胜利 —— D 大调 / 72 BPM / 12 小节 / 40.000 秒
     定位：不是欢呼，是"活下来了"。
     关键设计：前 2 小节还是 D 小调，第 3 小节三音才升高（F→F♯）。
     同一主音转大调，听众会觉得"松了一口气"，而不是"万岁"。
     不加铜管号角——打完仗没人想听阅兵。
     ══════════════════════════════════════════════════════════ */
  function buildWin() {
    const bpm = 72, bars = 12;
    const bar = 60 / bpm * 4;              // 3.333
    const ev = [];

    /* 1-2 小节 Dm（还沉浸着），3 小节起 D 大调（三音升高，天亮了） */
    n(ev, 0, 'pad', F.D3, bar * 2, 0.75);
    n(ev, 0, 'cello', F.A2, bar * 2, 0.55);
    n(ev, bar * 2, 'pad', F.D3, bar * 3, 0.85);
    n(ev, bar * 2, 'cello', F.F3, bar * 3, 0.65);       // 这里从 F 变 F♯
    n(ev, bar * 5, 'pad', F.B3, bar * 3, 0.80);
    n(ev, bar * 5, 'cello', F.D4, bar * 3, 0.60);
    n(ev, bar * 8, 'pad', F.A3, bar * 4, 0.85);
    n(ev, bar * 8, 'cello', F.F5, bar * 4, 0.55);

    /* 钢琴：前 2 小节还是 Dm 的音，第 3 小节起升三音 */
    const mel = [
      [0.0, 'D4'], [0.8, 'F4'], [1.6, 'A4'],            // Dm
      [0.0, 'D4'], [1.0, 'A4'],
      [0.0, 'F5'], [0.9, 'A4'], [1.8, 'D5'],            // 大调进来
      [0.0, 'B4'], [1.1, 'D5'],
      [0.0, 'A4'], [1.0, 'F5'],
      [0.0, 'D5'], [1.2, 'A4']
    ];
    for (let b = 0; b < bars; b++) {
      const m = mel[b];
      if (!m) continue;
      n(ev, b * bar + 0.15, 'piano', F[m[1]], 3.2, 0.70);
    }
    /* 每小节补一个低音，让它有落点 */
    ['D3','D3','D3','B2','A2','D3'].forEach((k, i) => {
      n(ev, i * 2 * bar, 'piano', F[k], 3.4, 0.45);
    });

    /* 定音鼓：只在转大调那一拍轻敲一下。多了就是凯旋，不对 */
    n(ev, bar * 2, 'timp', F.D2, 1.4, 0.35);
    n(ev, bar * 8, 'timp', F.D2, 1.4, 0.28);

    /* 高音薄雾：从第 3 小节起慢慢打开 */
    n(ev, bar * 2, 'air', F.A5, bar * 6, 0.45);
    n(ev, bar * 8, 'air', F.D6, bar * 4, 0.40);

    return {
      id:'win', label:'胜利', bpm, bars, barLen: bar,
      segs: [
        { from:0, name:'A 缓冲' }, { from:2, name:'B 转明' },
        { from:5, name:'C 打开' }, { from:8, name:'D 收' }
      ],
      chord: b => (b < 2 ? 'Dm' : b < 5 ? 'D' : b < 8 ? 'Bm' : 'D'),
      layers: ['piano','cello','pad','timp','air','amb'],
      amb: { type:'wide', level:0.35 },
      events: ev
    };
  }

  /* ══════════════════════════════════════════════════════════
     4. result 失败 —— D 小调 / 60 BPM / 12 小节 / 48.000 秒
     和声 Dm → C → B♭ → A，最后停在 A（属和弦）不解决。
     不给安慰，也不煽情到底——最后一格留给玩家自己。
     ══════════════════════════════════════════════════════════ */
  function buildLose() {
    const bpm = 60, bars = 12;
    const bar = 60 / bpm * 4;              // 4.000
    const ev = [];

    const bassLine = [F.D2, F.D2, F.D2, F.C3, F.C3, F.C3, F.Bb2, F.Bb2, F.Bb2, F.A2, F.A2, F.A2];
    bassLine.forEach((f, b) => n(ev, b * bar, 'bass', f, bar * 1.1, 0.75));

    /* 大提琴：一条缓慢下行的旋律，每个音都比上一个低一点 */
    const line = [
      [0, 'A3'], [1.2, 'G3'], [2.4, 'F3'],
      [3, 'E3'], [4.2, 'D3'],
      [6, 'D3'], [7.4, 'C3'],
      [9, 'A2'], [10.5, 'A2']
    ];
    line.forEach(([t, k]) => n(ev, t * bar, 'cello', F[k], bar * 1.6, 0.75));

    /* 钢琴：只给三个音，像有人在里面慢慢合上本子 */
    n(ev, 0.5 * bar, 'piano', F.D4, 3.0, 0.40);
    n(ev, 5.2 * bar, 'piano', F.F4, 3.0, 0.32);
    n(ev, 9.6 * bar, 'piano', F.E4, 4.0, 0.28);

    /* 无打击。失败曲里任何一下鼓都像在强调"你输了"，不需要强调 */

    return {
      id:'lose', label:'失败', bpm, bars, barLen: bar,
      segs: [
        { from:0, name:'A 落' }, { from:3, name:'B 沉' },
        { from:6, name:'C 空' }, { from:9, name:'D 悬' }
      ],
      chord: b => (b < 3 ? 'Dm' : b < 6 ? 'C' : b < 9 ? 'B♭' : 'A'),
      layers: ['bass','cello','piano','amb'],
      amb: { type:'wide', level:0.40 },
      events: ev
    };
  }

  /* ══════════════════════════════════════════════════════════
     5. menu —— 战役地图 / 档案柜
     D 多利亚 / 64 BPM / 16 小节 / 60.000 秒
     用多利亚不用自然小调：多利亚的大六度（B）比降六级（B♭）亮一点，
     不像在悼念，像在翻一份很旧的作战档案。
     ══════════════════════════════════════════════════════════ */
  function buildMenu() {
    const bpm = 64, bars = 16;
    const bar = 60 / bpm * 4;              // 3.750
    const ev = [];

    /* 低音：D 长音打底，偶尔走到 A 再回来。慢，几乎不动 */
    const bassAt = [[0,F.D2],[4,F.D2],[8,F.A2],[12,F.D2]];
    bassAt.forEach(([b, f]) => n(ev, b * bar, 'bass', f, bar * 4.1, 0.60));

    /* 钢琴：多利亚的特征是第六级 B 自然出现 */
    const mel = [
      [0.0,'D4'], [1.5,'F4'], [2.6,'A4'],
      [4.0,'B4'], [5.4,'A4'],
      [8.0,'F4'], [9.2,'E4'], [10.4,'D4'],
      [12.0,'A4'], [13.5,'F4'],
      [14.4,'D4']
    ];
    mel.forEach(([t, k]) => n(ev, t * bar, 'piano', F[k], 3.6, 0.62));

    /* 弦乐垫：很薄，负责"这屋子很大" */
    n(ev, 0, 'pad', F.D3, bar * 8, 0.42);
    n(ev, 8 * bar, 'pad', F.A3, bar * 8, 0.38);

    /* 高音：一个几乎听不见的 D，让空间有顶 */
    n(ev, 0, 'air', F.D5, bar * 16, 0.22);

    /* 纸张/房间噪：全程。这是"档案柜"质感的来源 */
    return {
      id:'menu', label:'菜单', bpm, bars, barLen: bar,
      segs: [
        { from:0,  name:'A 起' }, { from:4,  name:'A 读' },
        { from:8,  name:'B 翻' }, { from:12, name:'A′ 合' }
      ],
      chord: b => (b < 8 ? 'Dm' : b < 12 ? 'Am' : 'Dm'),
      layers: ['piano','bass','pad','air','amb'],
      amb: { type:'room', level:0.42 },
      events: ev
    };
  }

  return {
    battle: buildBattle(),
    tension: buildTension(),
    win: buildWin(),
    lose: buildLose(),
    menu: buildMenu()
  };
});
