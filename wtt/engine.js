/* Generated from backtest/engine.cjs - do not edit here. Waves Trend Toolkit [CR] engine. */
(function () {
// JS port of waves_trend_toolkit.pine (signal + TP/SL logic) for offline backtesting.
const NA = NaN;
const isNa = Number.isNaN;

// ── Pine-equivalent TA ─────────────────────────────────────────────────────────
function seededMa(src, len, alpha) {
  const o = new Array(src.length).fill(NA);
  let s = NA, run = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (isNa(x)) { run = 0; o[i] = s; continue; }
    run++;
    if (isNa(s)) {
      if (run >= len) { let sum = 0; for (let k = 0; k < len; k++) sum += src[i - k]; s = sum / len; }
    } else s = alpha * x + (1 - alpha) * s;
    o[i] = s;
  }
  return o;
}
const ema = (src, len) => seededMa(src, len, 2 / (len + 1));
const rma = (src, len) => seededMa(src, len, 1 / len);
function sma(src, len) {
  const o = new Array(src.length).fill(NA);
  for (let i = len - 1; i < src.length; i++) {
    let s = 0, ok = true;
    for (let k = 0; k < len; k++) { const x = src[i - k]; if (isNa(x)) { ok = false; break; } s += x; }
    if (ok) o[i] = s / len;
  }
  return o;
}
function wma(src, len) {
  const o = new Array(src.length).fill(NA);
  const den = len * (len + 1) / 2;
  for (let i = len - 1; i < src.length; i++) {
    let s = 0, ok = true;
    for (let k = 0; k < len; k++) { const x = src[i - k]; if (isNa(x)) { ok = false; break; } s += x * (len - k); }
    if (ok) o[i] = s / den;
  }
  return o;
}
function hma(src, len) {
  const a = wma(src, Math.floor(len / 2)), b = wma(src, len);
  return wma(a.map((x, i) => 2 * x - b[i]), Math.floor(Math.sqrt(len)));
}
function trueRange(h, l, c) {
  return h.map((x, i) => i === 0 ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])));
}
const atr = (h, l, c, len) => rma(trueRange(h, l, c), len);
function rsi(c, len) {
  const up = c.map((x, i) => i === 0 ? NA : Math.max(x - c[i - 1], 0));
  const dn = c.map((x, i) => i === 0 ? NA : Math.max(c[i - 1] - x, 0));
  const u = rma(up, len), d = rma(dn, len);
  return u.map((x, i) => d[i] === 0 ? 100 : x === 0 ? 0 : 100 - 100 / (1 + x / d[i]));
}
function adx(h, l, c, len) {
  const pdm = h.map((x, i) => { if (i === 0) return NA; const up = x - h[i - 1], dn = l[i - 1] - l[i]; return up > dn && up > 0 ? up : 0; });
  const mdm = h.map((x, i) => { if (i === 0) return NA; const up = x - h[i - 1], dn = l[i - 1] - l[i]; return dn > up && dn > 0 ? dn : 0; });
  const tr = rma(trueRange(h, l, c), len);
  const p = rma(pdm, len).map((x, i) => 100 * x / tr[i]);
  const m = rma(mdm, len).map((x, i) => 100 * x / tr[i]);
  const dx = p.map((x, i) => { const s = x + m[i]; return Math.abs(x - m[i]) / (s === 0 ? 1 : s); });
  return rma(dx, len).map(x => 100 * x);
}
function rolling(src, len, pick) {
  const o = new Array(src.length).fill(NA);
  for (let i = len - 1; i < src.length; i++) { let m = src[i]; for (let k = 1; k < len; k++) m = pick(m, src[i - k]); o[i] = m; }
  return o;
}
const highest = (src, len) => rolling(src, len, Math.max);
const lowest = (src, len) => rolling(src, len, Math.min);
function alma(src, len, off, sig) {
  const m = off * (len - 1), s = len / sig;
  const w = Array.from({ length: len }, (_, k) => Math.exp(-((k - m) ** 2) / (2 * s * s)));
  const ws = w.reduce((a, b) => a + b, 0);
  return src.map((_, i) => { if (i < len - 1) return NA; let acc = 0; for (let k = 0; k < len; k++) acc += src[i - (len - 1 - k)] * w[k]; return acc / ws; });
}
const shift = (src, n, i) => (i - n >= 0 ? src[i - n] : NA);

