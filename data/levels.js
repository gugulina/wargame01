/* 由 tools/export-levels.js 从 game/campaign.html 生成 —— 不要手改这个文件。
   改了关卡数据之后跑一次：node tools/export-levels.js
   想确认首页和引擎有没有走样：node tools/export-levels.js --check

   为什么是 .js 而不是 .json：项目要能双击直接打开，
   file:// 下 fetch 会被同源策略拦掉，<script src> 不会。 */
window.CANGYU = {
  "ver": "v4.6",
  "srcSig": "344781:1yn6pz4",
  "storage": {
    "save": "wargame.lankou.save",
    "saveVer": 3,
    "progress": "wargame.campaign.progress"
  },
  "levels": [
    {
      "id": "T1",
      "no": 0,
      "sub": false,
      "name": "军校沙盘",
      "type": "教学",
      "when": "战前 · 新历 1207 年 8 月下旬",
      "where": "西部军区陆军学校 · 沙盘教室",
      "teaser": "六种兵牌，一个不会推进的靶场。把按钮点一遍，再上真正的战场。",
      "ready": true,
      "open": true,
      "prevId": null,
      "noText": "序 · ",
      "win": "score",
      "turns": 7,
      "cols": 12,
      "rows": 9,
      "blue": {
        "cards": 6,
        "str": 31
      },
      "red": {
        "cards": 4,
        "str": 20
      }
    },
    {
      "id": "C1",
      "no": 1,
      "sub": false,
      "name": "北岭要塞",
      "type": "坚守",
      "when": "新历 1207 年 9 月 6 日",
      "where": "西部边陲 · 北岭要塞",
      "teaser": "敌军三个师自西面压向边陲，第 1 边防旅与第 103 步兵师被围在要塞里。守住八个回合。",
      "ready": true,
      "open": true,
      "prevId": null,
      "noText": "第 1 关 · ",
      "win": "survive",
      "turns": 8,
      "cols": 12,
      "rows": 9,
      "blue": {
        "cards": 12,
        "str": 67
      },
      "red": {
        "cards": 21,
        "str": 134
      }
    },
    {
      "id": "C2",
      "no": 2,
      "sub": false,
      "name": "青溪渡口",
      "type": "突围",
      "when": "新历 1207 年 11 月 27 日",
      "where": "青溪 · 上游渡口",
      "teaser": "第三方面军即将被合围。第 107 步兵师与第 201 坦克旅在东侧，撕开封锁线，至少四支部队过江。",
      "ready": true,
      "open": false,
      "prevId": "C1",
      "noText": "第 2 关 · ",
      "win": "reach",
      "turns": 12,
      "cols": 16,
      "rows": 10,
      "blue": {
        "cards": 14,
        "str": 85
      },
      "red": {
        "cards": 12,
        "str": 75
      }
    },
    {
      "id": "C3",
      "no": 3,
      "sub": false,
      "name": "岚口要地争夺战",
      "type": "防御",
      "when": "新历 1208 年 2 月 8 日",
      "where": "岚口 · 岚江东岸",
      "teaser": "主力东撤，你们留下。守住岚口市与机场十二个回合。",
      "ready": true,
      "open": false,
      "prevId": "C2",
      "noText": "第 3 关 · ",
      "win": "score",
      "turns": 12,
      "cols": 20,
      "rows": 14,
      "blue": {
        "cards": 23,
        "str": 133
      },
      "red": {
        "cards": 25,
        "str": 172
      }
    },
    {
      "id": "C3B",
      "no": 3,
      "sub": true,
      "name": "岚口机场保卫战",
      "type": "附属 · 防御",
      "when": "新历 1208 年 2 月 19 日",
      "where": "岚口 · 机场跑道",
      "teaser": "市区已经丢了，残部退守机场。跑道还要再撑十个回合，直到最后一批运输机起飞。",
      "ready": true,
      "open": false,
      "prevId": "C3",
      "noText": "第 3 关 · 附属 · ",
      "win": "survive",
      "turns": 10,
      "cols": 16,
      "rows": 10,
      "blue": {
        "cards": 15,
        "str": 79
      },
      "red": {
        "cards": 17,
        "str": 103
      }
    },
    {
      "id": "C4",
      "no": 4,
      "sub": false,
      "name": "波尔瓦萨港",
      "type": "坚守",
      "when": "新历 1208 年 4 月 11 日",
      "where": "南部海岸 · 波尔瓦萨港",
      "teaser": "敌军机动兵力三天推到港外。四支部队临时编成港口特遣军，港内七条军舰的炮口对着岸上。",
      "ready": true,
      "open": false,
      "prevId": "C3",
      "noText": "第 4 关 · ",
      "win": "survive",
      "turns": 20,
      "cols": 22,
      "rows": 16,
      "blue": {
        "cards": 36,
        "str": 257
      },
      "red": {
        "cards": 42,
        "str": 314
      }
    }
  ]
};
