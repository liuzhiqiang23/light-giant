/* =========================================================
 * 光之巨人 · 方块世界 —— 微信小游戏入口
 * 顺序敏感：先建适配层（主画布必须首次 createCanvas），
 * 再注入全局环境，然后加载 three，最后跑游戏本体。
 * 真机诊断：fatal 放最前，所有加载都包进监控——
 * 崩在哪里手机上直接弹窗，不让用户对着启动页干等。
 * ========================================================= */
GameGlobal.__err = '';
function fatal(msg) {
  const t = String(msg && msg.stack || msg && msg.message || msg).slice(0, 480);
  try { wx.setStorageSync('__bootErr', t); } catch (_) { }
  try { wx.showModal({ title: '启动报错·请拍照发我', content: t, showCancel: false }); } catch (_) { }
}
GameGlobal.__fatal = fatal;
if (wx.onError) wx.onError(msg => { GameGlobal.__err = String(msg).slice(0, 400); fatal(msg); });
if (wx.onUnhandledRejection) wx.onUnhandledRejection(r => { GameGlobal.__err = String(r && r.reason).slice(0, 400); fatal(r && (r.reason && (r.reason.stack || r.reason.message) || r.reason)); });
try {
  const last = wx.getStorageSync('__bootErr');
  if (last) wx.showModal({ title: '上次启动报错', content: String(last).slice(0, 480), showCancel: false });
} catch (e) { }

try {
  const { setGlobal } = require('./adapter.js');
  require('./hud.js');

  /* jsbridge 未就绪时 getSystemInfoSync 会抛错：兜底默认值 */
  let sys = {};
  try { sys = wx.getSystemInfoSync() || {}; } catch (e) { }
  GameGlobal.__plat = sys.platform || '';   // 'devtools' | 'ios' | 'android'：HUD 合成分流用
  /* 诊断提示必须进世界后再弹：512 世界生成超过 3s，启动期定时弹会被 showLoading 遮罩整个吃掉（b46 用户只见「首帧OK」） */
  GameGlobal.__diagShown = 0;
  GameGlobal.__diag = () => {
    if (GameGlobal.__diagShown) return;
    GameGlobal.__diagShown = 1;
    setTimeout(() => {
      try {
        const gi = GameGlobal.__glInfo || {};
        const he = wx.getStorageSync('__hudErr');
        const cap = (GameGlobal.__audioCap || '?').replace(/^音:/, '');   // audioCap 自带"音:"前缀，别再拼一个（b49 真机显示"音:音:"）
        const qn = '画质' + (GameGlobal.__qStep || 0)
          + ' U' + Math.round(GameGlobal.__msUp || 0) + '/R' + Math.round(GameGlobal.__msRd || 0) + '/H' + Math.round(GameGlobal.__msHud || 0);
        const base = 'GL:' + (gi.v || gi.err || '?').slice(0, 26) + ' ANGLE:' + (gi.angle ? 'Y' : 'N') + (he ? ' HUDERR' : '') + ' ' + (GameGlobal.__plat || '?') + ' 音:' + cap + ' ' + qn + ' 帧' + (GameGlobal.__flushN || 0);
        if (GameGlobal.__err) wx.showModal({ title: '运行报错·拍照发我', content: GameGlobal.__err + '\n—' + base, showCancel: false });
        else wx.showToast({ title: '音:' + cap + ' ' + qn + (GameGlobal.__hudPath || ''), icon: 'none', duration: 10000 });   // 尾字母 F=CanvasTexture直传 / D=老DataTexture（b52）
      } catch (e) { }
    }, 3000);
  };
  setTimeout(() => { GameGlobal.__diag(); }, 20000);   // 兜底：一直停在菜单不进世界也报一次
  setGlobal('innerWidth', sys.windowWidth || sys.screenWidth || 375);
  setGlobal('innerHeight', sys.windowHeight || sys.screenHeight || 667);
  setGlobal('devicePixelRatio', sys.pixelRatio || 2);
  setGlobal('document', GameGlobal.__doc);
  setGlobal('THREE', require('./libs/three.min.js'));

  /* 触屏 → 虚拟摇杆/按钮/视角 */
  wx.onTouchStart(e => { for (const t of e.touches) GameGlobal.__touch.start(t.clientX, t.clientY, t.identifier); });
  wx.onTouchMove(e => { for (const t of e.changedTouches) GameGlobal.__touch.move(t.clientX, t.clientY, t.identifier); });
  wx.onTouchEnd(e => { for (const t of e.changedTouches) GameGlobal.__touch.end(t.clientX, t.clientY, t.identifier); });
  wx.onTouchCancel(e => { for (const t of e.changedTouches) GameGlobal.__touch.end(t.clientX, t.clientY, t.identifier); });

  /* 开发者工具键盘调试（真机无） */
  if (wx.onKeyDown) wx.onKeyDown(e => GameGlobal.__key(e.code || e.key, e.key, true));
  if (wx.onKeyUp) wx.onKeyUp(e => GameGlobal.__key(e.code || e.key, e.key, false));

  /* 游戏本体（内部会 requestAnimationFrame(frame) 起主循环） */
  GameGlobal.__stage = s => { try { wx.showLoading({ title: String(s).slice(0, 30), mask: true }); } catch (_) { } };
  GameGlobal.__stage('0/4 进入游戏代码…');
  require('./game-code.js');
  if (wx.onHide) wx.onHide(() => { try { GameGlobal.__saveNow && GameGlobal.__saveNow(); } catch (e) { } });   // 切后台立即存档（补上 20s 定时器覆盖不到的空隙）
  try { wx.hideLoading(); } catch (_) { }

  /* 演示/截图钩子：开发者工具「编译模式下拉 → 添加编译模式 → 启动参数」可传 demo=night / demo=giant */
  try {
    const q = (wx.getLaunchOptionsSync && wx.getLaunchOptionsSync().query) || {};
    if (q.demo) setTimeout(() => {
      try {
        const g = GameGlobal.__game;
        if (!g) return;
        if (q.demo === 'night') { g.setPaused && g.setPaused(false); g.setDay(1, 130); }        // 直接入夜（dayT>120）
        if (q.demo === 'giant') { g.player.energy = 6; g.tryTransform(); }                     // 满能量变身
        if (q.demo === 'both') { g.setPaused && g.setPaused(false); g.setDay(1, 130); g.player.energy = 6; g.tryTransform(); }
      } catch (e) { }
    }, 2500);
  } catch (e) { }
} catch (e) { fatal(e && (e.stack || e.message) || e); throw e; }
