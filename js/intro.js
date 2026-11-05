/*
 * Hero scene and opening.
 *
 * One image, one coordinate system. A "camera" is { s, tx, ty }: an image
 * point p appears on screen at (s * p.x + tx, s * p.y + ty) inside the stage.
 * The opening starts with the camera close to an even patch of moon surface
 * and pulls straight back to the final framing. Only transform and opacity
 * are animated (Web Animations API, so it runs on the compositor).
 *
 * When WebGL2 is available the hero is a real 3D scene instead
 * (js/space.js: procedural moon, star field, the figures as billboards) and
 * this file only drives it; the painting and its DOM camera stay in the page
 * as the fallback (no WebGL2, shader/texture failure, slow start, lost context).
 *
 * Timeline (ms from start):
 *   200–620   logo + name appear (small → full size, one light settle)
 *   620–2200  hold
 *   2200–2600 logo + name leave
 *   2400–5600 camera pulls back (DOM fallback: 2400–5200)
 *   end       settled: header, scroll hint (and DOM star glints) fade in
 */
(function () {
  'use strict';

  var SCENE = window.SCENE;
  var root = document.documentElement;
  var hero = document.getElementById('top');
  var stage = document.getElementById('stage');
  var sceneImg = document.getElementById('cam-scene');
  var detailImg = document.getElementById('cam-detail');
  var grain = document.getElementById('grain');
  var mark = document.getElementById('intro-mark');
  var logo = document.getElementById('intro-logo');
  var skipBtn = document.getElementById('skip');
  var header = document.getElementById('site-header');
  var hint = document.getElementById('scroll-hint');
  var sky = document.getElementById('sky');
  var glints = document.getElementById('glints');
  if (!SCENE || !hero || !stage || !sceneImg) return;

  var T = { pop: 200, popDur: 420, out: 2200, outDur: 400, zoom: 2400, zoomDur: 2800, glZoomDur: 3200 };
  var STORE_KEY = 'ysl.intro.seen';
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  var mode = root.classList.contains('intro') ? 'intro' : 'settled';
  var size = { w: 0, h: 0 };
  var startCam = null;
  var finalCam = null;
  var t0 = 0;
  var sceneOK = null;   // null = loading, true = decoded, false = failed
  var detailOK = false;
  var sceneShown = false;
  var zoomAnims = [];
  var markAnims = [];
  var timers = [];

  // short event log, readable as window.__intro.trace (for checks)
  var traceLog = [];
  function trace(m) { traceLog.push(Math.round(performance.now()) + ' ' + m); }

  /* ---------- WebGL scene (js/space.js) ---------- */

  var SS = window.SpaceScene;
  var space = null;          // the 3D scene, while it is in use
  var glReady = false;       // shaders, textures and first frame done
  var glShown = false;       // canvas visible
  var GL_SETTLED_TIMEOUT = 6500;
  var glZoomAt = 0;          // when the 3D pull-back starts (timeline clock)
  // ?capture=1 (frame-stepped recording): wait for the scene instead of timing
  // out, since a virtual clock can run far ahead of shader compilation
  var CAPTURE = /[?&]capture=1(&|$)/.test(location.search);

  function glStart() {
    if (!SS || !SS.supported || !SS.supported()) { root.classList.remove('gl'); return false; }
    try {
      space = SS.create(stage, {
        figuresUrl: 'assets/scene/figures/figures.json',
        reducedMotion: reduceMQ.matches,
        manualReveal: true,
        onLost: function () { glFallback('lost'); }
      });
    } catch (e) { space = null; }
    if (!space) { root.classList.remove('gl'); return false; }
    root.classList.add('gl');
    space.ready.then(function () { if (space) { glReady = true; trace('gl ready'); } }, function (err) {
      trace('gl failed ' + (err && err.message ? err.message.split('\n')[0] : ''));
      glFallback('error');
    });
    return true;
  }

  function glReveal(fade) {
    if (!space || glShown) return;
    glShown = true;
    var c = space.canvas;
    if (fade) {
      c.style.transition = 'opacity 450ms ease-out';
      requestAnimationFrame(function () { c.style.opacity = '1'; });
    } else {
      c.style.opacity = '1';
    }
  }

  // Back to the painting: the DOM camera takes over from wherever we are.
  function glFallback(why) {
    if (!space) return;
    trace('gl fallback: ' + why);
    var s = space;
    space = null; glReady = false; glShown = false;
    try { s.destroy(); } catch (e) { /* ignore */ }
    root.classList.remove('gl');
    // the logo may be held longer while waiting for the scene: let it go now
    var outA = markAnims[1];
    if (outA && outA.startTime > now()) outA.startTime = Math.max(t0 + T.out, now());
    if (mode === 'intro' && glZoomAt && now() >= glZoomAt - 50) {
      // the 3D pull-back was under way: show the painting at its final framing
      measure();
      finalCam = frameFinal(size.w, size.h);
      applyCam(finalCam);
      imgReady(sceneImg).then(function (ok) {
        sceneOK = ok;
        if (!ok) { failScene(); return; }
        showScene(false);
        sceneImg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease-out' });
        placeSky();
      });
      settle();
    } else if (mode === 'intro') {
      if (t0) domAfterMark(true);
    } else {
      measure();
      finalCam = frameFinal(size.w, size.h);
      applyCam(finalCam);
      imgReady(sceneImg).then(function (ok) {
        sceneOK = ok;
        if (ok) { showScene(false); placeSky(); } else failScene();
      });
      if (mode === 'hurry') settle();
    }
  }

  // run fn once the scene is ready; fall back to the painting after `ms`
  function glWhenReady(ms, fn) {
    if (!space) return;
    if (glReady) { fn(); return; }
    var s = space;
    var tm = CAPTURE ? 0 : setTimeout(function () { if (space === s && !glReady) glFallback('timeout'); }, ms);
    s.ready.then(function () { clearTimeout(tm); if (space === s) fn(); }, function () { clearTimeout(tm); });
  }

  /* ---------- geometry ---------- */

  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }

  function measure() {
    size.w = stage.clientWidth || window.innerWidth;
    size.h = stage.clientHeight || window.innerHeight;
  }

  // Final framing: the whole composition fits between the header and the
  // scroll hint. On 16:9 screens this is close to the original image framing;
  // narrow screens shrink it so the scarf, tree and moon all stay in view.
  function frameFinal(w, h) {
    var c = SCENE.content, img = SCENE.image;
    var bw = c.x1 - c.x0, bh = c.y1 - c.y0;
    var narrow = w < 640;
    var padX = narrow ? 12 : Math.max(28, w * 0.04);
    var short = h < 520; // landscape phones: header and hint get less room
    var padT = short ? 58 : Math.max(narrow ? 64 : 72, h * 0.075);
    var padB = short ? 62 : Math.max(narrow ? 76 : 84, h * 0.085);
    var cover = Math.max(w / img.width, h / img.height);
    var s = Math.min((w - 2 * padX) / bw, (h - padT - padB) / bh, cover);

    // horizontal: keep the image centre where the original puts it, unless
    // that would push the scarf or the tree out of frame
    var fx = clamp(img.width / 2, c.x1 - (w / 2 - padX) / s, c.x0 + (w / 2 - padX) / s);

    // vertical: centre the composition in the band between header and hint,
    // lifted slightly when there is a lot of empty sky (tall phones)
    var band = h - padT - padB;
    var slack = band - bh * s;
    var mid = padT + band / 2 - Math.min(slack * 0.18, h * 0.035);
    var fy = (c.y0 + c.y1) / 2 - (mid - h / 2) / s;

    return { s: s, tx: w / 2 - s * fx, ty: h / 2 - s * fy };
  }

  // Opening close-up: the same number of image pixels from the centre to any
  // corner, so the view stays inside the moon on every aspect ratio.
  function frameStart(w, h) {
    var st = SCENE.start;
    var f = st.portrait && h / w >= st.portrait.minAspect ? st.portrait.focus : st.focus;
    var s = Math.hypot(w, h) / 2 / st.radius;
    return { s: s, tx: w / 2 - s * f[0], ty: h / 2 - s * f[1] };
  }

  // Straight pull-back between two cameras: one image point stays put on
  // screen, like a camera moving back along a line. Scale is interpolated in
  // s^-0.5 — between "even zoom speed" (log) and "even camera distance"
  // (1/s) — so the moment the rim, the sky and the characters come into
  // view gets more time than the featureless close-up.
  var PACE = 0.5;

  function path(a, b) {
    var ds = a.s - b.s;
    if (Math.abs(ds) < 1e-6) {
      return function (e) {
        return { s: a.s, tx: a.tx + (b.tx - a.tx) * e, ty: a.ty + (b.ty - a.ty) * e };
      };
    }
    var px = (b.tx - a.tx) / ds, py = (b.ty - a.ty) / ds;
    var sx = a.s * px + a.tx, sy = a.s * py + a.ty;
    var qa = Math.pow(a.s, -PACE), qb = Math.pow(b.s, -PACE);
    return function (e) {
      var s = Math.pow(qa + (qb - qa) * e, -1 / PACE);
      return { s: s, tx: sx - s * px, ty: sy - s * py };
    };
  }

  // Velocity profile: smooth (cosine) acceleration over the first `a` of the
  // time, steady speed, then a long smooth deceleration over the last `b`.
  function cruise(a, b) {
    var v = 1 / (1 - a / 2 - b / 2);
    var mid = 1 - a - b;
    return function (u) {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      if (u < a) return v * (u / 2 - (a / (2 * Math.PI)) * Math.sin(Math.PI * u / a));
      var e = v * a / 2;
      if (u < a + mid) return e + v * (u - a);
      var x = u - a - mid;
      return e + v * mid + v * (x / 2 + (b / (2 * Math.PI)) * Math.sin(Math.PI * x / b));
    };
  }

  // cubic-bezier easing evaluated in JS (used to sample keyframes)
  function bezier(x1, y1, x2, y2) {
    function a(p1, p2) { return 1 - 3 * p2 + 3 * p1; }
    function b(p1, p2) { return 3 * p2 - 6 * p1; }
    function c(p1) { return 3 * p1; }
    function calc(t, p1, p2) { return ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t; }
    function slope(t, p1, p2) { return 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1); }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) {
        var d = slope(t, x1, x2);
        if (Math.abs(d) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / d;
      }
      t = clamp(t, 0, 1);
      return calc(t, y1, y2);
    };
  }

  var easeZoom = cruise(0.16, 0.45);          // gentle start, long soft landing
  var easeHurry = bezier(0.32, 0.12, 0.2, 1);   // quick, but eases out of a standstill

  function sceneTf(c) {
    return 'translate3d(' + c.tx.toFixed(3) + 'px,' + c.ty.toFixed(3) + 'px,0) scale(' + c.s.toFixed(6) + ')';
  }

  function detailTf(c) {
    var d = SCENE.detail, k = d.size / d.px;
    return 'translate3d(' + (c.tx + c.s * d.x).toFixed(3) + 'px,' + (c.ty + c.s * d.y).toFixed(3) + 'px,0) scale(' + (c.s * k).toFixed(6) + ')';
  }

  function smooth(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // The detail tile stays opaque while every visible point is inside its
  // solid core, and fades out as its feathered edge comes into view.
  function detailOpacity(c) {
    var d = SCENE.detail, far = 0;
    [[0, 0], [size.w, 0], [0, size.h], [size.w, size.h]].forEach(function (p) {
      var ix = (p[0] - c.tx) / c.s, iy = (p[1] - c.ty) / c.s;
      far = Math.max(far, Math.hypot(ix - d.cx, iy - d.cy));
    });
    return 1 - smooth(d.solid - 8, d.solid + 26, far);
  }

  function applyCam(c) {
    sceneImg.style.transform = sceneTf(c);
    if (detailImg) detailImg.style.transform = detailTf(c);
  }

  function readCam() {
    var m = getComputedStyle(sceneImg).transform;
    if (!m || m === 'none') return startCam;
    var v = m.match(/matrix(3d)?\(([^)]+)\)/);
    if (!v) return startCam;
    var n = v[2].split(',').map(parseFloat);
    if (v[1]) return { s: n[0], tx: n[12], ty: n[13] };
    return { s: n[0], tx: n[4], ty: n[5] };
  }

  /* ---------- loading ---------- */

  function imgReady(img) {
    return new Promise(function (resolve) {
      if (!img || !img.getAttribute('src')) return resolve(false);
      var done = function (ok) { resolve(ok); };
      if (img.complete) {
        if (img.naturalWidth > 0) {
          (img.decode ? img.decode() : Promise.resolve()).then(function () { done(true); }, function () { done(img.naturalWidth > 0); });
        } else done(false);
        return;
      }
      img.addEventListener('load', function () {
        (img.decode ? img.decode() : Promise.resolve()).then(function () { done(true); }, function () { done(true); });
      }, { once: true });
      img.addEventListener('error', function () { done(false); }, { once: true });
    });
  }

  function wait(ms) { return new Promise(function (r) { timers.push(setTimeout(r, ms)); }); }

  function showScene(fade) {
    if (sceneShown) return;
    sceneShown = true;
    root.classList.add('scene-ready');
    // The image covers the whole stage from here on, so the cream backdrop
    // (only there for the moment before the image is decoded) can go.
    if (fade && mode === 'intro') {
      var f = sceneImg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: 'ease-out' });
      f.onfinish = function () { hero.classList.add('is-space'); };
    } else {
      hero.classList.add('is-space');
    }
  }

  function failScene() {
    sceneOK = false;
    if (space) return; // only the fallback image failed; the 3D scene carries on
    root.classList.add('no-scene');
    if (mode === 'intro') hurry('scene-failed');
  }

  /* ---------- intro ---------- */

  function now() { return document.timeline ? document.timeline.currentTime : performance.now(); }

  function startMark() {
    var pop = mark.animate([
      { opacity: 0, transform: 'scale(0.84)', easing: 'cubic-bezier(.2,.75,.3,1)' },
      { opacity: 1, offset: 0.4 },
      { transform: 'scale(1.025)', offset: 0.62, easing: 'cubic-bezier(.45,0,.55,1)' },
      { opacity: 1, transform: 'scale(1)' }
    ], { duration: T.popDur, fill: 'both' });
    pop.startTime = t0 + T.pop;

    var out = mark.animate([
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.955)' }
    ], { duration: T.outDur, easing: 'cubic-bezier(.45,0,.8,.4)', fill: 'forwards' });
    out.startTime = t0 + T.out;

    markAnims = [pop, out];
  }

  function startZoom(at) {
    trace('zoom at +' + Math.round(at - t0));
    var p = path(startCam, finalCam);
    var n = 90, sceneKF = [], detailKF = [];
    for (var i = 0; i <= n; i++) {
      var u = i / n, c = p(easeZoom(u));
      sceneKF.push({ offset: u, transform: sceneTf(c) });
      if (detailOK) detailKF.push({ offset: u, transform: detailTf(c), opacity: detailOpacity(c) });
    }
    var opts = { duration: T.zoomDur, fill: 'both', easing: 'linear' };
    var a = sceneImg.animate(sceneKF, opts);
    a.startTime = at;
    zoomAnims = [a];
    if (detailOK) {
      var d = detailImg.animate(detailKF, opts);
      d.startTime = at;
      zoomAnims.push(d);
    }
    if (grain) {
      var g0 = parseFloat(getComputedStyle(grain).opacity) || 0;
      var g = grain.animate([{ opacity: g0 }, { opacity: 0 }], { duration: 650, easing: 'ease-in', fill: 'forwards' });
      g.startTime = at;
      zoomAnims.push(g);
    }
    // the cream backdrop is covered by the image from here on
    timers.push(setTimeout(function () { hero.classList.add('is-space'); }, Math.max(0, at - now())));
    a.onfinish = function () { if (mode === 'intro') settle(); };
  }

  function runIntro() {
    try { sessionStorage.setItem(STORE_KEY, '1'); } catch (e) { /* private mode */ }

    measure();
    startCam = frameStart(size.w, size.h);
    finalCam = frameFinal(size.w, size.h);
    applyCam(startCam);
    if (!space && detailImg && detailImg.dataset.src) detailImg.src = detailImg.dataset.src;

    var sceneP = imgReady(sceneImg).then(function (ok) { sceneOK = ok; return ok; });
    var detailP = imgReady(detailImg).then(function (ok) { detailOK = ok; return ok; });
    var fontP = document.fonts && document.fonts.load ? document.fonts.load('500 20px Inter').catch(function () {}) : Promise.resolve();
    var logoP = imgReady(logo);

    // Start once the logo and font are ready (short cap), never waiting on
    // anything below the hero.
    var sceneWait = space ? space.ready.catch(function () {}) : sceneP;
    var started = Promise.all([logoP, fontP, sceneWait]);
    (space && CAPTURE ? started : Promise.race([started, wait(900)])).then(function () {
      if (mode !== 'intro') return;
      if (space) {
        if (glReady) glReveal(false);
        t0 = now() + 32;
        startMark();
        glSchedule();
        return;
      }
      if (sceneOK === false) { failScene(); return; }
      if (sceneOK) {
        showScene(false);
        if (detailOK) detailImg.classList.add('is-on');
      }
      t0 = now() + 32;
      startMark();
      domAfterMark(false);
    });

    bindHurry();
  }

  // 3D opening: the close-up is held behind the logo, then the camera pulls back.
  // If the scene is not ready shortly after the pull-back should start, the
  // painting takes over.
  function glSchedule() {
    var s = space, extended = false, out = markAnims[1];
    // not ready shortly before the logo leaves: hold it up to 1 s longer
    timers.push(setTimeout(function () {
      if (space === s && !glReady && mode === 'intro' && out) {
        out.startTime = t0 + T.out + 1000;
        extended = true;
        trace('hold extended');
      }
    }, Math.max(0, t0 + T.out - 150 - now())));
    glWhenReady(Math.max(300, t0 + T.zoom + 1000 - now()), function () {
      if (mode !== 'intro' || space !== s) return;
      var late = !glShown;
      glReveal(late);
      s.pose('start');
      var at = Math.max(t0 + T.zoom, now() + (late ? 480 : 60));
      if (extended && out) {
        var os = Math.max(t0 + T.out, now() + (late ? 300 : 40));
        out.startTime = os;
        at = Math.max(at, os + 200);
      }
      glZoomAt = at;
      trace('gl zoom at +' + Math.round(at - t0));
      timers.push(setTimeout(function () { hero.classList.add('is-space'); }, Math.max(0, at - now())));
      s.playIntro(at, T.glZoomDur).then(function () { if (mode === 'intro' && space === s) settle(); });
    });
  }

  // DOM opening (the painting), from the moment the mark is on screen.
  // `late`: taking over from the 3D scene, the images may still be loading.
  function domAfterMark(late) {
    {
      if (detailImg && detailImg.dataset.src && !detailImg.getAttribute('src')) detailImg.src = detailImg.dataset.src;
      var detailP = imgReady(detailImg).then(function (ok) { detailOK = ok; return ok; });
      var sceneP = imgReady(sceneImg).then(function (ok) { sceneOK = ok; return ok; });
      if (late) {
        sceneP.then(function (ok) {
          if (mode !== 'intro') { if (ok) showScene(false); return; }
          if (!ok) { failScene(); return; }
          showScene(true);
          detailOK = false;
          startZoom(Math.max(t0 + T.zoom, now() + 500));
        });
        return;
      }

      var schedule = function () {
        if (mode !== 'intro') return;
        var late = detailOK && !detailImg.classList.contains('is-on');
        if (detailOK) detailImg.classList.add('is-on');
        var at = Math.max(t0 + T.zoom, now() + 120);
        startZoom(at);
        // tile arrived during the hold: blend it in rather than switching
        if (late) detailImg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
      };

      if (sceneOK) {
        // give the detail tile until the zoom begins; skip it otherwise
        Promise.race([detailP, wait(Math.max(0, t0 + T.zoom - now() - 60))]).then(schedule);
      } else {
        // slow network: logo plays on the cream backdrop; zoom when ready
        var giveUp = setTimeout(function () { if (mode === 'intro' && !sceneOK) failScene(); }, 7000);
        timers.push(giveUp);
        sceneP.then(function (ok) {
          clearTimeout(giveUp);
          if (mode !== 'intro') { if (ok) showScene(false); return; }
          if (!ok) { failScene(); return; }
          showScene(true);
          detailOK = false; // late arrival: keep it simple
          var at = Math.max(t0 + T.zoom, now() + 600);
          startZoom(at);
        });
      }
    }
  }

  // Finish quickly from wherever the opening is (Skip, scroll, menu, resize).
  function hurry(why) {
    if (mode !== 'intro') return;
    trace('hurry:' + (typeof why === 'string' ? why : (why && why.type) || '?'));
    mode = 'hurry';
    unbindHurry();
    timers.forEach(clearTimeout);

    // logo and name out
    var mo = parseFloat(getComputedStyle(mark).opacity) || 0;
    var mt = getComputedStyle(mark).transform;
    markAnims.forEach(function (a) { a.cancel(); });
    if (mo > 0.01) {
      mark.animate([{ opacity: mo, transform: mt === 'none' ? 'none' : mt }, { opacity: 0, transform: 'scale(0.96)' }],
        { duration: 180, easing: 'ease-in', fill: 'forwards' });
    } else {
      mark.style.opacity = '0';
    }

    if (space) {
      hero.classList.add('is-space');
      if (glReady && glShown) {
        var s = space;
        s.hurry().then(function () { if (space === s && mode === 'hurry') settle(); });
      } else {
        settle();
      }
      return;
    }

    if (!sceneOK || !sceneShown) { settle(); return; }

    var cur = readCam();
    var dOp = detailImg && detailImg.classList.contains('is-on') ? parseFloat(getComputedStyle(detailImg).opacity) || 0 : 0;
    zoomAnims.forEach(function (a) { a.cancel(); });
    if (grain) grain.style.display = 'none'; // too faint to need a fade; saves work while scrolling
    zoomAnims = [];
    applyCam(cur);
    hero.classList.add('is-space');

    var p = path(cur, finalCam);
    var ratio = Math.abs(Math.log(cur.s / finalCam.s));
    var dur = Math.round(clamp(260 + ratio * 100, 260, 560));
    var n = 40, kf = [], dkf = [];
    for (var i = 0; i <= n; i++) {
      var c = p(easeHurry(i / n));
      kf.push({ offset: i / n, transform: sceneTf(c) });
      dkf.push({ offset: i / n, transform: detailTf(c) });
    }
    var a = sceneImg.animate(kf, { duration: dur, fill: 'both', easing: 'linear' });
    zoomAnims.push(a);
    if (dOp > 0.01) {
      zoomAnims.push(detailImg.animate(dkf, { duration: dur, fill: 'both', easing: 'linear' }));
      detailImg.animate([{ opacity: dOp }, { opacity: 0 }], { duration: Math.min(180, dur), fill: 'forwards', easing: 'ease-out' });
    } else if (detailImg) {
      detailImg.classList.remove('is-on');
    }
    a.onfinish = settle;
  }

  function settle() {
    trace('settle');
    if (mode === 'settled' && root.classList.contains('settled')) return;
    var wasIntro = root.classList.contains('intro');
    mode = 'settled';
    unbindHurry();
    timers.forEach(clearTimeout);

    measure();
    finalCam = frameFinal(size.w, size.h);
    applyCam(finalCam);
    zoomAnims.forEach(function (a) { a.cancel(); });
    markAnims.forEach(function (a) { a.cancel(); });
    zoomAnims = []; markAnims = [];
    if (detailImg) { detailImg.classList.remove('is-on'); detailImg.getAnimations().forEach(function (a) { a.cancel(); }); }

    hero.classList.add('is-space');
    if (space) {
      var s = space;
      s.settle();
      if (glShown) { /* already on screen at the final pose */ }
      else glWhenReady(GL_SETTLED_TIMEOUT, function () { s.settle(); glReveal(true); });
    } else if (sceneOK !== false) showScene(false);

    var hadFocus = skipBtn && document.activeElement === skipBtn;
    root.classList.remove('intro');
    root.classList.add('settled');
    if (wasIntro) root.classList.add('settled--reveal');
    if (hadFocus) {
      var brand = header && header.querySelector('a');
      if (brand) brand.focus({ preventScroll: true });
    }
    placeSky();
  }

  /* ---------- hurry triggers ---------- */

  function onWheel() { hurry('wheel'); }
  function onKey(e) {
    if (e.key === 'Escape') { hurry('escape'); return; }
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'End', 'Home'].indexOf(e.key) > -1) hurry('key');
  }
  function onSkip() { hurry('skip'); }
  function onTouch() { hurry('touch'); }
  function onAnchor(e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (a) hurry('link');
  }

  function bindHurry() {
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onAnchor, true);
    if (skipBtn) skipBtn.addEventListener('click', onSkip);
  }

  function unbindHurry() {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('touchmove', onTouch);
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onAnchor, true);
    if (skipBtn) skipBtn.removeEventListener('click', onSkip);
  }

  /* ---------- sky: star glints and margin stars ---------- */

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A few faint stars for the black margins outside the image (tall phones,
  // very wide screens), placed in image coordinates so they belong to the
  // same sky. Sparser and dimmer than the painted ones.
  var marginStars = (function () {
    var r = rng(1127), out = [], img = SCENE.image;
    for (var i = 0; i < 260; i++) {
      var x = -900 + r() * (img.width + 1800);
      var y = -1500 + r() * (img.height + 3000);
      if (x > -4 && x < img.width + 4 && y > -4 && y < img.height + 4) continue;
      out.push([x, y, 0.45 + r() * 0.65, 0.18 + r() * 0.34]);
    }
    return out;
  })();

  function placeSky() {
    if (space || !finalCam || sceneOK === false) return;
    var c = finalCam;
    // canvas
    if (sky && sky.getContext) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      sky.width = Math.round(size.w * dpr);
      sky.height = Math.round(size.h * dpr);
      var g = sky.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size.w, size.h);
      var left = c.tx, top = c.ty, right = c.tx + c.s * SCENE.image.width, bottom = c.ty + c.s * SCENE.image.height;
      marginStars.forEach(function (st) {
        var x = c.tx + c.s * st[0], y = c.ty + c.s * st[1];
        if (x < 0 || y < 0 || x > size.w || y > size.h) return;
        if (x > left - 2 && x < right + 2 && y > top - 2 && y < bottom + 2) return;
        g.beginPath();
        g.fillStyle = 'rgba(255,250,240,' + st[3].toFixed(3) + ')';
        g.arc(x, y, st[2], 0, Math.PI * 2);
        g.fill();
      });
    }
    // glints on painted stars
    if (glints) {
      var frag = document.createDocumentFragment();
      var r = rng(27);
      SCENE.stars.forEach(function (p, i) {
        var x = c.tx + c.s * p[0], y = c.ty + c.s * p[1];
        if (x < 6 || y < 6 || x > size.w - 6 || y > size.h - 6) return;
        var el = document.createElement('span');
        el.className = 'glint';
        var sz = clamp(16 * c.s, 9, 20);
        el.style.cssText = 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;--sz:' + sz.toFixed(1) +
          'px;--dur:' + (8 + r() * 7).toFixed(2) + 's;--delay:' + (1.5 + i * 1.9 + r() * 2).toFixed(2) + 's';
        frag.appendChild(el);
      });
      glints.textContent = '';
      glints.appendChild(frag);
    }
  }

  /* ---------- scroll: slower scene, header, hint ---------- */

  var ticking = false;
  var heroH = 0;
  var solidAt = 0;
  var lastY = -1;
  var mainEl = document.getElementById('main');
  var driftEl = document.querySelector('.drift');

  // The header gets its solid bar only once the dark gradient below the
  // hero is under it, so the bar never draws a line across the moon.
  function measureScroll() {
    heroH = hero.offsetHeight;
    var driftH = driftEl ? driftEl.offsetHeight : 0;
    solidAt = (mainEl ? mainEl.offsetTop : heroH + driftH) - driftH * 0.45;
  }

  function onScroll() {
    if (mode === 'intro' && window.scrollY > 2) hurry('scroll');
    if (!ticking) { ticking = true; requestAnimationFrame(updateScroll); }
  }

  function updateScroll() {
    ticking = false;
    var y = Math.max(0, window.scrollY);
    if (y === lastY) return;
    lastY = y;
    if (!heroH) measureScroll();
    if (y < heroH * 1.6) {
      var shift = reduceMQ.matches ? 0 : y * 0.32;
      stage.style.transform = shift ? 'translate3d(0,' + shift.toFixed(1) + 'px,0)' : '';
    }
    if (space && heroH) space.setScroll(y / heroH);
    if (hint) hint.style.opacity = String(clamp(1 - y / (heroH * 0.25), 0, 1));
    if (header) {
      header.classList.toggle('is-scrolled', y > 8);
      header.classList.toggle('is-solid', y > solidAt);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  // pause decorative motion when the hero is off screen
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      hero.classList.toggle('is-away', !entries[0].isIntersecting);
      if (space) space.setVisible(entries[0].isIntersecting);
    }, { threshold: 0 }).observe(hero);
  }

  /* ---------- resize ---------- */

  var lastSize = '';
  function onResize() {
    var w = stage.clientWidth, h = stage.clientHeight;
    var key = w + 'x' + h;
    if (key === lastSize) return;
    var first = lastSize === '';
    lastSize = key;
    measureScroll();
    if (first) return;
    if (space) space.resize();
    measure();
    finalCam = frameFinal(size.w, size.h);
    if (mode === 'intro') { hurry('resize ' + key); return; }
    if (mode === 'settled') { applyCam(finalCam); placeSky(); }
  }

  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(stage);
  else window.addEventListener('resize', onResize);

  /* ---------- go ---------- */

  sceneImg.addEventListener('error', function () { if (sceneOK !== false) failScene(); });

  var tGl = performance.now();
  glStart();
  trace('glStart ' + Math.round(performance.now() - tGl) + 'ms');
  if (logo) {
    logo.addEventListener('error', function () { mark.classList.add('no-logo'); });
    if (logo.complete && !logo.naturalWidth) mark.classList.add('no-logo');
  }

  // (re)mark JS as running — the head script's safety net may have removed it
  root.classList.add('js');

  measure();
  lastSize = stage.clientWidth + 'x' + stage.clientHeight;
  measureScroll();

  if (mode === 'intro' && (window.scrollY > 4 || reduceMQ.matches)) {
    // arrived scrolled (restored position) or motion is reduced
    root.classList.remove('intro');
    mode = 'settled';
  }

  if (mode === 'intro') {
    var go = function () {
      if (document.visibilityState === 'hidden') {
        document.addEventListener('visibilitychange', function v() {
          if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', v); runIntro(); }
        });
      } else runIntro();
    };
    go();
  } else {
    finalCam = frameFinal(size.w, size.h);
    startCam = finalCam;
    applyCam(finalCam);
    hero.classList.add('is-space');
    if (space) {
      // revisit, #deep link or reduced motion: the final view, no opening
      space.pose('final');
      var s0 = space;
      glWhenReady(GL_SETTLED_TIMEOUT, function () { s0.settle(); glReveal(true); });
      imgReady(sceneImg).then(function (ok) { sceneOK = ok; });
    } else {
      imgReady(sceneImg).then(function (ok) {
        sceneOK = ok;
        if (ok) { showScene(false); placeSky(); } else failScene();
      });
    }
    root.classList.add('settled');
    // incoming #link: land on it directly (no scroll through the hero)
    if (location.hash.length > 1) {
      var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) requestAnimationFrame(function () { target.scrollIntoView({ block: 'start', behavior: 'instant' }); });
    }
  }
  updateScroll();

  // smooth scrolling for in-page links only after the first landing
  window.addEventListener('load', function () {
    requestAnimationFrame(function () { root.classList.add('smooth-scroll'); });
  });
  if (document.readyState === 'complete') root.classList.add('smooth-scroll');

  // test hook for automated checks
  window.__intro = {
    get mode() { return mode; },
    get t0() { return t0; },
    trace: traceLog,
    skip: function () { hurry('api'); },
    cams: function () { return { start: startCam, final: finalCam, size: size }; },
    get gl() { return space ? (glReady ? (glShown ? 'shown' : 'ready') : 'loading') : 'off'; },
    get scene() { return space; }
  };
})();
