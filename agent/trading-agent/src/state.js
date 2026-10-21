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

// Fail closed on a corrupted or tampered state file: trading on wrong quantities could sell coins the agent never bought.
const finite = v => typeof v === 'number' && Number.isFinite(v);
const plainObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function validateState(s, file) {
  const bad = what => { throw new Error(`${file}: invalid state (${what}) - fix or remove it before starting`); };
  for (const k of ['lastBar', 'positions', 'pending', 'daily', 'lastCheck']) if (!plainObj(s[k])) bad(`${k} must be an object`);
  if (typeof s.halted !== 'boolean') bad('halted must be true/false');
  if (!plainObj(s.paper) || !finite(s.paper.usdt) || s.paper.usdt < 0 || !plainObj(s.paper.base)) bad('paper balance');
  if (!Number.isInteger(s.telegramOffset) || s.telegramOffset < 0) bad('telegramOffset');
  for (const [sym, p] of Object.entries(s.positions)) {
    if (!/^[A-Z0-9]+\/USDT$/.test(sym)) bad(`position key ${sym}`);
    for (const k of ['qty', 'entry', 'sl']) if (!finite(p?.[k]) || (k !== 'sl' && p[k] <= 0)) bad(`${sym}.${k}`);
    if (!Array.isArray(p.tps)) bad(`${sym}.tps`);
  }
  for (const [day, d] of Object.entries(s.daily)) if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !finite(d?.realized)) bad(`daily ${day}`);
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
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.file)) return defaultState(this.mode, this.paperStartBalance);
    let s;
    try { s = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (err) { throw new Error(`${this.file} is not valid JSON (${err.message}) - refusing to start`); }
    if (s.mode !== this.mode) throw new Error(`${this.file} belongs to mode "${s.mode}", not "${this.mode}" - refusing to start`);
    const merged = { ...defaultState(this.mode, this.paperStartBalance), ...s };
    validateState(merged, this.file);
    return merged;
  }

  // Atomic replace (write temp + rename), owner-only file mode.
  save(state) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  appendTrade(record) {
    fs.appendFileSync(this.tradesFile, JSON.stringify(record) + '\n', { mode: 0o600 });
  }

  // Single-instance lock: two agents on one account would double-buy.
  // Created with O_EXCL ('wx') so two processes starting together cannot both win; a lock left by a dead pid is replaced.
  acquireLock(pid = process.pid, isAlive = p => { try { process.kill(p, 0); return true; } catch { return false; } }) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(this.lockFile, String(pid), { flag: 'wx', mode: 0o600 });
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        const other = Number(fs.readFileSync(this.lockFile, 'utf8'));
        if (other === pid) return;
        if (other && isAlive(other)) throw new Error(`Another agent (pid ${other}) is already running in ${this.mode} mode`);
        fs.unlinkSync(this.lockFile); // stale lock from a crashed run
      }
    }
    throw new Error(`Could not acquire ${this.lockFile}`);
  }

  releaseLock() {
    try { fs.unlinkSync(this.lockFile); } catch { /* already gone */ }
  }
}

const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

module.exports = { StateStore, defaultState, validateState, utcDay };