// ── Shared (parameter-independent) model state ──────────────────────────────────
function prepare(rows) {
  const o = rows.map(r => r[1]), h = rows.map(r => r[2]), l = rows.map(r => r[3]), c = rows.map(r => r[4]), v = rows.map(r => r[5]);
  const hl2 = h.map((x, i) => (x + l[i]) / 2), hlc3 = h.map((x, i) => (x + l[i] + c[i]) / 3);
  const volMA = sma(v, 20);
  const D = { o, h, l, c, v, hl2, hlc3, n: c.length };
  D.rsi = rsi(c, 14);
  D.adx = adx(h, l, c, 14);
  D.relVol = v.map((x, i) => volMA[i] > 0 ? x / volMA[i] : 1);
  // FlowTrend (chart TF)
  { const s = ema(hl2, 30), a = atr(h, l, c, 30); let t = NA, d = 1; D.flowDir = c.map((cc, i) => {
      const up = s[i] - 1.8 * a[i], dn = s[i] + 1.8 * a[i];
      if (isNa(t)) t = up; else if (d === 1) { t = Math.max(t, up); if (cc < t) { d = -1; t = dn; } } else { t = Math.min(t, dn); if (cc > t) { d = 1; t = up; } }
      return d; }); }
  // ActionWave
  { const L = 55, lag = Math.max(1, Math.floor((L - 1) / 2));
    const awA = ema(hlc3.map((x, i) => x + (x - shift(hlc3, lag, i))), L), awB = ema(awA, Math.floor(L / 3));
    D.awDir = awA.map((x, i) => (x >= awB[i] ? 1 : -1)); }
  // Voltix midline direction
  { const mid = alma(c, 40, 0.85, 6); D.vxDir = mid.map((x, i) => (x >= shift(mid, 1, i) ? 1 : -1)); }
  // EMA200 distance in ATR(100) units: >0 above, <0 below.
  { const e = ema(c, 200), a = atr(h, l, c, 100); D.ema200 = e; D.z200 = c.map((x, i) => (x - e[i]) / a[i]); }
  D.magCache = {};
  D.vsCache = {};
  return D;
}

function magDir(D, mode) {
  if (D.magCache[mode]) return D.magCache[mode];
  const L = mode === 'Scalp' ? 20 : mode === 'Macro' ? 120 : 50;
  const hh = highest(D.h, L), ll = lowest(D.l, L);
  const mag = ema(hh.map((x, i) => (x + ll[i]) / 2), 5);
  const slope = Math.max(2, Math.floor(L / 4)), a = atr(D.h, D.l, D.c, L);
  return (D.magCache[mode] = mag.map((x, i) => { const p = shift(mag, slope, i); return Math.abs(x - p) < 0.35 * a[i] ? 0 : x > p ? 1 : -1; }));
}

