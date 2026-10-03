/* =========================================================
 * 光之巨人 · 小游戏 HUD 层（hud）
 * 游戏代码里所有 DOM 元素都是 adapter 的"状态存根"；
 * 本文件每帧把存根状态画到 2D 画布，再由 hudFlush 合成到 WebGL 画布。
 * 同时提供触屏方案：左侧虚拟摇杆 + 右侧技能按钮 + 可点热栏，
 * 触点最终合成为游戏认识的 keydown/mousedown/mousemove 事件。
 * ========================================================= */
const adapter = require('./adapter.js');
const G = GameGlobal;

const hudCanvas = wx.createCanvas();          // 离屏 2D（主画布已在 adapter 创建）
const ctx = hudCanvas.getContext('2d');

/* ---------- 小工具 ---------- */
const $ = id => G.__doc.getElementById(id);
const strip = s => String(s == null ? '' : s).replace(/[\uD800-\uDFFF]/g, '');   // 去掉 emoji（astral），devtools 字体缺字
function font(px, bold) { ctx.font = (bold ? 'bold ' : '') + Math.round(px) + 'px "Microsoft YaHei","Heiti SC",sans-serif'; }
function txt(s, x, y, px, color, opt) {
  opt = opt || {};
  font(px, opt.bold);
  ctx.textAlign = opt.align || 'left';
  ctx.textBaseline = opt.base || 'alphabetic';
  if (opt.glow) { ctx.shadowColor = opt.glow; ctx.shadowBlur = opt.glowBlur || 12; } else ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
/* 矢量爱心（devtools canvas 对 ❤emoji 支持不稳，直接画形状） */
function heart(x, y, sz, mode) {           // mode: full / half / empty
  ctx.save();
  ctx.translate(x, y);
  const r = sz * 0.30;
  const path = () => {
    ctx.beginPath();
    ctx.arc(-r * 0.55, -r * 0.45, r * 0.62, 0, Math.PI * 2);
    ctx.arc(r * 0.55, -r * 0.45, r * 0.62, 0, Math.PI * 2);
    ctx.moveTo(-r * 1.12, -r * 0.15);
    ctx.lineTo(0, r * 1.05);
    ctx.lineTo(r * 1.12, -r * 0.15);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = mode === 'empty' ? 'rgba(30,32,40,.9)' : (mode === 'half' ? 'rgba(30,32,40,.9)' : '#ff4b5b');
  ctx.fill();
  if (mode === 'half') {                   // 左半边补粉色
    ctx.save(); ctx.beginPath(); ctx.rect(-r * 1.2, -r, r * 1.2, r * 2.2); ctx.clip();
    path(); ctx.fillStyle = '#ff7b9c'; ctx.fill(); ctx.restore();
  }
  ctx.restore();
}

/* ---------- 触屏控件布局 ---------- */
let s = 1;                                  // 像素缩放（每帧按画布高度算）
let hotRects = [];                          // 可点区域 {x,y,w,h,r?,act}
const dirHeld = {};                         // touchId -> 方向键 code（十字键按住行走）
const atkHeld = {};                         // touchId -> 1（攻击键按住=鼠标左键按住）
let spaceLatch = false;                     // 跳：巨人态点按锁定 Space（飞行免按住），再点解除
const activeBtn = {};                       // touchId -> button def
const lookPts = {};                         // touchId -> {lx,ly,t,moved}
let menuRects = [];                         // 菜单按钮（进入世界/重开）

function btnGrid() {                        // 右侧 3×3 技能环（加大版：r52/间距118，右缘下缘各留 16s）
  const r = 52 * s, gap = 118 * s;
  const x0 = hudCanvas.width - 304 * s, y0 = hudCanvas.height - 304 * s;
  const defs = [
    { k: 'KeyF', label: '光炮' }, { k: 'KeyV', label: '飞踢' }, { k: 'KeyR', label: '拳击' },
    { k: 'KeyT', label: '变身' }, { k: 'KeyB', label: '巨大' }, { k: 'KeyG', label: '机枪' },
    { k: 'Space', label: '跳' }, { k: 'KeyC', label: '降' }, { place: true, label: '放置' }
  ];
  return defs.map((d, i) => ({
    ...d,
    x: x0 + (i % 3) * gap,
    y: y0 + Math.floor(i / 3) * gap,
    r
  }));
}

/* ---------- 触屏事件入口（game.js 接 wx.onTouchXXX） ---------- */
function toCanvas(x, y) { return [x * (hudCanvas.width / G.innerWidth), y * (hudCanvas.height / G.innerHeight)]; }
function dpadBtns() {                       // 左下十字方向键（整体右移上移版：中心(240s,H-240s)；▲前进键单独加大 r64）
  const cx = 240 * s, cy = hudCanvas.height - 240 * s;
  return [
    { k: 'KeyW', x: cx, y: cy - 112 * s, r: 64 * s },
    { k: 'KeyA', x: cx - 112 * s, y: cy, r: 54 * s },
    { k: 'KeyS', x: cx, y: cy + 112 * s, r: 54 * s },
    { k: 'KeyD', x: cx + 112 * s, y: cy, r: 54 * s }
  ];
}
function atkBtn() {                         // 「攻击」大按钮 = 鼠标左键（用户指定：放「飞踢」正上方，错开两者命中圈）
  return { x: hudCanvas.width - 186 * s, y: hudCanvas.height - 434 * s, r: 64 * s };
}
const isGiant = () => String(($('energyTxt') && $('energyTxt').textContent) || '').indexOf('巨人') >= 0;
const btnFlash = new Map();                 // 按钮key → 最后点按时刻：点击亮光反馈（点按即逝的技能键也有"已点击"发光）
function flashK(k, now) {
  const t0 = btnFlash.get(k);
  if (!t0) return 0;
  if (now - t0 > 600) { btnFlash.delete(k); return 0; }   // 过期即清：否则 Map 永不为空，交互逐帧刷新的判据会失灵
  return 1 - (now - t0) / 380;
}
function touchStart(cx, cy, id) {
  hudDirty = true;   // 按下/点亮/菜单点击都改 HUD 内容（b53 脏标记上传：内容不变不重传）
  const [x, y] = toCanvas(cx, cy);
  const now = Date.now();
  // 1) 菜单/死亡按钮
  for (const r of menuRects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { r.act(); return; }
  }
  // 2) 攻击键（=鼠标左键：按下挖/攻击，松开停）
  const ab = atkBtn(), adx = x - ab.x, ady = y - ab.y;
  if (adx * adx + ady * ady <= (ab.r * 1.15) ** 2) {
    atkHeld[id] = 1;
    btnFlash.set('atk', now);
    G.__mouse('mousedown', { button: 0, clientX: cx, clientY: cy });
    return;
  }
  // 3) 十字方向键（按住走，松开停）
  for (const d of dpadBtns()) {
    const dx = x - d.x, dy = y - d.y;
    if (dx * dx + dy * dy <= (d.r * 1.2) ** 2) {
      dirHeld[id] = d.k;
      btnFlash.set('dir' + d.k, now);
      G.__key(d.k, d.k[3].toLowerCase(), true);
      return;
    }
  }
  // 4) 技能按钮
  for (const b of btnGrid()) {
    const dx = x - b.x, dy = y - b.y;
    if (dx * dx + dy * dy <= (b.r * 1.25) ** 2) {
      btnFlash.set(b.k || b.label, now);    // 点击亮光：点按即逝的技能也有"已点击"反馈
      if (b.k === 'Space' && isGiant()) {   // 巨人飞行：点按锁定/再点解除，不用一直按住
        spaceLatch = !spaceLatch;
        G.__key('Space', ' ', spaceLatch);
        return;
      }
      activeBtn[id] = b;
      if (b.place) G.__mouse('mousedown', { button: 2, clientX: cx, clientY: cy });
      else G.__key(b.k, b.k === 'Space' ? ' ' : b.k, true);
      return;
    }
  }
  // 5) 热栏
  for (let i = 0; i < hotRects.length; i++) {
    const r = hotRects[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      G.__key('', String(i + 1), true);
      setTimeout(() => G.__key('', String(i + 1), false), 60);
      return;
    }
  }
  // 6) 静音小按钮（左上角 stats 下方）
  if (x < 260 * s && y > 150 * s && y < 220 * s) { G.__key('KeyM', 'm', true); setTimeout(() => G.__key('KeyM', 'm', false), 60); return; }
  // 7) 暂停按钮（右上）
  if (x > hudCanvas.width - 90 * s && y < 90 * s) { G.__doc.exitPointerLock(); return; }
  // 8) 其余=纯视角区：只转视角，绝不攻击（打/挖只归「攻击」键管，否则每次碰屏都在拆方块）
  lookPts[id] = { lx: x, ly: y, t: now, moved: 0 };
}
function touchMove(cx, cy, id) {
  const [x, y] = toCanvas(cx, cy);
  const L = lookPts[id];
  if (L) {
    const mx = x - L.lx, my = y - L.ly;
    L.moved += Math.abs(mx) + Math.abs(my);
    L.lx = x; L.ly = y;
    G.__mouse('mousemove', { movementX: mx * 1.7, movementY: my * 1.7, clientX: cx, clientY: cy });
  }
}
function touchEnd(cx, cy, id) {
  hudDirty = true;   // 松开/熄灭高亮（b53）
  const b = activeBtn[id];
  if (b) {
    if (b.place) G.__mouse('mouseup', { button: 2 });
    else G.__key(b.k, b.k === 'Space' ? ' ' : b.k, false);
    delete activeBtn[id];
    return;
  }
  if (dirHeld[id]) {                        // 十字键：松开停走
    G.__key(dirHeld[id], dirHeld[id][3].toLowerCase(), false);
    delete dirHeld[id];
    return;
  }
  if (atkHeld[id]) {                        // 攻击键：松开=左键抬起
    delete atkHeld[id];
    G.__mouse('mouseup', { button: 0 });
    return;
  }
  const L = lookPts[id];
  if (L) {
    // 轻点屏幕只当"点击画面继续"（暂停后恢复/重新锁定），不出拳、不挖方块、不锁定
    if (Date.now() - L.t < 260 && L.moved < 12) G.__canvasClick();
    delete lookPts[id];
  }
}

/* ---------- 状态读取 ---------- */
function bodyFlash(kind) {                  // bolt/trans/flash 三个游离 div 存根（按样式特征找）
  const ch = G.__doc.body.children || [];
  for (const el of ch) {
    const bg = el.style.background || el.style.cssText || '';
    if (kind === 'bolt' && bg.indexOf('200,228,255') >= 0) return el;
    if (kind === 'trans' && bg.indexOf('radial') >= 0) return el;
    if (kind === 'flash' && bg.indexOf('#ffd75e') >= 0) return el;
  }
  return null;
}
const num = v => parseFloat(v) || 0;
function fillColors(bg) {                   // 蓄力条渐变色按内联 background 判断
  const b = bg || '';
  if (b.indexOf('#ff2b2b') >= 0) return ['#36c6ff', '#ff2b2b'];
  if (b.indexOf('#ff7b1f') >= 0) return ['#ffe08a', '#ff7b1f'];
  if (b.indexOf('#d8f6ff') >= 0) return ['#66e8ff', '#d8f6ff'];
  return ['#19c8ff', '#aef4ff'];
}

/* ---------- 每帧绘制 ---------- */
/* 分段守卫：一段 UI 崩了不影响其他段，首次段错在真机弹窗报位置 */
const segErrs = [];
function seg(name, fn) {
  try { fn(); } catch (e) {
    const m = name + ':' + String(e && e.message || e).slice(0, 60);
    if (segErrs.length < 6) segErrs.push(m);
    try {
      if (!G.__segShown && G.__plat !== 'devtools') {
        G.__segShown = 1;
        wx.showModal({ title: 'HUD段错·拍照发我', content: m, showCancel: false });
      }
    } catch (_) { }
  }
}
function drawHUD() {
  const W = hudCanvas.width, H = hudCanvas.height;
  s = H / 720;
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  const doc = G.__doc;
  const now = Date.now();
  segErrs.length = 0;

  seg('闪光', () => {
  /* 全屏闪光（变身白光/落雷蓝闪） */
  const tf = bodyFlash('trans'), bf = bodyFlash('bolt');
  const tfOp = num(tf && tf.style.opacity), bfOp = num(bf && bf.style.opacity);
  if (tfOp > 0.01) {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,' + tfOp + ')');
    g.addColorStop(0.45, 'rgba(174,230,255,' + tfOp * 0.8 + ')');
    g.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (bfOp > 0.01) { ctx.fillStyle = 'rgba(200,228,255,' + 0.45 * bfOp + ')'; ctx.fillRect(0, 0, W, H); }
  });

  const startEl = $('start'), deathEl = $('death');
  const menuOn = startEl.style.display !== 'none';
  const deadOn = deathEl.style.display !== 'none';

  if (menuOn) { seg('菜单', () => drawMenu(W, H)); return; }
  if (deadOn) { seg('死亡', () => drawDeath(W, H)); return; }

  seg('受击红光', () => {
  /* 受击红光 */
  const df = $('dmgFlash'), dfOp = num(df.style.opacity);
  if (dfOp > 0.01) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(255,30,30,0)');
    g.addColorStop(1, 'rgba(255,30,30,' + 0.85 * dfOp + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  });

  /* 准星 */
  seg('准星', () => txt('+', W / 2, H / 2 + 8 * s, 24 * s, 'rgba(255,255,255,.85)', { align: 'center' }));

  seg('状态块', () => {
  /* 左上状态块：爱心 / 血量 / 能量条 / 形态 */
  const stats = $('stats');
  const hearts = stats ? (doc.getElementById('hearts').textContent || '') : '';
  let hy = 34 * s;
  for (let i = 0; i < hearts.length && i < 10; i++) {
    const m = hearts[i] === '❤' ? 'full' : (hearts[i] === '💗' ? 'half' : 'empty');
    heart(24 * s + i * 26 * s, hy, 20 * s, m);
  }
  const low = stats && stats.classList.contains('low');
  if (low) { /* 低血：整块红边呼吸 */ ctx.strokeStyle = 'rgba(255,60,60,' + (0.25 + 0.2 * Math.sin(now / 220)) + ')'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, W - 4, H - 4); }
  txt($('hpNum').textContent, 24 * s + hearts.length * 26 * s + 6 * s, hy + 6 * s, 16 * s, '#ffffff', { bold: true });
  // 能量条
  const ew = 180 * s, eh = 14 * s, ex = 24 * s, ey = hy + 18 * s;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; roundRect(ex, ey, ew, eh, eh / 2); ctx.fill();
  ctx.strokeStyle = '#9adcf0'; ctx.lineWidth = 1.5; ctx.stroke();
  const eW = num($('energyBar').style.width) / 100;
  if (eW > 0) {
    const g = ctx.createLinearGradient(ex, 0, ex + ew, 0);
    g.addColorStop(0, '#19c8ff'); g.addColorStop(1, '#aef4ff');
    ctx.fillStyle = g;
    ctx.save(); roundRect(ex + 2, ey + 2, Math.max(0, (ew - 4) * Math.min(1, eW)), eh - 4, (eh - 4) / 2); ctx.fill(); ctx.restore();
  }
  txt($('energyTxt').textContent, ex, ey + eh + 16 * s, 12 * s, '#9adcf0');
  txt(strip($('weaponTxt').textContent), ex, ey + eh + 38 * s, 13 * s, '#ffd75e');
  txt('🔇', ex, ey + eh + 78 * s, 20 * s, 'rgba(255,255,255,.75)');
  });

  seg('时钟', () => {
  /* 右上时钟 */
  const clockLines = String($('clock').innerHTML).split(/<br\s*\/?>/i);
  clockLines.forEach((ln, i) => txt(strip(ln), W - 24 * s, 34 * s + i * 24 * s, 14 * s, '#ffffff', { align: 'right' }));
  /* 暂停小按钮 */
  txt('⏸', W - 60 * s, 84 * s, 26 * s, 'rgba(255,255,255,.6)', { align: 'center' });
  });

  seg('中提示', () => {
  /* 变身计时 / 圣域提示 */
  const tt = $('transTimer');
  if (tt.style.display !== 'none') txt(strip(tt.textContent), W / 2, H * 0.16, 26 * s, '#ff5b5b', { align: 'center', bold: true, glow: '#ff2020' });
  const st = $('sanctTip');
  if (st.style.display !== 'none') txt(st.textContent, W / 2, H * 0.15, 18 * s, '#ffe9b0', { align: 'center', bold: true, glow: '#ffb400' });

  /* 漂浮提示语 */
  const fl = bodyFlash('flash');
  if (fl && fl.textContent) txt(strip(fl.textContent), W / 2, H * 0.26, 18 * s, '#ffd75e', { align: 'center', glow: '#000000' });

  /* 受击飘字 */
  const dn = $('dmgNum'), dnOp = num(dn.style.opacity);
  if (dnOp > 0.01) txt(dn.textContent, W / 2, num(dn.style.top) / 100 * H, 30 * s, '#ff4b4b', { align: 'center', bold: true, alpha: dnOp });

  /* 蓄力条 */
  const cb = $('chargeBar');
  if (cb.style.display !== 'none') {
    const bw = 150 * s, bh = 10 * s, bx = W / 2 - bw / 2, by = H * 0.56;
    ctx.fillStyle = 'rgba(0,10,20,.6)'; roundRect(bx, by, bw, bh, 5 * s); ctx.fill();
    ctx.strokeStyle = '#36c6ff'; ctx.lineWidth = 1; ctx.stroke();
    const f = num($('chargeFill').style.width) / 100;
    if (f > 0) {
      const c = fillColors($('chargeFill').style.background);
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
      ctx.fillStyle = g; ctx.save(); roundRect(bx + 1, by + 1, Math.max(0, (bw - 2) * Math.min(1, f)), bh - 2, 4 * s); ctx.fill(); ctx.restore();
    }
  }

  /* Boss 方向箭头 */
  const bd = $('bossDir');
  if (bd.style.display !== 'none') {
    const m = /translate\(([-\d.]+)px,([-\d.]+)px\)\s*rotate\(([-\d.]+)deg\)/.exec($('bossArrow').style.transform || '');
    if (m) {
      const px = W / 2 + num(m[1]) * (W / G.innerWidth), py = H / 2 + num(m[2]) * (H / G.innerHeight);
      ctx.save(); ctx.translate(px, py); ctx.rotate(num(m[3]) * Math.PI / 180);
      txt('▲', 0, 10 * s, 32 * s, '#ff4b4b', { align: 'center', glow: '#ff2020' });
      ctx.restore();
      txt(strip($('bossTxt').textContent), px, py + 56 * s, 12 * s, '#ffb0a8', { align: 'center' });
    }
  }
  });

  seg('快捷栏', () => {
  /* 热栏 */
  const hb = $('hotbar');
  const kids = hb.children || [];
  const sw = 52 * s, sgap = 6 * s;
  let hx = W / 2 - (kids.length * sw + (kids.length - 1) * sgap) / 2, hy2 = H - sw - 14 * s;
  hotRects = [];
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < kids.length; i++) {
    const d = kids[i];
    const sel = d.classList.contains('sel');
    ctx.fillStyle = 'rgba(0,0,0,.6)'; roundRect(hx, hy2, sw, sw, 6 * s); ctx.fill();
    ctx.strokeStyle = sel ? '#ffd75e' : 'rgba(220,240,255,.85)'; ctx.lineWidth = sel ? 3 : 2;
    if (sel) { ctx.shadowColor = 'rgba(255,215,94,.55)'; ctx.shadowBlur = 10; }
    ctx.stroke(); ctx.shadowBlur = 0;
    const slotCv = d.children && d.children[0];
    if (slotCv && slotCv.width) ctx.drawImage(slotCv, hx + 4 * s, hy2 + 4 * s, sw - 8 * s, sw - 8 * s);
    const key = d.children && d.children[1], cnt = d.children && d.children[2];
    if (key) txt(key.textContent, hx + 5 * s, hy2 + 14 * s, 10 * s, '#cccccc');
    if (cnt) txt(cnt.textContent, hx + sw - 4 * s, hy2 + sw - 4 * s, 12 * s, '#ffffff', { align: 'right' });
    hotRects.push({ x: hx, y: hy2, w: sw, h: sw });
    hx += sw + sgap;
  }
  ctx.imageSmoothingEnabled = true;
  });

  seg('暂停遮罩', () => {
  /* 暂停遮罩 */
  const pt = $('pauseTip');
  if (pt.style.display !== 'none') {
    ctx.fillStyle = 'rgba(5,8,18,.72)'; roundRect(W / 2 - 170 * s, H * 0.44 - 40 * s, 340 * s, 84 * s, 14 * s); ctx.fill();
    String(pt.textContent).split('\n').forEach((ln, i) =>
      txt(strip(ln), W / 2, H * 0.44 - 6 * s + i * 30 * s, i ? 14 * s : 24 * s, i ? '#9adcf0' : '#ffffff', { align: 'center' }));
  }
  });

  seg('触屏UI', () => drawTouchUI(W, H, now));
}

/* ---------- 开始菜单 / 死亡界面 ---------- */
function drawMenu(W, H) {
  ctx.fillStyle = 'rgba(5,8,18,.86)'; ctx.fillRect(0, 0, W, H);
  const cy = H * 0.14;
  txt('重生之我在方块位面当光之巨人', W / 2, cy + 40 * s, 38 * s, '#aef4ff', { align: 'center', bold: true, glow: '#19c8ff', glowBlur: 24 });
  txt('生存 · 建造 · 变身 · 讨伐怪兽', W / 2, cy + 76 * s, 20 * s, '#ffd75e', { align: 'center' });
  const lines = [
    '白天采集方块、修筑庇护所；夜晚怪兽成群袭来',
    '击败怪兽积攒能量，满 6 格按 T 化身光之巨人',
    '巨人技能：光炮 / 蓄力激光 / 飞踢 / 三连拳 / 巨大化',
    '神殿传送阵往返上界天堂 · 黎明自动修复战损大地'
  ];
  lines.forEach((ln, i) => txt(ln, W / 2, cy + 116 * s + i * 26 * s, 14 * s, '#cfe6ff', { align: 'center' }));
  menuRects = [];
  // 进入世界
  const bw = 220 * s, bh = 48 * s, bx = W / 2 - bw / 2, by = cy + 246 * s;
  const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  g.addColorStop(0, '#19c8ff'); g.addColorStop(1, '#7b5cff');
  ctx.fillStyle = g; roundRect(bx, by, bw, bh, 24 * s); ctx.fill();
  txt('进 入 世 界', W / 2, by + 32 * s, 19 * s, '#ffffff', { align: 'center', bold: true });
  menuRects.push({ x: bx, y: by, w: bw, h: bh, act: () => $('btnStart').click() });
  // 重开（有存档才显示）
  if ($('btnReset').style.display !== 'none') {
    const ry = by + bh + 16 * s, rw = 240 * s, rh = 34 * s, rx = W / 2 - rw / 2;
    ctx.fillStyle = '#39424e'; roundRect(rx, ry, rw, rh, 17 * s); ctx.fill();
    txt(strip('🗑 重开新世界（清除存档）'), W / 2, ry + 23 * s, 13 * s, '#cfd8e2', { align: 'center' });
    menuRects.push({ x: rx, y: ry, w: rw, h: rh, act: () => $('btnReset').click() });
  }
}
function drawDeath(W, H) {
  ctx.fillStyle = 'rgba(28,6,10,.88)'; ctx.fillRect(0, 0, W, H);
  txt('你被怪兽击败了', W / 2, H * 0.32, 40 * s, '#ff5b5b', { align: 'center', bold: true, glow: '#ff2020', glowBlur: 24 });
  txt($('deathStats').textContent, W / 2, H * 0.32 + 44 * s, 15 * s, '#cfe6ff', { align: 'center' });
  menuRects = [];
  const bw = 200 * s, bh = 44 * s, bx = W / 2 - bw / 2, by = H * 0.32 + 90 * s;
  const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  g.addColorStop(0, '#19c8ff'); g.addColorStop(1, '#7b5cff');
  ctx.fillStyle = g; roundRect(bx, by, bw, bh, 22 * s); ctx.fill();
  txt('重新开始', W / 2, by + 30 * s, 18 * s, '#ffffff', { align: 'center', bold: true });
  menuRects.push({ x: bx, y: by, w: bw, h: bh, act: () => G.location.reload() });
  txt('版本' + HUD_VER, W - 12 * s, H - 8 * s, 13 * s, 'rgba(255,255,255,.5)', { align: 'right' });
}

/* ---------- 触屏控件绘制 ---------- */
const HUD_VER = 'b57';                      // 版本水印：确认手机上跑的是哪个构建
function drawTouchUI(W, H, now) {
  menuRects = menuRects || [];
  // 左下十字方向键（按住行走；点击后发光 ~0.4s）
  for (const d of dpadBtns()) {
    const on = Object.values(dirHeld).indexOf(d.k) >= 0;
    const fl = flashK('dir' + d.k, now), lit = on || fl > 0;
    if (lit) { ctx.fillStyle = 'rgba(255,215,94,' + (0.12 + 0.3 * (on ? 1 : fl)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 1.32, 0, Math.PI * 2); ctx.fill(); }   // 光晕=廉价大圆垫底（shadowBlur 全分辨率下太贵）
    ctx.fillStyle = on ? 'rgba(255,215,94,.92)' : (fl > 0 ? 'rgba(255,215,94,' + (0.2 + 0.55 * fl).toFixed(2) + ')' : 'rgba(12,24,40,.72)');
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = lit ? '#ffd75e' : '#bfe8ff'; ctx.lineWidth = 2.5; ctx.stroke();
    const arrow = d.k === 'KeyW' ? '▲' : d.k === 'KeyA' ? '◀' : d.k === 'KeyS' ? '▼' : '▶';
    txt(arrow, d.x, d.y + 10 * s, 28 * s, lit ? '#4a3a00' : '#e8f6ff', { align: 'center', bold: true });
  }
  // 攻击键（=鼠标左键：挖方块/打怪/机枪连发；点击发光）
  const ab = atkBtn(), aOn = Object.keys(atkHeld).length > 0, aFl = flashK('atk', now), aLit = aOn || aFl > 0;
  if (aLit) { ctx.fillStyle = 'rgba(255,140,90,' + (0.12 + 0.3 * (aOn ? 1 : aFl)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(ab.x, ab.y, ab.r * 1.32, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = aOn ? 'rgba(255,140,90,.95)' : (aFl > 0 ? 'rgba(255,120,70,' + (0.3 + 0.55 * aFl).toFixed(2) + ')' : 'rgba(132,30,16,.88)');
  ctx.beginPath(); ctx.arc(ab.x, ab.y, ab.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = aLit ? '#ffb08a' : '#ffd0b0'; ctx.lineWidth = 3; ctx.stroke();
  txt('攻击', ab.x, ab.y + 10 * s, 26 * s, '#ffffff', { align: 'center', bold: true });
  // 技能按钮（跳在巨人态常亮=飞行锁定中；所有键点击后发光）
  for (const b of btnGrid()) {
    const active = b.k === 'Space' ? spaceLatch : Object.values(activeBtn).some(x => x === b);
    const fl = flashK(b.k || b.label, now), lit = active || fl > 0;
    if (lit) { ctx.fillStyle = 'rgba(255,215,94,' + (0.12 + 0.3 * (active ? 1 : fl)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.32, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = active ? 'rgba(255,215,94,.92)' : (fl > 0 ? 'rgba(255,215,94,' + (0.2 + 0.55 * fl).toFixed(2) + ')' : 'rgba(12,24,40,.9)');
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = lit ? '#ffd75e' : '#bfe8ff'; ctx.lineWidth = 3; ctx.stroke();
    txt(b.label, b.x, b.y + 8 * s, 20 * s, lit ? '#4a3a00' : '#ffffff', { align: 'center', bold: true });
  }
  txt('版本' + HUD_VER, W - 12 * s, H - 8 * s, 13 * s, 'rgba(255,255,255,.5)', { align: 'right' });
}

/* ---------- 合成到 WebGL 画布 ----------
 * 架构（真机呈现实测结论）：设备运行时对「同一帧里的第二次 renderer.render」
 * 结果不上屏——天空（第一次调用）可见，HUD（第二次调用）连无贴图纯色块都
 * 不可见，且无任何 GL 错误。故弃用独立 hudScene 二次渲染，把 HUD 面片挂在
 * 主相机下随主渲染调用一起上屏。
 * 贴图：DataTexture 按全尺寸一次性分配，之后每帧只覆写像素（老运行时对
 * 事后改尺寸支持差）；像素更新在 render 之后置 needsUpdate，下一帧生效。 */
let hudData = null, quad = null, hudW = 0, hudH = 0;
function hudFail(e) {
  try {
    if (!G.__hudErrTxt) { G.__hudErrTxt = 1; wx.setStorageSync('__hudErr', 'flush:' + String(e && e.message || e).slice(0, 200)); }
  } catch (_) { }
}
function ensureHudQuad(scene, camera) {
  if (quad) return true;
  const THREE = G.THREE;
  if (!THREE || !scene || !camera) return false;
  quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
  );   // opacity 0：贴图就绪前完全透明，避免首帧白闪
  quad.frustumCulled = false;
  quad.renderOrder = 999;          // 最后画、不测深：永远盖在 3D 画面上
  camera.add(quad);
  if (camera.parent !== scene) scene.add(camera);   // 相机进场景，子节点才会被渲染
  return true;
}
function fitQuad(camera) {
  /* 面片挂在相机前 1 单位，恰好铺满视口。注意 PlaneGeometry(2,2) 半宽半高=1，
     scale 必须填"半尺寸"——此前误填全尺寸导致 HUD 被放大 2 倍，屏幕只显示
     画布中央 1/4（准星在正中可见，四角 UI 全被推出屏外），真机两天看不到按钮即此因 */
  const fov = ((camera.fov || 70) * Math.PI) / 180;
  const e = camera.projectionMatrix.elements;
  const halfH = (e[5] > 0 ? 1 / e[5] : Math.tan(fov / 2));   // 视锥在 z=-1 处的半高（1/f=tan(fov/2)）
  const halfW = halfH * (camera.aspect || ((G.innerWidth || 375) / (G.innerHeight || 667)));
  quad.position.set(0, 0, -1);
  quad.scale.set(halfW, -halfH, 1);   // scale.y 翻转对齐 DataTexture 不翻转
}
/* 纹理只按全尺寸分配一次；之后每帧只往同一块 GPU 纹理刷像素。
   真机（老基础库）对 texImage2D 事后重新指定尺寸支持差 */
/* b52 直传路径：CanvasTexture 让 GL 自己搬画布，跳过 getImageData+整帧拷贝——
   b51 真机帧耗时分解实测 H 段 30-70ms 是最大瓶颈（U 只有 1-3）。黑屏/不刷新 → USE_FAST_TEX 改 false 回老路 */
let hudFast = null;
const USE_FAST_TEX = true;
/* b53 脏标记：内容不变就不重传——走路/转视角时 HUD 完全静止（准星固定屏中央），
   而真机一次全画布上传要 ~100ms（b52 实测搬进 R 段）。DOM 钩子/触摸/2s 心跳置脏 */
let hudDirty = true, lastUploadT = 0;
G.__hudDirty = function () { hudDirty = true; };
function ensureHudTex(w, h) {
  const THREE = G.THREE;
  if (USE_FAST_TEX) {
    if (hudFast && hudW === w && hudH === h) return;
    if (hudFast) { hudFast.dispose(); }
    if (hudData) { hudData.dispose(); hudData = null; }
    hudFast = new THREE.CanvasTexture(hudCanvas);
    hudFast.minFilter = THREE.LinearFilter;
    hudFast.magFilter = THREE.LinearFilter;
    hudFast.generateMipmaps = false;
    hudFast.flipY = false;             // 与 DataTexture 同向：fitQuad 的 -halfH 翻转保持不变
    quad.material.map = hudFast;
    quad.material.opacity = 1;
    quad.material.needsUpdate = true;
    G.__hudPath = 'F';
    hudW = w; hudH = h;
    return;
  }
  G.__hudPath = 'D';
  if (hudData && hudW === w && hudH === h) return;
  if (hudFast) { hudFast.dispose(); hudFast = null; }
  hudData = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat);
  hudData.minFilter = THREE.LinearFilter;
  hudData.magFilter = THREE.LinearFilter;
  hudData.generateMipmaps = false;
  hudData.flipY = false;
  quad.material.map = hudData;
  quad.material.opacity = 1;
  quad.material.needsUpdate = true;
  hudW = w; hudH = h;
}
/* HUD 探针：读 2D 画布状态（呈现自检靠开屏 2.5 秒纯红信号，肉眼可见） */
G.__hudProbe = function (tag) {
  let msg;
  try {
    const W = hudCanvas.width, H = hudCanvas.height;
    const img = ctx.getImageData(0, 0, W, H);
    let a = 0, n = 0;
    const step = Math.max(2, Math.round(W / 40)) * 4;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { a += img.data[(y * W + x) * 4 + 3]; n++; }
    msg = '帧=' + (G.__flushN || 0) + ' α均=' + Math.round(a / (n || 1))
      + ' tex=' + hudW + 'x' + hudH
      + (segErrs.length ? ' 段错:' + segErrs.join(' | ').slice(0, 100) : ' 段错:无');
    if (tag === '游戏内') {
      const zone = (x0, y0, x1, y1) => {
        let s2 = 0, c2 = 0;
        for (let y = y0; y < y1; y += 4) for (let x = x0; x < x1; x += 4) { s2 += img.data[(y * W + x) * 4 + 3]; c2++; }
        return Math.round(s2 / (c2 || 1));
      };
      msg += ' | 血条区=' + zone(20, 20, 400, 130)
        + ' 按钮区=' + zone(W - 300, H - 300, W - 10, H - 20)
        + ' 快捷栏区=' + zone(W / 2 - 250, H - 110, W / 2 + 250, H - 10);
    }
  } catch (e) { msg = '探测失败:' + String(e && e.message || e).slice(0, 140); }
  try { wx.showModal({ title: 'HUD探测' + (tag ? '·' + tag : ''), content: msg, showCancel: false }); } catch (_) { }
};
G.hudFlush = function (renderer, scene, camera) {
  try {
    G.__flushN = (G.__flushN || 0) + 1;
    if (!ensureHudQuad(scene, camera)) return;
    const mc = adapter.mainCanvas;
    /* 保险：个别真机上屏画布 width/height 可能读到 0，退回窗口尺寸×像素比 */
    const fbW = Math.round((G.innerWidth || 375) * (G.devicePixelRatio || 2));
    const fbH = Math.round((G.innerHeight || 667) * (G.devicePixelRatio || 2));
    const tw = mc.width || fbW, th = mc.height || fbH;   // 全分辨率（0.5 倍方案被用户否决：文字太糊，清晰优先）
    if (hudCanvas.width !== tw || hudCanvas.height !== th) {
      hudCanvas.width = tw; hudCanvas.height = th;
    }
    /* 上传时机（b53 脏标记，取代 b50 的隔帧方案）：有脏标记 / 按钮闪光淡出动画中（内容逐帧变）
       / 2s 心跳兜底漏标钩子。走路+转视角时 HUD 内容零变化 → 零上传，R 段回归纯渲染 */
    const nowT = Date.now();
    if (G.__plat === 'devtools' || hudDirty || btnFlash.size > 0 || nowT - lastUploadT > 2000) {
      drawHUD();
      ensureHudTex(hudCanvas.width, hudCanvas.height);
      if (hudFast) { hudFast.needsUpdate = true; }   // 直传：GL 层自己读画布，不走 CPU
      else {
        const img = ctx.getImageData(0, 0, hudCanvas.width, hudCanvas.height);
        hudData.image.data.set(img.data);   // 同尺寸覆写，不重新指定纹理大小
        hudData.needsUpdate = true;
      }
      hudDirty = false; lastUploadT = nowT;
      if (btnFlash.size > 0) hudDirty = true;   // 闪光淡出期间内容逐帧变：本帧画完下一帧还要再传
    }
    fitQuad(camera);
  } catch (e) { hudFail(e); }
};

G.__touch = { start: touchStart, move: touchMove, end: touchEnd };
module.exports = {};
