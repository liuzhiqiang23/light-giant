/* =========================================================
 * 光之巨人 · 小游戏适配层（adapter）
 * 在小游戏环境模拟浏览器 DOM/BOM 面：
 *  - 元素全部是"状态存根"：游戏代码照常读写 textContent/style，
 *    真正把它们画出来的是 hud.js（2D 画布 → 合成到 WebGL 画布）
 *  - 真画布只有一块：首次 wx.createCanvas() = 上屏画布，交给游戏当 #c
 *  - 输入：devtools 键盘走 wx.onKeyDown（game.js 接线），
 *    触屏由 hud.js 做虚拟摇杆/按钮，再合成 keydown/mousedown 事件回灌游戏
 * ========================================================= */
const G = GameGlobal;

/* ---- 主画布：必须最先调用（小游戏约定：首次 createCanvas 为上屏画布） ---- */
const mainCanvas = wx.createCanvas();
/* 真机 WebGL1：先把上下文建好，直接传给 three（不劫持 getContext，排除呈现层干扰） */
try {
  const glAttrs = { antialias: false, alpha: false };   // 不透明画布：对运行时合成器最友好
  GameGlobal.__glCtx = mainCanvas.getContext('webgl', glAttrs) || mainCanvas.getContext('experimental-webgl', glAttrs);
} catch (e) { }
mainCanvas.addEventListener = function (type, fn) {
  (this._listeners = this._listeners || {})[type] = this._listeners[type] || [];
  this._listeners[type].push(fn);
};
mainCanvas.requestPointerLock = function () {
  adapter.fakeLock = true;
  adapter.fireDoc('pointerlockchange');
};

