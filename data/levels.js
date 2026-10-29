/* 由 tools/export-levels.js 从 game/campaign.html 生成 —— 不要手改这个文件。
   改了关卡数据之后跑一次：node tools/export-levels.js
   想确认首页和引擎有没有走样：node tools/export-levels.js --check

   为什么是 .js 而不是 .json：项目要能双击直接打开，
   file:// 下 fetch 会被同源策略拦掉，<script src> 不会。 */
window.CANGYU = {
  "ver": "v4.16",
  "srcSig": "420973:1xzxytt",
  "storage": {
    "save": "wargame.lankou.save",
    "saveVer": 3,
    "progress": "wargame.campaign.progress"
  },
  "chapters": [
    {
      "no": 1,
      "name": "艰难时刻",
      "span": "新历 1207 年 9 月 – 1208 年 8 月",
      "where": "北岭 – 青溪 – 岚口 – 波尔瓦萨",
      "teaser": "边境七十二小时崩溃。你带着被留下来的人一路打一路退，退到不能再退。",
      "total": 9,
      "main": 6,
      "sub": 3,
      "ready": 9
    },
    {
      "no": 2,
      "name": "兵临城下",
      "span": "新历 1208 年 9 月 – 1208 年 12 月",
      "where": "岚京北郊 – 环城铁路 – 中央车站",
      "teaser": "首都圈成了最后一道防线。敌军的炮口已经能打到城里的钟楼。",
      "total": 9,
      "main": 6,
      "sub": 3,
      "ready": 0
    },
    {
      "no": 3,
      "name": "一步不退",
      "span": "新历 1209 年 1 月 – 1209 年 5 月",
      "where": "雾岭雪线 – 青溪冰面 – 三号公路",
      "teaser": "冬天封了山，也封了补给。没有援军，没有弹药，脚下这块地不退。",
      "total": 8,
      "main": 6,
      "sub": 2,
      "ready": 0
    },
    {
      "no": 4,
      "name": "破灭神话",
      "span": "新历 1209 年 6 月 – 1209 年 10 月",
      "where": "铁砧高地 – 长湾北岸 – 海峡",
      "teaser": "灰原近卫装甲师从没输过。这一章要做的事，就是让这句话变成过去式。",
      "total": 9,
      "main": 6,
      "sub": 3,
      "ready": 0
    },
    {
      "no": 5,
      "name": "战略决战",
      "span": "新历 1209 年 11 月 – 1210 年 3 月",
      "where": "潮汐湾 – 长湾海峡 – 岚京外海",
      "teaser": "双方主力全部投入。这一仗打完，战争的方向就定了。",
      "total": 8,
      "main": 6,
      "sub": 2,
      "ready": 0
    },
    {
      "no": 6,
      "name": "反攻号角",
      "span": "新历 1210 年 4 月 – 1210 年 8 月",
      "where": "青溪 – 岚口 – 雾岭 – 北岭",
      "teaser": "从渡江开始，一站一站往回打。回到北岭要塞那天，那里只剩断墙。",
      "total": 8,
      "main": 6,
      "sub": 2,
      "ready": 0
    },
    {
      "no": 7,
      "name": "决胜一击",
      "span": "新历 1210 年 9 月 – 1210 年 12 月",
      "where": "灰原第 7 旅 – 三号公路 – 口袋",
      "teaser": "把他们的主力装进口袋，然后收紧。",
      "total": 8,
      "main": 5,
      "sub": 3,
      "ready": 0
    },
    {
      "no": 8,
      "name": "伟大胜利",
      "span": "新历 1211 年 1 月 – 1211 年 3 月",
      "where": "岚京 – 灰岭 – 灰原首都",
      "teaser": "解围、反攻、终局。最后一仗不在我们的土地上打。",
      "total": 7,
      "main": 5,
      "sub": 2,
      "ready": 0
    }
  ],
  "levels": [
    {
      "id": "T1",
      "ch": 0,
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
      "ch": 1,
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
        "str": 139
      }
    },
    {
      "id": "C2",
      "ch": 1,
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
        "str": 87
      }
    },
    {
      "id": "C2B",
      "ch": 1,
      "no": 2,
      "sub": true,
      "name": "青溪夜渡",
      "type": "附属 · 特种",
      "when": "新历 1207 年 11 月 25 日",
      "where": "青溪 · 上游浅滩",
      "teaser": "渡口还在敌人手里。工兵连夜架一座浮桥，赶在天亮前把第一批辎重送过江。",
      "ready": true,
      "open": false,
      "prevId": "C2",
      "noText": "第 2 关 · 附属 · ",
      "win": "reach",
      "turns": 10,
      "cols": 14,
      "rows": 10,
      "blue": {
        "cards": 9,
        "str": 46
      },
      "red": {
        "cards": 8,
        "str": 40
      }
    },
    {
      "id": "C3",
      "ch": 1,
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
        "str": 191
      }
    },
    {
      "id": "C3B",
      "ch": 1,
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
        "str": 80
      },
      "red": {
        "cards": 17,
        "str": 119
      }
    },
    {
      "id": "C4",
      "ch": 1,
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
        "str": 304
      }
    },
    {
      "id": "C4B",
      "ch": 1,
      "no": 4,
      "sub": true,
      "name": "港口撤离",
      "type": "附属 · 撤离",
      "when": "新历 1208 年 4 月 18 日",
      "where": "南部海岸 · 波尔瓦萨港 · 西码头",
      "teaser": "要塞昨晚丢了。舰队还有最后一班出港时间，码头上是三万人的行李和两个师的残部。",
      "ready": true,
      "open": false,
      "prevId": "C4",
      "noText": "第 4 关 · 附属 · ",
      "win": "reach",
      "turns": 12,
      "cols": 22,
      "rows": 16,
      "blue": {
        "cards": 17,
        "str": 87
      },
      "red": {
        "cards": 11,
        "str": 75
      }
    },
    {
      "id": "C5",
      "ch": 1,
      "no": 5,
      "sub": false,
      "name": "南岭阻击",
      "type": "迟滞",
      "when": "新历 1208 年 6 月 3 日",
      "where": "中部 · 南岭公路 17 号桥",
      "teaser": "后撤的主力要从这条公路上过，四个师，两天两夜。你手上是一个被打残的旅和一座桥。",
      "ready": true,
      "open": false,
      "prevId": "C4",
      "noText": "第 5 关 · ",
      "win": "survive",
      "turns": 12,
      "cols": 16,
      "rows": 12,
      "blue": {
        "cards": 10,
        "str": 50
      },
      "red": {
        "cards": 11,
        "str": 56
      }
    },
    {
      "id": "C6",
      "ch": 1,
      "no": 6,
      "sub": false,
      "name": "岚京外围",
      "type": "防御",
      "when": "新历 1208 年 8 月 15 日",
      "where": "首都圈 · 岚京北郊防线",
      "teaser": "退到不能再退。城外最后一道防线后面就是首都，防线上只有刚补满的新兵。",
      "ready": true,
      "open": false,
      "prevId": "C5",
      "noText": "第 6 关 · ",
      "win": "survive",
      "turns": 14,
      "cols": 18,
      "rows": 12,
      "blue": {
        "cards": 16,
        "str": 83
      },
      "red": {
        "cards": 14,
        "str": 97
      }
    },
    {
      "id": "C7",
      "ch": 2,
      "no": 1,
      "sub": false,
      "name": "岚京北郊",
      "type": "防御",
      "when": "新历 1208 年 9 月 12 日",
      "where": "首都圈 · 岚京北郊",
      "teaser": "敌军的先头侦察已经能看见城里的钟楼。北郊这几座村子，是首都的最后一道门槛。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 1 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C7B",
      "ch": 2,
      "no": 1,
      "sub": true,
      "name": "环城铁路",
      "type": "附属 · 破袭",
      "when": "新历 1208 年 9 月 20 日",
      "where": "首都圈 · 环城铁路东段",
      "teaser": "敌军的弹药靠这条铁路运到城下。一晚上，拆掉三座桥涵，别让他们天亮前修好。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 1 关 · 附属 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C8",
      "ch": 2,
      "no": 2,
      "sub": false,
      "name": "城北水厂",
      "type": "坚守",
      "when": "新历 1208 年 10 月 2 日",
      "where": "首都圈 · 岚京城北水厂",
      "teaser": "两百万人喝的水从这里来。水厂一丢，城里的守军撑不过一周。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C9",
      "ch": 2,
      "no": 3,
      "sub": false,
      "name": "广播大楼",
      "type": "巷战",
      "when": "新历 1208 年 10 月 14 日",
      "where": "首都圈 · 岚京市中心 · 广播大楼",
      "teaser": "大楼里的发射机还在播送。谁控制它，谁就控制这座城听到的声音。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 3 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C9B",
      "ch": 2,
      "no": 3,
      "sub": true,
      "name": "断电之夜",
      "type": "附属 · 夜战",
      "when": "新历 1208 年 10 月 19 日",
      "where": "首都圈 · 岚京老城区",
      "teaser": "电厂停了，全城没有一盏灯。敌我都在黑暗里，靠声音判断对面是谁。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 3 关 · 附属 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C10",
      "ch": 2,
      "no": 4,
      "sub": false,
      "name": "中央车站",
      "type": "争夺",
      "when": "新历 1208 年 10 月 28 日",
      "where": "首都圈 · 岚京中央车站",
      "teaser": "城里的补给全靠这个站台。站台底下还有三条没被炸断的隧道。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C11",
      "ch": 2,
      "no": 5,
      "sub": false,
      "name": "外环防线",
      "type": "防御",
      "when": "新历 1208 年 11 月 15 日",
      "where": "首都圈 · 岚京外环",
      "teaser": "外环是包围圈的内缘。守住它，城里的粮食还能再进一个月。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 5 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C11B",
      "ch": 2,
      "no": 5,
      "sub": true,
      "name": "平民撤离",
      "type": "附属 · 护送",
      "when": "新历 1208 年 11 月 20 日",
      "where": "首都圈 · 岚京西郊公路",
      "teaser": "车队有四十公里长，走不快。敌军的侦察机已经在头顶转了两天。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 5 关 · 附属 · ",
      "win": "reach",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C12",
      "ch": 2,
      "no": 6,
      "sub": false,
      "name": "岚京保卫战",
      "type": "防御",
      "when": "新历 1208 年 12 月 6 日",
      "where": "首都圈 · 岚京市区",
      "teaser": "第 2 章的收尾。城还在，但城外已经没有一支援军了。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 6 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C13",
      "ch": 3,
      "no": 1,
      "sub": false,
      "name": "雾岭雪线",
      "type": "相持",
      "when": "新历 1209 年 1 月 8 日",
      "where": "中部 · 雾岭主脊",
      "teaser": "雪封了山，也封了双方的后勤。谁也不进攻，就看谁先在雪里冻掉一个营。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 1 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C14",
      "ch": 3,
      "no": 2,
      "sub": false,
      "name": "断粮七日",
      "type": "坚守",
      "when": "新历 1209 年 1 月 23 日",
      "where": "中部 · 雾岭北坡 4 号阵地",
      "teaser": "后方被切断了七天。弹药还剩两个基数，口粮还剩三天，命令是\"不许退\"。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C14B",
      "ch": 3,
      "no": 2,
      "sub": true,
      "name": "空投补给",
      "type": "附属 · 防空",
      "when": "新历 1209 年 1 月 26 日",
      "where": "中部 · 雾岭北坡空投场",
      "teaser": "运输机今晚来，投十二个伞包。敌军战斗机也在等同一批伞包。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · 附属 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C15",
      "ch": 3,
      "no": 3,
      "sub": false,
      "name": "青溪冰面",
      "type": "防御",
      "when": "新历 1209 年 2 月 14 日",
      "where": "北部 · 青溪下游",
      "teaser": "江面冻实了，天险没了。敌军装甲可以直接从冰上过来，你的阵地却还修在去年的位置上。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 3 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C16",
      "ch": 3,
      "no": 4,
      "sub": false,
      "name": "三号公路",
      "type": "阻击",
      "when": "新历 1209 年 3 月 5 日",
      "where": "中部 · 三号公路 42 公里处",
      "teaser": "一个装甲师要从这条路过去。你有一个反坦克连、两个步兵营和两天时间。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C16B",
      "ch": 3,
      "no": 4,
      "sub": true,
      "name": "雪地救援",
      "type": "附属 · 搜救",
      "when": "新历 1209 年 3 月 9 日",
      "where": "中部 · 三号公路以东林区",
      "teaser": "一架运输机掉在林子里，机组还活着。雪还在下，敌军搜索队比你先出发两小时。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · 附属 · ",
      "win": "reach",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C17",
      "ch": 3,
      "no": 5,
      "sub": false,
      "name": "野战医院",
      "type": "护送",
      "when": "新历 1209 年 4 月 2 日",
      "where": "中部 · 雾岭南麓",
      "teaser": "医院要整体后撤，三百个不能自己走的人。路上不能开炮，开了就等于告诉敌人你在哪。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 5 关 · ",
      "win": "reach",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C18",
      "ch": 3,
      "no": 6,
      "sub": false,
      "name": "冬季反突击",
      "type": "进攻",
      "when": "新历 1209 年 5 月 11 日",
      "where": "中部 · 雾岭北麓",
      "teaser": "雪化之前，敌军以为这个冬天不会有人进攻。把他们的前沿阵地连根拔掉。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 6 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C19",
      "ch": 4,
      "no": 1,
      "sub": false,
      "name": "铁砧高地",
      "type": "防御",
      "when": "新历 1209 年 6 月 10 日",
      "where": "北部 · 铁砧高地",
      "teaser": "高地是整条战线的支点。守不住它，反攻的出发阵地就没了。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 1 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C20",
      "ch": 4,
      "no": 2,
      "sub": false,
      "name": "近卫装甲第 2 师",
      "type": "歼灭",
      "when": "新历 1209 年 7 月 2 日",
      "where": "北部 · 铁砧高地以东",
      "teaser": "两年前在波尔瓦萨港，是这支部队把码头碾平的。今天它被切断了退路。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C20B",
      "ch": 4,
      "no": 2,
      "sub": true,
      "name": "铁蹄残部",
      "type": "附属 · 追击",
      "when": "新历 1209 年 7 月 5 日",
      "where": "北部 · 铁砧以东河谷",
      "teaser": "包围圈漏了一个口子，三十多辆坦克趁着夜色跑了。追不追？追就是离开补给线。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · 附属 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C21",
      "ch": 4,
      "no": 3,
      "sub": false,
      "name": "长湾北岸",
      "type": "进攻",
      "when": "新历 1209 年 7 月 28 日",
      "where": "东部 · 长湾北岸",
      "teaser": "第一次把战场推到海上。谁控制这段海岸，谁就掐住了对方的海运。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 3 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C22",
      "ch": 4,
      "no": 4,
      "sub": false,
      "name": "海空封锁",
      "type": "争夺",
      "when": "新历 1209 年 8 月 16 日",
      "where": "东部 · 长湾海峡",
      "teaser": "制空权和制海权是同一条线。这一段海峡，双方谁都不肯让。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C22B",
      "ch": 4,
      "no": 4,
      "sub": true,
      "name": "敌后电台",
      "type": "附属 · 渗透",
      "when": "新历 1209 年 8 月 20 日",
      "where": "敌后 · 长湾北岸 3 号灯塔",
      "teaser": "敌军舰队靠一座灯塔引导夜航。带了四个人、一台电台，没有重武器，也没有退路。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · 附属 · ",
      "win": "reach",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C23",
      "ch": 4,
      "no": 5,
      "sub": false,
      "name": "无线电静默",
      "type": "特种",
      "when": "新历 1209 年 9 月 4 日",
      "where": "东部 · 长湾北岸纵深",
      "teaser": "敌人能听见我们每一次呼叫。这一仗不许开电台——没有炮火支援，没有侦察报告。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 5 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C24",
      "ch": 4,
      "no": 6,
      "sub": false,
      "name": "神话终结",
      "type": "会战",
      "when": "新历 1209 年 10 月 12 日",
      "where": "东部 · 长湾北岸平原",
      "teaser": "第 4 章的收尾。灰原陆军从不承认自己会输，今天得让他们承认一次。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 6 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C24B",
      "ch": 4,
      "no": 6,
      "sub": true,
      "name": "受降",
      "type": "附属 · 对峙",
      "when": "新历 1209 年 10 月 18 日",
      "where": "东部 · 长湾北岸 · 3 号公路桥",
      "teaser": "对面派了联络官来谈条件。谈的时候，双方的前沿都还压着火。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 6 关 · 附属 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C25",
      "ch": 5,
      "no": 1,
      "sub": false,
      "name": "会战前夜",
      "type": "侦察",
      "when": "新历 1209 年 11 月 20 日",
      "where": "东部 · 潮汐湾以北",
      "teaser": "大会战前最后一次侦察。看到什么，决定明天从哪儿打。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 1 关 · ",
      "win": "reach",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C26",
      "ch": 5,
      "no": 2,
      "sub": false,
      "name": "潮汐湾登陆",
      "type": "登陆",
      "when": "新历 1210 年 1 月 9 日",
      "where": "南部 · 潮汐湾",
      "teaser": "天亮前第一波上岸。沙滩上的工事是敌军用三个月修起来的，你有六个小时。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C26B",
      "ch": 5,
      "no": 2,
      "sub": true,
      "name": "登陆艇队",
      "type": "附属 · 护航",
      "when": "新历 1210 年 1 月 9 日",
      "where": "南部 · 潮汐湾外海",
      "teaser": "运兵船走得慢，敌方岸炮和快艇都盯着这几条船。船到不了，岸上的人就是孤军。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · 附属 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C27",
      "ch": 5,
      "no": 3,
      "sub": false,
      "name": "滩头扩张",
      "type": "进攻",
      "when": "新历 1210 年 1 月 16 日",
      "where": "南部 · 潮汐湾滩头",
      "teaser": "登陆场还太窄。撑不到十公里纵深，下一波船就靠不上岸。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 3 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C28",
      "ch": 5,
      "no": 4,
      "sub": false,
      "name": "港口反击",
      "type": "防御",
      "when": "新历 1210 年 2 月 3 日",
      "where": "南部 · 潮汐湾港区",
      "teaser": "港口刚拿下三天，敌军的反击就来了。这次换他们来抢，你来守。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C29",
      "ch": 5,
      "no": 5,
      "sub": false,
      "name": "长湾海峡突破",
      "type": "海战",
      "when": "新历 1210 年 2 月 20 日",
      "where": "东部 · 长湾海峡南口",
      "teaser": "海峡里布了雷，两岸都有炮台。护航舰队必须在天黑前把运输船送过去。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 5 关 · ",
      "win": "reach",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C30",
      "ch": 5,
      "no": 6,
      "sub": false,
      "name": "决战日",
      "type": "会战",
      "when": "新历 1210 年 3 月 15 日",
      "where": "东部 · 长湾北岸平原",
      "teaser": "第 5 章的收尾，也是全篇兵力最厚的一关。双方主力都在场，谁先崩谁就输掉整场战争。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 6 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C30B",
      "ch": 5,
      "no": 6,
      "sub": true,
      "name": "夜色中的舰队",
      "type": "附属 · 夜战",
      "when": "新历 1210 年 3 月 17 日",
      "where": "东部 · 长湾海峡夜航段",
      "teaser": "夜战没有校射，没有侦察，只有雷达上的一次次回波和不到四千米的射程。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 6 关 · 附属 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C31",
      "ch": 6,
      "no": 1,
      "sub": false,
      "name": "青溪再夺",
      "type": "争夺",
      "when": "新历 1210 年 4 月 12 日",
      "where": "北部 · 青溪上游渡口",
      "teaser": "两年前从这个渡口撤出去，浮桥是自己炸的。今天要把它夺回来。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 1 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C32",
      "ch": 6,
      "no": 2,
      "sub": false,
      "name": "南岸桥头堡",
      "type": "进攻",
      "when": "新历 1210 年 5 月 2 日",
      "where": "北部 · 青溪南岸",
      "teaser": "渡口拿下来了，但南岸的桥头堡还在敌人手里。纵深不够，重装备就过不去。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C33",
      "ch": 6,
      "no": 3,
      "sub": false,
      "name": "岚口收复",
      "type": "进攻",
      "when": "新历 1210 年 5 月 28 日",
      "where": "北部 · 岚口市",
      "teaser": "两年前在这里守了十二个回合，最后把机场让了出去。今天的命令只有两个字：收回。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 3 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C33B",
      "ch": 6,
      "no": 3,
      "sub": true,
      "name": "跑道突击",
      "type": "附属 · 突袭",
      "when": "新历 1210 年 5 月 28 日",
      "where": "北部 · 岚口机场跑道",
      "teaser": "正面还在打，跑道这边先动手。炸掉停机坪上的飞机，城里的守军就等不到空中支援。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 3 关 · 附属 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C34",
      "ch": 6,
      "no": 4,
      "sub": false,
      "name": "机场再开",
      "type": "防御",
      "when": "新历 1210 年 6 月 15 日",
      "where": "北部 · 岚口机场",
      "teaser": "跑道刚修好第一条，敌军的炮就开始试射。这一次机场不能丢——丢了就没有下一次了。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C35",
      "ch": 6,
      "no": 5,
      "sub": false,
      "name": "雾岭通道",
      "type": "突破",
      "when": "新历 1210 年 7 月 6 日",
      "where": "中部 · 雾岭隘口",
      "teaser": "隘口只有三公里宽，两侧都是爬不上去的雪线。正面硬顶，代价会很大。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 5 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C36",
      "ch": 6,
      "no": 6,
      "sub": false,
      "name": "北岭归来",
      "type": "进攻",
      "when": "新历 1210 年 8 月 1 日",
      "where": "西部边陲 · 北岭要塞",
      "teaser": "第 6 章的收尾。开局那场守了八个回合的仗，现在要反过来打一遍。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 6 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C36B",
      "ch": 6,
      "no": 6,
      "sub": true,
      "name": "要塞清剿",
      "type": "附属 · 清剿",
      "when": "新历 1210 年 8 月 4 日",
      "where": "西部边陲 · 北岭要塞地下工事",
      "teaser": "地堡里还有人不肯出来。清剿比攻占难，因为你不能把整座要塞再炸一遍。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 6 关 · 附属 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C37",
      "ch": 7,
      "no": 1,
      "sub": false,
      "name": "合围圈",
      "type": "机动",
      "when": "新历 1210 年 9 月 10 日",
      "where": "西部 · 灰原第 7 旅侧后",
      "teaser": "两个集团军要在四天之内合拢。走慢了，口袋里就是自己人。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 1 关 · ",
      "win": "reach",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C37B",
      "ch": 7,
      "no": 1,
      "sub": true,
      "name": "空降断桥",
      "type": "附属 · 空降",
      "when": "新历 1210 年 9 月 12 日",
      "where": "西部 · 河口大桥",
      "teaser": "桥是敌军唯一的退路。夜里跳下去，天亮前炸掉它——没有重装备，没有第二次机会。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 1 关 · 附属 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C38",
      "ch": 7,
      "no": 2,
      "sub": false,
      "name": "灰原第 7 旅",
      "type": "歼灭",
      "when": "新历 1210 年 9 月 28 日",
      "where": "西部 · 河口以东",
      "teaser": "从北岭要塞一路追着我们走了三年的，就是这支部队。今天它的退路全断了。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C38B",
      "ch": 7,
      "no": 2,
      "sub": true,
      "name": "敌指挥部",
      "type": "附属 · 斩首",
      "when": "新历 1210 年 10 月 2 日",
      "where": "西部 · 河口镇教堂地下室",
      "teaser": "他们的军长还在地下室里发报。抓活的，还是炸平？两道命令中间只有十分钟。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · 附属 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C39",
      "ch": 7,
      "no": 3,
      "sub": false,
      "name": "口袋收紧",
      "type": "压缩",
      "when": "新历 1210 年 10 月 20 日",
      "where": "西部 · 河口包围圈",
      "teaser": "包围圈里还剩六个师。收紧的时候最怕的不是他们突围，是自己人打到自己人。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 3 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C40",
      "ch": 7,
      "no": 4,
      "sub": false,
      "name": "突围与反突围",
      "type": "防御",
      "when": "新历 1210 年 11 月 8 日",
      "where": "西部 · 口袋南缘",
      "teaser": "被围的部队集中了全部装甲，朝南面一个点砸。那里只有一个师，还是刚补满的。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C40B",
      "ch": 7,
      "no": 4,
      "sub": true,
      "name": "雪夜追歼",
      "type": "附属 · 追击",
      "when": "新历 1210 年 11 月 11 日",
      "where": "西部 · 河口以南雪原",
      "teaser": "他们跑不动了，我们也跑不动了。谁先放弃追击，谁就多留一个师在明年。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · 附属 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C41",
      "ch": 7,
      "no": 5,
      "sub": false,
      "name": "最后一条公路",
      "type": "阻击",
      "when": "新历 1210 年 12 月 1 日",
      "where": "西部 · 三号公路西段",
      "teaser": "第 7 章的收尾。这条公路是敌军最后一个集团军唯一的补给线，也是我们最后一块拼图。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 5 关 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C42",
      "ch": 8,
      "no": 1,
      "sub": false,
      "name": "解围",
      "type": "进攻",
      "when": "新历 1211 年 1 月 6 日",
      "where": "首都圈 · 岚京西郊",
      "teaser": "首都已经被围了两年。外面的部队打到城下这一天，城里的粮食只剩十天。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 1 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C43",
      "ch": 8,
      "no": 2,
      "sub": false,
      "name": "城下之盟",
      "type": "威慑",
      "when": "新历 1211 年 1 月 20 日",
      "where": "首都圈 · 岚京城下",
      "teaser": "围城的部队已经被围了。他们还有一战之力，但已经没有打赢的可能。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C43B",
      "ch": 8,
      "no": 2,
      "sub": true,
      "name": "停战线",
      "type": "附属 · 对峙",
      "when": "新历 1211 年 1 月 22 日",
      "where": "首都圈 · 岚京北郊停战线",
      "teaser": "谈判在进行，前沿还在对峙。任何一次走火，都可能让桌上的纸作废。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 2 关 · 附属 · ",
      "win": "survive",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C44",
      "ch": 8,
      "no": 3,
      "sub": false,
      "name": "岚京光复",
      "type": "巷战",
      "when": "新历 1211 年 2 月 3 日",
      "where": "首都圈 · 岚京市区",
      "teaser": "城里的敌人还没放下枪。逐街逐屋清过去，最后打到中央广场。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 3 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C45",
      "ch": 8,
      "no": 4,
      "sub": false,
      "name": "灰原首都",
      "type": "进攻",
      "when": "新历 1211 年 2 月 24 日",
      "where": "灰原 · 灰岭城外围",
      "teaser": "战争打了三年半，第一次踏上对方的土地。城里有四十万人，也有四个师的守军。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C45B",
      "ch": 8,
      "no": 4,
      "sub": true,
      "name": "地下通道",
      "type": "附属 · 渗透",
      "when": "新历 1211 年 2 月 26 日",
      "where": "灰原 · 灰岭城地下管网",
      "teaser": "城里有一套 1910 年代修的下水道，图纸在档案馆地板上摊了半张。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 4 关 · 附属 · ",
      "win": "reach",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    },
    {
      "id": "C46",
      "ch": 8,
      "no": 5,
      "sub": false,
      "name": "胜利日",
      "type": "终局",
      "when": "新历 1211 年 3 月 15 日",
      "where": "灰原 · 灰岭城中心",
      "teaser": "第 8 章的收尾，也是整场战役的最后一关。三年前从北岭要塞退出来的那批人，今天站在这里。",
      "ready": false,
      "open": false,
      "prevId": null,
      "noText": "第 5 关 · ",
      "win": "score",
      "blue": {
        "cards": 0,
        "str": 0
      },
      "red": {
        "cards": 0,
        "str": 0
      }
    }
  ]
};