function vectorShift(D, mode, sens) {
  const key = mode + sens;
  if (D.vsCache[key]) return D.vsCache[key];
  const k = mode === 'Scalp' ? 0.6 : mode === 'Macro' ? 1.8 : 1.0;
  const mult = mode === 'Scalp' ? 1.6 : mode === 'Macro' ? 3.0 : 2.2;
  const len = Math.max(2, Math.round(sens * k));
  const a = atr(D.h, D.l, D.c, len), basis = hma(D.hlc3, len);
  const vs = new Array(D.n).fill(NA), dir = new Array(D.n).fill(1), flip = new Array(D.n).fill(false);
  let cur = NA, d = 1, age = 0;
  for (let i = 0; i < D.n; i++) {
    const ext = Math.abs(D.c[i] - basis[i]) / Math.max(a[i], 1e-12);
    const early = 0.5 * Math.max(0, 1 - age / (len * 2));
    const tight = Math.min(0.5, Math.max(0, ext - 2) * 0.25);
    const buf = mult * (1 + early - tight) * a[i];
    const up = basis[i] + buf, dn = basis[i] - buf;
    if (isNa(cur)) cur = dn;
    else if (d === 1) { cur = Math.max(cur, dn); if (D.c[i] < cur) { d = -1; cur = up; } }
    else { cur = Math.min(cur, up); if (D.c[i] > cur) { d = 1; cur = dn; } }
    vs[i] = cur; dir[i] = d;
    flip[i] = i > 0 && !isNa(vs[i - 1]) && d !== dir[i - 1];
    age = flip[i] ? 0 : age + 1;
  }
  const r = D.rsi.map(x => (isNa(x) ? 50 : x));
  return (D.vsCache[key] = { vs, dir, flip, atr: a, len, rsiLo: lowest(r, len), rsiHi: highest(r, len) });
}

// ── Strategy simulation ────────────────────────────────────────────────────────
// p: { mode, sens, filter, tp: {mode:'Disabled'|'Dynamic', count, step}, sl: 'Trailing'|'Disabled', fee }
// Per-bar signals on CLOSED bars: sig[i] = +1 BUY / -1 SELL / 0 none, after the signal filter and EMA200 rules.
// This is the single source of truth for both the backtest (simulate) and the live trading agent.
function signals(D, p) {
  const V = vectorShift(D, p.mode, p.sens), mag = magDir(D, p.mode);
  const filt = { None: null, FlowTrend: D.flowDir, ActionWave: D.awDir, TrendMagnet: mag, 'Voltix Mid': D.vxDir }[p.filter];
  if (filt === undefined) throw new Error(`Unknown filter: ${p.filter}`);
  const E = p.ema || {};
  const sig = new Array(D.n).fill(0), power = new Array(D.n).fill(false), skipped = new Array(D.n).fill(0);
  for (let i = 1; i < D.n; i++) {
    if (!V.flip[i]) continue;
    const d = V.dir[i], z = D.z200[i];
    if (filt && filt[i] !== d) continue;
    // EMA rules are skipped while EMA200/ATR are still warming up (z is NaN), exactly like f_emaOk() in the Pine script.
    let ok = true;
    if (E.side && !isNa(z) && !(d * (D.c[i] - D.ema200[i]) > 0)) ok = false; // trade only on the EMA200 trend side
    if (E.maxZ != null && !isNa(z) && !(d * z < E.maxZ)) ok = false;          // skip entries already stretched from EMA200
    if (E.minZ != null && !isNa(z) && !(d * z <= E.minZ)) ok = false;         // mean-reversion: only enter when stretched the other way
    if (!ok) { skipped[i] = d; continue; }
    sig[i] = d;
    power[i] = (d === 1 ? V.rsiLo[i] < 30 : V.rsiHi[i] > 70) || (D.adx[i] > 25 && D.relVol[i] > 1.3);
  }
  return { sig, power, skipped, vs: V.vs, dir: V.dir, atr: V.atr, len: V.len, z: D.z200, ema200: D.ema200, flowDir: D.flowDir };
}

