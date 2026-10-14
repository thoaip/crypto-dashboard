// Durable agent state (positions, pending buys, last processed candle, daily P/L).
// One file PER MODE (state-paper.json / state-testnet.json / state-live.json) so paper positions can never
// be acted on with real money. Written atomically after every fill.
const fs = require('fs');
const path = require('path');

function defaultState(mode, paperStartBalance) {
  return {
    version: 2,
    mode,
    halted: false,          // set by /stop; blocks NEW entries only
    lastBar: {},            // symbol -> openTime of the last fully processed closed candle
    positions: {},          // symbol -> open position
    pending: {},            // symbol -> buy order sent but not yet confirmed (crash recovery)
    daily: {},              // 'YYYY-MM-DD' (UTC) -> { realized }
    lastCheck: {},          // symbol -> time of the last price check (scheduled paper runs)
    startedAt: null,
    paper: { usdt: paperStartBalance, base: {} },
    telegramOffset: 0,
  };
}

class StateStore {
  constructor(dir, mode, paperStartBalance) {
    this.dir = dir;
    this.mode = mode;
    this.file = path.join(dir, `state-${mode}.json`);
    this.tradesFile = path.join(dir, `trades-${mode}.jsonl`);
    this.lockFile = path.join(dir, `agent-${mode}.lock`);
    this.paperStartBalance = paperStartBalance;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) return defaultState(this.mode, this.paperStartBalance);
    const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (s.mode !== this.mode) throw new Error(`${this.file} belongs to mode "${s.mode}", not "${this.mode}" - refusing to start`);
    return { ...defaultState(this.mode, this.paperStartBalance), ...s };
  }

  save(state) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, this.file);
  }

  appendTrade(record) {
    fs.appendFileSync(this.tradesFile, JSON.stringify(record) + '\n');
  }

  // Single-instance lock: two agents on one account would double-buy.
  acquireLock(pid = process.pid, isAlive = p => { try { process.kill(p, 0); return true; } catch { return false; } }) {
    fs.mkdirSync(this.dir, { recursive: true });
    if (fs.existsSync(this.lockFile)) {
      const other = Number(fs.readFileSync(this.lockFile, 'utf8'));
      if (other && other !== pid && isAlive(other)) throw new Error(`Another agent (pid ${other}) is already running in ${this.mode} mode`);
    }
    fs.writeFileSync(this.lockFile, String(pid));
  }

  releaseLock() {
    try { fs.unlinkSync(this.lockFile); } catch { /* already gone */ }
  }
}

const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

module.exports = { StateStore, defaultState, utcDay };
