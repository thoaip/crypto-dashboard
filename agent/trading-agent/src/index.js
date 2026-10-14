// Entry point.
//   node src/index.js          run the agent loop (mode from .env: paper | testnet | live)
//   node src/index.js --once   evaluate every symbol once and print a report - never places orders
const fs = require('fs');
const path = require('path');
const { loadEnvFile, loadConfig, strategyParams } = require('./config');
const { fetchClosedCandles, fetchLastPrice, fetchRange } = require('./market');
const { StateStore } = require('./state');
const { PaperBroker, ExchangeBroker } = require('./broker');
const { Notifier } = require('./notifier');
const { Commentator } = require('./ai');
const { Agent, fmtPx } = require('./agent');
const { evaluate } = require('./strategy');

function makeLogger(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'agent.log');
  return msg => {
    const line = `${new Date().toISOString()} ${msg}`;
    process.stdout.write(line + '\n');
    fs.appendFileSync(file, line + '\n');
  };
}

const market = {
  candles: (symbol, tf) => fetchClosedCandles(symbol, tf, 1000),
  price: symbol => fetchLastPrice(symbol),
  range: (symbol, sinceMs) => fetchRange(symbol, sinceMs),
};

async function report(cfg, log) {
  log(`Report (no orders) - timeframe ${cfg.timeframe}`);
  for (const symbol of cfg.symbols) {
    try {
      const ev = evaluate(await market.candles(symbol, cfg.timeframe), strategyParams(cfg.timeframe, symbol, cfg.presets));
      const ls = ev.lastSignal;
      log(`${symbol.padEnd(10)} close ${fmtPx(ev.close)} | trend ${ev.trend === 1 ? 'UP' : 'DOWN'} | this candle ${ev.sig === 1 ? 'BUY' : ev.sig === -1 ? 'SELL' : '-'}${ev.power ? '+' : ''} | stop level ${fmtPx(ev.vs)} | EMA200 ${Number.isFinite(ev.z) ? ev.z.toFixed(2) : 'n/a'} ATR | last signal ${ls ? `${ls.dir === 1 ? 'BUY' : 'SELL'}${ls.power ? '+' : ''} @ ${fmtPx(ls.price)} (${ls.barsAgo} bars ago)` : 'none'}`);
    } catch (err) {
      log(`${symbol}: ${err.message}`);
    }
  }
}

async function main() {
  loadEnvFile();
  const cfg = loadConfig();
  const log = makeLogger(cfg.dataDir);

  if (process.argv.includes('--once')) return report(cfg, log);

  const store = new StateStore(cfg.dataDir, cfg.mode, cfg.paperStartBalance);
  store.acquireLock();
  process.on('exit', () => store.releaseLock());
  const state = store.load();
  const broker = cfg.mode === 'paper'
    ? new PaperBroker(state, market.price)
    : new ExchangeBroker({ apiKey: cfg.exchange.apiKey, secret: cfg.exchange.secret, sandbox: cfg.mode === 'testnet', stopLimitBuffer: cfg.stopLimitBuffer });
  await broker.init();

  const notifier = new Notifier({ token: cfg.telegram.token, chatId: cfg.telegram.chatId, log });
  const ai = new Commentator({ enabled: cfg.ai.enabled, model: cfg.ai.model, effort: cfg.ai.effort, keySet: cfg.anthropicKeySet, log });
  const agent = new Agent({ cfg, broker, market, notifier, ai, store, state, log });
  await agent.start(); // reconcile stored positions with the exchange balance

  const banner = `🚀 Agent khởi động [${cfg.mode.toUpperCase()}] ${cfg.symbols.join(', ')} | ${cfg.timeframe} | ${cfg.quotePerTrade} USDT/lệnh | tối đa ${cfg.maxOpenPositions} lệnh | lỗ ngày tối đa ${cfg.dailyLossLimit} USDT | Telegram ${notifier.enabled ? 'bật' : 'tắt'} | Claude ${ai.enabled ? 'bật' : 'tắt'}`;
  if (cfg.mode === 'live') log('!!! LIVE MODE: REAL ORDERS WITH REAL MONEY !!!');
  const firstRun = !state.startedAt;
  if (firstRun) state.startedAt = new Date().toISOString();
  if (firstRun || (cfg.notifyStartup && !process.argv.includes('--tick'))) await notifier.send(banner);

  // Scheduled mode (GitHub Actions): one cycle, save, exit.
  if (process.argv.includes('--tick')) {
    await agent.tick();
    store.save(state);
    const open = Object.keys(state.positions);
    log(`tick done | open: ${open.length ? open.join(', ') : 'none'} | paper USDT ${state.paper.usdt.toFixed(2)}`);
    return;
  }

  let stopping = false;
  const shutdown = () => { stopping = true; log('Shutting down after the current step...'); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (!stopping) {
    await agent.tick();
    for (let s = 0; s < cfg.pollSeconds && !stopping; s++) await new Promise(r => setTimeout(r, 1000));
  }
  store.save(state);
  await notifier.send('⏹️ Agent đã dừng. Lệnh mở (nếu có) vẫn còn stop trên sàn ở chế độ testnet/live.');
}

main().catch(err => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
