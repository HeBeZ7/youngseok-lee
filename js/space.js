/*
 * SpaceScene: the hero as a real 3D scene (WebGL2, no libraries).
 *
 * World units: the moon is a unit sphere at the origin (R = 1).
 *   - the moon is shaded procedurally (maria, multi-octave craters, regolith
 *     micro-relief; analytic gradients, octaves fade out below ~2–4 px);
 *   - the boy, the fox and the tree are camera-facing billboards (rotating
 *     about world-up only) anchored on the moon's top silhouette as seen from
 *     the final camera; they are hidden analytically by the sphere, so they
 *     rise over the horizon as the camera pulls back;
 *   - far stars sit at infinity, mid stars are 3D points 25–150 R away
 *     (parallax), a few soft near particles drift past during camera moves.
 *
 * The camera is driven by one path parameter e ∈ [0, 1] (0 = close-up above
 * the surface, 1 = final frontal view). Time → e via an easing; e → camera via
 * monotone splines on log-distance, orbit angles and view pitch/yaw.
 *
 *   SpaceScene.supported()
 *   SpaceScene.create(container, { figuresUrl, reducedMotion, manualReveal, onLost })
 *     → scene | null
 *   scene.canvas, scene.ready (Promise), scene.pose('start'|'final'),
 *   scene.playIntro(startTime, duration), scene.hurry(ms), scene.settle(),
 *   scene.setScroll(p), scene.setVisible(bool), scene.resize(), scene.destroy()
 */
