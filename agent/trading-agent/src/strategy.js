// Signal evaluation. Uses the SAME engine as the backtest (../backtest/engine.cjs) so live signals
// match the backtested logic and the Pine script defaults (Waves Trend Toolkit [CR] v2.5.0).
const path = require('path');
const { prepare, signals } = require(path.join(__dirname, '..', '..', 'backtest', 'engine.cjs'));

const MIN_BARS = 300; // EMA200 + ATR(100) + VectorShift warm-up

// Evaluate the most recent CLOSED candle.
function evaluate(rows, params) {
  if (!Array.isArray(rows) || rows.length < MIN_BARS) throw new Error(`Need at least ${MIN_BARS} closed candles, got ${rows?.length ?? 0}`);
  const D = prepare(rows);
  const S = signals(D, params);
  const i = rows.length - 1;
  let last = null;
  const recent = []; // signals of the last 100 candles, newest last (used to catch signals missed while offline)
  for (let k = i; k >= 0; k--) {
    if (S.sig[k] === 0) continue;
    const s = { dir: S.sig[k], price: rows[k][4], barsAgo: i - k, power: S.power[k], early: S.early[k], time: rows[k][0] };
    if (!last) last = s;
    if (i - k <= 100) recent.unshift(s);
    else break;
  }
  return {
    time: rows[i][0],
    close: rows[i][4],
    sig: S.sig[i],            // +1 BUY, -1 SELL, 0 none (after filters)
    power: S.power[i],
    early: S.early[i],        // BUY fired early on a downtrend-line break (VectorShift not up yet)
    skipped: S.skipped[i],    // direction blocked by the EMA200 stretch rule
    trend: S.dir[i],          // VectorShift direction
    vs: S.stop[i],            // trailing stop for longs: VectorShift line, or the recent low before VectorShift turns up
    atr: S.atr[i],
    z: S.z[i],                // distance from EMA200 in ATR(100)
    ema200: S.ema200[i],
    flowDir: S.flowDir[i],
    lastSignal: last,
    recent,
  };
}

module.exports = { evaluate, MIN_BARS };