function simulate(D, p) {
  const V = vectorShift(D, p.mode, p.sens);
  const S = signals(D, p);
  const trades = [];
  let t = null;
  const closeRest = (i, px, why) => {
    const rem = 1 - t.filled;
    if (rem > 1e-9) t.pnl += rem * t.dir * (px / t.entry - 1);
    t.exitIdx = i; t.why = why; t.pnl -= 2 * p.fee;
    trades.push(t); t = null;
  };
  for (let i = 1; i < D.n; i++) {
    const { o, h, l, c } = { o: D.o[i], h: D.h[i], l: D.l[i], c: D.c[i] };
    // 1) manage open trade with levels known before this bar
    if (t) {
      if (!isNa(t.sl) && (t.dir === 1 ? l <= t.sl : h >= t.sl)) {
        closeRest(i, t.dir === 1 ? Math.min(o, t.sl) : Math.max(o, t.sl), 'SL');
      } else {
        for (const tp of t.tps) {
          if (tp.hit) continue;
          if (t.dir === 1 ? h >= tp.px : l <= tp.px) {
            tp.hit = true;
            const fill = t.dir === 1 ? Math.max(o, tp.px) : Math.min(o, tp.px);
            t.pnl += tp.frac * t.dir * (fill / t.entry - 1); t.filled += tp.frac;
          }
        }
        if (t.tps.length && t.filled > 0.999) closeRest(i, c, 'TP');
      }
      if (t) { const fav = t.dir === 1 ? h - t.entry : t.entry - l; t.mfe = Math.max(t.mfe, fav); }
    }
    // 1b) EMA200 stretch exit: close when price is stretched exitZ ATRs from EMA200 in the trade's favour
    const z = D.z200[i], E = p.ema || {};
    if (t && E.exitZ && !isNa(z) && t.dir * z >= E.exitZ) closeRest(i, c, 'Stretch');
    // 2) signal at close (shared with the live agent via signals())
    const d = S.sig[i];
    if (d !== 0) {
      if (t) closeRest(i, c, 'Reverse');
      const power = S.power[i];
      const tps = [];
      if (p.tp.mode === 'Dynamic') for (let k = 1; k <= p.tp.count; k++) tps.push({ px: c + d * V.atr[i] * p.tp.step * k, frac: (p.tp.share ?? 1) / p.tp.count, hit: false });
      t = { dir: d, entry: c, entryIdx: i, atr: V.atr[i], power, tps, filled: 0, pnl: 0, mfe: 0, sl: p.sl === 'Trailing' ? V.vs[i] : NA };
    }
    // 3) trail the stop for the next bar
    if (t && p.sl === 'Trailing' && i > t.entryIdx) t.sl = t.dir === 1 ? Math.max(t.sl, V.vs[i]) : Math.min(t.sl, V.vs[i]);
  }
  if (t && p.includeOpen) trades.push({ ...t, open: true }); // still-open trade (dashboard), off for backtests
  return trades;
}

function stats(trades) {
  const n = trades.length;
  if (!n) return { n: 0, net: 0, pf: 0, win: 0, dd: 0, exp: 0 };
  let gp = 0, gl = 0, w = 0, eq = 0, peak = 0, dd = 0;
  for (const t of trades) {
    if (t.pnl > 0) { gp += t.pnl; w++; } else gl -= t.pnl;
    eq += t.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
  }
  return { n, net: eq * 100, pf: gl > 0 ? gp / gl : gp > 0 ? 99 : 0, win: (100 * w) / n, dd: dd * 100, exp: (eq / n) * 100 };
}

// Waves Trend Toolkit [CR] v2.3.0 default parameters per timeframe (Long Only defaults; see the Pine script).
const TF_SECONDS = { '4h': 14400, '8h': 28800, '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800 };
function defaultParams(tf, { btc8h = false } = {}) {
  const sec = TF_SECONDS[tf];
  if (!sec) throw new Error(`Unsupported timeframe ${tf}`);
  const preset = btc8h && tf === '8h';
  const maxZ = sec >= 432000 ? 8 : sec >= 43200 ? 4 : preset ? 4 : null;
  return {
    mode: 'Normal',
    sens: preset ? 30 : 20,
    filter: preset || sec < 86400 ? 'FlowTrend' : 'None',
    tp: { mode: 'Dynamic', count: 2, step: 2, share: 0.5 },
    sl: 'Trailing',
    ema: maxZ == null ? {} : { maxZ },
  };
}

// Works in Node (require) and in the browser (window.WTTEngine) - the dashboard loads this exact file.
const WTT_ENGINE = { prepare, signals, simulate, stats, defaultParams, TF_SECONDS, VERSION: '2.3.0' };
if (typeof module !== 'undefined' && module.exports) module.exports = WTT_ENGINE;
else globalThis.WTTEngine = WTT_ENGINE;

})();
