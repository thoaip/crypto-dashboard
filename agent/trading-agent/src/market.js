// Market data from Binance's public mainnet API (no key). Signals always use real-market candles,
// even in testnet mode, so the agent sees the same chart as TradingView.
const { TIMEFRAMES } = require('./config');

const BASE = 'https://api.binance.com';

async function getJson(url, { retries = 3, timeoutMs = 15000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

const toBinanceSymbol = symbol => symbol.replace('/', '');

// Closed candles only, oldest first: [openTime, open, high, low, close, volume]
async function fetchClosedCandles(symbol, tf, limit = 1000, now = Date.now()) {
  if (!TIMEFRAMES[tf]) throw new Error(`Unsupported timeframe ${tf}`);
  const rows = await getJson(`${BASE}/api/v3/klines?symbol=${toBinanceSymbol(symbol)}&interval=${tf}&limit=${limit}`);
  if (!Array.isArray(rows)) throw new Error(`Unexpected klines response for ${symbol}`);
  return rows.filter(k => k[6] < now).map(k => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
}

async function fetchLastPrice(symbol) {
  const j = await getJson(`${BASE}/api/v3/ticker/price?symbol=${toBinanceSymbol(symbol)}`);
  const px = Number(j.price);
  if (!Number.isFinite(px) || px <= 0) throw new Error(`Bad price for ${symbol}: ${j.price}`);
  return px;
}

// High/low traded since `sinceMs` (5-minute candles), so a scheduled run every N minutes still sees
// TP/stop touches that happened between runs - the same intrabar rule the backtest uses.
async function fetchRange(symbol, sinceMs, now = Date.now()) {
  const start = Math.max(sinceMs, now - 3 * 86400_000); // cap the look-back at 3 days
  const rows = await getJson(`${BASE}/api/v3/klines?symbol=${toBinanceSymbol(symbol)}&interval=5m&startTime=${Math.floor(start)}&limit=1000`);
  if (!Array.isArray(rows) || !rows.length) return null;
  let high = -Infinity, low = Infinity;
  for (const k of rows) { high = Math.max(high, +k[2]); low = Math.min(low, +k[3]); }
  return { high, low, last: +rows[rows.length - 1][4] };
}

module.exports = { fetchClosedCandles, fetchLastPrice, fetchRange };
