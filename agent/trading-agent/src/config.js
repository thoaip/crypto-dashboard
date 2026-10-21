// Configuration: config.json (strategy/risk) + .env (mode and secrets). Validated at startup; fails fast.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIVE_CONFIRM_PHRASE = 'I_ACCEPT_REAL_MONEY_RISK';
const MODES = ['paper', 'testnet', 'live'];
const MAX_SYMBOLS = 20;
const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const TIMEFRAMES = { '4h': 14400, '8h': 28800, '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800 };

function loadEnvFile(file = path.join(ROOT, '.env')) {
  if (fs.existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
}

function fail(msg) {
  throw new Error(`Config error: ${msg}`);
}

const positive = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail(`${name} must be a positive number (got ${v})`);
  return v;
};

function loadConfig({ env = process.env, file = path.join(ROOT, 'config.json') } = {}) {
  if (!fs.existsSync(file)) fail(`missing ${file} (copy config.example.json to config.json)`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

  const mode = String(env.MODE || 'paper').trim().toLowerCase();
  if (!MODES.includes(mode)) fail(`MODE must be one of ${MODES.join(', ')} (got "${mode}")`);

  if (!Array.isArray(raw.symbols) || raw.symbols.length === 0) fail('symbols must be a non-empty array');
  if (raw.symbols.length > MAX_SYMBOLS) fail(`at most ${MAX_SYMBOLS} symbols`);
  if (new Set(raw.symbols).size !== raw.symbols.length) fail('symbols must not repeat');
  for (const s of raw.symbols) if (!/^[A-Z0-9]+\/USDT$/.test(s)) fail(`symbol "${s}" must look like "BTC/USDT" (spot, USDT quote only)`);
  if (!TIMEFRAMES[raw.timeframe]) fail(`timeframe must be one of ${Object.keys(TIMEFRAMES).join(', ')}`);

  const cfg = {
    mode,
    symbols: raw.symbols,
    timeframe: raw.timeframe,
    quotePerTrade: positive(raw.quotePerTrade, 'quotePerTrade'),
    maxOpenPositions: positive(raw.maxOpenPositions, 'maxOpenPositions'),
    dailyLossLimit: positive(raw.dailyLossLimit, 'dailyLossLimit'),
    pollSeconds: Math.max(10, positive(raw.pollSeconds ?? 30, 'pollSeconds')),
    paperStartBalance: positive(raw.paperStartBalance ?? 1000, 'paperStartBalance'),
    stopLimitBuffer: raw.stopLimitBuffer ?? 0.005,
    presets: raw.presets || {},
    intrabarChecks: raw.intrabarChecks === true, // paper only: use 5m highs/lows between scheduled runs
    notifyStartup: raw.notifyStartup !== false,
    htfTimeframes: raw.htfTimeframes || ['8h', '12h', '1d', '3d', '1w'],
    ai: { enabled: raw.ai?.enabled !== false, model: raw.ai?.model || 'claude-opus-5-5', effort: raw.ai?.effort || 'low' },
    liveMaxQuotePerTrade: positive(raw.live?.maxQuotePerTrade ?? 100, 'live.maxQuotePerTrade'),
    telegram: {
      token: (env.TELEGRAM_BOT_TOKEN || '').trim(),
      chatId: (env.TELEGRAM_CHAT_ID || '').trim(),
      allowedUserIds: (env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    },
    exchange: { apiKey: env.BINANCE_API_KEY || '', secret: env.BINANCE_API_SECRET || '' },
    anthropicKeySet: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
    dataDir: path.join(ROOT, 'data'),
    stopFile: path.join(ROOT, 'STOP'),
  };
  for (const tf of cfg.htfTimeframes) if (!TIMEFRAMES[tf]) fail(`htfTimeframes contains unsupported "${tf}"`);
  if (typeof cfg.stopLimitBuffer !== 'number' || !(cfg.stopLimitBuffer > 0 && cfg.stopLimitBuffer < 0.05)) fail('stopLimitBuffer must be a number between 0 and 0.05');
  if (!Number.isInteger(cfg.maxOpenPositions)) fail('maxOpenPositions must be an integer');
  if (!/^[a-z0-9][a-z0-9.-]{2,63}$/.test(cfg.ai.model)) fail(`ai.model "${cfg.ai.model}" is not a valid model id`);
  if (!AI_EFFORTS.includes(cfg.ai.effort)) fail(`ai.effort must be one of ${AI_EFFORTS.join(', ')}`);

  // ── Telegram: well-formed values only; commands are accepted from a private chat (positive id) ──
  const tg = cfg.telegram;
  if (tg.token && !/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(tg.token)) fail('TELEGRAM_BOT_TOKEN is malformed');
  if (tg.chatId && !/^\d{1,15}$/.test(tg.chatId)) fail('TELEGRAM_CHAT_ID must be your private chat id (a positive number); group chats cannot send commands');
  if (Boolean(tg.token) !== Boolean(tg.chatId)) fail('set both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, or neither');
  for (const id of tg.allowedUserIds) if (!/^\d{1,15}$/.test(id)) fail(`TELEGRAM_ALLOWED_USER_IDS contains "${id}" (comma-separated numeric user ids)`);

  // ── Safety gates for anything that touches an exchange account ──
  if (mode !== 'paper' && (!cfg.exchange.apiKey || !cfg.exchange.secret)) fail(`MODE=${mode} needs BINANCE_API_KEY and BINANCE_API_SECRET in .env`);
  if (mode === 'live') {
    if (env.LIVE_CONFIRM !== LIVE_CONFIRM_PHRASE) fail(`MODE=live requires LIVE_CONFIRM=${LIVE_CONFIRM_PHRASE} in .env`);
    if (cfg.quotePerTrade > cfg.liveMaxQuotePerTrade) fail(`quotePerTrade ${cfg.quotePerTrade} exceeds live.maxQuotePerTrade ${cfg.liveMaxQuotePerTrade}`);
  }
  return cfg;
}

// Strategy parameters for a timeframe — Waves Trend Toolkit [CR] v2.3.0 defaults, defined once in the shared engine.
const { defaultParams } = require(path.join(ROOT, '..', 'backtest', 'engine.cjs'));
function strategyParams(tf, symbol, presets = {}) {
  if (!TIMEFRAMES[tf]) throw new Error(`Unsupported timeframe ${tf}`);
  return defaultParams(tf, { btc8h: presets[symbol] === 'btc8h' });
}

module.exports = { loadEnvFile, loadConfig, strategyParams, TIMEFRAMES, LIVE_CONFIRM_PHRASE, ROOT };