(function () {
  'use strict';

  var DEG = Math.PI / 180;
  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------ helpers */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function sph(az, el) { return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]; }
  var Y = [0, 1, 0];

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

  // Velocity profile: cosine acceleration over the first `a`, cruise, long
  // cosine deceleration over the last `b` of the time.
  function cruise(a, b) {
    var v = 1 / (1 - a / 2 - b / 2), mid = 1 - a - b;
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

  function bezier(x1, y1, x2, y2) {
    function A(p1, p2) { return 1 - 3 * p2 + 3 * p1; }
    function B(p1, p2) { return 3 * p2 - 6 * p1; }
    function C(p1) { return 3 * p1; }
    function calc(t, p1, p2) { return ((A(p1, p2) * t + B(p1, p2)) * t + C(p1)) * t; }
    function slope(t, p1, p2) { return 3 * A(p1, p2) * t * t + 2 * B(p1, p2) * t + C(p1); }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) {
        var d = slope(t, x1, x2);
        if (Math.abs(d) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / d;
      }
      return calc(clamp(t, 0, 1), y1, y2);
    };
  }

  // Monotone cubic (Fritsch–Carlson) through (xs, ys).
  function pchip(xs, ys) {
    var n = xs.length, d = [], m = [], i;
    for (i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      var k = 0;
      while (k < n - 2 && x > xs[k + 1]) k++;
      var h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] +
             (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
    };
  }

  var easeZoom = cruise(0.16, 0.45);
  var easeHurry = bezier(0.3, 0.1, 0.18, 1);

  /* ------------------------------------------------------------ support */

  var supportCache = null;
  var spare = null; // the probe context, handed to the first create()
  function ctxAttrs() {
    return {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: /[?&]capture=1(&|$)/.test(location.search),
      powerPreference: 'default', failIfMajorPerformanceCaveat: true
    };
  }
  function supported() {
    if (supportCache !== null) return supportCache;
    supportCache = false;
    try {
      if (!window.WebGL2RenderingContext) return false;
      var c = document.createElement('canvas');
      // final backing size up front: resizing a live WebGL canvas waits on the GPU process
      var q0 = tier(), w0 = window.innerWidth || 1, h0 = window.innerHeight || 1;
      var d0 = Math.min(window.devicePixelRatio || 1, q0.dprCap);
      if (w0 * h0 * d0 * d0 > q0.budget) d0 = Math.sqrt(q0.budget / (w0 * h0));
      c.width = Math.max(1, Math.round(w0 * d0)); c.height = Math.max(1, Math.round(h0 * d0));
      var gl = c.getContext('webgl2', ctxAttrs());
      if (!gl) return false;
      var hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      var ok = !!hp && hp.precision >= 23 && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 2048;
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      var r = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      if (/swiftshader|llvmpipe|software|basic render/i.test(r)) ok = false;
      if (ok) spare = { canvas: c, gl: gl };
      else { var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
      supportCache = ok;
    } catch (e) { supportCache = false; }
    return supportCache;
  }

  /* ------------------------------------------------------------ shaders */

  var HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

  var COMMON = [
    'const float INV32 = 1.0 / 4294967296.0;',
    'uvec3 pcg3d(uvec3 v) {',
    '  v = v * 1664525u + 1013904223u;',
    '  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;',
    '  v ^= v >> 16u;',
    '  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;',
    '  return v;',
    '}',
    'float hash1(uvec3 p) {',
    '  uint h = (p.x * 0x8da6b343u) ^ (p.y * 0xd8163841u) ^ (p.z * 0xcb1ab31fu);',
    '  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;',
    '  return float(h) * INV32;',
    '}',
    'uvec3 cellId(vec3 i, uint seed) { return uvec3(ivec3(i) + 1048576) + uvec3(seed, seed * 3u, seed * 7u); }',
    // value noise, -1..1
    'float vnoise(vec3 x, uint seed) {',
    '  vec3 i = floor(x); vec3 f = x - i;',
    '  vec3 u = f * f * (3.0 - 2.0 * f);',
    '  uvec3 p = cellId(i, seed);',
    '  float a = hash1(p), b = hash1(p + uvec3(1u,0u,0u)), c = hash1(p + uvec3(0u,1u,0u)), d = hash1(p + uvec3(1u,1u,0u));',
    '  float e = hash1(p + uvec3(0u,0u,1u)), g = hash1(p + uvec3(1u,0u,1u)), h = hash1(p + uvec3(0u,1u,1u)), k = hash1(p + uvec3(1u,1u,1u));',
    '  float v = mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);',
    '  return v * 2.0 - 1.0;',
    '}',
    // value noise with analytic gradient (quintic), -1..1
    'vec4 vnoised(vec3 x, uint seed) {',
    '  vec3 i = floor(x); vec3 f = x - i;',
    '  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
    '  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);',
    '  uvec3 p = cellId(i, seed);',
    '  float a = hash1(p), b = hash1(p + uvec3(1u,0u,0u)), c = hash1(p + uvec3(0u,1u,0u)), d = hash1(p + uvec3(1u,1u,0u));',
    '  float e = hash1(p + uvec3(0u,0u,1u)), g = hash1(p + uvec3(1u,0u,1u)), h = hash1(p + uvec3(0u,1u,1u)), k = hash1(p + uvec3(1u,1u,1u));',
    '  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + h, k6 = a - b - e + g;',
    '  float k7 = -a + b + c - d + e - g - h + k;',
    '  float v = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;',
    '  vec3 gr = du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,',
    '                      k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x,',
    '                      k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);',
    '  return vec4(v * 2.0 - 1.0, gr * 2.0);',
    '}',
    'const mat3 MROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);',
    // Khronos PBR Neutral: compresses highlights, keeps hue and saturation
    'vec3 tonemap(vec3 c) {',
    '  float x = min(c.r, min(c.g, c.b));',
    '  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;',
    '  c -= off;',
    '  float peak = max(c.r, max(c.g, c.b));',
    '  const float sc = 0.76;',
    '  if (peak < sc) return c;',
    '  const float d = 1.0 - sc;',
    '  float np = 1.0 - d * d / (peak + d - sc);',
    '  c *= np / peak;',
    '  float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);',
    '  return mix(c, vec3(np), g);',
    '}',
    'vec3 toSRGB(vec3 c) {',
    '  c = clamp(c, 0.0, 1.0);',
    '  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));',
    '}',
    'float dither(vec2 fc) { return (fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0; }'
  ].join('\n');

  // the low grassy plateau under the figures (the painting's flattened top)
  var MOUND = [
    'uniform vec4 uMound;',    // axis (unit), amplitude
    'uniform vec2 uMoundR;',   // flat until, gone by (radians from the axis)
    'float mound(vec3 p) {',
    '  float th = acos(clamp(dot(p, uMound.xyz), -1.0, 1.0));',
    '  return uMound.w * 0.5 * th * th * (1.0 - smoothstep(uMoundR.x, uMoundR.y, th));',
    '}',
    'float sdf(vec3 q) { float l = length(q); return l - (1.0 + mound(q / l)); }'
  ].join('\n');

  // full-screen triangle, interpolating world-space view rays
  var FS_VS = HEAD + [
    'uniform vec3 uRay[3];',
    'out vec3 vRay;',
    'void main() {',
    '  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);',
    '  vRay = uRay[gl_VertexID];',
    '  gl_Position = vec4(p, 0.0, 1.0);',
    '}'
  ].join('\n');

  var STAR_VS = HEAD + [
    'uniform mat4 uPV;',
    'uniform float uW, uPx, uTime, uGain;',
    'in vec4 a0;',   // xyz (direction or position), sigma (css px)
    'in vec4 a1;',   // rgb flux, twinkle amount
    'in vec2 a2;',   // twinkle period (s), phase
    'in float a3;',  // soft glow
    'out vec3 vCol;',
    'out vec3 vK;',
    'void main() {',
    '  vec4 c = uPV * vec4(a0.xyz, uW);',
    '  if (uW < 0.5) c.z = c.w * 0.99999;',
    '  gl_Position = c;',
    '  float sig = max(a0.w * uPx, 0.62);',
    '  float tw = 1.0 - a1.w * (0.5 + 0.5 * sin(uTime * 6.2831853 / a2.x + a2.y));',
    '  float peak = uPx * uPx / (6.2831853 * sig * sig);',
    '  vCol = a1.rgb * (tw * uGain * peak);',
    '  float ps = ceil(sig * (6.0 + 22.0 * a3));',
    '  gl_PointSize = ps;',
    '  vK = vec3(ps / sig, a3, 0.0);',
    '}'
  ].join('\n');

  var STAR_FS = HEAD + [
    'in vec3 vCol;',
    'in vec3 vK;',
    'out vec4 o;',
    'void main() {',
    '  vec2 q = (gl_PointCoord - 0.5) * vK.x;',
    '  float r2 = dot(q, q);',
    '  float g = exp(-0.5 * r2) + vK.y * 0.045 * exp(-0.5 * r2 / 30.0);',
    '  o = vec4(vCol * g, 1.0);',
    '}'
  ].join('\n');

  // screen-space quad around the moon's silhouette (rays interpolated at its corners)
  var QUAD_VS = HEAD + [
    'uniform vec4 uRect;',
    'uniform vec3 uRayQ[4];',
    'out vec3 vRay;',
    'void main() {',
    '  int k = gl_VertexID;',
    '  int ix = (k == 1 || k == 2 || k == 4) ? 1 : 0;',
    '  int iy = (k == 2 || k == 4 || k == 5) ? 1 : 0;',
    '  vRay = uRayQ[ix + 2 * iy];',
    '  gl_Position = vec4(ix == 1 ? uRect.z : uRect.x, iy == 1 ? uRect.w : uRect.y, 0.0, 1.0);',
    '}'
  ].join('\n');

  // the black: a barely visible large-scale variation and a faint star cloud
  var BGBAKE_FS = HEAD + COMMON + [
    'uniform highp sampler3D uNoise;',
    'float tnz(vec3 x, uint sd) { return textureLod(uNoise, fract(x / 8.0 + float(sd) * 0.0731), 0.0).r * 2.0 - 1.0; }',
    'out vec4 o;',
    'uniform int uFace;',
    'uniform float uSize;',
    'uniform vec3 uBandN;',
    'vec3 faceDir(int f, vec2 c) {',
    '  if (f == 0) return vec3(1.0, -c.y, -c.x);',
    '  if (f == 1) return vec3(-1.0, -c.y, c.x);',
    '  if (f == 2) return vec3(c.x, 1.0, c.y);',
    '  if (f == 3) return vec3(c.x, -1.0, -c.y);',
    '  if (f == 4) return vec3(c.x, -c.y, 1.0);',
    '  return vec3(-c.x, -c.y, -1.0);',
    '}',
    'void main() {',
    '  vec3 d = normalize(faceDir(uFace, gl_FragCoord.xy / uSize * 2.0 - 1.0));',
    '  float n = 0.5 + 0.5 * (0.6 * tnz(d * 1.6, 3u) + 0.4 * tnz(MROT * d * 3.4, 5u));',
    '  float lat = dot(d, uBandN);',
    '  float cl = 0.5 + 0.5 * (0.65 * tnz(d * 4.0 + 7.0, 9u) + 0.35 * tnz(MROT * d * 9.0, 13u));',
    '  float band = exp(-lat * lat / 0.018) * (0.3 + 0.7 * cl * cl);',
    '  o = vec4(n * n, band, 0.0, 1.0);',
    '}'
  ].join('\n');

  var BG_FS = HEAD + COMMON + [
    'in vec3 vRay;',
    'out vec4 o;',
    'uniform highp samplerCube uBg;',
    'uniform float uGain;',
    'uniform vec2 uRes;',
    'void main() {',
    '  vec4 t = texture(uBg, normalize(vRay));',
    '  float v = (0.3 + 1.3 * t.r + 3.0 * t.g) / 255.0 * uGain;',
    '  vec3 col = v * vec3(0.94, 0.97, 1.04);',
    '  col *= smoothstep(0.0, 0.25, gl_FragCoord.y / uRes.y);',
    '  o = vec4(max(col + dither(gl_FragCoord.xy), 0.0), 1.0);',
    '}'
  ].join('\n');

  // 64³ periodic value noise (period 8 cells) with its gradient, RGBA8
  var NOISE3_FS = HEAD + COMMON + [
    'out vec4 o;',
    'uniform float uLayer;',
    'float hp(ivec3 c) { return hash1(uvec3(c & 7) + uvec3(17u, 59u, 101u)); }',
    'void main() {',
    '  vec3 x = vec3(gl_FragCoord.xy, uLayer + 0.5) / 8.0;',
    '  vec3 i = floor(x); vec3 f = x - i;',
    '  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
    '  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);',
    '  ivec3 c = ivec3(i);',
    '  float a = hp(c), b = hp(c + ivec3(1,0,0)), cc = hp(c + ivec3(0,1,0)), d = hp(c + ivec3(1,1,0));',
    '  float e = hp(c + ivec3(0,0,1)), g = hp(c + ivec3(1,0,1)), h = hp(c + ivec3(0,1,1)), k = hp(c + ivec3(1,1,1));',
    '  float k1 = b - a, k2 = cc - a, k3 = e - a, k4 = a - b - cc + d, k5 = a - cc - e + h, k6 = a - b - e + g;',
    '  float k7 = -a + b + cc - d + e - g - h + k;',
    '  float v = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;',
    '  vec3 gr = 2.0 * du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,',
    '                            k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x,',
    '                            k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);',
    '  o = vec4(v, clamp(gr / 8.0 + 0.5, 0.0, 1.0));',
    '}'
  ].join('\n');

  // crater profile shared by the bake and the live octaves
  var CRATER = [
    'float sstep(float a, float b, float x, out float d) {',
    '  float t = clamp((x - a) / (b - a), 0.0, 1.0);',
    '  d = 6.0 * t * (1.0 - t) / (b - a);',
    '  return t * t * (3.0 - 2.0 * t);',
    '}',
    // bowl (optionally flat-floored) + raised rim, zero beyond x = 1.6; with its derivative
    'void profd(float x, float fl, out float h, out float dh) {',
    '  float q = x * x - 1.0;',
    '  float bowl = max(q, -fl); float db = q > -fl ? 2.0 * x : 0.0;',
    '  float di, dout;',
    '  float inner = 1.0 - sstep(0.82, 1.22, x, di);',
    '  float e = x - 1.0;',
    '  float rim = 0.24 * exp(-7.5 * e * e); float dr = rim * (-15.0 * e);',
    '  float outer = 1.0 - sstep(1.2, 1.6, x, dout);',
    '  float core = bowl * inner + rim;',
    '  h = core * outer;',
    '  dh = (db * inner - bowl * di + dr) * outer - core * dout;',
    '}',
    // adds height + gradient (lattice space) and albedo masks (floor, rim/halo)
    'void crater(vec3 q, vec3 c, float rad, float fl, float amp, float wt, inout float h, inout vec3 g, inout vec2 m) {',
    '  vec3 d = q - c; float dist = length(d); float x = dist / rad;',
    '  if (x >= 1.6) return;',
    '  float h0, dh; profd(x, fl, h0, dh);',
    '  h += h0 * amp;',
    '  g += d * (dh * amp / (rad * max(dist, 1e-6)));',
    '  float e = x - 1.02; float rm = max(0.0, 1.0 - e * e * 8.0); float ha = max(0.0, 1.0 - x * x * 0.45);',
    '  m.x = max(m.x, (1.0 - smoothstep(0.45, 1.0, x)) * wt);',
    '  m.y = max(m.y, (rm * rm + 0.5 * ha * ha) * wt);',
    '}',
    'float sMask(vec3 p, vec3 s) { return smoothstep(0.03, 0.13, length(p - s)); }',
    'float fMask(vec3 p, vec4 f[3], int nf) {',
    '  float m = 1.0;',
    '  for (int j = 0; j < nf; j++) m = min(m, smoothstep(0.55 * f[j].w, 1.5 * f[j].w, length(p - f[j].xyz)));',
    '  return m;',
    '}'
  ].join('\n');

  // Large-scale surface, baked once into two cube maps:
  //   G: surface gradient (xyz, ±0.5) + height (w)     M: maria, crater floor, rim/halo, blotches
  var MACRO_FS = HEAD + COMMON + CRATER + [
    'uniform highp sampler3D uNoise;',
    'float tnz(vec3 x, uint sd) { return textureLod(uNoise, fract(x / 8.0 + float(sd) * 0.0731), 0.0).r * 2.0 - 1.0; }',
    'layout(location = 0) out vec4 oG;',
    'layout(location = 1) out vec4 oM;',
    'uniform int uFace;',
    'uniform float uSize;',
    'uniform int uBakeOct, uEight;',
    'uniform vec3 uStart;',
    'uniform vec4 uFig[3];',
    'uniform int uNFig;',
    'vec3 faceDir(int f, vec2 c) {',
    '  if (f == 0) return vec3(1.0, -c.y, -c.x);',
    '  if (f == 1) return vec3(-1.0, -c.y, c.x);',
    '  if (f == 2) return vec3(c.x, 1.0, c.y);',
    '  if (f == 3) return vec3(c.x, -1.0, -c.y);',
    '  if (f == 4) return vec3(c.x, -c.y, 1.0);',
    '  return vec3(-c.x, -c.y, -1.0);',
    '}',
    'void main() {',
    '  vec3 p = normalize(faceDir(uFace, gl_FragCoord.xy / uSize * 2.0 - 1.0));',
    '  float startMask = sMask(p, uStart);',
    '  float figMask = fMask(p, uFig, uNFig);',
    '  float dS = length(p - uStart);',
    '  float topBand = smoothstep(0.82, 0.93, p.y);',
    '  vec3 wq = p * 2.1 + 0.45 * vec3(tnz(p * 3.0, 41u), tnz(p * 3.0 + 9.1, 42u), tnz(p * 3.0 - 4.7, 43u));',
    '  float mar0 = 0.55 * vnoise(wq + vec3(3.1, -1.7, 0.4), 11u) + 0.3 * vnoise(MROT * wq * 2.1, 12u) + 0.15 * tnz(p * 9.0, 14u);',
    '  mar0 += 0.11 * tnz(p * 21.0, 15u) + 0.06 * tnz(MROT * p * 47.0, 16u);',
    '  float mar = smoothstep(0.06, 0.2, mar0) * smoothstep(0.08, 0.3, dS) * (1.0 - topBand * 0.9);',
    '  float blot = 0.42 * vnoise(p * 6.0 + 2.3, 21u) + 0.28 * vnoise(MROT * p * 15.0, 22u) + 0.18 * tnz(p * 38.0, 23u) + 0.12 * tnz(MROT * p * 85.0, 24u);',
    '  float bigMask = startMask * figMask;',
    '  float h = 0.0; vec3 G = vec3(0.0); vec2 cm = vec2(0.0);',
    '  mat3 R = mat3(1.0);',
    '  float cell = 0.46;',
    '  for (int i = 0; i < uBakeOct; i++) {',
    '    float mk = i < 3 ? bigMask : mix(0.3, 1.0, startMask) * mix(0.25, 1.0, figMask);',
    '    float dens = i < 1 ? mix(0.8, 0.4, mar) : mix(0.95, 0.55, mar);',
    '    vec3 q = R * p / cell;',
    '    float hq = 0.0; vec3 gq = vec3(0.0); vec2 mq = vec2(0.0);',
    '    uint seed = uint(i) * 7919u + 101u;',
    '    {',
    '      vec3 id = floor(q);',
    '      uvec3 u = cellId(id, seed);',
    '      vec3 r1 = vec3(pcg3d(u)) * INV32;',
    '      if (r1.x < dens) {',
    '        vec3 r2 = vec3(pcg3d(u ^ uvec3(0x9e3779b9u, 0x85ebca6bu, 0xc2b2ae35u))) * INV32;',
    '        float rad = i < 3 ? mix(0.16, 0.30, r1.y) : mix(0.08, 0.30, pow(r1.y, 2.5));',
    '        float lim = 1.6 * rad;',
    '        vec3 cc = id + mix(vec3(lim), vec3(1.0 - lim), r2);',
    '        cc = R * normalize((cc * cell) * R) / cell;',
    '        vec3 fc = cc - id;',
    '        float age = mix(0.25, 1.0, r1.z * r1.z);',
    '        if (all(greaterThan(fc, vec3(lim))) && all(lessThan(fc, vec3(1.0 - lim))))',
    '          crater(q, cc, rad, 1.0, 0.18 * age * rad, age * age, hq, gq, mq);',
    '      }',
    '    }',
    '    h += hq * cell * mk;',
    '    G += (transpose(R) * gq) * mk;',
    '    cm = max(cm, mq * mk * (i < 3 ? 1.0 : 0.8));',
    '    R = MROT * R;',
    '    cell *= 0.52;',
    '  }',
    '  oG = vec4(clamp(G + 0.5, 0.0, 1.0), clamp(h * 16.0 + 0.5, 0.0, 1.0));',
    '  oM = vec4(mar, cm.x, cm.y, blot * 0.5 + 0.5);',
    '}'
  ].join('\n');

  var MOON_FS = HEAD + COMMON + CRATER + [
    'uniform vec4 uMound;',
    'in vec3 vRay;',
    'out vec4 o;',
    'uniform highp samplerCube uMacroG, uMacroM;',
    'uniform highp sampler3D uNoise;',
    'uniform vec3 uCam, uL, uStart;',
    'uniform float uPxAng, uCraterOct, uMicroOct, uExposure;',
    'uniform mat3 uRot[14];',
    'uniform int uBakeOct, uCraterOctI, uMicroOctI;',
    'uniform vec4 uFig[3];',      // anchor (unit vector), influence radius
    'uniform vec4 uShadow[3];',   // sigma horizontal, sigma vertical
    'uniform vec4 uShadowC[3];',  // centre (on the sphere), strength
    'uniform int uNFig;',
    'vec4 hash43(vec3 p) {',
    '  vec4 p4 = fract(vec4(p.xyzx) * vec4(0.1031, 0.1030, 0.0973, 0.1099));',
    '  p4 += dot(p4, p4.wzxy + 33.33);',
    '  return fract((p4.xxyz + p4.yzzw) * p4.zywx);',
    '}',
    'vec3 hash33(vec3 p3) {',
    '  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));',
    '  p3 += dot(p3, p3.yxz + 33.33);',
    '  return fract((p3.xxy + p3.yxx) * p3.zyx);',
    '}',
    'void main() {',
    '  vec3 ro = uCam; vec3 rd = normalize(vRay);',
    '  float b = dot(ro, rd); float c = dot(ro, ro) - 1.0;',
    '  float tc = max(-b, 1e-4);',
    '  float mr = sqrt(max(c + 1.0 - b * b, 0.0));',
    '  float pxw = tc * uPxAng;',
    '  if (mr > 1.03 + 2.0 * pxw) discard;',
    '  float disc = b * b - c;',
    '  float t = disc > 0.0 ? -b - sqrt(disc) : tc;',
    '  vec3 p = normalize(ro + rd * t);',
    // signed distance to the silhouette (world units), for the limb's coverage
    '  float covD = disc * 0.5;',
    '  vec3 N = p;',
    '  float mu = max(dot(-rd, N), 0.0);',
    '  float fw = t * uPxAng / max(mu, 0.12);',   // world size of a pixel on the surface
    '',
    // baked large scale
    '  vec4 g0 = texture(uMacroG, p);',
    '  vec4 m0 = texture(uMacroM, p);',
    '  vec3 G = g0.xyz - 0.5;',
    '  float h = (g0.w - 0.5) / 16.0;',
    '  float mar = m0.x; vec2 cm = m0.yz; float blot = m0.w * 2.0 - 1.0;',
    '',
    '  float startMask = sMask(p, uStart);',
    '  float figMask = 1.0; float moss = 0.0; float shade = 1.0;',
    '  float cAx = dot(p, uMound.xyz);',
    '  for (int j = 0; j < uNFig; j++) {',
    '    if (cAx < 0.25) break;',
    '    vec3 A = uFig[j].xyz; float r = uFig[j].w;',
    '    float dA = length(p - A);',
    '    if (dA > 1.6 * r) continue;',
    '    figMask = min(figMask, smoothstep(0.55 * r, 1.5 * r, dA));',
    '    moss = max(moss, 1.0 - smoothstep(0.25 * r, 1.25 * r, dA));',
    '    vec3 dd = p - uShadowC[j].xyz;',
    '    float k = exp(-dd.x * dd.x / (uShadow[j].x * uShadow[j].x) - (dot(dd, dd) - dd.x * dd.x) / (uShadow[j].y * uShadow[j].y));',
    '    shade *= 1.0 - uShadowC[j].w * k;',
    '  }',
    '  float topBand = smoothstep(0.82, 0.93, p.y);',

    // finer craters, live, faded out below ~2–4 px
    '  {',
    '    float cell = 0.46 * pow(0.52, float(uBakeOct));',
    '    for (int i = uBakeOct; i < uCraterOctI; i++) {',
    '      {',
    '        mat3 R = uRot[i];',
    '        float lod = smoothstep(1.6, 4.0, 0.25 * cell / fw);',
    '        if (lod <= 0.0) break;',
    '        float mk = (i < 5 ? mix(0.3, 1.0, startMask) * mix(0.25, 1.0, figMask) : mix(0.55, 1.0, figMask)) * lod;',
    '        float dens = mix(1.0, 0.65, mar);',
    '        vec3 q = R * p / cell;',
    '        vec3 id = floor(q);',
    '        vec4 r1 = hash43(id + float(i) * 17.31);',
    '        if (r1.x < dens && mk > 0.003) {',
    '          vec3 r2 = hash33(id + float(i) * 23.17 + 5.3);',
    '          float rad = mix(0.08, 0.30, pow(r1.y, 2.5));',
    '          float lim = 1.6 * rad;',
    '          vec3 cc = id + mix(vec3(lim), vec3(1.0 - lim), r2);',
    '          cc = R * normalize((cc * cell) * R) / cell;',
    '          vec3 fc = cc - id;',
    '          float age = mix(0.25, 1.0, r1.z * r1.z);',
    '          float hq = 0.0; vec3 gq = vec3(0.0); vec2 mq = vec2(0.0);',
    '          if (all(greaterThan(fc, vec3(lim))) && all(lessThan(fc, vec3(1.0 - lim))))',
    '            crater(q, cc, rad, 1.0, 0.25 * age * rad, age * age, hq, gq, mq);',
    '          h += hq * cell * mk;',
    '          G += (gq * R) * mk;',
    '          cm = max(cm, mq * mk * (i < 6 ? 0.8 : 0.55));',
    '        }',
    '      }',
    '      cell *= 0.52;',
    '    }',
    '  }',
    '',
    // regolith micro-relief and fine albedo variation (3D noise texture)
    '  float speck = 0.0;',
    '  {',
    '    float fr = 46.0;',
    '    for (int i = 0; i < uMicroOctI; i++) {',
    '      float lod = smoothstep(2.0, 5.0, 1.0 / (fr * fw));',
    '      if (lod <= 0.0) break;',
    '      mat3 Rm = uRot[i + 1];',
    '      vec4 tn = textureLod(uNoise, fract((Rm * p) * (fr / 8.0) + float(i) * 0.137), 0.0);',
    '      float nv = tn.r * 2.0 - 1.0; vec3 ng = (tn.gba - 0.5) * 8.0;',
    '      float a = 0.05 / fr * lod;',
    '      h += nv * a;',
    '      G += (ng * Rm) * (a * fr);',
    '      speck += nv * lod * (i < 3 ? 0.055 : 0.025);',
    '      fr *= 2.3;',
    '    }',
    '  }',
    '',
    // limb coverage (the bumpy silhouette follows the height field)
    '  float cov = clamp(0.5 + (covD + (covD < 1.0 ? h * 0.35 : 0.0)) / pxw, 0.0, 1.0);',
    '  if (cov <= 0.0) discard;',
    '',
    // perturbed normal from the surface gradient
    '  vec3 Gs = G - dot(G, N) * N;',
    '  vec3 n = normalize(N - Gs);',
    '',
    // albedo
    '  vec3 high = vec3(0.83, 0.79, 0.715);',
    '  vec3 mare = vec3(0.33, 0.36, 0.415);',
    // irregular maria borders at close range
    '  float me = textureLod(uNoise, fract(MROT * p * (140.0 / 8.0)), 0.0).r * 0.6 + textureLod(uNoise, fract(p * (330.0 / 8.0)), 0.0).r * 0.4;',
    '  mar = clamp(mar + (me - 0.5) * 1.6 * mar * (1.0 - mar), 0.0, 1.0);',
    '  vec3 alb = mix(high, mare * (0.9 + 0.2 * me), mar * (0.85 + 0.15 * blot));',
    '  alb *= 1.0 + 0.2 * blot + speck;',
    '  alb = mix(alb, alb * vec3(0.80, 0.84, 0.92), cm.x * 0.5);',
    '  alb *= 1.0 + 0.04 * cm.y * (1.0 - 0.5 * mar);',
    '  float mossN = textureLod(uNoise, fract(p * (60.0 / 8.0)), 0.0).r * 0.65 + textureLod(uNoise, fract(MROT * p * (150.0 / 8.0)), 0.0).r * 0.35;',
    '  float mo = moss * smoothstep(0.45, 0.7, mossN + 0.3 * moss - 0.15) * smoothstep(0.86, 0.95, p.y);',
    '  alb = mix(alb, mix(vec3(0.10, 0.17, 0.04), vec3(0.20, 0.26, 0.08), mossN), mo * 0.85);',
    '',
    // lighting
    '  float ndl = dot(n, uL);',
    '  float nl0 = dot(N, uL);',
    '  float diff = clamp((ndl + 0.1) / 1.1, 0.0, 1.0);',
    '  diff *= smoothstep(-0.3, 0.2, nl0);',
    // gentle falloff toward the limb, on the lit side too
    '  diff *= mix(0.62, 1.0, smoothstep(0.0, 0.6, mu));',
    '  vec3 sun = vec3(1.0, 0.975, 0.93) * uExposure;',
    '  vec3 amb = vec3(0.030, 0.040, 0.064) * (0.8 + 0.2 * N.y);',
    '  vec3 cool = vec3(0.040, 0.056, 0.095) * smoothstep(-0.55, -0.05, nl0) * (1.0 - smoothstep(-0.05, 0.55, nl0));',
    '  vec3 col = alb * (sun * diff * shade + amb + cool);',
    '  col = toSRGB(tonemap(col)) + dither(gl_FragCoord.xy);',
    '  o = vec4(col * cov, cov);',
    '}'
  ].join('\n');

  var FIG_VS = HEAD + [
    'in vec2 aUV;',
    'uniform mat4 uPV;',
    'uniform vec2 uSize, uBase;',
    'uniform vec3 uAnchorW, uRight;',
    'uniform float uK, uFigH, uSink, uAnchorY;',
    'uniform vec2 uCirc;',      // a = A·right, r'^2 of the sphere cross-section in the billboard plane
    'uniform float uGround[17];', // painted ground under the sprite, relative to the base (world, up +)
    'out vec2 vUV;',
    'out vec3 vW;',
    'out float vHg;',
    'void main() {',
    '  vec2 px = aUV * uSize;',
    '  float u = (px.x - uBase.x) * uK;',
    '  float hh = (uBase.y - px.y) * uK;',
    '  float gi = clamp(aUV.x * 16.0, 0.0, 16.0); int i0 = min(int(gi), 15);',
    '  float gp = mix(uGround[i0], uGround[i0 + 1], gi - float(i0));',
    // our ground under this column: sphere section in the billboard plane, raised by the plateau
    '  float xo = uCirc.x + u;',
    '  float vy = sqrt(max(uCirc.y - xo * xo, 0.0));',
    '  float gt = vy - uAnchorY;',
    '  float hg = hh - gp;',
    '  float warp = clamp(gt - gp, -0.12, 0.12) * (1.0 - smoothstep(0.0, 0.35 * uFigH, hg));',
    '  vec3 w = uAnchorW + uRight * u + vec3(0.0, hh + warp - uSink, 0.0);',
    '  vW = w; vUV = aUV; vHg = hg;',
    '  gl_Position = uPV * vec4(w, 1.0);',
    '}'
  ].join('\n');

  var FIG_FS = HEAD + [
    'in vec2 vUV;',
    'in vec3 vW;',
    'in float vHg;',
    'out vec4 o;',
    'uniform sampler2D uTex, uWts;',
    'uniform vec2 uSize, uBase, uNeck;',
    'uniform float uTime, uLife, uPxAng, uKind, uGain, uK, uFade, uGust;',
    'uniform vec3 uCam;',
    'void main() {',
    '  vec2 px = vUV * uSize;',
    '  vec4 w0 = texture(uWts, vUV);',
    '  vec4 w1 = textureLod(uWts, vUV, 3.3);',
    '  vec2 off = vec2(0.0);',
    '  float t = uTime;',
    // scarf: slow travelling wave, rooted at the neck, strongest at the tip
    '  float wr = max(w0.r, min(1.0, w1.r * 2.8));',
    '  if (wr > 0.001 && uKind < 0.5) {',
    '    float dn = distance(px, uNeck);',
    '    float grow = smoothstep(10.0, 190.0, dn);',
    '    float sx = uNeck.x - px.x;',
    '    float ph = sx * 0.042 - t * 2.0;',
    '    float gust = (0.8 + 0.2 * sin(t * 0.43 + 1.3)) * (1.5 + 1.0 * uGust);',
    '    off += wr * grow * gust * vec2(0.8 * sin(ph * 0.5 + 0.8), 3.6 * sin(ph) + 0.9 * sin(ph * 1.9 - t * 0.7) + 1.1 * uGust * sin(ph * 2.6 - t * 1.3));',
    '  }',
    // leaves and thin branches: tiny wind sway (trunk weight is 0)
    '  float wg = max(w0.g, min(1.0, w1.g * 2.0));',
    '  if (wg > 0.001) {',
    '    float ph = dot(px, vec2(0.021, 0.014));',
    '    float gust = (0.65 + 0.35 * sin(t * 0.37 + ph * 0.3)) * (1.6 + 1.4 * uGust);',
    '    off += wg * gust * vec2(1.4 * sin(t * 1.15 + ph) + 0.5 * sin(t * 2.3 + ph * 2.7), 0.65 * cos(t * 1.4 + ph * 1.3));',
    '  }',
    // breathing: a fraction of a pixel, anchored at the base
    '  if (w0.b > 0.001) {',
    '    float br = (uKind > 0.5 ? sin(t * 1.282 + 2.1) : sin(t * 1.428)) * 0.009 * w0.b;',
    '    off += (px - uBase) * vec2(0.3, 1.0) * br;',
    '  }',
    '  vec2 uv = vUV - off * uLife / uSize;',
    '  vec4 c = texture(uTex, uv);',
    '  if (c.a < 0.003) discard;',
    // light from the upper left: a thin warm rim on light-facing edges
    '  float aL = texture(uTex, uv + vec2(-1.8, -2.2) / uSize).a;',
    '  float rim = clamp(c.a - aL, 0.0, 1.0);',
    '  c.rgb += rim * vec3(0.30, 0.25, 0.17) * c.a;',
    // a little darker where it meets the ground
    '  c.rgb *= mix(0.74, 1.0, smoothstep(-4.0, 26.0, vHg / uK));',
    '  c.rgb *= uGain;',
    // hidden by the moon (inside it, or behind its limb). What the painting puts
    // below the ground line (grass, the fox tail tip) may lie over the near face.
    '  float ov = clamp(0.004 - vHg, 0.0, 0.07);',
    '  vec3 rd = vW - uCam; float tf = length(rd); rd /= tf;',
    '  float R1 = 1.0 - ov;',
    '  float cov = clamp(0.5 + (length(vW) - R1) / (tf * uPxAng), 0.0, 1.0);',
    '  float b = dot(uCam, rd); float tc = -b;',
    '  if (tc > 0.0 && tc < tf - 0.01) {',
    '    float mr = sqrt(max(dot(uCam, uCam) - b * b, 0.0));',
    '    cov = min(cov, clamp(0.5 + (mr - R1) / (tc * uPxAng), 0.0, 1.0));',
    '  }',
    '  o = c * (cov * uFade);',
    '}'
  ].join('\n');

  // a shooting star: screen-space streak, bright head, fading tail (additive)
  var METEOR_VS = HEAD + [
    'uniform vec4 uSeg;',     // head.xy, tail.xy (render-target px)
    'uniform float uHalfW;',
    'uniform vec2 uRes;',
    'out vec2 vT;',
    'void main() {',
    '  int k = gl_VertexID;',
    '  vec2 c = vec2((k == 1 || k == 2 || k == 4) ? 1.0 : 0.0, (k == 2 || k == 4 || k == 5) ? 1.0 : -1.0);',
    '  vec2 d = uSeg.xy - uSeg.zw; float L = max(length(d), 1.0); vec2 dir = d / L; vec2 nr = vec2(-dir.y, dir.x);',
    '  float ext = L + uHalfW * 3.0;',
    '  vec2 q = uSeg.zw + dir * (c.x * ext) + nr * (c.y * uHalfW * 3.0);',
    '  vT = vec2(c.x * ext / L, c.y * 3.0);',
    '  gl_Position = vec4(q / uRes * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var METEOR_FS = HEAD + [
    'in vec2 vT;',
    'out vec4 o;',
    'uniform float uAlpha;',
    'void main() {',
    '  float al = clamp(vT.x, 0.0, 1.0);',
    '  float tail = al * al * al * step(vT.x, 1.0) * exp(-vT.y * vT.y * 1.6);',
    '  float hx = (vT.x - 1.0) * 14.0;',
    '  float head = exp(-hx * hx - vT.y * vT.y * 0.9);',
    '  float a = (tail * 0.8 + head) * uAlpha;',
    '  o = vec4(vec3(0.93, 0.96, 1.0) * a, 1.0);',
    '}'
  ].join('\n');

  var NEAR_VS = HEAD + [
    'uniform mat4 uPV;',
    'uniform vec4 uP[8];',
    'uniform float uA[8];',
    'uniform vec3 uCam;',
    'uniform vec2 uRes;',
    'uniform float uFpx;',
    'out vec2 vQ;',
    'out float vA;',
    'void main() {',
    '  int id = gl_VertexID / 6; int k = gl_VertexID - id * 6;',
    '  vec2 cr = vec2((k == 1 || k == 2 || k == 4) ? 1.0 : -1.0, (k == 2 || k == 4 || k == 5) ? 1.0 : -1.0);',
    '  vec4 c = uPV * vec4(uP[id].xyz, 1.0);',
    '  float dist = length(uP[id].xyz - uCam);',
    '  float r = clamp(uP[id].w / dist * uFpx, 3.0, 260.0);',
    '  c.xy += cr * r / uRes * 2.0 * c.w;',
    '  vQ = cr;',
    '  vA = uA[id] * smoothstep(0.05, 0.4, dist) / (1.0 + r * 0.012);',
    '  gl_Position = c;',
    '}'
  ].join('\n');

  var NEAR_FS = HEAD + [
    'in vec2 vQ;',
    'in float vA;',
    'out vec4 o;',
    'void main() {',
    '  float r = length(vQ);',
    '  float a = (1.0 - smoothstep(0.35, 1.0, r)) * (0.85 + 0.15 * smoothstep(0.4, 0.8, r));',
    '  o = vec4(vec3(1.0, 0.95, 0.88) * a * vA, 1.0);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------ scene */

  function isMobile() {
    var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    var small = Math.min(screen.width || 9999, screen.height || 9999) < 820;
    return !!(coarse && small);
  }

  function tier(forceMobile) {
    var mobile = forceMobile != null ? !!forceMobile : isMobile();
    return mobile
      ? { dprCap: 1.35, budget: 0.8e6, far: 3000, mid: 160, craterOct: 11, microOct: 7, bake: 384, bakeOct: 3 }
      : { dprCap: 1.5, budget: 2.2e6, far: 7500, mid: 380, craterOct: 12, microOct: 8, bake: 384, bakeOct: 3 };
  }

  function compileAll(gl) {
    var parallel = gl.getExtension('KHR_parallel_shader_compile');
    var progs = {}, pending = [];
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }
    function program(name, vs, fs, attribs) {
      var p = gl.createProgram();
      var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
      gl.attachShader(p, v); gl.attachShader(p, f);
      if (attribs) attribs.forEach(function (a, i) { gl.bindAttribLocation(p, i, a); });
      gl.linkProgram(p);
      progs[name] = { p: p, v: v, f: f, u: {} };
      pending.push(name);
    }
    program('moon', QUAD_VS, MOON_FS);
    program('macro', FS_VS, MACRO_FS);
    program('fig', FIG_VS, FIG_FS, ['aUV']);
    program('star', STAR_VS, STAR_FS, ['a0', 'a1', 'a2', 'a3']);
    program('bg', FS_VS, BG_FS);
    program('noise3', FS_VS, NOISE3_FS);
    program('bgbake', FS_VS, BGBAKE_FS);
    program('near', NEAR_VS, NEAR_FS);
    program('meteor', METEOR_VS, METEOR_FS);
    return { progs: progs, pending: pending, parallel: parallel };
  }

  // As soon as this file runs: probe WebGL2, size the canvas for the hero and
  // queue every shader compile, so the GPU process starts work while the rest
  // of the page loads (create() then reuses the context and programs).
  var prewarmT = {};
  function prewarm() {
    try {
      prewarmT.start = performance.now();
      var ok = supported();
      prewarmT.supported = performance.now();
      if (!ok || !spare || spare.cp) return;
      prewarmT.sized = performance.now();
      spare.cp = compileAll(spare.gl);
      prewarmT.queued = performance.now();
    } catch (e) { /* create() starts from scratch */ }
  }

  function create(container, opts) {
    opts = opts || {};
    if (!container || !supported()) return null;

    var Q = tier(opts.mobile);
    if (opts.quality) for (var qk in opts.quality) Q[qk] = opts.quality[qk];

    var Qunused = false
      ? { dprCap: 1.35, budget: 0.8e6, far: 3000, mid: 160, craterOct: 11, microOct: 7, bake: 384, bakeOct: 3 }
      : { dprCap: 1.5, budget: 2.2e6, far: 7500, mid: 380, craterOct: 12, microOct: 8, bake: 384, bakeOct: 3 };

    var capture = opts.capture != null ? !!opts.capture : /[?&]capture=1(&|$)/.test(location.search);
    var canvas, gl = null, cpReuse = null;
    var attrs = ctxAttrs();
    attrs.preserveDrawingBuffer = capture;
    if (spare && !spare.gl.isContextLost() && spare.gl.getContextAttributes().preserveDrawingBuffer === capture) {
      canvas = spare.canvas; gl = spare.gl; cpReuse = spare.cp || null;
    } else {
      canvas = document.createElement('canvas');
      try { gl = canvas.getContext('webgl2', attrs); } catch (e) { gl = null; }
    }
    spare = null;
    if (!gl) return null;
    canvas.className = 'space';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;opacity:0;pointer-events:none;';
    container.appendChild(canvas);

    var reduced = !!opts.reducedMotion;
    var captureDriven = false;
    var destroyed = false, failed = false;
    var raf = 0, visible = true, pageVisible = document.visibilityState !== 'hidden';
    var layers = { bg: true, far: true, mid: true, moon: true, figs: true, near: true };

    // camera state
    var e = 0;                 // path parameter
    var anim = null;           // { start, dur, e0, ease, resolves: [] }
    var waiting = [];          // promises waiting for e === 1
    var settled = false, lifeStart = 0;
    var scrollP = 0, scrollS = 0;
    var ptr = { x: 0, y: 0, sx: 0, sy: 0 };
    var finePointer = !capture && window.matchMedia && matchMedia('(pointer: fine)').matches;
    var t0 = performance.now();
    var lastTs = t0;
    var debugE = null, debugTime = null;
    var stats = { frames: 0, last: 0, fps: 0, ms: 0, acc: 0, n: 0 };
    var timing = { created: performance.now(), long: [] };
    function slow(label, t1) { var d = performance.now() - t1; if (d > 30) timing.long.push(label + ' ' + Math.round(d) + 'ms @' + Math.round(t1)); }

    var size = { w: 1, h: 1, bw: 1, bh: 1, dpr: 1 };
    var F = null, path = null;
    var figs = [], PM = null;
    var content = { x0: -1.08, x1: 1.52, y0: -1.0, y1: 2.12 };
    var START = { az: -24, el: -1, alt: 0.06 };

    /* ---------- GL setup ---------- */

    function finishProgram(name) {
      var P = progs[name];
      if (!gl.getProgramParameter(P.p, gl.LINK_STATUS)) {
        var log = gl.getShaderInfoLog(P.v) + '\n' + gl.getShaderInfoLog(P.f) + '\n' + gl.getProgramInfoLog(P.p);
        throw new Error('SpaceScene: ' + name + ' failed\n' + log);
      }
      var n = gl.getProgramParameter(P.p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) {
        var info = gl.getActiveUniform(P.p, i);
        var nm = info.name.replace(/\[0\]$/, '');
        P.u[nm] = gl.getUniformLocation(P.p, info.name);
      }
    }

    try { resize(); } catch (err) { /* sized again when ready */ }
    var CP = cpReuse || compileAll(gl);
    var progs = CP.progs, pending = CP.pending.slice(), parallel = CP.parallel;
    timing.programs = performance.now();

    function compiled() {
      return new Promise(function (resolve, reject) {
        function check() {
          if (destroyed || failed) return reject(new Error('SpaceScene: stopped'));
          if (parallel) {
            for (var i = 0; i < pending.length; i++) {
              if (!gl.getProgramParameter(progs[pending[i]].p, parallel.COMPLETION_STATUS_KHR)) {
                return requestAnimationFrame(check);
              }
            }
          }
          var tq = performance.now();
          try { pending.forEach(finishProgram); pending = []; slow('finishPrograms', tq); resolve(); } catch (err) { reject(err); }
        }
        check();
      });
    }

    var emptyVAO = gl.createVertexArray();

    /* ---------- baked textures: 3D noise and the large-scale moon ---------- */

    var noiseTex = null, macroG = null, macroM = null, bgTex = null;

    // octave rotations: R0 = I, R(i+1) = MROT * R(i)   (column-major, as in GLSL)
    var ROTS = (function () {
      var m = [0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64];
      var out = new Float32Array(14 * 9), R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      for (var i = 0; i < 14; i++) {
        out.set(R, i * 9);
        var n = [];
        for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) {
          var v = 0;
          for (var k = 0; k < 3; k++) v += m[k * 3 + r] * R[c * 3 + k];
          n[c * 3 + r] = v;
        }
        R = n;
      }
      return out;
    })();

    function bakeBg() {
      var S = 64;
      bgTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, bgTex);
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.RGBA8, S, S);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.push(bgTex);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, S, S);
      gl.disable(gl.BLEND);
      var P = progs.bgbake;
      gl.useProgram(P.p);
      gl.bindVertexArray(emptyVAO);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, noiseTex); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(P.u.uNoise, 2);
      gl.uniform1f(P.u.uSize, S);
      gl.uniform3fv(P.u.uBandN, bandN);
      for (var f = 0; f < 6; f++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, bgTex, 0);
        gl.uniform1i(P.u.uFace, f);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
    }

    function bakeNoise() {
      var N = 64;
      noiseTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, noiseTex);
      gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA8, N, N, N);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R].forEach(function (w) { gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT); });
      textures.push(noiseTex);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, N, N);
      gl.disable(gl.BLEND);
      gl.useProgram(progs.noise3.p);
      gl.bindVertexArray(emptyVAO);
      for (var z = 0; z < N; z++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, noiseTex, 0, z);
        gl.uniform1f(progs.noise3.u.uLayer, z);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
    }

    function cubeTex(S) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
      var levels = Math.floor(Math.log2(S)) + 1;
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, levels, gl.RGBA8, S, S);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.push(t);
      return t;
    }

    // the large-scale moon, a quarter face per step, two steps per frame; no
    // synchronous GL calls, so the main thread never waits for the GPU
    function bakeMacro() {
      var S = Q.bake, H = S / 2;
      macroG = cubeTex(S); macroM = cubeTex(S);
      var fb = gl.createFramebuffer();
      var fu = figUniforms().fa, sp = startPoint();
      return new Promise(function (resolve, reject) {
        var k = 0;
        function chunk() {
          var face = k >> 2, q = k & 3;
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          var tgt = gl.TEXTURE_CUBE_MAP_POSITIVE_X + face;
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tgt, macroG, 0);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, tgt, macroM, 0);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
          gl.viewport(0, 0, S, S);
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor((q & 1) * H, (q >> 1) * H, H, H);
          gl.disable(gl.BLEND);
          var P = progs.macro, U = P.u;
          gl.useProgram(P.p);
          gl.bindVertexArray(emptyVAO);
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, noiseTex); gl.activeTexture(gl.TEXTURE0);
          gl.uniform1i(U.uNoise, 2);
          gl.uniform1i(U.uFace, face);
          gl.uniform1f(U.uSize, S);
          gl.uniform1i(U.uBakeOct, Q.bakeOct);
          gl.uniform1i(U.uEight, 8);
          gl.uniform3fv(U.uStart, sp);
          gl.uniform4fv(U.uFig, fu);
          gl.uniform1i(U.uNFig, Math.min(3, figs.length));
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.disable(gl.SCISSOR_TEST);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.flush();
          k++;
        }
        function next() {
          if (destroyed || failed) { gl.deleteFramebuffer(fb); return reject(new Error('SpaceScene: stopped')); }
          if (performance.now() < quietTill) { requestAnimationFrame(next); return; }
          try {
            var tb = performance.now();
            chunk(); if (k < 24) chunk();
            slow('bake ' + k, tb);
            if (k < 24) { requestAnimationFrame(next); return; }
            gl.deleteFramebuffer(fb);
            [macroG, macroM].forEach(function (t) { gl.bindTexture(gl.TEXTURE_CUBE_MAP, t); gl.generateMipmap(gl.TEXTURE_CUBE_MAP); });
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
            resolve();
          } catch (err) { reject(err); }
        }
        next();
      });
    }

    // resolves once the GPU has finished everything issued so far (polled per frame)
    function gpuDone() {
      return new Promise(function (resolve) {
        var f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        function poll() {
          if (destroyed || failed) { resolve(); return; }
          if (!f || gl.getSyncParameter(f, gl.SYNC_STATUS) === gl.SIGNALED) { if (f) gl.deleteSync(f); resolve(); return; }
          requestAnimationFrame(poll);
        }
        requestAnimationFrame(poll);
      });
    }

    // Heavy GPU-process work (draw-time shader compiles, bakes) stops frame
    // production for the whole page, so it never starts inside a quiet window
    // (the logo pop / fade-out); see scene.quietUntil().
    var quietTill = 0;
    function whenQuiet() {
      return new Promise(function (resolve) {
        function chk() {
          if (destroyed || failed) { resolve(); return; }
          if (performance.now() < quietTill) { requestAnimationFrame(chk); return; }
          resolve();
        }
        chk();
      });
    }
    function steps(list) {
      return list.reduce(function (pr, fn) {
        return pr.then(function () { return whenQuiet(); }).then(function () {
          if (destroyed || failed) return;
          fn(); gl.flush();
          return new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
        });
      }, Promise.resolve());
    }

    // one tiny draw per program (one per frame) into 1×1 targets with the real
    // output layouts, so ANGLE's draw-time shader compiles happen now
    function warmPrograms() {
      var t1, t2, d2, d3, dc, fb;
      function units(n) {
        var u = progs[n].u;
        gl.useProgram(progs[n].p);
        if (u.uNoise) gl.uniform1i(u.uNoise, 2);
        if (u.uMacroG) gl.uniform1i(u.uMacroG, 3);
        if (u.uMacroM) gl.uniform1i(u.uMacroM, 4);
        if (u.uBg) gl.uniform1i(u.uBg, 5);
        if (u.uTex) gl.uniform1i(u.uTex, 0);
        if (u.uWts) gl.uniform1i(u.uWts, 1);
      }
      function bindTargets(two) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t1, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, two ? t2 : null, 0);
        gl.drawBuffers(two ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0]);
        gl.viewport(0, 0, 1, 1);
        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, d3);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_CUBE_MAP, dc);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_CUBE_MAP, dc);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_CUBE_MAP, dc);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, d2);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, d2);
      }
      function draw(n, vao, mode, two) {
        return function () {
          bindTargets(two);
          units(n);
          gl.bindVertexArray(vao || emptyVAO);
          gl.drawArrays(mode || gl.TRIANGLES, 0, mode === gl.POINTS ? 1 : 3);
          gl.bindVertexArray(null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        };
      }
      return steps([
        function () {
          t1 = gl.createTexture(); t2 = gl.createTexture(); d2 = gl.createTexture();
          [t1, t2, d2].forEach(function (t) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1); });
          d3 = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, d3); gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA8, 1, 1, 1);
          dc = gl.createTexture(); gl.bindTexture(gl.TEXTURE_CUBE_MAP, dc); gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.RGBA8, 1, 1);
          fb = gl.createFramebuffer();
        },
        draw('moon'), draw('macro', null, null, true), draw('fig', figGrid.vao), draw('star', farStars.vao, gl.POINTS),
        draw('bg'), draw('noise3'), draw('bgbake'), draw('near'), draw('meteor'),
        function () {
          gl.deleteFramebuffer(fb);
          [t1, t2, d2, d3, dc].forEach(function (t) { gl.deleteTexture(t); });
        }
      ]).then(gpuDone);
    }

    function figUniforms() {
      var fa = new Float32Array(12), sa = new Float32Array(12), sc = new Float32Array(12);
      figs.forEach(function (fg, i) {
        if (i > 2) return;
        var wd = Math.max(40, fg.span[1] - fg.span[0]) * K;
        fa[i * 4] = fg.anchor[0]; fa[i * 4 + 1] = fg.anchor[1]; fa[i * 4 + 2] = fg.anchor[2];
        fa[i * 4 + 3] = Math.max(0.12, wd * 0.9);
        sa[i * 4] = wd * 0.62; sa[i * 4 + 1] = 0.05;
        // just below the base on the near face, shifted away from the light (to the right)
        var A = fg.anchor;
        var tz = norm(sub([0, 0, 1], mul(A, A[2]))), tx = norm(sub([1, 0, 0], mul(A, A[0])));
        var C = norm(add(A, add(mul(tz, 0.045), mul(tx, wd * 0.22))));
        sc[i * 4] = C[0]; sc[i * 4 + 1] = C[1]; sc[i * 4 + 2] = C[2]; sc[i * 4 + 3] = fg.kind === 2 ? 0.5 : 0.58;
      });
      return { fa: fa, sa: sa, sc: sc };
    }

    /* ---------- stars ---------- */

    function kelvin(T) {
      var t = T / 100, r, g, b;
      if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
      else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
      return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
    }

    var bandN = norm([0.42, 0.86, 0.29]);
    var SKY_AXIS = norm([0.25, 1, 0.15]);

    var KT = [];
    for (var ki = 0; ki < 64; ki++) KT.push(kelvin(3400 + 9500 * Math.pow(ki / 63, 1.6)));
    function starAttrs(r, flux, sig, buf, o) {
      var k = KT[(r() * 63.99) | 0];
      var sat = 0.55;
      var col = [lerp(1, k[0], sat), lerp(1, k[1], sat), lerp(1, k[2], sat)];
      var lum = 0.3 * col[0] + 0.55 * col[1] + 0.15 * col[2];
      var tw = r() < (flux > 0.45 ? 0.5 : 0.12) ? 0.3 + 0.4 * r() : 0;
      buf[o + 3] = sig;
      buf[o + 4] = col[0] / lum * flux; buf[o + 5] = col[1] / lum * flux; buf[o + 6] = col[2] / lum * flux;
      buf[o + 7] = tw;
      buf[o + 8] = (flux > 0.45 ? 1.1 + 3.2 * r() : 1.6 + 5.5 * r()); buf[o + 9] = r() * TAU;
      buf[o + 10] = 0;
    }

    function buildFar(n) {
      var r = rng(4021), buf = new Float32Array(n * 11);
      var u = norm(cross(bandN, [0, 0, 1])), v = cross(bandN, u);
      for (var i = 0; i < n; i++) {
        var o = i * 11, d, inBand = r() < 0.4;
        if (inBand) {
          var lon = r() * TAU;
          // clumpy along the band
          var clump = 0.5 + 0.5 * Math.sin(lon * 3.0 + 1.0) * Math.sin(lon * 7.0 + 2.0);
          if (r() > 0.35 + 0.65 * clump) lon = r() * TAU;
          var g = (r() + r() + r() - 1.5) * 0.17;
          d = norm(add(add(mul(u, Math.cos(lon)), mul(v, Math.sin(lon))), mul(bandN, g)));
        } else {
          var z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z);
          d = [s * Math.cos(a), z, s * Math.sin(a)];
        }
        buf[o] = d[0]; buf[o + 1] = d[1]; buf[o + 2] = d[2];
        var x = r();
        // strongly skewed: most barely visible, a few clearly brighter, a handful with a soft glow
        var flux = inBand ? 0.035 + 0.4 * Math.pow(x, 8) : 0.05 + 2.0 * Math.pow(x, 11);
        var glow = 0;
        if (!inBand && r() < 0.004) { flux = 2.5 + 3.5 * r(); glow = 0.6 + 0.4 * r(); }
        var sig = 0.4 + 0.42 * Math.pow(Math.min(flux, 4) / 4, 0.6) + 0.12 * r();
        starAttrs(r, flux * 2.4, sig, buf, o);
        buf[o + 10] = glow;
      }
      return buf;
    }

    function buildMid(n) {
      var r = rng(9137), buf = new Float32Array(n * 11);
      for (var i = 0; i < n; i++) {
        var o = i * 11, d;
        if (r() < 0.68) {
          // a cone around the final view direction (−Z)
          var ca = Math.cos(36 * DEG), z = ca + (1 - ca) * r(), a = r() * TAU, s = Math.sqrt(1 - z * z);
          d = [s * Math.cos(a), s * Math.sin(a), -z];
        } else {
          do {
            var z2 = r() * 2 - 1, a2 = r() * TAU, s2 = Math.sqrt(1 - z2 * z2);
            d = [s2 * Math.cos(a2), z2, s2 * Math.sin(a2)];
          } while (d[2] > 0.3);
        }
        var dist = 25 * Math.pow(6, r());
        buf[o] = d[0] * dist; buf[o + 1] = d[1] * dist; buf[o + 2] = d[2] * dist;
        var flux = (0.05 + 1.8 * Math.pow(r(), 9)) * Math.pow(40 / dist, 0.5);
        var sig = 0.42 + 0.35 * Math.min(1, flux / 1.5) + 0.1 * r();
        starAttrs(r, flux * 2.4, sig, buf, o);
      }
      return buf;
    }

    function starVAO(data) {
      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 44, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 44, 16);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 44, 32);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 44, 40);
      gl.bindVertexArray(null);
      return { vao: vao, buf: b, n: data.length / 11 };
    }

    var farData = buildFar(Q.far);
    // three softly glinting stars in the open sky of the final view
    [[-0.42, 0.26, -1], [0.47, 0.17, -1], [-0.28, -0.24, -1]].forEach(function (g, i) {
      var d = norm(g), o = i * 11;
      farData[o] = d[0]; farData[o + 1] = d[1]; farData[o + 2] = d[2]; farData[o + 3] = 0.85;
      farData[o + 4] = 6.2; farData[o + 5] = 6.3; farData[o + 6] = 6.6; farData[o + 7] = 0.35;
      farData[o + 8] = 3.4 + 1.3 * i; farData[o + 9] = i * 2.1; farData[o + 10] = 1;
    });
    var farStars = starVAO(farData);
    var midStars = starVAO(buildMid(Q.mid));
    timing.stars = performance.now();

    /* ---------- figure billboards ---------- */

    var gridN = 28;
    var figGrid = (function () {
      var verts = new Float32Array((gridN + 1) * (gridN + 1) * 2), idx = new Uint16Array(gridN * gridN * 6), i, j, k = 0;
      for (j = 0; j <= gridN; j++) for (i = 0; i <= gridN; i++) { verts[k++] = i / gridN; verts[k++] = j / gridN; }
      k = 0;
      for (j = 0; j < gridN; j++) for (i = 0; i < gridN; i++) {
        var a = j * (gridN + 1) + i, b = a + 1, c = a + gridN + 1, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao: vao, vb: vb, ib: ib, count: idx.length };
    })();

    var textures = [];
    function texture(src, premult) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!premult);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, premult ? gl.BROWSER_DEFAULT_WEBGL : gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      textures.push(t);
      return t;
    }

    function loadImage(url, low) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.decoding = 'async';
        if (low) { try { img.fetchPriority = 'low'; } catch (e) { /* older browsers */ } }
        img.onload = function () {
          (img.decode ? img.decode() : Promise.resolve()).then(function () { resolve(img); }, function () { resolve(img); });
        };
        img.onerror = function () { reject(new Error('SpaceScene: image failed ' + url)); };
        img.src = url;
      });
    }

    // weights: decode without premultiplication / colour management when possible
    function loadData(url) {
      if (window.createImageBitmap && window.fetch) {
        return fetch(url).then(function (r) {
          if (!r.ok) throw new Error('SpaceScene: ' + url + ' ' + r.status);
          return r.blob();
        }).then(function (b) {
          return createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        }).catch(function () { return loadImage(url); });
      }
      return loadImage(url);
    }

    // figures.json first (anchors, masks); the sprites stream in afterwards at low
    // priority (WebP copies when present) and fade in when they arrive
    var spritesP = null;
    function loadFigures() {
      var url = opts.figuresUrl;
      if (!url) return Promise.reject(new Error('SpaceScene: figuresUrl missing'));
      var base = new URL(url, location.href);
      return fetch(base.href).then(function (r) {
        if (!r.ok) throw new Error('SpaceScene: figures.json ' + r.status);
        return r.json();
      }).then(function (j) {
        PM = j.paintedMoon;
        TOPLINE = Array.isArray(j.paintedMoonTopLine) && j.paintedMoonTopLine.length > 1
          ? j.paintedMoonTopLine.slice().sort(function (a, b) { return a[0] - b[0]; }) : null;
        if (!PM || !j.figures || !j.figures.length) throw new Error('SpaceScene: figures.json incomplete');
        var order = { tree: 0, fox: 1, prince: 2 };
        var list = j.figures.slice().sort(function (a, b) { return (order[a.id] || 0) - (order[b.id] || 0); });
        figs = list.map(function (f) {
          return {
            id: f.id, kind: f.id === 'prince' ? 0 : f.id === 'fox' ? 1 : 2,
            W: f.width, H: f.height,
            srcX: f.srcX, srcY: f.srcY, base: f.base, topY: f.topY || 0,
            span: f.baseSpan || [0, f.width], neck: f.neck || [0, 0],
            tex: null, wts: null, anchor: [0, 1, 0], shownAt: 0,
            src: new URL(f.file, base).href, wsrc: f.weights ? new URL(f.weights, base).href : null
          };
        });
        spritesP = Promise.all(figs.map(loadSprite));
        spritesP.catch(function () { /* a missing sprite only hides that figure */ });
      });
    }

    function loadSprite(fig) {
      var webp = fig.src.replace(/\.png(\?|$)/i, '.webp$1');
      var img = webp !== fig.src
        ? loadImage(webp, true).catch(function () { return loadImage(fig.src, true); })
        : loadImage(fig.src, true);
      return Promise.all([img, fig.wsrc ? loadData(fig.wsrc) : Promise.resolve(null)]).then(function (imgs) {
        if (destroyed || failed) return;
        // uploading while the GPU process is still compiling shaders blocks the main
        // thread for the length of that compile: wait until the scene is ready (GPU idle)
        uploadQ.push(function () { uploadSprite(fig, imgs); });
        if (isReady) kick();
      });
    }

    var uploadQ = [];
    function drainUpload() {
      if (!isReady || !uploadQ.length) return;
      uploadQ.shift()();
    }

    function uploadSprite(fig, imgs) {
      {
        fig.W = fig.W || imgs[0].naturalWidth; fig.H = fig.H || imgs[0].naturalHeight;
        var tu = performance.now();
        fig.tex = texture(imgs[0], true);
        slow('upload ' + fig.id, tu);
        if (imgs[1]) fig.wts = texture(imgs[1], false);
        else {
          fig.wts = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, fig.wts);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          textures.push(fig.wts);
        }
        if (imgs[1] && imgs[1].close) imgs[1].close();
        fig.shownAt = performance.now();
        heldDrawn = false;
      }
    }

    /* ---------- framing and path ---------- */

    var K = 1; // world units per painted pixel (1 / painted moon radius)
    var TOPLINE = null;
    var MOUND_AMP = 0, MOUND_R = [0.25, 1.15];
    var moundAxis = [0, 1, 0];

    // the painted ground line (painting px): measured top line, else the painted ellipse
    function paintedGround(x) {
      var T = TOPLINE;
      if (T && x >= T[0][0] && x <= T[T.length - 1][0]) {
        for (var i = 0; i < T.length - 1; i++) {
          if (x <= T[i + 1][0]) return lerp(T[i][1], T[i + 1][1], (x - T[i][0]) / (T[i + 1][0] - T[i][0] || 1));
        }
      }
      var dx = clamp((x - PM.cx) / PM.rx, -1, 1);
      var ye = PM.cy - PM.ry * Math.sqrt(1 - dx * dx);
      if (T) {
        // continue the measured line smoothly into the ellipse
        var e = x < T[0][0] ? T[0] : T[T.length - 1];
        var de = clamp((e[0] - PM.cx) / PM.rx, -1, 1);
        ye += e[1] - (PM.cy - PM.ry * Math.sqrt(1 - de * de));
      }
      return ye;
    }

    function moundAt(q) {
      var th = Math.acos(clamp(dot(norm(q), moundAxis), -1, 1));
      return MOUND_AMP * 0.5 * th * th * (1 - smooth(MOUND_R[0], MOUND_R[1], th));
    }

    function silhouetteAnchors(D, elDeg) {
      var c = sph(0, elDeg * DEG);
      var e1 = [1, 0, 0];
      var e2 = norm(sub(Y, mul(c, c[1])));
      var rho = Math.sqrt(1 - 1 / (D * D));
      function onSil(xp) {
        var s = clamp(xp, -0.96, 0.96);
        return add(mul(c, 1 / D), add(mul(e1, rho * s), mul(e2, rho * Math.sqrt(1 - s * s))));
      }
      // plateau centred between the outermost contacts
      var x0 = 1e9, x1 = -1e9;
      figs.forEach(function (f) { var x = f.srcX + f.base[0]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); });
      moundAxis = norm(onSil(((x0 + x1) / 2 - PM.cx) / PM.rx));
      figs.forEach(function (f) {
        f.xp = (f.srcX + f.base[0] - PM.cx) / PM.rx;
        f.anchor = onSil(f.xp);
        f.anchorW = mul(f.anchor, 1 + moundAt(f.anchor));
        // painted ground under the sprite, relative to its base (world units, up +)
        var by = f.srcY + f.base[1], g = new Float32Array(17);
        for (var k = 0; k <= 16; k++) g[k] = -(paintedGround(f.srcX + k / 16 * f.W) - by) * K;
        f.ground = g;
      });
    }

    function measureContent() {
      if (!figs.length) return;
      var x0 = -1, x1 = 1, y1 = 1, pad = 14;
      figs.forEach(function (f) {
        var A = f.anchorW || f.anchor;
        x0 = Math.min(x0, A[0] + (pad - f.base[0]) * K);
        x1 = Math.max(x1, A[0] + (f.W - pad - f.base[0]) * K);
        y1 = Math.max(y1, A[1] + (f.base[1] - f.topY) * K);
      });
      content = { x0: x0, x1: x1, y0: -1, y1: y1 };
    }

    function framing(w, h) {
      var aspect = w / h;
      var vfov = aspect >= 1 ? 30 : Math.max(30, Math.min(52, 2 * Math.atan(Math.tan(10 * DEG) / aspect) / DEG));
      var tanH = Math.tan(vfov * DEG / 2), fpx = (h / 2) / tanH;
      var narrow = w < 640, short = h < 520;
      var padT = short ? 112 : Math.max(narrow ? 64 : 72, h * 0.075);
      var padB = short ? 58 : Math.max(narrow ? 76 : 84, h * 0.085);
      var band = h - padT - padB;
      var cw = content.x1 - content.x0, ch = content.y1 - content.y0;
      var wf = aspect < 1 ? 0.84 : 0.88;
      var R = Math.min(0.16 * h, wf * w / cw, band / (ch * 1.02));
      var D = Math.sqrt(1 + (fpx / R) * (fpx / R));
      var ccx = (content.x0 + content.x1) / 2;
      var bias = aspect < 1 ? 1 : lerp(1, 0.35, smooth(0.9, 1.5, aspect));
      var mx = -ccx * R * bias;
      var lim = w * (1 - wf) / 2;
      mx = clamp(mx, -w / 2 + lim - content.x0 * R, w / 2 - lim - content.x1 * R);
      var slack = band - ch * R;
      var mid = padT + band / 2 - Math.min(Math.max(slack, 0) * 0.18, h * 0.035);
      var my = (mid - h / 2) + ((content.y0 + content.y1) / 2) * R;
      return {
        vfov: vfov, fpx: fpx, R: R, D: D, az: 0, el: 2.5,
        pitch: Math.atan(my / fpx) / DEG, yaw: -Math.atan(mx / fpx) / DEG
      };
    }

    // camera channels at keyframes of e: log distance, orbit az/el, view pitch/yaw (deg)
    function buildPath(Fm) {
      var ks = [
        [0.00, Math.log(1 + START.alt), START.az, START.el, 0, 0],
        [0.18, Math.log(1.38), -21, -1.5, 26, 0],
        [0.44, Math.log(2.15), -13, 0.0, 24, Fm.yaw * 0.15],
        [0.71, Math.log(4.6), -4, 2.6, 12.5, Fm.yaw * 0.6],
        [1.00, Math.log(Fm.D), Fm.az, Fm.el, Fm.pitch, Fm.yaw]
      ];
      var xs = ks.map(function (k) { return k[0]; });
      var ch = [];
      for (var c = 1; c < 6; c++) ch.push(pchip(xs, ks.map(function (k) { return k[c]; })));
      return function (x) { return [ch[0](x), ch[1](x), ch[2](x), ch[3](x), ch[4](x)]; };
    }

    function camera(x, extra) {
      var v = path(x);
      var d = Math.exp(v[0] + (extra ? extra.dlog : 0));
      var az = (v[1] + (extra ? extra.az : 0)) * DEG, el = (v[2] + (extra ? extra.el : 0)) * DEG;
      var pitch = (v[3] + (extra ? extra.pitch : 0)) * DEG, yaw = v[4] * DEG;
      var dir = sph(az, el);
      var pos = mul(dir, d);
      var fwd = mul(dir, -1);
      var right = norm(cross(fwd, Y));
      var up = cross(right, fwd);
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      var f2 = add(mul(fwd, cp), mul(up, sp));
      var u2 = sub(mul(up, cp), mul(fwd, sp));
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var f3 = add(mul(f2, cy), mul(right, sy));
      var r3 = sub(mul(right, cy), mul(f2, sy));
      return { pos: pos, fwd: f3, right: r3, up: u2, d: d };
    }

    function startPoint() { return sph(START.az * DEG, START.el * DEG); }

    /* ---------- near particles ---------- */

    var nearP = [];
    var METEORS = (function () {
      var r = rng(5309), out = [], t = 2.2 + 1.6 * r();
      for (var i = 0; i < 90; i++) {
        var faint = r() < 0.25;
        out.push({ t: t, dur: 0.6 + 0.6 * r(), len: (faint ? 0.55 : 1) * (80 + 160 * r()), a: faint ? 0.45 : 0.85 + 0.15 * r(), seed: 7000 + i });
        t += (Q.far < 5000 ? 1.6 : 1) * (5 + 6 * r());
      }
      return out;
    })();
    var GUSTS = (function () {
      var r = rng(811), out = [], t = 3 + 4 * r();
      for (var i = 0; i < 120; i++) { var d = 1.5 + r(); out.push([t, d, 0.7 + 0.3 * r()]); t += d + 8 + 7 * r(); }
      return out;
    })();
    function gustAt(t) {
      for (var i = 0; i < GUSTS.length; i++) {
        var g = GUSTS[i];
        if (t < g[0]) break;
        if (t < g[0] + g[1] + 1.2) return g[2] * smooth(0, 0.45, t - g[0]) * (1 - smooth(g[1] - 0.2, g[1] + 1.2, t - g[0]));
      }
      return 0;
    }
    // screen rect (css px) of moon + figures in the final view, kept clear of meteors
    function contentRect() {
      var cx = size.w / 2 - F.fpx * Math.tan(F.yaw * DEG), cy = size.h / 2 + F.fpx * Math.tan(F.pitch * DEG), R = F.R, m = 60;
      return [cx + content.x0 * R - m, cy - content.y1 * R - m, cx + content.x1 * R + m, cy + R + m];
    }
    function meteorPath(mt) {
      if (mt.path !== undefined && mt.pathKey === size.w + 'x' + size.h) return mt.path;
      var r = rng(mt.seed), rc = contentRect(), best = null;
      for (var tries = 0; tries < 14 && !best; tries++) {
        var narrowS = size.w < 700;
        var x0 = (0.04 + 0.92 * r()) * size.w, y0 = (0.03 + (narrowS ? 0.9 : 0.5) * r()) * size.h;
        var ang = (125 + 40 * r()) * DEG;   // down-left diagonal, ±20°
        var dx = Math.cos(ang), dy = Math.sin(ang), travel = mt.len * (narrowS ? 0.9 : 1.9);
        var ok = true;
        for (var k = -1; k <= 10 && ok; k++) {
          var px = x0 + dx * travel * k / 10, py = y0 + dy * travel * k / 10;
          if (px < 8 || py < 8 || px > size.w - 8 || py > size.h - 8) ok = false;
          if (px > rc[0] && px < rc[2] && py > rc[1] && py < rc[3]) ok = false;
        }
        if (ok) best = [x0, y0, dx, dy, travel];
      }
      mt.path = best; mt.pathKey = size.w + 'x' + size.h;
      return best;
    }

    var dustP = [], camF = null;
    function buildDust() {
      var r = rng(4441), n = Q.far < 5000 ? 5 : 8;
      camF = camera(1);
      dustP = [];
      for (var i = 0; i < n; i++) {
        dustP.push({ z: 2.2 + 7 * r(), u: r() * 2.5 - 1.25, v: (r() * 2 - 1) * 0.85,
          vu: (r() < 0.5 ? -1 : 1) * (0.008 + 0.022 * r()), vv: (r() - 0.5) * 0.006,
          rw: 0.009 + 0.014 * r(), a: 0.028 + 0.03 * r() });
      }
    }

    function buildNear() {
      buildDust();
      var r = rng(771);
      nearP = [];
      var es = [0.34, 0.45, 0.55, 0.63, 0.72, 0.8];
      es.forEach(function (ek) {
        var c = camera(ek);
        var ang = r() * TAU, lat = (0.3 + 0.35 * r()) * c.d;
        var off = add(mul(c.right, Math.cos(ang) * lat * 1.5), mul(c.up, Math.sin(ang) * lat));
        var p = add(add(c.pos, off), mul(c.fwd, (0.1 + 0.25 * r()) * c.d));
        nearP.push({ p: p, rw: (0.006 + 0.01 * r()) * c.d, a: 0.05 + 0.07 * r() });
      });
    }

    /* ---------- render ---------- */

    var M = { proj: new Float32Array(16), view: new Float32Array(16), pv: new Float32Array(16), pv0: new Float32Array(16) };

    function mat(out, a, b) {
      for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
        var s = 0;
        for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        out[i * 4 + j] = s;
      }
      return out;
    }

    function ambientTime(ts) { return debugTime != null ? debugTime : (ts - t0) / 1000; }

    function cameraExtra(ts) {
      var x = { dlog: 0, az: 0, el: 0, pitch: 0 };
      var t = ambientTime(ts);
      if (settled && !reduced) {
        var k = smooth(0, 1, (ts - lifeStart) / 3000);
        if (debugTime != null) k = 1;
        x.az += k * (1.5 * Math.sin(t * TAU / 52 + 0.7) + 0.3 * Math.sin(t * TAU / 29 + 2.1));
        x.el += k * (0.7 * Math.sin(t * TAU / 61 + 1.9) + 0.15 * Math.sin(t * TAU / 23));
        x.dlog += k * 0.03 * Math.sin(t * TAU / 47 + 0.4);
        x.az += k * ptr.sx * 1.4;
        x.el += k * ptr.sy * 0.9;
      }
      // scroll: the camera eases back and up a little first
      var sp = smooth(0, 0.6, scrollS);
      x.dlog += 0.07 * sp;
      x.el += 2.2 * sp;
      x.pitch += -1.2 * sp;
      return x;
    }

    var cam = null;

    // NDC rectangle around the moon's silhouette (null when off screen)
    function moonRect(c, tanH, aspect) {
      var d = c.d, r = 1.035 + MOUND_AMP * 0.2;
      if (d < r * 1.06) return [-1, -1, 1, 1];
      var n = mul(c.pos, 1 / d);
      var cc = mul(n, r * r / d), rr = r * Math.sqrt(1 - r * r / (d * d));
      var u = norm(cross(n, Math.abs(n[1]) < 0.9 ? Y : [1, 0, 0])), v = cross(n, u);
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (var i = 0; i < 24; i++) {
        var a = i / 24 * TAU;
        var q = add(cc, add(mul(u, rr * Math.cos(a)), mul(v, rr * Math.sin(a))));
        var rel = sub(q, c.pos), z = dot(rel, c.fwd);
        if (z < 0.01) return [-1, -1, 1, 1];
        var sx = dot(rel, c.right) / (z * tanH * aspect), sy = dot(rel, c.up) / (z * tanH);
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      var mx = (x1 - x0) * 0.02 + 6 / size.bw, my = (y1 - y0) * 0.02 + 6 / size.bh;
      x0 = Math.max(-1, x0 - mx); x1 = Math.min(1, x1 + mx); y0 = Math.max(-1, y0 - my); y1 = Math.min(1, y1 + my);
      if (x0 >= x1 || y0 >= y1) return null;
      return [x0, y0, x1, y1];
    }

    // offscreen target for reduced-resolution frames (blitted up to the canvas)
    var off = { fb: null, rb: null, w: 0, h: 0 };
    function offscreen() {
      if (off.fb && off.w === size.bw && off.h === size.bh) return off.fb;
      if (!off.fb) { off.fb = gl.createFramebuffer(); off.rb = gl.createRenderbuffer(); }
      gl.bindRenderbuffer(gl.RENDERBUFFER, off.rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, size.bw, size.bh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, off.fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, off.rb);
      off.w = size.bw; off.h = size.bh;
      return off.fb;
    }
    var rscale = 1, frameEMA = 16.7, prevFrameTs = 0, heldDrawn = false, warm = 8;

    function render(ts) {
      var rs = capture ? 1 : rscale;
      var w = Math.max(1, Math.round(size.bw * rs)), h = Math.max(1, Math.round(size.bh * rs));
      var scaled = w < size.bw - 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, scaled ? offscreen() : null);
      var aspect = size.w / size.h;
      var x = e;
      cam = camera(x, cameraExtra(ts));
      var tanH = Math.tan(F.vfov * DEG / 2);
      var near = 0.002, far = 1200, f = 1 / tanH;
      var P = M.proj;
      P.fill(0);
      P[0] = f / aspect; P[5] = f; P[10] = (far + near) / (near - far); P[11] = -1; P[14] = 2 * far * near / (near - far);
      var V = M.view, r = cam.right, u = cam.up, fw = cam.fwd, p = cam.pos;
      V[0] = r[0]; V[4] = r[1]; V[8] = r[2]; V[12] = -dot(r, p);
      V[1] = u[0]; V[5] = u[1]; V[9] = u[2]; V[13] = -dot(u, p);
      V[2] = -fw[0]; V[6] = -fw[1]; V[10] = -fw[2]; V[14] = dot(fw, p);
      V[3] = 0; V[7] = 0; V[11] = 0; V[15] = 1;
      mat(M.pv, P, V);

      var rays = [];
      [[-1, -1], [3, -1], [-1, 3]].forEach(function (c) {
        var d = add(fw, add(mul(r, c[0] * tanH * aspect), mul(u, c[1] * tanH)));
        rays.push(d[0], d[1], d[2]);
      });
      var pxAng = 2 * tanH / h;
      var t = ambientTime(ts);
      var gain = 1 - 0.7 * smooth(0.08, 1.1, scrollS);
      var life = reduced ? 0 : 1;

      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(emptyVAO);

      var U;
      if (layers.bg) {
        gl.disable(gl.BLEND);
        gl.useProgram(progs.bg.p); U = progs.bg.u;
        gl.uniform3fv(U.uRay, rays);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_CUBE_MAP, bgTex);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(U.uBg, 5);
        gl.uniform1f(U.uGain, gain);
        gl.uniform2f(U.uRes, w, h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      if (layers.far || layers.mid) {
        gl.useProgram(progs.star.p); U = progs.star.u;
        gl.uniform1f(U.uPx, size.dpr * w / size.bw);
        gl.uniform1f(U.uTime, reduced ? 0 : t);
        gl.uniform1f(U.uGain, gain);
        if (layers.far) {
          var P0 = M.pv0, V0 = new Float32Array(V); V0[12] = 0; V0[13] = 0; V0[14] = 0;
          var sa = reduced ? 0 : t * 0.11 * DEG, ax = SKY_AXIS, cs = Math.cos(sa), sn = Math.sin(sa), oc = 1 - cs;
          var Rs = new Float32Array([
            cs + ax[0] * ax[0] * oc, ax[1] * ax[0] * oc + ax[2] * sn, ax[2] * ax[0] * oc - ax[1] * sn, 0,
            ax[0] * ax[1] * oc - ax[2] * sn, cs + ax[1] * ax[1] * oc, ax[2] * ax[1] * oc + ax[0] * sn, 0,
            ax[0] * ax[2] * oc + ax[1] * sn, ax[1] * ax[2] * oc - ax[0] * sn, cs + ax[2] * ax[2] * oc, 0,
            0, 0, 0, 1]);
          mat(P0, P, mat(new Float32Array(16), V0, Rs));
          gl.uniformMatrix4fv(U.uPV, false, P0);
          gl.uniform1f(U.uW, 0);
          gl.bindVertexArray(farStars.vao);
          gl.drawArrays(gl.POINTS, 0, farStars.n);
        }
        if (layers.mid) {
          gl.uniformMatrix4fv(U.uPV, false, M.pv);
          gl.uniform1f(U.uW, 1);
          gl.bindVertexArray(midStars.vao);
          gl.drawArrays(gl.POINTS, 0, midStars.n);
        }
        gl.bindVertexArray(emptyVAO);
      }

      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      var lifeK = settled && !reduced ? (debugTime != null ? 1 : smooth(0, 1, (ts - lifeStart) / 3000)) : 0;
      if (lifeK > 0 && layers.near) {
        var tl = debugTime != null ? debugTime : (ts - lifeStart) / 1000;
        var sx = w / size.w, sy = h / size.h, mU = null;
        for (var mi = 0; mi < METEORS.length; mi++) {
          var mt = METEORS[mi];
          if (tl < mt.t) break;
          var mu = (tl - mt.t) / mt.dur;
          if (mu >= 1) continue;
          var mp = meteorPath(mt);
          if (!mp) continue;
          if (!mU) {
            gl.blendFunc(gl.ONE, gl.ONE);
            gl.useProgram(progs.meteor.p); mU = progs.meteor.u;
            gl.uniform2f(mU.uRes, w, h);
            gl.uniform1f(mU.uHalfW, 0.9 * sx);
          }
          var hx = mp[0] + mp[2] * mp[4] * mu, hy = mp[1] + mp[3] * mp[4] * mu;
          var tlen = mt.len * (size.w < 700 ? 0.5 : 1) * Math.min(1, mu / 0.3);
          var tx = hx - mp[2] * tlen, ty = hy - mp[3] * tlen;
          gl.uniform4f(mU.uSeg, hx * sx, (size.h - hy) * sy, tx * sx, (size.h - ty) * sy);
          gl.uniform1f(mU.uAlpha, mt.a * lifeK * gain * smooth(0, 0.12, mu) * (1 - smooth(0.6, 1, mu)));
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      var rect = layers.moon ? moonRect(cam, tanH, aspect) : null;
      if (rect) {
        gl.useProgram(progs.moon.p); U = progs.moon.u;
        gl.uniform4f(U.uRect, rect[0], rect[1], rect[2], rect[3]);
        var rq = [];
        [[rect[0], rect[1]], [rect[2], rect[1]], [rect[0], rect[3]], [rect[2], rect[3]]].forEach(function (c) {
          var d = add(fw, add(mul(r, c[0] * tanH * aspect), mul(u, c[1] * tanH)));
          rq.push(d[0], d[1], d[2]);
        });
        gl.uniform3fv(U.uRayQ, rq);
        gl.uniformMatrix3fv(U.uRot, false, ROTS);
        gl.uniform3fv(U.uCam, cam.pos);
        gl.uniform3fv(U.uL, LIGHT);
        gl.uniform3fv(U.uStart, startPoint());
        gl.uniform1f(U.uPxAng, pxAng);
        gl.uniform1f(U.uCraterOct, Q.craterOct);
        gl.uniform1f(U.uMicroOct, Q.microOct);
        gl.uniform1f(U.uExposure, EXPOSURE);
        gl.uniform1i(U.uBakeOct, Q.bakeOct);
        gl.uniform1i(U.uCraterOctI, Math.min(14, Q.craterOct));
        gl.uniform1i(U.uMicroOctI, Math.min(11, Q.microOct));
        gl.uniform4f(U.uMound, moundAxis[0], moundAxis[1], moundAxis[2], MOUND_AMP);
        gl.uniform2f(U.uMoundR, MOUND_R[0], MOUND_R[1]);
        var fu = figUniforms();
        gl.uniform4fv(U.uFig, fu.fa);
        gl.uniform4fv(U.uShadow, fu.sa);
        gl.uniform4fv(U.uShadowC, fu.sc);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, noiseTex);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_CUBE_MAP, macroG);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_CUBE_MAP, macroM);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(U.uNoise, 2); gl.uniform1i(U.uMacroG, 3); gl.uniform1i(U.uMacroM, 4);
        gl.uniform1i(U.uNFig, Math.min(3, figs.length));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      if (layers.figs && figs.length && PM) {
        gl.useProgram(progs.fig.p); U = progs.fig.u;
        gl.uniformMatrix4fv(U.uPV, false, M.pv);
        gl.uniform3fv(U.uCam, cam.pos);
        gl.uniform1f(U.uPxAng, pxAng);
        gl.uniform1f(U.uTime, t);
        gl.uniform1f(U.uLife, life);
        gl.uniform1f(U.uGust, reduced ? 0 : gustAt(t));
        gl.uniform1f(U.uK, K);
        gl.uniform1f(U.uSink, 0.003);

        gl.uniform1f(U.uGain, 1);
        gl.uniform1i(U.uTex, 0);
        gl.uniform1i(U.uWts, 1);
        gl.bindVertexArray(figGrid.vao);
        gl.uniform4f(U.uMound, moundAxis[0], moundAxis[1], moundAxis[2], MOUND_AMP);
        gl.uniform2f(U.uMoundR, MOUND_R[0], MOUND_R[1]);
        figs.forEach(function (fg) {
          if (!fg.tex) return;
          gl.uniform1f(U.uFade, smooth(0, 450, ts - fg.shownAt));
          var A = fg.anchor, AW = fg.anchorW;
          var tc = sub(cam.pos, AW); tc[1] = 0;
          var fd = norm(tc);
          var rt = norm(cross(Y, fd));
          var fa2 = dot(A, fd);
          gl.uniform2f(U.uSize, fg.W, fg.H);
          gl.uniform2f(U.uBase, fg.base[0], fg.base[1]);
          gl.uniform2f(U.uNeck, fg.neck[0], fg.neck[1]);
          gl.uniform3fv(U.uAnchorW, AW);
          gl.uniform1f(U.uAnchorY, AW[1]);
          gl.uniform3fv(U.uRight, rt);
          gl.uniform2f(U.uCirc, dot(A, rt), 1 - fa2 * fa2);
          gl.uniform1fv(U.uGround, fg.ground);
          gl.uniform1f(U.uFigH, (fg.base[1] - fg.topY) * K);
          gl.uniform1f(U.uKind, fg.kind);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fg.tex);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fg.wts);
          gl.drawElements(gl.TRIANGLES, figGrid.count, gl.UNSIGNED_SHORT, 0);
        });
        gl.activeTexture(gl.TEXTURE0);
        gl.bindVertexArray(emptyVAO);
      }

      if (layers.near && !reduced) {
        var vis = smooth(0.22, 0.38, x) * (1 - smooth(0.86, 0.985, x));
        var dustK = Math.max(lifeK, 0.6 * smooth(0.93, 1, x));
        var list = nearP;
        if (vis <= 0.001 && dustK > 0.001 && camF) {
          vis = dustK;
          list = dustP.map(function (d) {
            var span = 2.5, uu = d.u + d.vu * t;
            uu = ((uu + 1.25) % span + span) % span - 1.25;
            var vv = d.v + d.vv * Math.sin(t * 0.05 + d.z);
            var fade = 1 - smooth(1.0, 1.25, Math.abs(uu));
            var q = add(camF.pos, add(add(mul(camF.right, uu * d.z * tanH * aspect), mul(camF.up, vv * d.z * tanH)), mul(camF.fwd, d.z)));
            return { p: q, rw: d.rw * d.z, a: d.a * fade };
          });
        }
        if (vis > 0.001) {
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(progs.near.p); U = progs.near.u;
          var pa = new Float32Array(32), aa = new Float32Array(8);
          list.forEach(function (q, i) {
            pa[i * 4] = q.p[0]; pa[i * 4 + 1] = q.p[1]; pa[i * 4 + 2] = q.p[2]; pa[i * 4 + 3] = q.rw;
            // hidden if the moon is in front
            var rd = sub(q.p, cam.pos), tf = len(rd); rd = mul(rd, 1 / tf);
            var b = dot(cam.pos, rd), c = dot(cam.pos, cam.pos) - 1, di = b * b - c;
            var occ = di > 0 && (-b - Math.sqrt(di)) < tf;
            aa[i] = occ ? 0 : q.a * vis;
          });
          gl.uniform4fv(U.uP, pa);
          gl.uniform1fv(U.uA, aa);
          gl.uniformMatrix4fv(U.uPV, false, M.pv);
          gl.uniform3fv(U.uCam, cam.pos);
          gl.uniform2f(U.uRes, w, h);
          gl.uniform1f(U.uFpx, (h / 2) / tanH);
          gl.drawArrays(gl.TRIANGLES, 0, list.length * 6);
        }
      }
      gl.bindVertexArray(null);
      if (scaled) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, off.fb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, size.bw, size.bh, gl.COLOR_BUFFER_BIT, gl.LINEAR);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }

    // keep frames on time: lower the internal resolution while frames run late
    // (mostly during the pull-back, when the moon fills the screen), raise it back after
    function adapt(ts) {
      if (capture) return;
      if (prevFrameTs) {
        var dt = ts - prevFrameTs;
        if (dt > 0 && dt < 200) frameEMA += (dt - frameEMA) * 0.25;
      }
      prevFrameTs = ts;
      if (warm > 0) { warm--; return; }
      var lo = anim ? 0.6 : 0.75;
      if (frameEMA > 21) rscale = Math.max(lo, rscale - 0.035);
      else if (frameEMA < 17.6) rscale = Math.min(1, rscale + (anim ? 0.02 : 0.04));
      if (rscale < lo) rscale = Math.min(1, rscale + 0.04);
    }

    /* ---------- loop ---------- */

    function step(ts) {
      if (anim) {
        var u = (ts - anim.start) / anim.dur;
        if (u < 0) e = anim.e0;
        else if (u >= 1) e = 1;
        else e = anim.e0 + (1 - anim.e0) * anim.ease(u);
      }
      if (debugE != null) e = debugE;
      // smoothed pointer and scroll
      var dt = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000));
      lastTs = ts;
      var kp = 1 - Math.exp(-dt / 0.7);
      ptr.sx += (ptr.x - ptr.sx) * kp; ptr.sy += (ptr.y - ptr.sy) * kp;
      var ks = reduced || capture ? 1 : 1 - Math.exp(-dt / 0.25);
      scrollS += (scrollP - scrollS) * ks;
    }

    function armAnim(a) {
      a.timer = setTimeout(function () {
        if (anim !== a || destroyed) return;
        e = 1;
        finishAnim();
        heldDrawn = false;
        kick();
      }, Math.max(0, a.start + a.dur - performance.now()) + 40);
    }

    function finishAnim() {
      if (anim && e >= 1) {
        var done = anim; anim = null;
        clearTimeout(done.timer);
        done.resolves.forEach(function (r) { r(); });
        var w = waiting; waiting = [];
        w.forEach(function (r) { r(); });
      }
    }

    function frame(ts) {
      raf = 0;
      if (destroyed || failed) return;
      if (captureDriven) return;
      var t1 = performance.now();
      step(ts);
      if (uploadQ.length) drainUpload();
      var holding = anim && ts < anim.start && debugE == null;
      if (holding && heldDrawn) { prevFrameTs = 0; warm = 6; frameEMA = 16.7; if (wantLoop()) raf = requestAnimationFrame(frame); return; }
      heldDrawn = !!holding;
      adapt(ts);
      try { render(ts); } catch (err) { fail(err); return; }
      stats.acc += performance.now() - t1; stats.n++;
      stats.frames++;
      if (ts - stats.last > 500) {
        stats.fps = stats.frames * 1000 / (ts - stats.last || 1);
        stats.ms = stats.acc / Math.max(1, stats.n);
        stats.frames = 0; stats.acc = 0; stats.n = 0; stats.last = ts;
      }
      finishAnim();
      if (wantLoop()) raf = requestAnimationFrame(frame);
    }

    function wantLoop() {
      if (!visible || !pageVisible || destroyed || failed) return false;
      if (anim) return true;
      if (reduced) return Math.abs(scrollS - scrollP) > 1e-4;
      return true;
    }

    function kick() {
      if (!raf && !destroyed && !failed && visible && pageVisible && isReady) raf = requestAnimationFrame(frame);
    }

    /* ---------- public ---------- */

    var isReady = false;
    var readyReject = null;

    function fail(err) {
      if (failed) return;
      failed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (readyReject) readyReject(err);
      if (typeof opts.onLost === 'function') { try { opts.onLost(err); } catch (e2) { /* ignore */ } }
    }

    canvas.addEventListener('webglcontextlost', function (ev) {
      ev.preventDefault();
      fail(new Error('SpaceScene: context lost'));
    });

    function resize() {
      if (destroyed) return;
      var w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
      var dpr = Math.min(window.devicePixelRatio || 1, Q.dprCap);
      if (w * h * dpr * dpr > Q.budget) dpr = Math.sqrt(Q.budget / (w * h));
      var bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      size = { w: w, h: h, bw: bw, bh: bh, dpr: bw / w };
      if (PM) {
        silhouetteAnchors(12, 2.5);
        measureContent();
      }
      F = framing(w, h);
      if (PM) silhouetteAnchors(F.D, F.el);
      path = buildPath(F);
      buildNear();
      heldDrawn = false;
      if (isReady) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        frame(performance.now());
      }
    }

    function onPointer(ev) {
      if (!finePointer || ev.pointerType && ev.pointerType !== 'mouse') return;
      ptr.x = clamp((ev.clientX / (window.innerWidth || 1)) * 2 - 1, -1, 1);
      ptr.y = clamp((ev.clientY / (window.innerHeight || 1)) * 2 - 1, -1, 1) * -1;
    }
    function onVis() {
      pageVisible = document.visibilityState !== 'hidden';
      if (pageVisible) { lastTs = performance.now(); kick(); }
    }
    document.addEventListener('visibilitychange', onVis);
    if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true });

    var scene = {
      canvas: canvas,
      ready: null,
      pose: function (which) {
        if (anim) clearTimeout(anim.timer);
        anim = null;
        heldDrawn = false;
        e = which === 'final' ? 1 : 0;
        kick();
        if (isReady && !raf) frame(performance.now());
      },
      playIntro: function (startTime, duration) {
        return new Promise(function (resolve) {
          if (reduced) { e = 1; kick(); resolve(); return; }
          if (anim) clearTimeout(anim.timer);
          anim = { start: startTime, dur: Math.max(1, duration || 3200), e0: 0, ease: easeZoom, resolves: [resolve] };
          armAnim(anim);
          e = 0;
          kick();
        });
      },
      hurry: function (ms) {
        return new Promise(function (resolve) {
          if (e >= 1 && !anim) { resolve(); return; }
          var prev = anim;
          var e0 = e;
          var dur = ms != null ? ms : Math.round(300 + 400 * (1 - e0));
          if (prev) clearTimeout(prev.timer);
          anim = { start: performance.now(), dur: Math.max(1, dur), e0: e0, ease: easeHurry, resolves: [resolve] };
          if (prev) anim.resolves = anim.resolves.concat(prev.resolves);
          armAnim(anim);
          kick();
        });
      },
      settle: function () {
        var prev = anim;
        anim = null;
        e = 1;
        if (prev) { clearTimeout(prev.timer); prev.resolves.forEach(function (r) { r(); }); }
        if (!settled) { settled = true; lifeStart = performance.now(); }
        kick();
        if (isReady && reduced) frame(performance.now());
      },
      setScroll: function (p) {
        scrollP = clamp(+p || 0, 0, 2);
        kick();
      },
      setVisible: function (v) {
        visible = !!v;
        if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; }
        if (visible) { lastTs = performance.now(); kick(); }
      },
      resize: resize,
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pointermove', onPointer);
        try {
          textures.forEach(function (t) { gl.deleteTexture(t); });
          Object.keys(progs).forEach(function (k) { gl.deleteProgram(progs[k].p); gl.deleteShader(progs[k].v); gl.deleteShader(progs[k].f); });
          [farStars, midStars].forEach(function (s) { gl.deleteBuffer(s.buf); gl.deleteVertexArray(s.vao); });
          gl.deleteBuffer(figGrid.vb); gl.deleteBuffer(figGrid.ib); gl.deleteVertexArray(figGrid.vao);
          var lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        } catch (err) { /* ignore */ }
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      },
      // intro.js: no heavy GPU work before this time (timeline clock, ms)
      quietUntil: function (t) { quietTill = +t || 0; },
      get progress() { return e; },
      debug: {
        layers: layers,
        stats: stats,
        timing: timing,
        get renderScale() { return rscale; },
        get meteors() { return METEORS.slice(0, 6).map(function (m) { return { t: m.t, dur: m.dur, path: meteorPath(m) }; }); },
        quality: Q,
        get framing() { return F; },
        get content() { return content; },
        get figures() { return figs.map(function (f) { return { id: f.id, anchor: f.anchor, xp: f.xp }; }); },
        setE: function (v) { debugE = v == null ? null : clamp(v, 0, 1); if (v != null) e = debugE; scene._redraw(); },
        setTime: function (s) { debugTime = s == null ? null : s; scene._redraw(); },
        introE: function (ms, zoomAt, zoomDur) { return easeZoom(clamp((ms - zoomAt) / zoomDur, 0, 1)); },
        camera: function () { return cam; },
        bench: function (n) {
          n = n || 60;
          var px = new Uint8Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          var t1 = performance.now();
          for (var i = 0; i < n; i++) render(performance.now());
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return (performance.now() - t1) / n;
        }
      },
      _redraw: function () { if (isReady) { if (raf) { cancelAnimationFrame(raf); raf = 0; } frame(performance.now()); } }
    };

    scene.ready = new Promise(function (resolve, reject) {
      readyReject = reject;
      Promise.all([compiled().then(function () { timing.compiled = performance.now(); }),
                   loadFigures().then(function () { timing.figures = performance.now(); })]).then(function () {
        if (destroyed || failed) throw new Error('SpaceScene: stopped');
        K = 1 / PM.rx;
        resize();
        return warmPrograms();
      }).then(function () {
        timing.warmed = performance.now();
        if (destroyed || failed) throw new Error('SpaceScene: stopped');
        return steps([bakeNoise, bakeBg]).then(bakeMacro);
      }).then(function () {
        return gpuDone();
      }).then(function () {
        timing.baked = performance.now();
        if (destroyed || failed) throw new Error('SpaceScene: stopped');
        if (gl.isContextLost()) throw new Error('SpaceScene: context lost');
        step(performance.now());
        var tr = performance.now();
        render(performance.now());
        slow('first render', tr);
        isReady = true;
        if (!opts.manualReveal) canvas.style.opacity = '1';
        requestAnimationFrame(function () {
          if (failed || destroyed) return reject(new Error('SpaceScene: stopped'));
          kick();
          timing.ready = performance.now();
          resolve(scene);
        });
      }).catch(function (err) { fail(err); reject(err); });
    });
    scene.ready.catch(function () { /* handled by the caller */ });

    // ?capture=1: a recorder can render frames for exact clock values
    // (same clock as document.timeline.currentTime / performance.now()).
    if (capture) {
      window.__spaceCapture = {
        renderAt: function (ms) {
          if (!isReady || destroyed || failed) return false;
          captureDriven = true;
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          while (uploadQ.length) drainUpload();
          step(ms);
          render(ms);
          finishAnim();
          return true;
        },
        release: function () { captureDriven = false; kick(); },
        get scene() { return scene; }
      };
    }

    try { resize(); } catch (err) { /* sized again when ready */ }
    timing.createDone = performance.now();
    return scene;
  }

  var LIGHT = norm([-0.62, 0.6, 0.42]);
  var EXPOSURE = 1.42;

  prewarm();

  window.SpaceScene = {
    prewarmTiming: prewarmT,
    supported: supported,
    create: create,
    ease: easeZoom
  };
})();