/* ---- 元素存根 ---- */
const elMap = new Map();
function parseCss(s) {
  const o = {};
  String(s || '').split(';').forEach(p => {
    const i = p.indexOf(':');
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}
function makeEl(tag, id) {
  const style = {};
  let cssText = '';
  let _textContent = '', _innerHTML = '';
  const el = {
    tagName: String(tag).toUpperCase(), id: id || '', children: [],
    _listeners: {},
    classList: {
      _s: new Set(),
      add(...n) { n.forEach(x => this._s.add(x)); },
      remove(...n) { n.forEach(x => this._s.delete(x)); },
      toggle(n, force) {
        const on = force === undefined ? !this._s.has(n) : !!force;
        on ? this._s.add(n) : this._s.delete(n);
        return on;
      },
      contains(n) { return this._s.has(n); }
    },
    addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { const a = el._listeners[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    click() { (el._listeners.click || []).forEach(fn => fn({ target: el, preventDefault() { } })); },
    appendChild(c) { el.children.push(c); return c; },
    getContext(type) { return null; }          // div 存根不会被取 2d 上下文
  };
  /* b53 HUD 脏标记：游戏代码任何 textContent/innerHTML/style 写入 → HUD 需要重传。
     存根元素正是 drawHUD 的唯一数据源，这里挂钩=全量覆盖（掉血/提示/时钟/圣域/蓄力条…） */
  Object.defineProperty(el, 'textContent', {
    get() { return _textContent; },
    set(v) { if (_textContent !== v) { _textContent = v; GameGlobal.__hudDirty && GameGlobal.__hudDirty(); } }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return _innerHTML; },
    set(v) { if (_innerHTML !== v) { _innerHTML = v; GameGlobal.__hudDirty && GameGlobal.__hudDirty(); } }
  });
  Object.defineProperty(el, 'className', {
    get() { return [...el.classList._s].join(' '); },
    set(v) { el.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  const styleProxy = new Proxy(style, {
    set(o, k, v) { if (o[k] !== v) { o[k] = v; GameGlobal.__hudDirty && GameGlobal.__hudDirty(); } return true; }
  });
  Object.defineProperty(el, 'style', {
    get() { return styleProxy; }
  });
  style.cssText = '';
  Object.defineProperty(style, 'cssText', {
    get() { return cssText; },
    set(v) { cssText = String(v); Object.assign(style, parseCss(v)); }
  });
  if (tag === 'canvas') {
    // 保险：正常流程 createElement('canvas') 已单独处理，走不到这里
    const cv = wx.createCanvas();
    cv.cloneNode = function () { const c = wx.createCanvas(); c.width = this.width; c.height = this.height; return c; };
    return cv;
  }
  return el;
}

/* HTML 初始内容（对应 H5 版 <body> 里的静态标记） */
const SEED = {
  cross: '+',
  hpNum: '20/20',
  energyTxt: '能量 0/6（击败怪兽充能）',
  weaponTxt: '👊 拳模式（按 G 换机枪）',
  sanctTip: '✦ 圣域庇护 · 怪兽不敢踏足神殿 ✦',
  bossArrow: '▲',
  hint: '左键 破坏/攻击 · 右键 放置 · G 机枪 · T 变身 · F 能量炮/长按激光 · V 飞踢 · R 拳击 · B 巨大化 · M 静音',
  pauseTip: '⏸ 已暂停\n点击画面继续冒险'
};
/* CSS 初始 display（对应 H5 版样式表） */
const SEED_DISPLAY = {
  transTimer: 'none', sanctTip: 'none', pauseTip: 'none', bossDir: 'none',
  chargeBar: 'none', death: 'none', start: 'flex', btnReset: 'none'
};

const documentShim = {
  body: null, // 下面赋值（避免引用未初始化的 makeEl）
  addEventListener(type, fn) { (docL[type] = docL[type] || []).push(fn); },
  createElement(tag) {
    if (String(tag).toLowerCase() === 'canvas') {
      const cv = wx.createCanvas();                    // 离屏画布（主画布已在最前创建）
      cv.cloneNode = function () { const c = wx.createCanvas(); c.width = this.width; c.height = this.height; return c; };
      return cv;
    }
    return makeEl(tag);
  },
  getElementById(id) {
    if (id === 'c') return mainCanvas;
    if (!elMap.has(id)) {
      const el = makeEl('div', id);
      if (SEED[id]) el.textContent = SEED[id];
      if (SEED_DISPLAY[id] !== undefined) el.style.display = SEED_DISPLAY[id];
      elMap.set(id, el);
    }
    return elMap.get(id);
  },
  exitPointerLock() { adapter.fakeLock = false; adapter.fireDoc('pointerlockchange'); }
};
documentShim.body = makeEl('body');
Object.defineProperty(documentShim, 'pointerLockElement', {
  get() { return adapter.fakeLock ? mainCanvas : null; }
});
const docL = {};

/* ---- window 面 ----
 * 目标全局对象：真沙箱 globalThis 优先，GameGlobal / window 兜底（三者可能不同）。
 * 开发者工具某些上下文里 window/document/location/localStorage 是只读或平台残缺桩：
 * 挂载顺序 = 直接赋值 → defineProperty → 都失败就把垫片方法混入既有对象。 */
const GLOBALS = [];
try { if (globalThis) GLOBALS.push(globalThis); } catch (e) { }
try { if (GameGlobal && GLOBALS.indexOf(GameGlobal) < 0) GLOBALS.push(GameGlobal); } catch (e) { }
try { if (typeof window !== 'undefined' && window && GLOBALS.indexOf(window) < 0) GLOBALS.push(window); } catch (e) { }

function setGlobal(key, val, defineFirst) {
  for (const O of GLOBALS) {
    const assign = () => { try { O[key] = val; return true; } catch (e) { return false; } };
    const define = () => { try { Object.defineProperty(O, key, { value: val, configurable: true, writable: true }); return true; } catch (e) { return false; } };
    if (defineFirst ? (define() || assign()) : (assign() || define())) return true;
  }
  /* 不可覆写（如平台残缺 document 桩）：把垫片的公开方法混进去 */
  try {
    for (const O of GLOBALS) {
      const cur = O[key];
      if (cur && (typeof cur === 'object' || typeof cur === 'function') && cur !== val) {
        for (const k of Object.keys(val)) { try { cur[k] = val[k]; } catch (e) { } }
        return true;
      }
    }
  } catch (e) { }
  return false;
}
const winL = {};
setGlobal('addEventListener', function (type, fn) { (winL[type] = winL[type] || []).push(fn); });
setGlobal('removeEventListener', function (type, fn) { const a = winL[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); });
setGlobal('location', {                                        // location 不能直接赋值（对真实 window 赋值=页面跳转）
  reload() { try { wx.exitMiniProgram(); } catch (e) { } }     // 小游戏无法刷新 JS：退出重进即新世界
}, true);
const audioCtor = function () {
  try { return wx.createWebAudioContext(); } catch (e) { return null; }
};
setGlobal('AudioContext', audioCtor);
setGlobal('webkitAudioContext', audioCtor);
/* 真机小游戏无 performance 全局（H5 浏览器才有）：给个毫秒兜底，
   只用于连段计时/主循环初值，dt 有钳制，时钟基线无所谓 */
if (typeof performance === 'undefined' || !performance.now) {
  const __pt0 = Date.now();
  setGlobal('performance', { now: () => Date.now() - __pt0 });
}
setGlobal('localStorage', {
  getItem(k) { try { const v = wx.getStorageSync(k); return v === '' ? null : v; } catch (e) { return null; } },
  setItem(k, v) { try { wx.setStorageSync(k, String(v)); } catch (e) { } },
  removeItem(k) { try { wx.removeStorageSync(k); } catch (e) { } }
});
setGlobal('window', G);   // 失败也无妨：裸 window 本来就有完整 BOM（AudioContext 等已单独挂）

/* ---- 事件回灌（hud.js / game.js 用） ---- */
setGlobal('__key', function (code, key, down) {
  const ev = { code, key: key || code, repeat: false, preventDefault() { } };
  (winL[down ? 'keydown' : 'keyup'] || []).slice().forEach(fn => { try { fn(ev); } catch (e) { } });
});
setGlobal('__mouse', function (type, ev) {
  (winL[type] || []).slice().forEach(fn => { try { fn(ev); } catch (e) { } });
});
setGlobal('__canvasClick', function () {
  const ls = (mainCanvas._listeners && mainCanvas._listeners.click) || [];
  ls.slice().forEach(fn => { try { fn({}); } catch (e) { } });
});
setGlobal('__setGlobal', setGlobal);

const adapter = {
  mainCanvas, document: documentShim, setGlobal,
  fakeLock: false,
  fireDoc(type) { (docL[type] || []).slice().forEach(fn => { try { fn({}); } catch (e) { } }); }
};
setGlobal('__doc', documentShim);
setGlobal('__DOC', documentShim);   // game-code 内部用 DOC 引用垫片（平台 document 桩冻结不可用）
setGlobal('__adapter', adapter);
setGlobal('document', documentShim);   // 游戏代码裸用 document
/* document 专判：若最终存活的是平台残缺桩（被混入了我们的方法），还要补指针锁存取器 */
try {
  for (const O of GLOBALS) {
    const d = O.document;
    if (d && d !== documentShim && typeof d.getElementById === 'function') {
      if (!('pointerLockElement' in d)) {
        Object.defineProperty(d, 'pointerLockElement', {
          get() { return adapter.fakeLock ? mainCanvas : null; }, configurable: true
        });
      }
      break;
    }
  }
} catch (e) { }
module.exports = adapter;
