/* ==========================================================================
 * 星空战机 —— 游戏主逻辑
 * --------------------------------------------------------------------------
 * 结构：
 *   1. 工具函数 / DOM 引用
 *   2. 星空背景（向下滚动、随游戏时长加速、上限为初始速度 2 倍）
 *   3. 战斗对象（玩家战机 / 敌机 / 子弹 / 道具 / 特效 / BOSS）
 *   4. 局内成长系统（经验 → 升级 → 三选一强化）
 *   5. 三段式梯度难度
 *   6. 输入（键盘方向键·WASD·空格·ESC、鼠标、触屏点击与拖动）
 *   7. 状态机（主菜单 / 游戏中 / 升级选择 / 暂停中 / 结算界面）
 *   8. 更新与渲染（碰撞判定、命中反馈、UI）
 * ========================================================================== */
(function () {
  'use strict';

  var CFG = window.CONFIG;
  var W = CFG.WIDTH, H = CFG.HEIGHT;

  /* ======================================================================
   * 1. 工具函数与 DOM
   * ==================================================================== */

  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* 矩形相交（中心点 + 尺寸） */
  function intersects(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) * 2 < (aw + bw) && Math.abs(ay - by) * 2 < (ah + bh);
  }

  /* 生成对象的碰撞盒（机身中心小矩形） */
  function hitBox(e) {
    var s = e.cfg || e;
    return { x: e.x, y: e.y, w: s.HIT_W || s.W, h: s.HIT_H || s.H };
  }

  function hits(a, b) {
    var A = hitBox(a), B = hitBox(b);
    return intersects(A.x, A.y, A.w, A.h, B.x, B.y, B.w, B.h);
  }

  /* 按权重随机抽取 */
  function pickWeighted(table) {
    var total = 0, k;
    for (k in table) { if (table.hasOwnProperty(k)) { total += table[k]; } }
    if (total <= 0) { return null; }
    var r = Math.random() * total;
    for (k in table) {
      if (table.hasOwnProperty(k)) {
        r -= table[k];
        if (r <= 0) { return k; }
      }
    }
    return null;
  }

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var stage = document.getElementById('stage');
  var resultTitleEl = document.getElementById('result-title');
  var resultScoreEl = document.getElementById('result-score');
  var levelupCardsEl = document.getElementById('levelup-cards');
  var levelupSubEl = document.getElementById('levelup-sub');

  var IS_TOUCH = (function () {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) { return true; }
    } catch (e) { /* ignore */ }
    return (navigator.maxTouchPoints || 0) > 0 && !window.matchMedia('(pointer: fine)').matches;
  })();

  /* 画布固定 9:16，等比缩放（CSS 已负责窗口居中） */
  function resizeCanvas() {
    var rect = stage.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    var scale = ((rect.width / W) + (rect.height / H)) / 2;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  /* 屏幕坐标 → 逻辑坐标 */
  function toLogic(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
  }

  /* ======================================================================
   * 2. 星空背景
   * ==================================================================== */

  function Starfield() {
    var s = CFG.STARFIELD;
    this.time = 0;
    this.baseSpeed = s.BASE_SPEED;  // 初始（基础）速度
    this.stars = [];
    for (var i = 0; i < s.STAR_COUNT; i++) {
      var layer = randInt(0, s.LAYER_COUNT - 1);
      this.stars.push({
        x: rand(0, W), y: rand(0, H), layer: layer,
        r: rand(s.STAR_SIZE[0], s.STAR_SIZE[1]) * (0.7 + 0.35 * layer),
        baseAlpha: rand(s.STAR_ALPHA[0], s.STAR_ALPHA[1]),
        color: s.COLORS[randInt(0, s.COLORS.length - 1)],
        phase: rand(0, Math.PI * 2)
      });
    }
  }

  /* 当前滚动速度：初始值 → 随时间加速 → 上限为初始值的 MAX_SPEED_MULT 倍 */
  Starfield.prototype.speed = function () {
    var s = CFG.STARFIELD;
    return Math.min(this.baseSpeed + s.ACCEL_PER_SEC * this.time,
                    this.baseSpeed * s.MAX_SPEED_MULT);
  };

  Starfield.prototype.update = function (dt) {
    var s = CFG.STARFIELD;
    this.time += dt;
    var v = this.speed();
    for (var i = 0; i < this.stars.length; i++) {
      var st = this.stars[i];
      st.y += v * s.LAYER_FACTORS[st.layer] * dt;
      if (st.y > H + 4) {                 // 超出边界立即回收，从顶部重新进入
        st.y = -4;
        st.x = rand(0, W);
      }
    }
  };

  Starfield.prototype.draw = function () {
    var s = CFG.STARFIELD;
    for (var i = 0; i < this.stars.length; i++) {
      var st = this.stars[i];
      var tw = 0.7 + 0.3 * Math.sin(this.time * s.TWINKLE_SPEED + st.phase);
      ctx.globalAlpha = clamp(st.baseAlpha * tw, 0, 1);
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /* ======================================================================
   * 3-1. 局内成长系统：强化池 / 叠加规则 / 派生属性
   * ==================================================================== */

  function upgradeDef(key) {
    var list = CFG.RPG.UPGRADES;
    for (var i = 0; i < list.length; i++) { if (list[i].key === key) { return list[i]; } }
    return null;
  }

  /* 同类强化叠加时数值递减：第 n 层的效果系数 */
  function stackFactor(n) {           // n 从 1 开始
    var f = CFG.RPG.STACK_FALLOFF;
    return f[Math.min(n - 1, f.length - 1)];
  }

  /* 某个强化累计到 level 层后的总值（受各自上限约束） */
  function upgradeValue(def, level) {
    if (!def || level <= 0) { return 0; }
    var total = 0;
    for (var i = 1; i <= level; i++) { total += stackFactor(i); }
    switch (def.key) {
      case 'fireRate':  return Math.min(CFG.PLAYER.FIRE_RATE * def.RATE_PER_STACK * total,
                                        CFG.PLAYER.FIRE_RATE * def.RATE_CAP);
      case 'damage':    return Math.min(def.DAMAGE_PER_STACK * total, def.DAMAGE_CAP);
      case 'chain':     return Math.min(def.CHAIN_PER_STACK * level, def.CHAIN_CAP);
      case 'moveSpeed': return Math.min(def.SPEED_PER_STACK * total, def.SPEED_CAP);
      case 'maxHp':     return Math.min(def.HP_PER_STACK * level, def.HP_CAP);
      case 'shield':    return Math.min(def.SHIELD_PER_STACK * level, def.SHIELD_CAP);
    }
    return 0;
  }

  function upgradeDescription(def, level) { return def.desc(upgradeValue(def, level)); }

  /* 玩家当前全部派生属性 */
  function playerStats(p) {
    var P = CFG.PLAYER;
    var s = { rate: P.FIRE_RATE, damage: P.BULLET_DAMAGE, chain: 1, speed: P.SPEED,
              hpMax: P.HP_MAX, shieldMax: 0 };
    var list = CFG.RPG.UPGRADES;
    for (var i = 0; i < list.length; i++) {
      var def = list[i], lv = p.upgrades[def.key] || 0;
      if (lv <= 0) { continue; }
      var v = upgradeValue(def, lv);
      switch (def.key) {
        case 'fireRate':  s.rate += v; break;
        case 'damage':    s.damage += v; break;
        case 'chain':     s.chain += v; break;
        case 'moveSpeed': s.speed *= (1 + v); break;
        case 'maxHp':     s.hpMax += v; break;
        case 'shield':    s.shieldMax += v; break;
      }
    }
    s.rate = Math.min(s.rate, P.FIRE_RATE * P.FIRE_RATE_CAP_MULT);
    s.chain = Math.min(s.chain, 1 + upgradeDef('chain').CHAIN_CAP);
    s.hpMax = Math.min(s.hpMax, P.HP_MAX_CAP);
    s.shieldMax = Math.min(s.shieldMax, P.SHIELD_MAX);
    return s;
  }

  /* 随机 3 个强化选项（避免同一次出现重复项，且不包含已满层的强化） */
  function rollUpgradeChoices(p, n) {
    var pool = [];
    for (var i = 0; i < CFG.RPG.UPGRADES.length; i++) {
      var def = CFG.RPG.UPGRADES[i];
      if ((p.upgrades[def.key] || 0) < def.maxStack) { pool.push(def); }
    }
    var out = [];
    while (out.length < n && pool.length) {
      var idx = randInt(0, pool.length - 1);
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  }

  /* ======================================================================
   * 3-2. 三段式梯度难度
   * ==================================================================== */

  var Difficulty = {
    /* 当前所处阶段（按累计得分） */
    stageFor: function (score) {
      var st = CFG.DIFFICULTY_STAGES;
      for (var i = 0; i < st.length; i++) {
        if (score >= st[i].SCORE_MIN && score < st[i].SCORE_MAX) { return st[i]; }
      }
      return st[st.length - 1];
    },
    stageIndexFor: function (score) {
      var st = CFG.DIFFICULTY_STAGES;
      for (var i = 0; i < st.length; i++) {
        if (score >= st[i].SCORE_MIN && score < st[i].SCORE_MAX) { return i; }
      }
      return st.length - 1;
    },
    /* 当前阶段内的数值倍率：每 30 秒按阶段参数递增一档，并受阶段上限约束 */
    scales: function (stageTime, stage) {
      var d = CFG.DIFFICULTY;
      var steps = Math.floor(stageTime / d.STEP_TIME);
      var speed = Math.min(1 + stage.SPEED_GAIN * steps, stage.MAX_MULT);
      var interval = Math.max(Math.pow(1 - stage.INTERVAL_DECAY, steps), 1 / stage.MAX_MULT);
      return { speed: speed, interval: interval };
    },
    /* BOSS 阶段难度：按玩家 4~6 级平均水平插值 */
    bossTuning: function (level) {
      var t = CFG.BOSS_TUNING;
      var lv = clamp(level, t.MIN_LEVEL, t.MAX_LEVEL);
      var a = CFG.DIFFICULTY_STAGES[t.LEVEL_TO_STAGE[t.MIN_LEVEL]];
      var b = CFG.DIFFICULTY_STAGES[t.LEVEL_TO_STAGE[t.MAX_LEVEL]];
      var f = (lv - t.MIN_LEVEL) / (t.MAX_LEVEL - t.MIN_LEVEL);
      return {
        hp: Math.round(lerp(a.BOSS_HP, b.BOSS_HP, f)),
        burstInterval: CFG.BOSS.BURST_INTERVAL * lerp(a.BOSS_BURST_FACTOR, b.BOSS_BURST_FACTOR, f),
        spreadInterval: CFG.BOSS.SPREAD_INTERVAL * lerp(a.BOSS_SPREAD_FACTOR, b.BOSS_SPREAD_FACTOR, f),
        density: lerp(a.BULLET_DENSITY, b.BULLET_DENSITY, f),
        level: lv
      };
    }
  };

  /* ======================================================================
   * 3-3. 战斗对象
   * ==================================================================== */

  /* ------------------------------ 玩家战机 ------------------------------ */
  function Player() {
    var p = CFG.PLAYER;
    this.cfg = p;
    this.baseX = p.START_X;             // 屏幕底部水平中央
    this.baseY = p.START_Y;
    this.x = p.START_X;
    this.y = p.START_Y;
    this.tx = p.START_X;                // 平滑过渡的目标点
    this.ty = p.START_Y;
    this.hp = p.HP_MAX;                 // 初始生命值 3
    this.shield = 0;                    // 减伤护盾层数（强化获得）
    this.tempShield = 0;                // 临时护盾（满血拾取生命道具转化）
    this.invincible = 0;                // 无敌剩余时间
    this.shootTimer = 0;
    this.doubleTimer = 0;               // 火力强化剩余时间
    this.rateTimer = 0;                 // 射速强化剩余时间
    this.recoil = 0;                    // 射击后坐位移
    this.engine = 0;
    /* 成长系统 */
    this.level = 1;
    this.xp = 0;
    this.upgrades = {};
    for (var i = 0; i < CFG.RPG.UPGRADES.length; i++) { this.upgrades[CFG.RPG.UPGRADES[i].key] = 0; }
    this.applyMaxHp(true);
  }

  Player.prototype.stats = function () { return playerStats(this); };

  /* 生命上限 / 护盾上限强化后同步当前数值（升级时补足新增的部分） */
  Player.prototype.applyMaxHp = function (healDelta) {
    var s = this.stats();
    if (healDelta && s.hpMax > this.hp) { this.hp = s.hpMax; }
    this.hp = Math.min(this.hp, s.hpMax);
    if (healDelta && s.shieldMax > this.shield) { this.shield = s.shieldMax; }
    this.shield = Math.min(this.shield, s.shieldMax);
    this.tempShield = Math.min(this.tempShield, CFG.PLAYER.SHIELD_MAX);
  };

  Player.prototype.upgradeLevel = function (key) { return this.upgrades[key] || 0; };

  /* 获得强化：生命上限 / 护盾类立即补足新增的数值 */
  Player.prototype.grantUpgrade = function (def) {
    this.upgrades[def.key] = (this.upgrades[def.key] || 0) + 1;
    if (def.key === 'maxHp' || def.key === 'shield') { this.applyMaxHp(true); }
  };

  /* 经验 → 自动升级 */
  Player.prototype.gainXp = function (amount) {
    this.xp += amount;
    var up = 0;
    while (this.level < CFG.RPG.LEVEL_MAX && this.xp >= CFG.RPG.XP_PER_LEVEL[this.level - 1]) {
      this.xp -= CFG.RPG.XP_PER_LEVEL[this.level - 1];
      this.level += 1;
      up += 1;
    }
    if (this.level >= CFG.RPG.LEVEL_MAX) { this.xp = 0; }   // 满级后不再累计
    return up;
  };

  Player.prototype.xpNeeded = function () {
    if (this.level >= CFG.RPG.LEVEL_MAX) { return 0; }
    return CFG.RPG.XP_PER_LEVEL[this.level - 1];
  };

  Player.prototype.flashVisible = function () {
    if (this.invincible <= 0) { return 1; }
    /* 无敌状态：半透明 + 交替闪烁 */
    var blink = Math.floor(Game.time * 16) % 2 === 0;
    return blink ? 0.75 : 0.25;
  };

  Player.prototype.update = function (dt) {
    var p = CFG.PLAYER;
    var s = this.stats();
    if (this.invincible > 0) { this.invincible = Math.max(0, this.invincible - dt); }
    if (this.doubleTimer > 0) { this.doubleTimer = Math.max(0, this.doubleTimer - dt); }
    if (this.rateTimer > 0) { this.rateTimer = Math.max(0, this.rateTimer - dt); }
    this.engine += dt;
    this.recoil = lerp(this.recoil, 0, Math.min(1, p.RECOIL.DECAY * dt));   // 后坐回弹

    /* ---- 目标点：拖动优先，其次键盘方向键 / WASD ---- */
    var draggable = Game.pointer.active;
    if (draggable) {
      this.tx = Game.pointer.x;
      this.ty = Game.pointer.y;
    } else {
      var dx = (Input.right ? 1 : 0) - (Input.left ? 1 : 0);
      var dy = (Input.down ? 1 : 0) - (Input.up ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        var len = Math.hypot(dx, dy);
        var sp = s.speed * dt / len;
        /* 目标点按速度推进，实际位置再平滑趋近目标 → 响应跟手且无卡顿 */
        this.tx = clamp(this.tx + dx * sp, p.W / 2, W - p.W / 2);
        this.ty = clamp(this.ty + dy * sp, p.H / 2, H - p.H / 2);
        Game.moveIntent = true;
        Game.clearHint();
      }
    }

    var k = Math.min(1, (draggable ? p.FOLLOW_LERP : p.RESPONSE) * dt);
    var nx = lerp(this.x, this.tx, k);
    var ny = lerp(this.y, this.ty, k);
    /* 键盘松开后同样受速度限制，避免瞬间跳变 */
    if (!draggable) {
      var maxStep = s.speed * dt * 1.2;
      nx = this.x + clamp(nx - this.x, -maxStep, maxStep);
      ny = this.y + clamp(ny - this.y, -maxStep, maxStep);
    }
    this.x = clamp(nx, p.W / 2, W - p.W / 2);
    this.y = clamp(ny, p.H / 2, H - p.H / 2);

    /* ---- 自动持续向上发射子弹 ---- */
    var rate = s.rate * (this.rateTimer > 0 ? p.RATE_BUFF_MULT : 1);
    rate = Math.min(rate, p.FIRE_RATE * p.FIRE_RATE_CAP_MULT);
    var interval = 1 / rate;
    if (this.shootTimer > 1) { this.shootTimer = 0; }   // 防止计时器无限累积
    this.shootTimer += dt;
    while (this.shootTimer >= interval) {
      this.shootTimer -= interval;
      this.shoot();
    }
    if (this.shootTimer > interval) { this.shootTimer = interval; }
  };

  Player.prototype.shoot = function () {
    var p = CFG.PLAYER;
    var s = this.stats();
    var lanes = Math.round(s.chain);
    var gap = p.LANE_GAP * (this.doubleTimer > 0 ? 1.3 : 1);   // 火力强化时弹距扩大 30%
    var y = this.y - p.H / 2 - 4 - this.recoil;
    var start = -(lanes - 1) / 2;
    for (var i = 0; i < lanes; i++) {
      Game.playerBullets.push(new PlayerBullet(this.x + (start + i) * gap, y, s.damage));
    }
    this.recoil = p.RECOIL.MAX;          // 极轻微上向后坐
    window.SFX.shoot();
  };

  Player.prototype.pickup = function (type) {
    var p = CFG.PLAYER;
    var res = { picked: false, glow: false };
    switch (type) {
      case 'fire':
        this.doubleTimer = p.POWERUP_TIME;              // 火力强化 12 秒
        res.picked = true;
        break;
      case 'rate':
        this.rateTimer = p.RATE_BUFF_TIME;              // 射速 +50%，持续 8 秒
        res.picked = true;
        break;
      case 'heal':
        if (this.hp < this.stats().hpMax) {
          this.hp += 1;
          res.picked = true;
        } else {
          this.tempShield += 1;                         // 满生命时转化为 1 层临时护盾
          res.picked = true; res.glow = true;
        }
        break;
      case 'shield':
        this.shield = Math.min(this.shield + 1, p.SHIELD_MAX);
        res.picked = true;
        break;
      case 'bomb':
        Game.detonateBomb();
        res.picked = true; res.glow = true;
        break;
    }
    window.SFX.pickup();
    return res;
  };

  Player.prototype.hurt = function () {
    var p = CFG.PLAYER;
    if (this.invincible > 0) { return false; }          // 无敌期间免疫所有伤害
    /* 减伤护盾 / 临时护盾：抵挡 1 次伤害 */
    if (this.shield > 0) {
      this.shield -= 1;
      this.invincible = p.INVINCIBLE_TIME;
      Game.spawnShieldBreak(this.x, this.y);
      window.SFX.hurt();
      return true;
    }
    if (this.tempShield > 0) {
      this.tempShield -= 1;
      this.invincible = p.INVINCIBLE_TIME;
      Game.spawnShieldBreak(this.x, this.y);
      window.SFX.hurt();
      return true;
    }
    this.hp -= 1;
    this.invincible = p.INVINCIBLE_TIME;                // 触发 0.5 秒无敌
    window.SFX.hurt();
    Game.spawnExplosion(this.x, this.y, CFG.EFFECTS.HIT_FLASH.DURATION,
                        36, CFG.EFFECTS.HIT_FLASH.COLOR, 7);
    if (this.hp <= 0) {
      this.hp = 0;
      Game.spawnExplosion(this.x, this.y, 0.7, 60, '255,120,160', 16);
      Game.finish(false);                               // 生命值归零 → 结算界面失败分支
    }
    return true;
  };

  Player.prototype.draw = function () {
    var p = CFG.PLAYER;
    var boosted = this.doubleTimer > 0 || this.stats().chain > 1;   // 火力 / 多弹状态
    ctx.save();
    ctx.translate(this.x, this.y + this.recoil * 0.5);
    ctx.globalAlpha = this.flashVisible();

    /* 引擎尾焰：基础蓝色，火力 / 多弹状态变黄并加长 */
    var flameLen = p.H * (boosted ? 0.62 : 0.42) + Math.sin(this.engine * 26) * 5;
    var fg = ctx.createLinearGradient(0, p.H * 0.26, 0, p.H * 0.26 + flameLen);
    if (boosted) {
      fg.addColorStop(0, 'rgba(255,238,150,0.98)');
      fg.addColorStop(0.5, 'rgba(255,170,60,0.7)');
      fg.addColorStop(1, 'rgba(255,90,20,0)');
    } else {
      fg.addColorStop(0, 'rgba(150,232,255,0.95)');
      fg.addColorStop(1, 'rgba(40,120,255,0)');
    }
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-9, p.H * 0.26);
    ctx.lineTo(9, p.H * 0.26);
    ctx.lineTo(0, p.H * 0.28 + flameLen);
    ctx.closePath();
    ctx.fill();

    /* 两翼副炮光效（火力 / 多弹状态） */
    if (boosted) {
      var glow = 0.55 + 0.45 * Math.sin(this.engine * 18);
      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * glow;
      ctx.fillStyle = 'rgba(255,214,120,0.9)';
      ctx.shadowColor = 'rgba(255,190,80,0.95)';
      ctx.shadowBlur = 12;
      [-1, 1].forEach(function (sgn) {
        ctx.beginPath();
        ctx.moveTo(sgn * p.W * 0.30, p.H * 0.02);
        ctx.lineTo(sgn * p.W * 0.52, p.H * 0.20);
        ctx.lineTo(sgn * p.W * 0.30, p.H * 0.30);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
    }

    /* 机身 */
    var g = ctx.createLinearGradient(0, -p.H / 2, 0, p.H / 2);
    g.addColorStop(0, '#eaf7ff');
    g.addColorStop(0.45, '#7fd4ff');
    g.addColorStop(1, '#1b6fc4');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -p.H / 2);
    ctx.lineTo(p.W * 0.20, -p.H * 0.10);
    ctx.lineTo(p.W * 0.50, p.H * 0.14);
    ctx.lineTo(p.W * 0.28, p.H * 0.36);
    ctx.lineTo(-p.W * 0.28, p.H * 0.36);
    ctx.lineTo(-p.W * 0.50, p.H * 0.14);
    ctx.lineTo(-p.W * 0.20, -p.H * 0.10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,250,255,0.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    /* 座舱 */
    ctx.fillStyle = 'rgba(20,60,120,0.9)';
    ctx.beginPath();
    ctx.ellipse(0, -p.H * 0.10, p.W * 0.13, p.H * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(180,245,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(0, -p.H * 0.14, p.W * 0.07, p.H * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  /* ------------------------------ 玩家子弹 ------------------------------ */
  function PlayerBullet(x, y, damage) {
    var p = CFG.PLAYER;
    this.cfg = { W: p.BULLET_W, H: p.BULLET_H, HIT_W: p.BULLET_W, HIT_H: p.BULLET_H };
    this.x = x;
    this.y = y;
    this.damage = damage === undefined ? p.BULLET_DAMAGE : damage;
    this.vy = -p.BULLET_SPEED;
    this.dead = false;
  }
  PlayerBullet.prototype.update = function (dt) {
    this.y += this.vy * dt;
    if (this.y < -this.cfg.H) { this.dead = true; }   // 飞出屏幕顶部自动销毁
  };
  PlayerBullet.prototype.draw = function () {
    var c = this.cfg;
    var x = this.x - c.W / 2, y = this.y - c.H / 2;
    /* 淡蓝色外光晕 */
    ctx.save();
    ctx.shadowColor = 'rgba(130,215,255,0.95)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(190,235,255,0.55)';
    ctx.fillRect(x - c.W * 0.35, y - 2, c.W * 1.7, c.H + 4);
    ctx.restore();
    /* 弹体 */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, c.W, c.H);
    ctx.fillStyle = 'rgba(205,240,255,0.92)';
    ctx.fillRect(this.x - c.W * 0.2, y, c.W * 0.4, c.H * 0.55);
  };

  /* ------------------------------- 敌机 ------------------------------- */
  function Enemy(type) {
    var c = CFG.ENEMIES[type];
    var em = CFG.ENEMY_COMMON;
    this.cfg = c;
    this.type = type;
    /* 敌机血量按当前难度阶段缩放（中期中型 4 点、后期中型 5 点等），视觉与玩法不变 */
    var hpMult = (Game.stage().HP_MULT && Game.stage().HP_MULT[type]) || 1;
    this.maxHp = Math.max(1, Math.round(c.HP * hpMult));
    this.hp = this.maxHp;
    /* 摆动型敌机需要为自己的横向摆幅预留空间，避免贴边生成导致摆幅被边界裁剪 */
    var swayAmp = c.SWAY_WIDTH_MULT ? c.W * c.SWAY_WIDTH_MULT : 0;
    var margin = W * em.SPAWN_X_MARGIN;
    var minX = margin + c.W / 2 + swayAmp;
    var maxX = W - margin - c.W / 2 - swayAmp;
    if (maxX < minX) { minX = maxX = W / 2; }
    this.x = rand(minX, maxX);
    this.y = -c.H / 2;
    this.baseX = this.x;
    this.age = 0;
    this.fireTimer = c.FIRE_INTERVAL > 0 ? c.FIRE_INTERVAL * rand(0.45, 1.0) : 0;
    this.vy = c.SPEED;
    this.dead = false;
    this.hitFlash = 0;
    /* 摆动参数：生成时一次性确定，难度提升不影响摆幅与周期 */
    this.swayRange = Math.min(swayAmp,
                              Math.max(0, this.baseX - c.W / 2),
                              Math.max(0, W - c.W / 2 - this.baseX));
    this.swayPhase = rand(0, Math.PI * 2);
  }

  Enemy.prototype.update = function (dt) {
    var c = this.cfg;
    var sc = Game.stageScales().speed;
    this.age += dt;
    this.vy = c.SPEED * sc;
    if (this.hitFlash > 0) { this.hitFlash = Math.max(0, this.hitFlash - dt); }

    if (c.MOTION === 'sine') {
      /* 中型敌机：平滑正弦曲线左右摆动，周期 2 秒 / 次 */
      var omega = 2 * Math.PI / c.SWAY_PERIOD;
      this.x = clamp(this.baseX + Math.sin(omega * this.age + this.swayPhase) * this.swayRange,
                     c.W / 2, W - c.W / 2);
    }

    this.y += this.vy * dt;

    /* 敌方子弹（弹幕密度由梯度难度统一缩放；后期中型射击间隔缩短） */
    if (c.FIRE_INTERVAL > 0 && this.y > 0 && this.y < H - 40) {
      var stage = Game.stage();
      var density = stage.BULLET_DENSITY;
      var interval = (stage.MEDIUM_FIRE_INTERVAL && c.key === 'medium')
        ? stage.MEDIUM_FIRE_INTERVAL : c.FIRE_INTERVAL;
      this.fireTimer -= dt * density;
      if (this.fireTimer <= 1e-9) {
        this.fireTimer += interval;
        this.fire();
      }
    }

    if (this.y - c.H / 2 > H + CFG.ENEMY_COMMON.DESPAWN_MARGIN) {
      this.dead = true;                               // 飞出屏幕底部自动销毁
    }
  };

  Enemy.prototype.fire = function () {
    var c = this.cfg;
    var stage = Game.stage();
    var y = this.y + c.H / 2;
    var front = stage.BULLET_DENSITY >= 1.3 ? 1.15 : 1;   // 后期弹幕更快
    if (c.BULLET_MODE === 'double') {
      /* 后期精英双排子弹横向间距扩大 20% */
      var offset = c.DOUBLE_OFFSET * (stage.ELITE_BULLET_GAP_MULT || 1);
      Game.enemyBullets.push(new EnemyBullet(this.x - offset, y, 0, c.BULLET_SPEED * front));
      Game.enemyBullets.push(new EnemyBullet(this.x + offset, y, 0, c.BULLET_SPEED * front));
    } else {
      Game.enemyBullets.push(new EnemyBullet(this.x, y, 0, c.BULLET_SPEED * front));
    }
  };

  /* 命中 / 击毁时的白色高亮 */
  Enemy.prototype.drawHitFlash = function () {
    if (this.hitFlash <= 0) { return; }
    var c = this.cfg;
    ctx.save();
    ctx.globalAlpha = clamp(this.hitFlash / CFG.EFFECTS.HIT_BLINK.DURATION, 0, 1) * 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, c.W * 0.52, c.H * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  Enemy.prototype.draw = function () {
    var c = this.cfg;
    var t = clamp(this.hp / this.maxHp, 0, 1);
    ctx.save();
    ctx.translate(this.x, this.y);

    var g = ctx.createLinearGradient(0, -c.H / 2, 0, c.H / 2);
    g.addColorStop(0, c.COLOR);
    g.addColorStop(1, c.COLOR_DARK);
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;

    /* 机头朝上（面向自下而上的玩家），与向下俯冲的方向一致 */
    ctx.beginPath();
    if (this.type === 'small') {
      ctx.moveTo(0, -c.H / 2);
      ctx.lineTo(c.W * 0.34, -c.H * 0.04);
      ctx.lineTo(c.W / 2, c.H * 0.46);
      ctx.lineTo(c.W * 0.16, c.H * 0.16);
      ctx.lineTo(0, c.H * 0.30);
      ctx.lineTo(-c.W * 0.16, c.H * 0.16);
      ctx.lineTo(-c.W / 2, c.H * 0.46);
      ctx.lineTo(-c.W * 0.34, -c.H * 0.04);
    } else if (this.type === 'medium') {
      ctx.moveTo(0, -c.H / 2);
      ctx.lineTo(c.W * 0.26, -c.H * 0.22);
      ctx.lineTo(c.W / 2, c.H * 0.02);
      ctx.lineTo(c.W * 0.40, c.H * 0.44);
      ctx.lineTo(c.W * 0.16, c.H * 0.22);
      ctx.lineTo(0, c.H * 0.34);
      ctx.lineTo(-c.W * 0.16, c.H * 0.22);
      ctx.lineTo(-c.W * 0.40, c.H * 0.44);
      ctx.lineTo(-c.W / 2, c.H * 0.02);
      ctx.lineTo(-c.W * 0.26, -c.H * 0.22);
    } else {
      ctx.moveTo(0, -c.H / 2);
      ctx.lineTo(c.W * 0.17, -c.H * 0.26);
      ctx.lineTo(c.W * 0.38, -c.H * 0.16);
      ctx.lineTo(c.W / 2, c.H * 0.10);
      ctx.lineTo(c.W * 0.32, c.H * 0.46);
      ctx.lineTo(c.W * 0.14, c.H * 0.26);
      ctx.lineTo(0, c.H * 0.36);
      ctx.lineTo(-c.W * 0.14, c.H * 0.26);
      ctx.lineTo(-c.W * 0.32, c.H * 0.46);
      ctx.lineTo(-c.W / 2, c.H * 0.10);
      ctx.lineTo(-c.W * 0.38, -c.H * 0.16);
      ctx.lineTo(-c.W * 0.17, -c.H * 0.26);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    /* 座舱 */
    ctx.fillStyle = 'rgba(10,20,40,0.72)';
    ctx.beginPath();
    ctx.ellipse(0, this.type === 'small' ? -c.H * 0.02 : -c.H * 0.06,
                c.W * 0.12, c.H * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 多血量敌机的血条 */
    if (this.maxHp > 1) {
      var bw = c.W * 0.86, bh = 4;
      var by = -c.H / 2 - 9;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(-bw / 2, by, bw, bh);
      ctx.fillStyle = t > 0.6 ? '#7dff9b' : (t > 0.3 ? '#ffd166' : '#ff6b81');
      ctx.fillRect(-bw / 2, by, bw * t, bh);
    }

    ctx.restore();
  };

  /* ------------------------------ 敌方子弹 ------------------------------ */
  function EnemyBullet(x, y, vx, vy) {
    this.cfg = CFG.ENEMY_BULLET;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.dead = false;
  }
  EnemyBullet.prototype.update = function (dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    var m = 60, c = this.cfg;
    if (this.y - c.H > H + m || this.y + c.H < -m || this.x < -m || this.x > W + m) {
      this.dead = true;                              // 超出边界及时销毁回收
    }
  };
  EnemyBullet.prototype.draw = function () {
    var c = this.cfg;
    var w = c.W, h = c.H;
    var rgb = c.R + ',' + c.G + ',' + c.B;

    /* 尾部渐隐拖尾（长度 = 本体长度 × 1，不参与碰撞） */
    var trailLen = h * c.TRAIL_LEN_MULT;
    var ty0 = this.y - h / 2, ty1 = ty0 + trailLen;
    var tg = ctx.createLinearGradient(0, ty0, 0, ty1);
    tg.addColorStop(0, 'rgba(' + rgb + ',0.55)');
    tg.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.moveTo(this.x - w * 0.30, ty0);
    ctx.lineTo(this.x + w * 0.30, ty0);
    ctx.lineTo(this.x + w * 0.10, ty1);
    ctx.lineTo(this.x - w * 0.10, ty1);
    ctx.closePath();
    ctx.fill();

    /* 同色半透明外光晕（宽度 = 本体宽度 × 2，透明度 50%） */
    ctx.save();
    ctx.globalAlpha = c.HALO_ALPHA;
    var hg = ctx.createLinearGradient(this.x - w, 0, this.x + w, 0);
    hg.addColorStop(0, 'rgba(' + rgb + ',0)');
    hg.addColorStop(0.5, 'rgba(' + rgb + ',0.85)');
    hg.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = hg;
    ctx.fillRect(this.x - w * (c.HALO_WIDTH_MULT / 2), this.y - h / 2, w * c.HALO_WIDTH_MULT, h);
    ctx.restore();

    /* 弹体 */
    ctx.fillStyle = c.COLOR;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y + h / 2);
    ctx.lineTo(this.x + w / 2, this.y - h * 0.18);
    ctx.lineTo(this.x, this.y - h / 2);
    ctx.lineTo(this.x - w / 2, this.y - h * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,225,225,0.9)';
    ctx.fillRect(this.x - c.W * 0.12, this.y - h * 0.3, c.W * 0.24, h * 0.5);
  };

  /* ------------------------------- 道具 ------------------------------- */
  function Powerup(x, y, type) {
    var c = CFG.POWERUPS;
    this.cfg = c;
    this.x = x;
    this.y = y;
    this.type = type;
    this.def = c.TYPES[type];
    this.age = 0;
    this.dead = false;
  }
  Powerup.prototype.update = function (dt) {
    this.age += dt;
    this.y += CFG.POWERUPS.DROP_SPEED * dt;          // 匀速向下下落
    if (this.y - this.cfg.H > H) { this.dead = true; }
  };
  Powerup.prototype.draw = function () {
    var c = this.cfg;
    var pulse = 0.75 + 0.25 * Math.sin(this.age * 7);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowColor = this.def.COLOR;
    ctx.shadowBlur = 16 * pulse;
    ctx.fillStyle = 'rgba(8,14,28,0.88)';
    ctx.beginPath();
    ctx.arc(0, 0, c.W / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.def.COLOR;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = this.def.COLOR;
    if (this.type === 'bomb') {
      /* 炸弹：实心圆 + 引线 */
      ctx.beginPath();
      ctx.arc(0, 1, c.W * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.def.COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(2, -c.W * 0.18);
      ctx.lineTo(6, -c.W * 0.34);
      ctx.stroke();
    } else if (this.type === 'shield') {
      /* 护盾：六边形轮廓 */
      ctx.lineWidth = 2;
      ctx.strokeStyle = this.def.COLOR;
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 6 + i * Math.PI / 3;
        var px = Math.cos(a) * c.W * 0.24, py = Math.sin(a) * c.W * 0.24;
        if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.font = 'bold 18px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.def.GLYPH, 0, 1);
    }
    ctx.restore();
  };

  /* ------------------------------- 特效 ------------------------------- */
  function Effect(x, y, duration, radius, color, particles) {
    this.x = x; this.y = y;
    this.duration = duration;
    this.age = 0;
    this.radius = radius;
    this.color = color;
    this.dead = false;
    this.particles = [];
    var count = particles === undefined ? CFG.EFFECTS.PARTICLE_COUNT : particles;
    for (var i = 0; i < count; i++) {
      var a = rand(0, Math.PI * 2);
      var sp = rand(CFG.EFFECTS.PARTICLE_SPEED[0], CFG.EFFECTS.PARTICLE_SPEED[1]);
      this.particles.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(1.2, 3.4) });
    }
  }
  Effect.prototype.update = function (dt) {
    this.age += dt;
    if (this.age >= this.duration) { this.dead = true; return; }
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
    }
  };
  Effect.prototype.draw = function () {
    var t = clamp(this.age / this.duration, 0, 1);
    ctx.save();
    var r = this.radius * (0.45 + 0.55 * t);
    var g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
    g.addColorStop(0, 'rgba(' + this.color + ',' + (0.95 * (1 - t)) + ')');
    g.addColorStop(1, 'rgba(' + this.color + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9 * (1 - t);
    ctx.fillStyle = 'rgba(' + this.color + ',0.95)';
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      ctx.beginPath();
      ctx.arc(this.x + p.x, this.y + p.y, p.r * (1 - t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  /* ---------------------------- 最终 BOSS ---------------------------- */
  function Boss(tuning) {
    var b = CFG.BOSS;
    this.cfg = b;
    this.w = b.W;
    this.h = b.H;
    this.tuning = tuning || Difficulty.bossTuning(CFG.BOSS_TUNING.MIN_LEVEL);
    this.maxHp = this.tuning.hp;
    this.hp = this.maxHp;
    this.x = W / 2;
    this.y = H * b.Y_RATIO;           // 屏幕上方 1/4 位置
    this.age = 0;
    this.dir = 1;
    this.burstTimer = this.tuning.burstInterval * 0.8;
    this.spreadTimer = this.tuning.spreadInterval * 0.5;
    this.summonTimers = {};                 // 三类敌机各自独立的召唤计时
    var summons = b.SUMMONS || [];
    for (var si = 0; si < summons.length; si++) {
      this.summonTimers['summon_' + summons[si].type] = summons[si].interval * (0.5 + si * 0.5);
    }
    this.enraged = false;                   // 追加技能：半血狂暴（仅首次触发）
    this.healUsed = false;                  // 追加技能：单次回血是否已用掉
    this.healPending = false;
    this.healDelay = 0;
    this.healFlash = 0;                     // 绿色光晕剩余时间
    this.hitFlash = 0;
    this.dead = false;
  }
  /* 血量低于阈值后，所有弹幕发射间隔乘以 ENRAGE_FIRE_MULT（频率 +35%）
   * 返回发射间隔系数：1 = 正常，0.74 = 狂暴
   * 狂暴仅首次触发一次：触发后即使因「单次回血」回到高血量也保持狂暴状态 */
  Boss.prototype.refreshEnrage = function () {
    var b = CFG.BOSS;
    if (!this.enraged && this.hp > 0 && this.hp < this.maxHp * b.ENRAGE_HP_RATIO) {
      this.enraged = true;
    }
    return this.enraged ? b.ENRAGE_FIRE_MULT : 1;
  };
  Boss.prototype.update = function (dt) {
    var b = CFG.BOSS;
    this.age += dt;
    if (this.hitFlash > 0) { this.hitFlash = Math.max(0, this.hitFlash - dt); }

    /* 仅沿水平方向左右往复移动 */
    this.x += b.SPEED * this.dir * dt;
    var minX = b.SWAY_MARGIN + this.w / 2;
    var maxX = W - b.SWAY_MARGIN - this.w / 2;
    if (this.x <= minX) { this.x = minX; this.dir = 1; }
    if (this.x >= maxX) { this.x = maxX; this.dir = -1; }

    /* 弹幕节奏由「匹配玩家 4~6 级」的难度参数决定，半血狂暴后整体提速 */
    var enrage = this.refreshEnrage();
    this.burstTimer -= dt;
    if (this.burstTimer <= 1e-9) {
      this.burstTimer += this.burstInterval();
      this.fireBurst();
    }
    this.spreadTimer -= dt;
    if (this.spreadTimer <= 1e-9) {
      this.spreadTimer += this.spreadInterval();
      this.fireSpread();
    }
    /* 追加技能：三类敌机各自独立冷却，从屏幕顶部随机位置召唤 */
    var summons = b.SUMMONS;
    for (var si = 0; si < summons.length; si++) {
      var cfg = summons[si];
      var key = 'summon_' + cfg.type;
      this.summonTimers[key] -= dt;
      if (this.summonTimers[key] <= 1e-9) {
        this.summonTimers[key] += cfg.interval;
        this.summon(cfg.type, cfg.count);
      }
    }
    /* 追加技能：单次回血（血量首次降到 25% → 立即回复 30 点，全程仅 1 次） */
    if (this.healPending) {
      if (this.healDelay > 0) { this.healDelay -= dt; }
      if (this.healDelay <= 0) {
        this.healPending = false;
        this.healUsed = true;
        this.hp = Math.min(this.maxHp, this.hp + b.HEAL_AMOUNT);
        this.healFlash = b.HEAL_FLASH_TIME;      // 0.6 秒绿色光晕闪烁
        Game.spawnExplosion(this.x, this.y, b.HEAL_FLASH_TIME, 120, '110,255,160', 18);
      }
    }
    if (this.healFlash > 0) { this.healFlash = Math.max(0, this.healFlash - dt); }
  };
  /* 当前平行弹 / 散射弹的实际间隔（含难度系数与狂暴系数） */
  Boss.prototype.burstInterval = function () {
    return this.tuning.burstInterval * (this.enraged ? CFG.BOSS.ENRAGE_FIRE_MULT : 1);
  };
  Boss.prototype.spreadInterval = function () {
    return this.tuning.spreadInterval * (this.enraged ? CFG.BOSS.ENRAGE_FIRE_MULT : 1);
  };
  /* 召唤：沿用当前阶段敌机属性，从顶部随机横坐标下落 */
  Boss.prototype.summon = function (type, count) {
    var em = CFG.ENEMY_COMMON;
    var c = CFG.ENEMIES[type];
    for (var i = 0; i < count; i++) {
      var e = Game.spawnEnemy(type);
      e.summoned = true;
      var lo = W * em.SPAWN_X_MARGIN + c.W / 2;
      var hi = W * (1 - em.SPAWN_X_MARGIN) - c.W / 2;
      var x = lo < hi ? rand(lo, hi) : W / 2;
      e.x = x;
      e.baseX = x;
      e.y = -c.H / 2 - i * (c.H + 10);
      Game.spawnExplosion(e.x, 30, 0.3, 38, '196,132,252', 5);
    }
  };
  /* 受击后判定是否触发单次回血（血量首次降至 25% 时） */
  Boss.prototype.checkHeal = function () {
    var b = CFG.BOSS;
    if (this.healUsed || this.healPending || this.hp <= 0) { return; }
    if (this.hp <= this.maxHp * b.HEAL_TRIGGER_RATIO) {
      this.healPending = true;
      this.healDelay = 0;      // 立即回复（延迟字段便于调试/调整表现）
    }
  };
  Boss.prototype.fireBurst = function () {
    var b = CFG.BOSS;
    var y = this.y + this.h / 2 - 6;
    var half = (b.BURST_COUNT - 1) / 2;
    for (var i = 0; i < b.BURST_COUNT; i++) {
      Game.enemyBullets.push(new EnemyBullet(this.x + (i - half) * b.BURST_OFFSET, y, 0, b.BURST_SPEED));
    }
  };
  Boss.prototype.fireSpread = function () {
    var b = CFG.BOSS;
    var y = this.y + this.h / 2 - 6;
    var half = (b.SPREAD_COUNT - 1) / 2;
    for (var i = 0; i < b.SPREAD_COUNT; i++) {
      var ang = (i - half) * b.SPREAD_STEP * Math.PI / 180;   // 以正下方为中心扇形展开
      Game.enemyBullets.push(new EnemyBullet(this.x, y,
        Math.sin(ang) * b.SPREAD_SPEED, Math.cos(ang) * b.SPREAD_SPEED));
    }
  };
  Boss.prototype.draw = function () {
    var b = CFG.BOSS;
    var t = clamp(this.hp / this.maxHp, 0, 1);
    ctx.save();
    ctx.translate(this.x, this.y);

    var halo = ctx.createRadialGradient(0, 0, 10, 0, 0, this.w * 0.62);
    halo.addColorStop(0, 'rgba(196,132,252,0.35)');
    halo.addColorStop(1, 'rgba(196,132,252,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, this.w * 0.62, 0, Math.PI * 2);
    ctx.fill();

    var g = ctx.createLinearGradient(0, -this.h / 2, 0, this.h / 2);
    g.addColorStop(0, b.COLOR);
    g.addColorStop(1, b.COLOR_DARK);
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(240,220,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.h / 2);
    ctx.lineTo(this.w * 0.16, this.h * 0.26);
    ctx.lineTo(this.w * 0.42, this.h * 0.20);
    ctx.lineTo(this.w / 2, -this.h * 0.06);
    ctx.lineTo(this.w * 0.30, -this.h / 2);
    ctx.lineTo(-this.w * 0.30, -this.h / 2);
    ctx.lineTo(-this.w / 2, -this.h * 0.06);
    ctx.lineTo(-this.w * 0.42, this.h * 0.20);
    ctx.lineTo(-this.w * 0.16, this.h * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    var pulse = 0.6 + 0.4 * Math.sin(this.age * 6);
    ctx.fillStyle = 'rgba(255,235,255,' + (0.75 * pulse + 0.2) + ')';
    ctx.beginPath();
    ctx.ellipse(0, 0, this.w * 0.10, this.h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(30,10,50,0.9)';
    [-1, 1].forEach(function (s) {
      ctx.beginPath();
      ctx.arc(s * this.w * 0.34, this.h * 0.16, 6, 0, Math.PI * 2);
      ctx.fill();
    }, this);

    if (this.hitFlash > 0) {
      ctx.globalAlpha = clamp(this.hitFlash / CFG.EFFECTS.HIT_BLINK.DURATION, 0, 1) * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.w / 2, this.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    /* 回血：0.6 秒绿色光晕闪烁 */
    if (this.healFlash > 0) {
      var hf = clamp(this.healFlash / CFG.BOSS.HEAL_FLASH_TIME, 0, 1);
      var pulse = 0.55 + 0.45 * Math.sin(this.healFlash * 32);
      var gg = ctx.createRadialGradient(0, 0, 8, 0, 0, this.w * 0.72);
      gg.addColorStop(0, 'rgba(140,255,180,' + (0.75 * hf * pulse) + ')');
      gg.addColorStop(0.55, 'rgba(70,230,140,' + (0.45 * hf) + ')');
      gg.addColorStop(1, 'rgba(70,230,140,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(0, 0, this.w * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = hf;
      ctx.fillStyle = 'rgba(150,255,190,0.85)';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.w / 2, this.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    /* 顶部 BOSS 血条（位于状态栏下方，避免与分数/生命值重叠） */
    var bw = b.HP_BAR_W, bh = b.HP_BAR_H;
    var bx = (W - bw) / 2, by = b.HP_BAR_Y;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = 'rgba(60,20,80,0.9)';
    ctx.fillRect(bx, by, bw, bh);
    var hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    hg.addColorStop(0, '#ff5f8d');
    hg.addColorStop(1, '#c084fc');
    ctx.fillStyle = hg;
    ctx.fillRect(bx, by, bw * t, bh);
    ctx.strokeStyle = 'rgba(255,220,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#f4e8ff';
    ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    var label = '最终 BOSS  ' + Math.max(0, Math.ceil(this.hp)) + ' / ' + this.maxHp +
                '　（难度 Lv.' + this.tuning.level + '）';
    ctx.fillText(label, W / 2, by - 8);
    /* 半血狂暴 / 回血状态提示 */
    var status = [];
    if (this.enraged) { status.push('狂暴：弹幕频率 +35%'); }
    if (this.healUsed) { status.push('回血已使用'); }
    if (status.length) {
      ctx.fillStyle = this.enraged ? '#ff6b81' : '#8ce8b0';
      ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
      ctx.fillText(status.join('　'), W / 2, by + bh + 14);
    }
    ctx.textAlign = 'left';
  };

  /* ======================================================================
   * 4. 输入
   * ==================================================================== */

  var Input = {
    left: false, right: false, up: false, down: false,
    isMoveKey: function (code) {
      return code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' ||
             code === 'KeyA' || code === 'KeyD' || code === 'KeyW' || code === 'KeyS';
    }
  };

  function keyToDir(code) {
    switch (code) {
      case 'ArrowLeft': case 'KeyA': return 'left';
      case 'ArrowRight': case 'KeyD': return 'right';
      case 'ArrowUp': case 'KeyW': return 'up';
      case 'ArrowDown': case 'KeyS': return 'down';
    }
    return null;
  }

  window.addEventListener('keydown', function (e) {
    if (e.repeat) {
      if (Input.isMoveKey(e.code)) { e.preventDefault(); }
      return;
    }
    window.SFX.boot();                       // 首次用户手势后启动音频
    var dir = keyToDir(e.code);
    if (dir) {
      if (Game.state === CFG.STATE.PLAYING) {
        Input[dir] = true;
        Game.moveIntent = true;              // 首次执行移动操作 → 提示立即消失
        Game.clearHint();
      }
      e.preventDefault();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();                    // 通用确认键（并阻止页面滚动）
      Game.onConfirm();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      Game.onPauseToggle();
    } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      /* 升级选择也可以用数字键 1/2/3 */
      if (Game.state === CFG.STATE.LEVELUP) {
        e.preventDefault();
        Game.chooseUpgrade(parseInt(e.code.slice(5), 10) - 1);
      }
    }
  });

  window.addEventListener('keyup', function (e) {
    var dir = keyToDir(e.code);
    if (dir) { Input[dir] = false; }
  });

  window.addEventListener('blur', function () {
    Input.left = Input.right = Input.up = Input.down = false;
    Game.pointer.active = false;
  });

  /* -------------------- 鼠标点击 / 触屏点击 UI 按钮 -------------------- */
  function bindButton(el, handler) {
    if (!el) { return; }
    el.addEventListener('click', function (e) {
      e.preventDefault();
      window.SFX.boot();
      handler();
    });
  }

  /* ------------------------ 触屏拖动 / 鼠标拖动 ------------------------ */
  function onPointerDown(e) {
    window.SFX.boot();
    if (Game.state === CFG.STATE.PLAYING) {
      var p = toLogic(e.clientX, e.clientY);
      var b = CFG.UI.PAUSE_BTN;
      /* 命中方形暂停按钮 → 跳转暂停状态 */
      if (p.x >= b.X && p.x <= b.X + b.SIZE && p.y >= b.Y && p.y <= b.Y + b.SIZE) {
        Game.onPauseToggle();
        return;
      }
      Game.pointer.active = true;            // 触屏 / 鼠标拖动战机跟随
      Game.pointer.x = p.x;
      Game.pointer.y = p.y;
      Game.moveIntent = true;
      Game.clearHint();
      if (canvas.setPointerCapture && e.pointerId !== undefined) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    }
  }

  function onPointerMove(e) {
    if (!Game.pointer.active) { return; }
    var p = toLogic(e.clientX, e.clientY);
    Game.pointer.x = p.x;
    Game.pointer.y = p.y;
  }

  function onPointerUp() { Game.pointer.active = false; }

  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
  } else {
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0];
      onPointerDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () {} });
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      var t = e.changedTouches[0];
      onPointerMove({ clientX: t.clientX, clientY: t.clientY });
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', function (e) { onPointerUp(); e.preventDefault(); }, { passive: false });
  }

  /* ======================================================================
   * 5. 游戏主体 + 状态机
   * ==================================================================== */

  var Game = {
    state: CFG.STATE.MENU,
    prevState: CFG.STATE.MENU,
    time: 0,                 // 累计游戏时长
    score: 0,
    hintSeen: false,         // 首次操作提示是否已经展示过
    showHint: false,
    hintTimer: 0,
    hintAlpha: 0,
    hintText: '',
    moveIntent: false,
    pointer: { active: false, x: 0, y: 0 },
    bossTriggered: false,
    eliteSpawned: 0,
    stageTime: 0,            // 当前难度阶段内的计时
    stageIndex: 0,
    pendingLevelUps: 0,
    upgradeChoices: [],
    destroyed: 0,
    player: null,
    starfield: null,
    enemies: [],
    playerBullets: [],
    enemyBullets: [],
    powerups: [],
    effects: [],
    boss: null,
    spawnTimer: { small: 0, medium: 0 },

    /* --------------------------- 初始化 --------------------------- */
    init: function () {
      this.starfield = new Starfield();
      this.hintText = IS_TOUCH ? CFG.HINT.TEXT_MOBILE : CFG.HINT.TEXT_PC;
      this.resetWorld();
      bindButton(this.el('start'), this.bound('start'));
      bindButton(this.el('resume'), this.bound('resume'));
      var homes = document.querySelectorAll('[data-action="home"]');
      for (var i = 0; i < homes.length; i++) { bindButton(homes[i], this.bound('home')); }
      bindButton(this.el('restart'), this.bound('restart'));
      this.applyState(CFG.STATE.MENU);
    },

    el: function (action) { return document.querySelector('[data-action="' + action + '"]'); },
    bound: function (action) {
      var self = this;
      return function () { self.action(action); };
    },

    /* 清空世界，准备新的一局 */
    resetWorld: function () {
      this.time = 0;
      this.score = 0;
      this.stageTime = 0;
      this.stageIndex = 0;
      this.pendingLevelUps = 0;
      this.upgradeChoices = [];
      this.destroyed = 0;
      this.enemies.length = 0;
      this.playerBullets.length = 0;
      this.enemyBullets.length = 0;
      this.powerups.length = 0;
      this.effects.length = 0;
      this.boss = null;
      this.bossTriggered = false;
      this.eliteSpawned = 0;
      this.spawnTimer.small = CFG.ENEMIES.small.SPAWN_INTERVAL;
      this.spawnTimer.medium = CFG.ENEMIES.medium.SPAWN_INTERVAL;
      this.player = new Player();
      this.pointer.active = false;
      this.moveIntent = false;
      this.hintTimer = 0;
      this.hintAlpha = 0;
      this.showHint = false;
      if (levelupCardsEl) { levelupCardsEl.innerHTML = ''; }
    },

    /* ------------------------ 难度阶段辅助 ------------------------ */
    stage: function () { return CFG.DIFFICULTY_STAGES[this.stageIndex] || CFG.DIFFICULTY_STAGES[0]; },

    stageScales: function () { return Difficulty.scales(this.stageTime, this.stage()); },

    /* 得分跨过阶段边界时切换梯度并重置阶段计时 */
    syncStage: function () {
      var idx = Difficulty.stageIndexFor(this.score);
      if (idx !== this.stageIndex) {
        this.stageIndex = idx;
        this.stageTime = 0;
        this.spawnTimer.small = Math.min(this.spawnTimer.small, CFG.ENEMIES.small.SPAWN_INTERVAL);
        this.spawnTimer.medium = Math.min(this.spawnTimer.medium, CFG.ENEMIES.medium.SPAWN_INTERVAL);
      }
    },

    /* --------------------------- 状态机 --------------------------- */
    canTransition: function (to) {
      var S = CFG.STATE;
      switch (this.state) {
        case S.MENU:     return to === S.PLAYING;
        case S.PLAYING:  return to === S.PAUSED || to === S.GAMEOVER || to === S.LEVELUP;
        case S.LEVELUP:  return to === S.PLAYING || to === S.GAMEOVER || to === S.MENU;
        case S.PAUSED:   return to === S.PLAYING || to === S.MENU;
        case S.GAMEOVER: return to === S.PLAYING || to === S.MENU;
      }
      return false;
    },

    /* 所有界面切换都必须走这里 */
    setState: function (next) {
      if (!this.canTransition(next)) { return false; }
      this.prevState = this.state;
      this.state = next;
      this.applyState(next);
      return true;
    },

    applyState: function (state) {
      var S = CFG.STATE;
      stage.setAttribute('data-state', state);

      if (state === S.PLAYING) {
        if (this.prevState !== S.PAUSED && this.prevState !== S.LEVELUP) {
          /* 由主菜单或结算界面进入：开始新的一局 */
          this.resetWorld();
          if (!this.hintSeen) {                // 首次从主菜单进入对局时触发提示
            this.hintSeen = true;
            this.showHint = true;
            this.hintTimer = 0;
            this.hintAlpha = CFG.HINT.ALPHA;
          }
        } else if (this.prevState === S.LEVELUP) {
          this.updateLevelupModal();
        } else {
          this.pointer.active = false;         // 从暂停恢复
        }
        window.SFX.boot();
        window.SFX.startMusic();
        window.SFX.duckMusic(false);
      } else if (state === S.PAUSED) {
        this.pointer.active = false;
        window.SFX.duckMusic(true);            // 暂停时音乐同样静止
      } else if (state === S.LEVELUP) {
        this.pointer.active = false;
        window.SFX.duckMusic(true);
        this.updateLevelupModal();
      } else if (state === S.MENU) {
        this.resetWorld();
        window.SFX.duckMusic(false);
      } else if (state === S.GAMEOVER) {
        this.pointer.active = false;
        window.SFX.duckMusic(true);
      }
    },

    /* ------------------------ 外部动作入口 ------------------------ */
    action: function (name) {
      var S = CFG.STATE;
      switch (name) {
        case 'start':
        case 'restart':
          this.setState(S.PLAYING);
          break;
        case 'resume':
          if (this.state === S.PAUSED) { this.setState(S.PLAYING); }
          break;
        case 'home':
          this.setState(S.MENU);
          break;
      }
    },

    /* 空格：通用确认键（主菜单开始 / 结算重开 / 暂停继续） */
    onConfirm: function () {
      var S = CFG.STATE;
      if (this.state === S.MENU || this.state === S.GAMEOVER) { this.setState(S.PLAYING); }
      else if (this.state === S.PAUSED) { this.setState(S.PLAYING); }
    },

    /* ESC：暂停 / 继续切换（升级选择界面不响应） */
    onPauseToggle: function () {
      var S = CFG.STATE;
      if (this.state === S.PLAYING) { this.setState(S.PAUSED); }
      else if (this.state === S.PAUSED) { this.setState(S.PLAYING); }
    },

    /* 失败 / 胜利结算 */
    finish: function (win) {
      var S = CFG.STATE;
      if (this.state !== S.PLAYING && this.state !== S.LEVELUP) { return; }
      resultTitleEl.textContent = win ? '游戏胜利' : '游戏结束';
      resultTitleEl.className = 'result-title ' + (win ? 'win' : 'lose');
      resultScoreEl.textContent = '最终得分：' + this.score +
        '　等级 Lv.' + this.player.level + '　击毁 ' + this.destroyed + ' 架';
      this.pendingLevelUps = 0;
      this.setState(S.GAMEOVER);
    },

    clearHint: function () {
      if (this.showHint && this.hintAlpha > 0) {
        this.showHint = false;
        this.hintAlpha = 0;
      }
    },

    /* ==================================================================
     * 成长系统：经验 → 升级 → 三选一
     * ================================================================ */

    rewardXp: function (enemy) {
      var up = this.player.gainXp(enemy.cfg.XP || 0);
      if (up > 0) {
        this.pendingLevelUps += up;
        this.beginLevelUp();
      }
    },

    /* 进入升级选择界面（世界冻结） */
    beginLevelUp: function () {
      var S = CFG.STATE;
      if (this.state === S.PLAYING) { this.setState(S.LEVELUP); return; }
      if ((this.state === S.LEVELUP || this.state === S.PAUSED) && !this.upgradeChoices.length) {
        this.updateLevelupModal();
      }
    },

    /* 当前等级下可选的强化（同名强化会显示为「叠加到第 N 层」） */
    refreshChoices: function () {
      this.upgradeChoices = rollUpgradeChoices(this.player, CFG.RPG.CHOICE_COUNT);
    },

    /* 构建升级弹窗内的三张卡片 */
    updateLevelupModal: function () {
      if (!levelupCardsEl) { return; }
      var p = this.player;
      if (!this.upgradeChoices.length) { this.refreshChoices(); }
      levelupSubEl.textContent = '等级 ' + p.level + '　选择一项强化（最高 ' + CFG.RPG.LEVEL_MAX + ' 级）';
      levelupCardsEl.innerHTML = '';
      for (var i = 0; i < this.upgradeChoices.length; i++) {
        var def = this.upgradeChoices[i];
        var cur = p.upgradeLevel(def.key);
        var next = Math.min(cur + 1, def.maxStack);
        var card = document.createElement('button');
        card.className = 'card';
        card.setAttribute('data-upgrade', def.key);
        card.innerHTML =
          '<span class="card-badge">' + def.short + '</span>' +
          '<span class="card-body">' +
            '<span class="card-name">' + def.name + '</span>' +
            '<span class="card-desc">' + upgradeDescription(def, next) + '</span>' +
            '<span class="card-stack">叠加 ' + cur + ' → ' + next + ' / ' + def.maxStack + '</span>' +
          '</span>' +
          '<span class="card-key">' + (i + 1) + '</span>';
        (function (idx) {
          card.addEventListener('click', function (e) {
            e.preventDefault();
            Game.chooseUpgrade(idx);
          });
        })(i);
        levelupCardsEl.appendChild(card);
      }
    },

    /* 选择第 index 个强化 */
    chooseUpgrade: function (index) {
      if (this.state !== CFG.STATE.LEVELUP) { return; }
      var def = this.upgradeChoices[index];
      if (!def) { return; }
      this.player.grantUpgrade(def);
      this.upgradeChoices = [];
      if (this.pendingLevelUps > 1) {          // 还有pending的升级 → 继续弹窗
        this.pendingLevelUps -= 1;
        this.refreshChoices();
        this.updateLevelupModal();
      } else {
        this.pendingLevelUps = 0;
        this.setState(CFG.STATE.PLAYING);
      }
    },

    /* ==================================================================
     * 生成 / 奖励 / 道具
     * ================================================================ */

    spawnEnemy: function (type) {
      var e = new Enemy(type);
      this.enemies.push(e);
      return e;
    },

    /* 顶部随机生成：权重按当前阶段的 WEIGHT_MULT 调整（后期中型出场占比提升） */
    spawnWeightedEnemy: function () {
      var mult = this.stage().WEIGHT_MULT || {};
      var table = {};
      for (var k in CFG.SPAWN_WEIGHTS) {
        if (!CFG.SPAWN_WEIGHTS.hasOwnProperty(k)) { continue; }
        table[k] = CFG.SPAWN_WEIGHTS[k] * (mult[k] === undefined ? 1 : mult[k]);
      }
      var type = pickWeighted(table);
      if (!type) { type = 'small'; }
      return this.spawnEnemy(type);
    },

    spawnExplosion: function (x, y, duration, radius, color, particles) {
      this.effects.push(new Effect(x, y, duration, radius, color, particles));
    },

    spawnShieldBreak: function (x, y) {
      this.effects.push(new Effect(x, y, 0.3, 52, '110,200,255', 12));
    },

    /* 掉落判定：概率 15%，前期偏向生命类、后期偏向火力 / 炸弹类 */
    rollPowerupType: function () {
      var idx = this.stageIndex;
      var table = {};
      for (var k in CFG.POWERUPS.TYPES) {
        if (!CFG.POWERUPS.TYPES.hasOwnProperty(k)) { continue; }
        var w = CFG.POWERUPS.TYPES[k].weightByStage[idx] || 0;
        if (w > 0) { table[k] = w; }
      }
      return pickWeighted(table);
    },

    dropLoot: function (x, y) {
      if (Math.random() >= CFG.POWERUPS.DROP_CHANCE) { return null; }
      var type = this.rollPowerupType();
      if (!type) { return null; }
      var pu = new Powerup(x, y, type);
      this.powerups.push(pu);
      return pu;
    },

    /* 击毁敌机的统一结算：分数 + 经验 + 爆炸特效 + 掉落 */
    reward: function (e, grantXp) {
      this.score += e.cfg.SCORE;
      this.destroyed += 1;
      this.spawnExplosion(e.x, e.y, CFG.EFFECTS.HIT_FLASH.DURATION,
                          CFG.EFFECTS.HIT_FLASH.RADIUS, CFG.EFFECTS.HIT_FLASH.COLOR);
      window.SFX.explode();
      this.dropLoot(e.x, e.y);
      this.syncStage();
      if (grantXp !== false) { this.rewardXp(e); }
    },

    /* 击杀（不掉落重复判定，供击毁/撞毁共用） */
    killEnemy: function (e, opts) {
      if (e.dead) { return; }
      e.dead = true;
      opts = opts || {};
      this.reward(e, opts.xp !== false);
    },

    /* --------------------- 全屏炸弹道具 --------------------- */
    detonateBomb: function () {
      /* 清空屏幕内所有普通敌机与敌方子弹 */
      for (var i = 0; i < this.enemies.length; i++) {
        var e = this.enemies[i];
        if (!e.dead) {
          this.spawnExplosion(e.x, e.y, CFG.EFFECTS.HIT_FLASH.DURATION,
                              CFG.EFFECTS.HIT_FLASH.RADIUS, '255,230,170', 8);
          e.dead = true;
          this.score += e.cfg.SCORE;
          this.destroyed += 1;
        }
      }
      this.enemyBullets.length = 0;
      /* 对 BOSS 造成 10 点伤害 */
      if (this.boss && this.boss.hp > 0) {
        this.boss.hp -= CFG.POWERUPS.BOMB.BOSS_DAMAGE;
        this.boss.hitFlash = CFG.EFFECTS.HIT_BLINK.DURATION;
        if (this.boss.hp <= 0) { this.killBoss(); }
        else { this.boss.checkHeal(); }
      }
      /* 全屏爆炸表现 */
      for (var j = 0; j < 7; j++) {
        this.spawnExplosion(rand(W * 0.1, W * 0.9), rand(H * 0.12, H * 0.8),
                            0.36, rand(70, 130), '255,214,150', 8);
      }
      this.syncStage();
      window.SFX.explode();
    },

    /* --------------------- BOSS --------------------- */
    spawnBoss: function () {
      this.bossTriggered = true;
      this.enemies.length = 0;                 // 清空屏幕内所有普通敌机
      this.enemyBullets.length = 0;            // 清空屏幕内所有敌方子弹
      var tuning = Difficulty.bossTuning(this.player.level);
      this.boss = new Boss(tuning);
      this.spawnExplosion(W / 2, H * 0.22, 0.6, 150, '196,132,252', 14);
    },

    killBoss: function () {
      var b = CFG.BOSS;
      this.score += b.SCORE_KILL;                       // 击败额外获得 2500 分
      this.destroyed += 1;
      this.spawnExplosion(this.boss.x, this.boss.y, CFG.EFFECTS.BIG_FLASH.DURATION,
                          CFG.EFFECTS.BIG_FLASH.RADIUS, CFG.EFFECTS.BIG_FLASH.COLOR, 40);
      window.SFX.explode();
      this.boss.dead = true;
      this.boss = null;
      this.finish(true);                                // 胜利结算
    },

    /* ==================================================================
     * 主更新
     * ================================================================ */
    update: function (dt) {
      var S = CFG.STATE;
      if (this.state === S.MENU || this.state === S.GAMEOVER) {
        this.starfield.update(dt);                      // 仅保留星空背景滚动
        return;
      }
      if (this.state === S.PAUSED || this.state === S.LEVELUP) {
        return;                                         // 游戏逻辑完全冻结，画面静止
      }

      /* ---- 游戏中 ---- */
      this.time += dt;
      this.stageTime += dt;
      this.starfield.update(dt);
      this.updateHint(dt);
      this.player.update(dt);
      this.playerBullets.forEach(function (b) { b.update(dt); });

      this.updateSpawning(dt);

      this.enemies.forEach(function (e) { e.update(dt); });
      this.enemyBullets.forEach(function (b) { b.update(dt); });
      this.powerups.forEach(function (p) { p.update(dt); });
      this.effects.forEach(function (f) { f.update(dt); });
      if (this.boss) { this.boss.update(dt); }

      this.handleCollisions();
      this.cleanup();

      /* 累计得分达到阈值 → 触发最终 BOSS */
      if (!this.bossTriggered && this.score >= CFG.BOSS.SCORE_TRIGGER) {
        this.spawnBoss();
      }
    },

    updateHint: function (dt) {
      if (!this.showHint) { return; }
      this.hintTimer += dt;
      var total = CFG.HINT.DURATION, fade = CFG.HINT.FADE_TIME;
      if (this.hintTimer >= total) {
        this.showHint = false;
        this.hintAlpha = 0;
        return;
      }
      this.hintAlpha = this.hintTimer > total - fade
        ? CFG.HINT.ALPHA * ((total - this.hintTimer) / fade)
        : CFG.HINT.ALPHA;
    },

    /* 生成：梯度难度决定普通敌机间隔与精英机刷新 */
    updateSpawning: function (dt) {
      var stage = this.stage();
      var scales = this.stageScales();

      /* 精英敌机：中期加入、后期刷新加快（前期不出现） */
      if (stage.ELITE_ENABLED && stage.ELITE_INTERVAL) {
        var period = stage.ELITE_INTERVAL / stage.ELITE_INTERVAL_FACTOR;
        var due = Math.floor(this.stageTime / period);
        while (this.eliteSpawned < due) {
          this.eliteSpawned++;
          if (!this.bossTriggered) { this.spawnEnemy('elite'); }
        }
      }

      /* BOSS 出现后停止生成普通敌机 */
      if (this.bossTriggered) { return; }

      for (var key in CFG.ENEMIES) {
        if (!CFG.ENEMIES.hasOwnProperty(key)) { continue; }
        var c = CFG.ENEMIES[key];
        if (!c.SPAWN_INTERVAL) { continue; }
        var interval = Math.max(0.2, c.SPAWN_INTERVAL * scales.interval * (stage.INTERVAL_MULT || 1));
        this.spawnTimer[key] -= dt;
        while (this.spawnTimer[key] <= 0) {
          this.spawnTimer[key] += interval;
          this.spawnWeightedEnemy();
        }
      }
    },

    /* ==================================================================
     * 碰撞判定（核心战斗规则保持不变）
     * ================================================================ */
    handleCollisions: function () {
      var i, j, b, e, pb, eb, pu;

      /* 玩家子弹 → 敌机 / BOSS */
      for (i = 0; i < this.playerBullets.length; i++) {
        pb = this.playerBullets[i];
        if (pb.dead) { continue; }

        /* BOSS */
        if (this.boss && this.boss.hp > 0) {
          var bb = hitBox(this.boss);
          var pbh = hitBox(pb);
          if (intersects(pbh.x, pbh.y, pbh.w, pbh.h, bb.x, bb.y, bb.w, bb.h)) {
            pb.dead = true;
            this.boss.hp -= pb.damage;
            this.boss.hitFlash = CFG.EFFECTS.HIT_BLINK.DURATION;
            this.spawnExplosion(pb.x, pb.y, 0.14, 18, '255,240,200', 4);
            if (this.boss.hp <= 0) { this.killBoss(); }
            else { this.boss.checkHeal(); }         // 血量首次降到 25% → 触发单次回血
            continue;
          }
        }

        /* 普通敌机 */
        for (j = 0; j < this.enemies.length; j++) {
          e = this.enemies[j];
          if (e.dead) { continue; }
          if (hits(pb, e)) {
            pb.dead = true;
            e.hp -= pb.damage;                          // 火力强化后可一发打多点
            e.hitFlash = CFG.EFFECTS.HIT_BLINK.DURATION; // 0.1 秒白色高亮闪烁
            if (e.hp <= 0) { this.killEnemy(e); }        // 血量归零立即销毁 + 计分 + 经验
            break;
          }
        }
      }

      if (!this.player || this.player.hp <= 0) { return; }

      /* 敌方子弹 → 玩家 */
      for (i = 0; i < this.enemyBullets.length; i++) {
        eb = this.enemyBullets[i];
        if (eb.dead) { continue; }
        if (hits(eb, this.player)) {
          eb.dead = true;                              // 对应敌方子弹销毁
          if (this.player.hurt()) { break; }           // 扣血 / 消耗护盾 + 无敌时间
        }
      }

      /* 敌机机身 → 玩家 */
      if (this.player.hp > 0 && this.player.invincible <= 0) {
        for (j = 0; j < this.enemies.length; j++) {
          e = this.enemies[j];
          if (e.dead) { continue; }
          if (hits(e, this.player)) {
            e.dead = true;                             // 敌机销毁
            this.spawnExplosion(e.x, e.y, CFG.EFFECTS.HIT_FLASH.DURATION,
                                CFG.EFFECTS.HIT_FLASH.RADIUS, '255,150,150', 8);
            this.player.hurt();                        // 撞机不给分与经验
            break;
          }
        }
      }

      /* BOSS 机身 → 玩家（BOSS 不向下移动，但撞上同样受伤） */
      if (this.boss && this.player.hp > 0 && this.player.invincible <= 0) {
        var bh2 = hitBox(this.boss), ph = hitBox(this.player);
        if (intersects(ph.x, ph.y, ph.w, ph.h, bh2.x, bh2.y, bh2.w, bh2.h)) {
          this.player.hurt();
        }
      }

      /* 道具 → 玩家自动拾取 */
      for (i = 0; i < this.powerups.length; i++) {
        pu = this.powerups[i];
        if (pu.dead) { continue; }
        if (hits(pu, this.player)) {
          pu.dead = true;
          this.player.pickup(pu.type);
        }
      }
    },

    /* 回收清理：超出边界或已销毁的对象 */
    cleanup: function () {
      this.playerBullets = this.playerBullets.filter(function (o) { return !o.dead; });
      this.enemyBullets = this.enemyBullets.filter(function (o) { return !o.dead; });
      this.enemies = this.enemies.filter(function (o) { return !o.dead; });
      this.powerups = this.powerups.filter(function (o) { return !o.dead; });
      this.effects = this.effects.filter(function (o) { return !o.dead; });
    },

    /* ==================================================================
     * 渲染
     * ================================================================ */
    render: function () {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#05060f');
      g.addColorStop(0.5, '#070c1c');
      g.addColorStop(1, '#0a0f24');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      this.starfield.draw();

      var S = CFG.STATE;
      if (this.state === S.MENU) { return; }         // 主菜单：静态星空背景 + 覆盖层

      this.powerups.forEach(function (p) { p.draw(); });
      this.playerBullets.forEach(function (b) { b.draw(); });
      this.enemies.forEach(function (e) { e.draw(); });
      this.enemyBullets.forEach(function (b) { b.draw(); });
      if (this.boss) { this.boss.draw(); }
      if (this.player && this.player.hp > 0) { this.player.draw(); }
      this.enemies.forEach(function (e) { e.drawHitFlash(); });
      this.effects.forEach(function (f) { f.draw(); });

      if (this.state === S.PLAYING || this.state === S.PAUSED || this.state === S.LEVELUP) {
        this.drawHUD();
        if (this.state === S.PLAYING) { this.drawHint(); }
      }
      /* 暂停 / 升级 / 结算的遮罩与弹窗由 DOM 覆盖层负责 */
    },

    /* ------------------------- 顶部固定状态栏 ------------------------- */
    drawHUD: function () {
      var u = CFG.UI;
      var p = this.player;
      var stats = p ? p.stats() : { hpMax: CFG.PLAYER.HP_MAX, chain: 1 };
      ctx.save();

      /* 状态栏底板（不随背景滚动） */
      var g = ctx.createLinearGradient(0, 0, 0, u.TOPBAR_H);
      g.addColorStop(0, 'rgba(4,8,20,0.86)');
      g.addColorStop(1, 'rgba(4,8,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, u.TOPBAR_H);

      /* 实时分数 */
      ctx.fillStyle = u.SCORE.COLOR;
      ctx.font = 'bold ' + u.SCORE.FONT_SIZE + 'px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'rgba(90,190,255,0.8)';
      ctx.shadowBlur = 10;
      ctx.fillText('分数：' + this.score, u.SCORE.X, u.SCORE.Y);
      ctx.shadowBlur = 0;

      /* 第二行：等级 + 当前难度阶段 */
      ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#ffe08a';
      ctx.fillText('Lv.' + (p ? p.level : 1) + ' / ' + CFG.RPG.LEVEL_MAX, u.SCORE.X, u.SCORE.Y + 20);
      ctx.font = '13px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(160,205,240,0.8)';
      ctx.fillText(this.stage().name, u.SCORE.X + 64, u.SCORE.Y + 20);

      /* 生命值心形（最大生命随强化提高） */
      var hpMax = Math.min(stats.hpMax, CFG.PLAYER.HP_MAX_CAP);
      var heartStep = u.HEART.SIZE * 2 + u.HEART.GAP;
      var startX = u.HEART.X - (hpMax - 1) * heartStep;
      for (var i = 0; i < hpMax; i++) {
        var hx = startX + i * heartStep;
        if (p && i < p.hp) {
          ctx.shadowColor = 'rgba(255,70,120,0.9)';
          ctx.shadowBlur = 12;
          drawHeart(hx, u.HEART.Y, u.HEART.SIZE, '#ff4d6d');
          ctx.shadowBlur = 0;
        } else {
          drawHeart(hx, u.HEART.Y, u.HEART.SIZE, 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.28)');
        }
      }
      /* 护盾层数标识（位于心形正下方，不与其它文字重叠） */
      var shieldCount = p ? (p.shield + p.tempShield) : 0;
      if (shieldCount > 0) {
        var sy = u.HEART.Y + u.SHIELD.OFFSET_Y;
        var span = (hpMax - 1) * heartStep;
        var shStep = u.SHIELD.SIZE * 2 + u.SHIELD.GAP;
        var shStart = (u.HEART.X + startX) / 2 - (shieldCount - 1) * shStep / 2;
        for (var s2 = 0; s2 < shieldCount; s2++) {
          drawShieldIcon(shStart + s2 * shStep, sy, u.SHIELD.SIZE,
                         s2 < (p ? p.shield : 0) ? '#38bdf8' : '#a5e8ff');
        }
      }

      /* 经验条（升级进度） */
      if (p && p.level < CFG.RPG.LEVEL_MAX) {
        var need = p.xpNeeded();
        var ratio = need > 0 ? clamp(p.xp / need, 0, 1) : 1;
        var barX = 224, barY = 70, barW = 174, barH = 7;
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(barX, barY, barW, barH);
        var eg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        eg.addColorStop(0, '#5ee7ff');
        eg.addColorStop(1, '#ffe08a');
        ctx.fillStyle = eg;
        ctx.fillRect(barX, barY, barW * ratio, barH);
        ctx.strokeStyle = 'rgba(180,230,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);
        ctx.fillStyle = 'rgba(200,230,255,0.85)';
        ctx.font = '11px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('经验 ' + p.xp + ' / ' + need, barX + barW / 2, barY - 4);
        ctx.textAlign = 'left';
      }

      /* 临时增益提示（贴在左下，避开心形与经验条） */
      if (p && (p.doubleTimer > 0 || p.rateTimer > 0)) {
        var tagY = 92;
        ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
        if (p.doubleTimer > 0) {
          ctx.fillStyle = '#fbbf24';
          ctx.fillText('火力强化 ' + p.doubleTimer.toFixed(1) + 's', u.SCORE.X, tagY);
          tagY += 15;
        }
        if (p.rateTimer > 0) {
          ctx.fillStyle = '#c4b5fd';
          ctx.fillText('射速 +50% ' + p.rateTimer.toFixed(1) + 's', u.SCORE.X, tagY);
        }
      }

      /* 方形暂停按钮 */
      var b = u.PAUSE_BTN;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(b.X, b.Y, b.SIZE, b.SIZE, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,230,255,0.75)';
      ctx.lineWidth = 2;
      roundRect(b.X, b.Y, b.SIZE, b.SIZE, 10);
      ctx.stroke();
      ctx.fillStyle = 'rgba(215,242,255,0.95)';
      var barW = 5, barH = 18;
      ctx.fillRect(b.X + b.SIZE / 2 - barW - 3, b.Y + b.SIZE / 2 - barH / 2, barW, barH);
      ctx.fillRect(b.X + b.SIZE / 2 + 3, b.Y + b.SIZE / 2 - barH / 2, barW, barH);

      ctx.restore();
    },

    /* ------------------------ 首次操作提示 ------------------------ */
    drawHint: function () {
      if (!this.showHint || this.hintAlpha <= 0) { return; }
      var h = CFG.HINT;
      ctx.save();
      ctx.globalAlpha = clamp(this.hintAlpha, 0, 1);
      ctx.fillStyle = '#ffffff';                    // 半透明白色文字
      ctx.font = h.FONT_SIZE + 'px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 8;
      ctx.fillText(this.hintText, W / 2, H * h.Y_RATIO);
      ctx.restore();
    }
  };

  /* 心形绘制 */
  function drawHeart(cx, cy, size, fill, stroke) {
    var s = size;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, s * 0.72);
    ctx.bezierCurveTo(-s * 1.35, -s * 0.18, -s * 0.62, -s * 1.05, 0, -s * 0.34);
    ctx.bezierCurveTo(s * 0.62, -s * 1.05, s * 1.35, -s * 0.18, 0, s * 0.72);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* 护盾六边形标识 */
  function drawShieldIcon(cx, cy, size, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 6 + i * Math.PI / 3;
      var x = Math.cos(a) * size, y = Math.sin(a) * size;
      if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ======================================================================
   * 6. 启动
   * ==================================================================== */

  window.Game = Game;

  var lastTime = 0;

  function frame(now) {
    var raw = (now - lastTime) / 1000;
    lastTime = now;
    if (!isFinite(raw) || raw < 0) { raw = 0; }
    var dt = Math.min(raw, 0.05);            // 防止切换标签页后跳帧
    Game.update(dt);
    Game.render();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', function () { setTimeout(resizeCanvas, 120); });

  resizeCanvas();
  Game.init();
  requestAnimationFrame(function (t) {
    lastTime = t;
    requestAnimationFrame(frame);
  });
})();
