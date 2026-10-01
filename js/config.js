/* ==========================================================================
 * 星空战机 —— 全局配置文件
 * --------------------------------------------------------------------------
 * 本文件集中存放所有可调数值参数（画面、玩家、成长、敌机、道具体系、难度梯度、
 * BOSS、特效、音效…），后续调整数值只需要修改这一个文件，无需改动游戏逻辑。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 逻辑分辨率（竖版 9:16，画布内部坐标系） ---------------- */
  var WIDTH = 540;
  var HEIGHT = 960;

  /* ---------------- 5 类游戏状态（状态机使用） ---------------- */
  var STATE = {
    MENU: 'menu',          // 主菜单
    PLAYING: 'playing',    // 游戏中
    LEVELUP: 'levelup',    // 升级选择（三选一，游戏逻辑冻结）
    PAUSED: 'paused',      // 暂停中
    GAMEOVER: 'gameover'   // 结算界面
  };

  /* ---------------- 星空背景 ---------------- */
  var STARFIELD = {
    STAR_COUNT: 160,          // 星星总数（按面积权重分配到各层）
    LAYER_COUNT: 3,           // 视差层数
    BASE_SPEED: 60,           // 初始滚动速度（像素/秒）——基础值
    MAX_SPEED_MULT: 2.0,      // 滚动速度上限 = 初始值 × 2
    ACCEL_PER_SEC: 0.9,       // 每游戏 1 秒的速度增量
    LAYER_FACTORS: [0.45, 0.8, 1.35],   // 各层速度系数
    STAR_SIZE: [0.8, 2.2],    // 星星半径范围
    STAR_ALPHA: [0.25, 0.95], // 星星透明度范围
    TWINKLE_SPEED: 3.0,       // 闪烁速度
    COLORS: ['#ffffff', '#ffffff', '#ffffff', '#cfe4ff', '#ffe6bb', '#c9b6ff']
  };

  /* ---------------- 玩家战机 ---------------- */
  var PLAYER = {
    START_X: WIDTH / 2,             // 屏幕底部水平中央
    START_Y: HEIGHT - 110,
    W: 46, H: 52,                   // 视觉尺寸
    HIT_W: 20, HIT_H: 24,           // 碰撞盒（小于视觉贴图）
    HP_MAX: 3,                      // 初始生命值（可被「生命上限」强化提高）
    HP_MAX_CAP: 5,                  // 生命上限硬顶
    SPEED: 330,                     // 基础移动速度（像素/秒）
    /* 操控优化：输入不再直接位移，而是先写入目标点再平滑趋近（保留全方向与速度） */
    RESPONSE: 42,                   // 键盘平滑系数（越大越跟手，16ms 内基本到位）
    FOLLOW_LERP: 26,                // 鼠标 / 触屏拖动跟随系数（无拖动延迟）
    FIRE_RATE: 3,                   // 初始射速：每秒 3 发
    FIRE_RATE_CAP_MULT: 3.0,        // 射速硬顶 = 初始射速 × 3
    BULLET_W: 4.6, BULLET_H: 21.6,  // 白色细长矩形子弹（宽度 +15%、长度 +20%）
    BULLET_SPEED: 760,              // 向上飞行速度
    BULLET_DAMAGE: 1,               // 单发基础伤害（可被「火力增强」提高）
    /* 多弹链：并排多发的横向间距（火力强化状态下间距扩大 30%） */
    LANE_GAP: 13,
    CENTER_GAP: 9,                  // 火力强化时双发的间距（向后兼容字段）
    INVINCIBLE_TIME: 0.5,           // 受击后无敌时间（秒）
    POWERUP_TIME: 12,               // 火力强化持续时间（秒）
    RATE_BUFF_MULT: 1.5,            // 射速强化道具：射速 +50%
    RATE_BUFF_TIME: 8,              // 射速强化持续时间（秒）
    SHIELD_MAX: 2,                  // 减伤护盾上限层数（强化）
    RECOIL: { MAX: 5.5, DECAY: 46 } // 每次射击的极轻微后坐震动（像素 / 衰减速度）
  };

  /* ---------------- 局内成长系统（经验 · 升级 · 三选一强化） ---------------- */
  var RPG = {
    LEVEL_MAX: 8,                  // 初始 1 级、最高 8 级
    /* 升到 2~8 级所需经验。曲线按「单局 8~10 分钟、打 BOSS 时约 4~6 级」标定：
     * 累计到 5 级需 1050 经验，而 15000 分对应的击杀经验约 1260，因此 BOSS 阶段
     * 玩家等级自然落在 5~6 级区间。如需提前/推后成长节奏，只需调整本数组。 */
    /* 升到 2~8 级所需经验。曲线按「单局 8~10 分钟、打到 BOSS 时约 5~6 级」标定：
     * 15000 分对应的总击杀经验约 3000，因此 Lv.7 的门槛特意抬高，
     * 让玩家带着接近满级的战力进入 BOSS 战（BOSS 难度按 4~6 级封顶匹配）。 */
    XP_PER_LEVEL: [30, 80, 160, 300, 500, 1500, 2400],
    CHOICE_COUNT: 3,               // 每次升级弹出 3 个随机强化
    /* 同类强化叠加时数值递减：第 1/2/3/4 层的效果系数 */
    STACK_FALLOFF: [1, 0.7, 0.5, 0.35],
    /* 强化池：6 种，可用 maxStack 与 disabled 控制出现与上限 */
    UPGRADES: [
      {
        key: 'fireRate', name: '射速提升', short: '速', maxStack: 4,
        desc: function (v) { return '射速 +' + Math.round(v * 100) + '%'; },
        /* v = FIRE_RATE * RATE_PER_STACK * 叠加系数 */
        RATE_PER_STACK: 0.18, RATE_CAP: 0.9
      },
      {
        key: 'damage', name: '火力增强', short: '攻', maxStack: 4,
        desc: function (v) { return '子弹伤害 +' + v.toFixed(2) + '/发'; },
        DAMAGE_PER_STACK: 0.35, DAMAGE_CAP: 1.4
      },
      {
        key: 'chain', name: '额外弹链', short: '链', maxStack: 3,
        desc: function (v) { return '并排弹链 +1（当前 ' + (1 + v) + ' 发，最多 4 发）'; },
        CHAIN_PER_STACK: 1, CHAIN_CAP: 3
      },
      {
        key: 'moveSpeed', name: '移速提升', short: '速', maxStack: 4,
        desc: function (v) { return '移动速度 +' + Math.round(v * 100) + '%'; },
        SPEED_PER_STACK: 0.08, SPEED_CAP: 0.32
      },
      {
        key: 'maxHp', name: '生命上限', short: '命', maxStack: 2,
        desc: function (v) { return '生命上限 +' + v + '（最高 ' + PLAYER.HP_MAX_CAP + '）'; },
        HP_PER_STACK: 1, HP_CAP: PLAYER.HP_MAX_CAP - PLAYER.HP_MAX
      },
      {
        key: 'shield', name: '减伤护盾', short: '盾', maxStack: 2,
        desc: function (v) { return '护盾层数 +1（当前 ' + v + ' 层，最多 2 层）'; },
        SHIELD_PER_STACK: 1, SHIELD_CAP: PLAYER.SHIELD_MAX
      }
    ],
    /* 经验奖励 */
    XP: { small: 10, medium: 30, elite: 80 }
  };

  /* ---------------- 敌机通用 ---------------- */
  var ENEMY_COMMON = {
    DESPAWN_MARGIN: 60,   // 飞出边界的回收余量
    SPAWN_X_MARGIN: 0.06, // 顶部随机横坐标的边距比例（相对画布宽度）
    DROP_CHANCE: 0.15     // 击毁任意敌机掉落道具的基础概率 = 15%
  };

  /* ---------------- 三种普通敌机 ----------------
   * 生成间隔按「单局 8~10 分钟」的节奏标定（见 tools/calibrate.js）：
   * 击杀得分与经验的总投放速度决定整局时长。若希望节奏更激烈，
   * 按比例调小下列 SPAWN_INTERVAL 即可（例如全部 ×0.6 约缩短到 5 分钟一局）。 */
  var ENEMIES = {
    /* 小型：血量 1，匀速直线下落，不发射子弹，60 分 */
    small: {
      key: 'small', label: '小型',
      HP: 1, SCORE: 60, XP: RPG.XP.small, SPAWN_INTERVAL: 2.1, SPEED: 120,
      W: 34, H: 34, HIT_W: 20, HIT_H: 20,
      COLOR: '#67e8f9', COLOR_DARK: '#0e7490',
      MOTION: 'straight',
      FIRE_INTERVAL: 0, BULLET_SPEED: 0, BULLET_MODE: 'none', BULLET_COUNT: 1
    },
    /* 中型：血量 3，正弦摆动下落，每 2 秒发射 1 发红色子弹，150 分 */
    medium: {
      key: 'medium', label: '中型',
      HP: 3, SCORE: 150, XP: RPG.XP.medium, SPAWN_INTERVAL: 6.0, SPEED: 95,
      W: 46, H: 44, HIT_W: 26, HIT_H: 26,
      COLOR: '#fbbf24', COLOR_DARK: '#b45309',
      MOTION: 'sine',
      SWAY_PERIOD: 2.0,          // 摆动周期 2 秒 / 次
      SWAY_WIDTH_MULT: 1.5,      // 最大横向位移 = 自身宽度 × 1.5（难度提升不影响该参数）
      FIRE_INTERVAL: 2.0, BULLET_SPEED: 250, BULLET_MODE: 'single', BULLET_COUNT: 1
    },
    /* 精英：血量 5，匀速直线下落，每 1.5 秒双排子弹，300 分，固定周期刷新 */
    elite: {
      key: 'elite', label: '精英',
      HP: 5, SCORE: 300, XP: RPG.XP.elite, SPAWN_INTERVAL: null, SPEED: 78,
      W: 62, H: 56, HIT_W: 34, HIT_H: 32,
      COLOR: '#fb7185', COLOR_DARK: '#9f1239',
      MOTION: 'straight',
      FIRE_INTERVAL: 1.5, BULLET_SPEED: 260, BULLET_MODE: 'double', BULLET_COUNT: 2,
      DOUBLE_OFFSET: 18,       // 双排子弹横向间距（后期在该基础上扩大 20%）
      TIER: 'elite',
      FIXED_SPAWN_PERIOD: 40   // 每游戏 40 秒固定生成 1 架的基准（中期起生效，后期压缩到 35 秒）
    }
  };

  /* 顶部随机生成时普通敌机的权重（精英机不走这里，由梯度难度控制固定刷新）
   * 前期通过整体权重 ×1.05 实现「生成间隔缩短 5%」的密度提升（见 DIFFICULTY_STAGES.INTERVAL_MULT）；
   * 后期通过阶段的 WEIGHT_MULT 提升中型敌机出场占比。 */
  var SPAWN_WEIGHTS = { small: 5, medium: 2.2 };

  /* ---------------- 三段式梯度难度 ----------------
   * 前期 / 中期 / 后期分别定义：每 30 秒生成间隔衰减、移速增益、两者上限倍数。
   * 精英机刷新间隔在每个阶段固定；弹幕密度用 BULLET_DENSITY 整体缩放；
   * 敌机血量按阶段的 HP_MULT 提升（后期更硬）；
   * 后期另外压缩中型敌机射击间隔、扩大精英双排弹间距、提升中型出场占比。 */
  var DIFFICULTY_STAGES = [
    {
      key: 'early', name: '新手友好期',
      SCORE_MIN: 0, SCORE_MAX: 5000,
      INTERVAL_DECAY: 0, SPEED_GAIN: 0, MAX_MULT: 1.0,      // 前期维持初始值
      INTERVAL_MULT: 0.95,                                  // 整体生成间隔缩短 5%（小幅提升密度）
      ELITE_ENABLED: false, ELITE_INTERVAL: null, ELITE_INTERVAL_FACTOR: 1,
      BULLET_DENSITY: 1.0,
      HP_MULT: { small: 1, medium: 1, elite: 1 },           // 前期敌机血量保持初始值
      WEIGHT_MULT: { small: 1, medium: 1 },
      MEDIUM_FIRE_INTERVAL: null, ELITE_BULLET_GAP_MULT: 1,
      BOSS_HP: 0, BOSS_BURST_FACTOR: 1.0, BOSS_SPREAD_FACTOR: 1.0   // BOSS 不会在前期出现
    },
    {
      key: 'mid', name: '稳步提升期',
      SCORE_MIN: 5000, SCORE_MAX: 12000,
      INTERVAL_DECAY: 0.13, SPEED_GAIN: 0.05, MAX_MULT: 1.8, // 每 30 秒：间隔 -13%、移速 +5%，上限 1.8 倍
      INTERVAL_MULT: 1.0,
      ELITE_ENABLED: true, ELITE_INTERVAL: 40, ELITE_INTERVAL_FACTOR: 1,   // 加入精英敌机：每 40 秒 1 架
      BULLET_DENSITY: 1.15,
      HP_MULT: { small: 1, medium: 4 / 3, elite: 6 / 5 },    // 中型 4 点、精英 6 点
      WEIGHT_MULT: { small: 1, medium: 1.1 },                // 中型出场占比小幅提升
      MEDIUM_FIRE_INTERVAL: null, ELITE_BULLET_GAP_MULT: 1,
      BOSS_HP: 120, BOSS_BURST_FACTOR: 0.95, BOSS_SPREAD_FACTOR: 1.0
    },
    {
      key: 'late', name: '高压挑战期',
      SCORE_MIN: 12000, SCORE_MAX: Infinity,
      INTERVAL_DECAY: 0.18, SPEED_GAIN: 0.08, MAX_MULT: 2.0, // 每 30 秒：间隔 -18%、移速 +8%，上限 2 倍
      INTERVAL_MULT: 1.0,
      ELITE_ENABLED: true, ELITE_INTERVAL: 30, ELITE_INTERVAL_FACTOR: 1,   // 精英机刷新压缩到 30 秒
      BULLET_DENSITY: 1.35,                                  // 弹幕密度提升
      HP_MULT: { small: 1, medium: 5 / 3, elite: 8 / 5 },    // 中型 5 点、精英 8 点
      WEIGHT_MULT: { small: 1, medium: 1.2 },                // 中型敌机出场占比提升 20%（权重口径）
      MEDIUM_FIRE_INTERVAL: 1.5,                             // 中型敌机射击间隔 2 秒 → 1.5 秒
      ELITE_BULLET_GAP_MULT: 1.2,                            // 精英双排弹横向间距 +20%
      BOSS_HP: 140, BOSS_BURST_FACTOR: 0.8, BOSS_SPREAD_FACTOR: 0.85
    }
  ];

  /* 阶段时长的时间轴口径 */
  var DIFFICULTY = {
    STEP_TIME: 30,          // 每 30 秒提升一档
    MULT_MIN: 1.0
  };

  /* BOSS 阶段难度匹配玩家 4~6 级平均水平：
   * 玩家等级低于 4 时按 4 级（中期难度）结算，6 级以上按 6 级（后期难度）结算，中间线性插值 */
  var BOSS_TUNING = {
    MIN_LEVEL: 4,
    MAX_LEVEL: 6,
    /* 关卡难度等级 → 采用的阶段预设索引（后两个阶段） */
    LEVEL_TO_STAGE: { 4: 1, 5: 2, 6: 2 }
  };

  /* ---------------- 敌方子弹 ---------------- */
  var ENEMY_BULLET = {
    W: 10.4, H: 20.8,          // 视觉尺寸（原 8×16 放大 30%）
    HIT_W: 10.4, HIT_H: 20.8,  // 碰撞盒（略小于含光晕的整体观感）
    COLOR: '#ff4d4d',
    R: 255, G: 77, B: 77,      // 外光晕与拖尾使用的同色 RGB
    HALO_WIDTH_MULT: 2.0,      // 光晕宽度 = 本体宽度 × 2
    HALO_ALPHA: 0.5,           // 光晕透明度 50%
    TRAIL_LEN_MULT: 1.0        // 尾部拖尾长度 = 本体长度 × 1
  };

  /* ---------------- 最终 BOSS ---------------- */
  var BOSS = {
    SCORE_TRIGGER: 15000,       // 累计得分达到该值触发
    HP: 120,                    // 基础血量（实际按玩家等级在阶段预设间插值）
    SCORE_KILL: 2500,           // 击败额外得分
    XP: 400,                    // 击败奖励经验
    W: 240, H: 116,
    HIT_W: 168, HIT_H: 82,
    Y_RATIO: 0.25,              // 生成在屏幕上方 1/4 位置
    SPEED: 110,                 // 仅水平往复移动
    SWAY_MARGIN: 24,            // 水平往复的边界余量
    BURST_INTERVAL: 1.2,        // 每 1.2 秒发射 1 组平行子弹
    BURST_COUNT: 3,
    BURST_OFFSET: 78,
    BURST_SPEED: 265,
    SPREAD_INTERVAL: 2.5,       // 每 2.5 秒发射 1 组扇形散射子弹
    SPREAD_COUNT: 5,
    SPREAD_STEP: 12,            // 相邻子弹角度差（度）
    SPREAD_SPEED: 240,
    /* 追加技能 1：血量低于阈值后弹幕频率提升（仅首次触发一次） */
    ENRAGE_HP_RATIO: 0.5,       // 血量降至 50% 以下触发
    ENRAGE_FIRE_MULT: 0.74,     // 弹幕发射间隔乘以该系数（频率 +35%）
    /* 追加技能 2：单次回血（全程仅生效 1 次） */
    HEAL_TRIGGER_RATIO: 0.25,   // 血量首次降至 25% 时自动触发
    HEAL_AMOUNT: 30,            // 立即回复 30 点生命
    HEAL_FLASH_TIME: 0.6,       // 机身绿色光晕闪烁时长（秒）
    /* 追加技能 3：三类敌机独立冷却召唤（从屏幕顶部随机位置生成） */
    SUMMONS: [
      { type: 'small',  interval: 3.5, count: 2 },
      { type: 'medium', interval: 6.0, count: 1 },
      { type: 'elite',  interval: 10.0, count: 1 }
    ],
    COLOR: '#c084fc', COLOR_DARK: '#4c1d95',
    HP_BAR_W: 380, HP_BAR_H: 13,
    HP_BAR_Y: 132               // 血条纵坐标（位于顶部状态栏与增益提示下方）
  };

  /* ---------------- 道具系统 ----------------
   * 5 种道具；掉落概率 15%，前期偏向生命类，后期偏向火力 / 炸弹类。
   * 每种道具的 weightByStage 与对应难度阶段的索引对齐（early / mid / late）。 */
  var POWERUPS = {
    DROP_SPEED: 125,
    W: 30, H: 30, HIT_W: 30, HIT_H: 30,   // 道具用完整尺寸判定拾取
    DROP_CHANCE: ENEMY_COMMON.DROP_CHANCE,
    TYPES: {
      fire:   { key: 'fire',   label: '火力强化', GLYPH: 'F', COLOR: '#f59e0b', weightByStage: [1, 3, 5] },
      heal:   { key: 'heal',   label: '生命恢复', GLYPH: 'H', COLOR: '#34d399', weightByStage: [6, 2.5, 1] },
      shield: { key: 'shield', label: '护盾生成', GLYPH: 'S', COLOR: '#38bdf8', weightByStage: [2, 3, 3] },
      rate:   { key: 'rate',   label: '射速强化', GLYPH: 'R', COLOR: '#a78bfa', weightByStage: [0, 3, 4] },
      bomb:   { key: 'bomb',   label: '全屏炸弹', GLYPH: 'B', COLOR: '#fb7185', weightByStage: [0, 1.5, 3] }
    },
    BOMB: { BOSS_DAMAGE: 10 }    // 全屏炸弹对 BOSS 造成 10 点伤害
  };

  /* ---------------- 特效 ---------------- */
  var EFFECTS = {
    HIT_FLASH: { DURATION: 0.2, RADIUS: 44, COLOR: '255,255,255' },   // 敌机击毁 0.2 秒爆炸闪光
    HIT_BLINK: { DURATION: 0.1 },                                     // 命中敌机的 0.1 秒白色高亮闪烁
    BIG_FLASH: { DURATION: 1.0, RADIUS: 210, COLOR: '255,214,170' },  // BOSS 击毁 1 秒大型爆炸
    FIREBALL_DURATION: 0.4,
    FIREBALL_RADIUS: 30,
    PARTICLE_COUNT: 14,
    PARTICLE_SPEED: [80, 280]
  };

  /* ---------------- 音效与音乐 ---------------- */
  var AUDIO = {
    MASTER_VOLUME: 0.7,     // 总音量（中等）
    MUSIC_VOLUME: 0.5,      // 背景音乐音量（中等）
    SFX_VOLUME: 0.6,        // 四类短促触发音效音量
    MUSIC_TEMPO: 122,       // 轻快电子风循环速度（BPM）
    SFX: {
      shoot:  { type: 'square',   freq: 920,  freqEnd: 430,  duration: 0.07, gain: 0.16 },
      explode:{ type: 'noise',    freq: 1600, freqEnd: 160,  duration: 0.34, gain: 0.42 },
      hurt:   { type: 'sawtooth', freq: 300,  freqEnd: 70,   duration: 0.28, gain: 0.32 },
      pickup: { type: 'triangle', freq: 880,  freqEnd: 1560, duration: 0.20, gain: 0.26 }
    }
  };

  /* ---------------- 首次操作提示 ---------------- */
  var HINT = {
    DURATION: 3.0,        // 默认显示 3 秒
    FADE_TIME: 0.6,       // 最后 0.6 秒淡出
    Y_RATIO: 0.62,        // 屏幕中部偏下
    FONT_SIZE: 19,
    ALPHA: 0.8,           // 半透明白色
    TEXT_PC: '方向键 / WASD 控制移动  自动射击  ESC暂停',
    TEXT_MOBILE: '拖动屏幕控制战机  自动射击  点击右上角暂停'
  };

  /* ---------------- UI 布局参数（均按 540×960 逻辑坐标绘制） ---------------- */
  var UI = {
    TOPBAR_H: 68,
    SCORE: { X: 18, Y: 42, FONT_SIZE: 24, COLOR: '#e6f2ff' },
    HEART: { SIZE: 19, GAP: 7, X: 302, Y: 32 },     // 心形区域起点
    SHIELD: { SIZE: 11, GAP: 6, OFFSET_Y: 26 },     // 护盾层数标识（心形下方）
    PAUSE_BTN: { X: 452, Y: 14, SIZE: 44 },         // 方形暂停按钮
    TITLE: { TEXT: '星空战机', Y: 330, FONT_SIZE: 68, COLOR: '#9be7ff' },
    SUBTITLE: { TEXT: '方向键/WASD移动，自动射击', Y: 386, FONT_SIZE: 18, COLOR: 'rgba(230,242,255,0.72)' },
    RESULT_SCORE: { Y: 470, FONT_SIZE: 28, COLOR: '#ffffff' }
  };

  global.CONFIG = {
    WIDTH: WIDTH,
    HEIGHT: HEIGHT,
    ASPECT: WIDTH / HEIGHT,
    STATE: STATE,
    STARFIELD: STARFIELD,
    PLAYER: PLAYER,
    RPG: RPG,
    ENEMY_COMMON: ENEMY_COMMON,
    ENEMIES: ENEMIES,
    SPAWN_WEIGHTS: SPAWN_WEIGHTS,
    DIFFICULTY: DIFFICULTY,
    DIFFICULTY_STAGES: DIFFICULTY_STAGES,
    BOSS_TUNING: BOSS_TUNING,
    ENEMY_BULLET: ENEMY_BULLET,
    BOSS: BOSS,
    POWERUPS: POWERUPS,
    EFFECTS: EFFECTS,
    AUDIO: AUDIO,
    HINT: HINT,
    UI: UI
  };
})(window);
