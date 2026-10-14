// Trading agent core. Mirrors the backtested rules of Waves Trend Toolkit [CR] v2.3.0 (Long Only):
//  - BUY signal on a closed candle  -> market buy quotePerTrade USDT (if risk checks pass)
//  - TP1 / TP2 at signal close + 2 / 4 ATR -> sell 25% each (50% total); the rest runs on the trailing stop
//  - Stop = VectorShift level, raised on every closed candle (never lowered)
//  - SELL signal -> close the long
// Signals are decided by the rules only. Claude adds commentary to notifications and never changes a decision.
//
// Exchange safety rules (testnet/live):
//  - state is saved right after every fill; a buy is recorded as "pending" BEFORE it is sent (crash recovery)
//  - before any sell, the exchange stop is cancelled AND its fills are booked (no double-selling)
//  - sells never exceed the free balance; TP slices below the exchange minimum are merged into the runner
//  - a missing exchange stop is re-placed on every poll
const fs = require('fs');
const { strategyParams, TIMEFRAMES } = require('./config');
const { evaluate } = require('./strategy');
const { utcDay } = require('./state');
const { EST_FEE } = require('./broker');

const TP_COUNT = 2, TP_STEP_ATR = 2, TP_SHARE = 0.5;
const FRESH_FRACTION = 0.25;     // on first sight of a symbol, act only if its last candle closed within 25% of a bar
const PENDING_TIMEOUT_MS = 5 * 60_000;
const ALERT_EVERY_MS = 30 * 60_000;
const DUST = 1e-12;

// Out-of-sample backtest summary per timeframe (11 coins, Long Only, v2.3.0 defaults) - context for the commentary.
const BACKTEST_NOTE = {
  '4h': 'PF ~1.65 trên 11 coin, ổn định',
  '8h': 'PF ~2.0 trên 11 coin',
  '12h': 'PF ~2.3 trên 11 coin',
  '1d': 'PF ~2.1 trên 11 coin',
  '3d': 'PF cao nhưng rất ít lệnh, kém tin cậy',
  '1w': 'quá ít lệnh, kém tin cậy; 3/6 coin mới có lãi',
};

const fmtPx = n => (!Number.isFinite(n) ? 'n/a' : n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(5));
const fmtPct = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const arrow = d => (d === 1 ? '▲' : d === -1 ? '▼' : '■');
// Error text may contain signed request URLs; never forward query strings to Telegram/logs.
const cleanErr = err => String(err?.message || err).replace(/\?[^\s"']*/g, '?…').slice(0, 300);

class Agent {
  constructor({ cfg, broker, market, notifier, ai, store, state, log, now = () => Date.now(), evaluateFn = evaluate, fsImpl = fs }) {
    Object.assign(this, { cfg, broker, market, notifier, ai, store, state, log, now, evaluateFn, fs: fsImpl });
    this.exchange = broker.kind !== 'paper';
    this.lastEval = {};
    this.alertedAt = {};
  }

  params(tf, symbol) { return strategyParams(tf, symbol, this.cfg.presets); }
  persist() { this.store.save(this.state); }
  price(symbol) { return this.broker.price(symbol); }

  async alertOnce(key, text) {
    const last = this.alertedAt[key] || 0;
    if (this.now() - last < ALERT_EVERY_MS) return;
    this.alertedAt[key] = this.now();
    await this.notifier.send(text);
  }

  // ───────────────────────────── startup ─────────────────────────────
  // Make the stored positions agree with what the exchange account really holds.
  async start() {
    if (!this.exchange) return;
    for (const [symbol, pos] of Object.entries(this.state.positions)) {
      try {
        const held = await this.broker.totalBase(symbol);
        if (held >= pos.qty * 0.98) continue;
        if (!this.broker.sellable(symbol, held, pos.entry)) {
          delete this.state.positions[symbol];
          await this.notifier.send(`⚠️ ${symbol}: tài khoản không còn giữ lệnh đã lưu (${fmtPx(pos.qty)}). Đã xóa khỏi trạng thái, KHÔNG bán gì.`);
        } else {
          await this.notifier.send(`⚠️ ${symbol}: tài khoản giữ ${fmtPx(held)} < ${fmtPx(pos.qty)} đã lưu. Agent chỉ quản lý ${fmtPx(held)}.`);
          pos.qty = held;
        }
      } catch (err) {
        await this.notifier.send(`⚠️ ${symbol}: không đối chiếu được số dư khi khởi động (${cleanErr(err)}).`);
      }
    }
    this.persist();
  }

  // ───────────────────────────── main loop step ─────────────────────────────
  async tick() {
    await this.handleCommands();
    for (const symbol of this.cfg.symbols) await this.processSymbol(symbol);
    this.persist();
  }

  async guarded(symbol, what, fn) {
    try {
      return await fn();
    } catch (err) {
      this.log(`[${symbol}] ${what} error: ${err.stack || err.message}`);
      await this.alertOnce(`${symbol}:${what}`, `⚠️ ${symbol} (${what}): ${cleanErr(err)}`);
      return undefined;
    }
  }

  // Candle logic and position management fail independently: a data error never stops stop/TP checks.
  async processSymbol(symbol) {
    await this.guarded(symbol, 'pending', () => this.resolvePending(symbol));
    // Paper + scheduled runs: first apply TP/stop touches that happened since the last run, at their levels.
    if (this.cfg.intrabarChecks && !this.exchange && this.state.positions[symbol]) {
      await this.guarded(symbol, 'intrabar', () => this.catchUpRange(symbol));
    }
    await this.guarded(symbol, 'signal', () => this.processBars(symbol));
    if (this.state.positions[symbol]) await this.guarded(symbol, 'manage', async () => this.manage(symbol, await this.price(symbol)));
    this.state.lastCheck = { ...this.state.lastCheck, [symbol]: this.now() };
  }

  // Backtest-style intrabar handling for paper mode: the stop is checked first (conservative), then TPs, each filled at its level.
  async catchUpRange(symbol) {
    const pos = this.state.positions[symbol];
    const since = Math.max(this.state.lastCheck?.[symbol] ?? pos.openedAt, pos.openedAt);
    const r = await this.market.range(symbol, since);
    if (!r) return;
    pos.best = Math.max(pos.best, r.high);
    if (r.low <= pos.sl) { await this.closePosition(symbol, Math.min(pos.sl, r.last), 'Stop loss (chạm giữa 2 lần kiểm tra)'); return; }
    for (const [k, tp] of pos.tps.entries()) {
      if (tp.hit || r.high < tp.px) continue;
      const qty = Math.min(pos.qty, pos.initialQty * tp.frac);
      const sale = await this.broker.marketSell(symbol, qty, tp.px);
      tp.hit = true;
      this.recordSale(pos, sale.qty, sale.price, sale.fee);
      this.persist();
      await this.notifier.send(`✅ ${symbol} chạm TP${k + 1} @ ${fmtPx(tp.px)}: bán ${fmtPx(sale.qty)}, còn ${fmtPx(pos.qty)} chạy theo trailing stop ${fmtPx(pos.sl)}.`);
    }
    if (pos.qty <= DUST) await this.finalize(symbol, 'Hết khối lượng sau TP');
  }

  async processBars(symbol) {
    const tf = this.cfg.timeframe;
    const ev = this.evaluateFn(await this.market.candles(symbol, tf), this.params(tf, symbol));
    this.lastEval[symbol] = ev;
    const prev = this.state.lastBar[symbol];
    if (prev === ev.time) return ev;
    const barMs = TIMEFRAMES[tf] * 1000;
    if (prev === undefined) {
      const fresh = this.now() - (ev.time + barMs) < barMs * FRESH_FRACTION;
      if (fresh) await this.onNewBar(symbol, ev);
      else this.log(`[${symbol}] first run: last candle is not fresh, waiting for the next close`);
    } else {
      if (ev.time - prev > barMs) await this.catchUp(symbol, ev, prev);
      await this.onNewBar(symbol, ev);
    }
    this.state.lastBar[symbol] = ev.time; // only after the candle was fully handled, so failures are retried
    this.persist();
    return ev;
  }

  // Candles closed while the agent was offline: act on a missed SELL; never chase a missed BUY.
  async catchUp(symbol, ev, prev) {
    const missed = (ev.recent || []).filter(s => s.time > prev && s.time < ev.time);
    if (!missed.length) return;
    const pos = this.state.positions[symbol];
    if (pos && missed.some(s => s.dir === -1)) {
      await this.closePosition(symbol, await this.price(symbol), 'Tín hiệu BÁN bị lỡ khi agent tắt');
    } else if (!pos && missed.some(s => s.dir === 1)) {
      await this.notifier.send(`ℹ️ ${symbol}: có tín hiệu MUA khi agent tắt (${missed.length} tín hiệu bị lỡ). Không đuổi theo tín hiệu cũ.`);
    }
  }

  // ───────────────────────────── closed-candle logic ─────────────────────────────
  async onNewBar(symbol, ev) {
    const pos = this.state.positions[symbol];
    if (ev.sig === -1) {
      if (pos) await this.closePosition(symbol, await this.price(symbol), 'Tín hiệu BÁN');
      await this.announce(symbol, ev, pos ? 'đã đóng lệnh mua' : 'không có lệnh mở');
      return;
    }
    if (ev.sig === 1) {
      let action;
      if (pos) {
        // A new BUY while already long (the SELL in between was filtered): keep targets, only raise the stop.
        if (ev.vs > pos.sl) { pos.sl = ev.vs; this.persist(); await this.resetStop(symbol, await this.price(symbol)); }
        action = 'đang có lệnh: giữ lệnh, nâng stop';
      } else if (this.state.pending[symbol]) {
        action = 'đang chờ xác nhận lệnh mua trước đó';
      } else {
        const risk = this.riskCheck();
        action = risk.ok ? await this.open(symbol, ev) : `KHÔNG vào lệnh: ${risk.reason}`;
      }
      await this.announce(symbol, ev, action);
      return;
    }
    if (ev.skipped === 1 && !pos) {
      await this.notifier.send(`⏭️ ${symbol} ${this.cfg.timeframe}: bỏ qua tín hiệu MUA vì giá cách EMA200 ${ev.z.toFixed(1)} ATR (quá xa).`);
    }
    if (pos && Number.isFinite(ev.vs) && ev.vs > pos.sl) {
      pos.sl = ev.vs; // trailing stop only moves up
      this.persist();
      const price = await this.price(symbol);
      if (pos.sl >= price) await this.closePosition(symbol, price, 'Xu hướng đảo chiều (stop vượt giá)');
      else await this.resetStop(symbol, price);
    }
  }

  targets(ev) {
    return Array.from({ length: TP_COUNT }, (_, k) => ({ px: ev.close + ev.atr * TP_STEP_ATR * (k + 1), frac: TP_SHARE / TP_COUNT, hit: false }));
  }

  riskCheck() {
    if (this.fs.existsSync(this.cfg.stopFile)) return { ok: false, reason: 'có file STOP (kill switch)' };
    if (this.state.halted) return { ok: false, reason: 'đang tạm dừng bởi /stop' };
    const day = this.state.daily[utcDay(this.now())];
    if (day && day.realized <= -this.cfg.dailyLossLimit) return { ok: false, reason: `chạm giới hạn lỗ ngày (${day.realized.toFixed(2)} USDT)` };
    const open = Object.keys(this.state.positions).length + Object.keys(this.state.pending).length;
    if (open >= this.cfg.maxOpenPositions) return { ok: false, reason: `đã đủ ${this.cfg.maxOpenPositions} lệnh mở` };
    return { ok: true };
  }

  async open(symbol, ev) {
    const quote = this.cfg.quotePerTrade;
    const free = await this.broker.freeQuote();
    if (free < quote) return `KHÔNG vào lệnh: số dư ${free.toFixed(2)} USDT < ${quote} USDT`;
    const price = await this.price(symbol);
    const snapshot = { time: ev.time, close: ev.close, vs: ev.vs, atr: ev.atr, power: ev.power };
    const clientOrderId = `wtt${ev.time.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (this.exchange) {
      this.state.pending[symbol] = { clientOrderId, quote, ev: snapshot, at: this.now() };
      this.persist(); // recorded BEFORE the order is sent
    }
    let fill;
    try {
      fill = await this.broker.marketBuy(symbol, quote, price, clientOrderId);
    } catch (err) {
      if (!this.exchange || this.broker.isRejection(err)) {
        delete this.state.pending[symbol];
        this.persist();
        return `KHÔNG vào lệnh: sàn từ chối (${cleanErr(err)})`;
      }
      throw err; // unknown outcome: keep "pending", resolvePending() checks the order next poll
    }
    const note = this.createPosition(symbol, snapshot, fill, quote);
    await this.resetStop(symbol, price);
    return `ĐÃ MUA ${fmtPx(fill.qty)} @ ${fmtPx(fill.price)} (${quote} USDT)${note}`;
  }

  createPosition(symbol, ev, fill, quote) {
    const slice = (fill.qty * TP_SHARE) / TP_COUNT;
    const tpsOk = this.broker.sellable(symbol, slice, fill.price);
    const pos = {
      symbol, entry: fill.price, qty: fill.qty, initialQty: fill.qty, cost: quote,
      sl: ev.vs, tps: tpsOk ? this.targets(ev) : [], stopId: null, stopBooked: 0, realized: 0, best: fill.price,
      openedAt: this.now(), signalTime: ev.time, power: ev.power, exitRequested: null,
    };
    this.state.positions[symbol] = pos;
    delete this.state.pending[symbol];
    this.persist();
    this.store.appendTrade({ type: 'open', time: new Date(this.now()).toISOString(), mode: this.broker.kind, symbol, qty: pos.qty, price: pos.entry, cost: quote, sl: pos.sl, tps: pos.tps.map(t => t.px) });
    return tpsOk ? '' : ' - TP từng phần nhỏ hơn mức tối thiểu của sàn nên tắt, cả lệnh chạy theo trailing stop';
  }

  // A buy whose outcome was unknown (crash / timeout): look it up by client order id.
  async resolvePending(symbol) {
    const p = this.state.pending[symbol];
    if (!p) return;
    if (this.state.positions[symbol]) { delete this.state.pending[symbol]; this.persist(); return; }
    const fill = await this.broker.findBuy(symbol, p.clientOrderId, p.ev.close);
    if (fill) {
      this.createPosition(symbol, p.ev, fill, p.quote);
      await this.notifier.send(`🔁 ${symbol}: đã khôi phục lệnh mua ${fmtPx(fill.qty)} @ ${fmtPx(fill.price)} sau sự cố.`);
      await this.resetStop(symbol, await this.price(symbol));
    } else if (this.now() - p.at > PENDING_TIMEOUT_MS) {
      delete this.state.pending[symbol];
      this.persist();
      await this.notifier.send(`ℹ️ ${symbol}: lệnh mua chờ xác nhận không tồn tại trên sàn, đã hủy theo dõi.`);
    }
  }

  // ───────────────────────────── live price management ─────────────────────────────
  async manage(symbol, price) {
    const pos = this.state.positions[symbol];
    if (!pos) return;
    pos.best = Math.max(pos.best, price);

    if (this.exchange && pos.stopId) {
      const st = await this.broker.stopStatus(symbol, pos.stopId);
      this.bookStop(pos, st);
      if (st.status !== 'open') pos.stopId = null;
      if (pos.qty <= DUST || st.status === 'closed') { await this.finalize(symbol, 'Stop loss khớp trên sàn'); return; }
    }
    if (pos.exitRequested) { await this.closePosition(symbol, price, pos.exitRequested); return; }
    if (price <= pos.sl) { await this.closePosition(symbol, price, 'Stop loss'); return; }

    try {
      for (const [k, tp] of pos.tps.entries()) {
        if (tp.hit || price < tp.px) continue;
        const qty = Math.min(pos.qty, pos.initialQty * tp.frac);
        if (!this.broker.sellable(symbol, qty, price)) {
          tp.hit = true; tp.skipped = true;
          this.persist();
          await this.notifier.send(`ℹ️ ${symbol} chạm TP${k + 1} nhưng phần bán nhỏ hơn mức tối thiểu của sàn; gộp vào phần chạy theo trailing stop.`);
          continue;
        }
        if (await this.releaseStop(symbol)) return; // the stop had filled: position closed
        const sale = await this.broker.marketSell(symbol, qty, price);
        tp.hit = true;
        this.recordSale(pos, sale.qty, sale.price, sale.fee);
        this.persist();
        await this.notifier.send(`✅ ${symbol} chạm TP${k + 1} @ ${fmtPx(sale.price)}: bán ${fmtPx(sale.qty)}, còn ${fmtPx(pos.qty)} chạy theo trailing stop ${fmtPx(pos.sl)}.`);
      }
      const tookProfit = pos.tps.some(t => t.hit && !t.skipped);
      if (pos.qty <= DUST || (tookProfit && !this.broker.sellable(symbol, pos.qty, price))) { await this.finalize(symbol, 'Hết khối lượng sau TP'); return; }
    } finally {
      // Re-place a missing exchange stop on every poll, including right after a failed TP sell.
      if (this.exchange && this.state.positions[symbol] && !pos.stopId) await this.resetStop(symbol, price);
    }
  }

  bookStop(pos, st) {
    const delta = (st.filled || 0) - (pos.stopBooked || 0);
    if (delta > DUST) {
      const fee = Number.isFinite(st.fee) && st.filled > 0 ? st.fee * (delta / st.filled) : delta * st.price * EST_FEE;
      this.recordSale(pos, delta, st.price, fee);
      pos.stopBooked = st.filled;
      this.persist();
    }
  }

  // Cancel our exchange stop and book whatever it already filled. Returns true if that closed the position.
  async releaseStop(symbol) {
    const pos = this.state.positions[symbol];
    if (!pos?.stopId) return false;
    const st = await this.broker.cancelStop(symbol, pos.stopId);
    this.bookStop(pos, st);
    pos.stopId = null;
    this.persist();
    if (pos.qty <= DUST || st.status === 'closed') { await this.finalize(symbol, 'Stop loss khớp trên sàn'); return true; }
    return false;
  }

  async resetStop(symbol, price) {
    if (!this.exchange) return;
    if (await this.releaseStop(symbol)) return;
    const pos = this.state.positions[symbol];
    if (!pos || !(pos.sl < price) || !this.broker.sellable(symbol, pos.qty, pos.sl)) return; // a stop at/above market would fill instantly; manage() exits
    try {
      pos.stopId = await this.broker.placeStop(symbol, pos.qty, pos.sl);
      pos.stopBooked = 0;
      this.persist();
    } catch (err) {
      await this.alertOnce(`${symbol}:stop`, `🚨 ${symbol}: KHÔNG đặt được stop trên sàn (${cleanErr(err)}). Agent sẽ thử lại mỗi lần kiểm tra và vẫn tự theo dõi stop ${fmtPx(pos.sl)}.`);
    }
  }

  recordSale(pos, qty, price, fee) {
    if (!(qty >= 0) || !(price > 0) || !Number.isFinite(fee)) throw new Error(`Invalid fill (qty ${qty}, price ${price}, fee ${fee})`);
    if (qty === 0) return;
    const basis = pos.cost * (qty / pos.initialQty);
    pos.realized += qty * price - fee - basis;
    pos.qty = Math.max(0, pos.qty - qty);
  }

  async closePosition(symbol, price, reason) {
    const pos = this.state.positions[symbol];
    if (!pos) return;
    pos.exitRequested = reason; // if the sell fails, manage() retries the exit on the next poll
    this.persist();
    if (await this.releaseStop(symbol)) return;
    if (pos.qty > DUST) {
      const sale = await this.broker.marketSell(symbol, pos.qty, price);
      this.recordSale(pos, sale.qty, sale.price, sale.fee);
    }
    await this.finalize(symbol, reason);
  }

  async finalize(symbol, reason) {
    const pos = this.state.positions[symbol];
    if (!pos) return;
    delete this.state.positions[symbol];
    const day = utcDay(this.now());
    this.state.daily[day] = { realized: (this.state.daily[day]?.realized || 0) + pos.realized };
    this.persist();
    const pct = (pos.realized / pos.cost) * 100;
    const maxPct = (pos.best / pos.entry - 1) * 100;
    const dust = pos.qty > DUST ? ` (còn lại ${fmtPx(pos.qty)} lẻ dưới mức tối thiểu của sàn)` : '';
    this.store.appendTrade({ type: 'close', time: new Date(this.now()).toISOString(), mode: this.broker.kind, symbol, reason, realized: pos.realized, pct, maxFavorablePct: maxPct, dust: pos.qty });
    await this.notifier.send(`${pos.realized >= 0 ? '💰' : '🔻'} ĐÓNG ${symbol} (${reason}): ${pos.realized >= 0 ? '+' : ''}${pos.realized.toFixed(2)} USDT (${fmtPct(pct)}), cao nhất ${fmtPct(maxPct)}${dust}. Lãi/lỗ hôm nay: ${this.state.daily[day].realized.toFixed(2)} USDT.`);
    if (this.state.daily[day].realized <= -this.cfg.dailyLossLimit) {
      await this.notifier.send(`🛑 Chạm giới hạn lỗ ngày ${this.cfg.dailyLossLimit} USDT. Ngừng mở lệnh mới tới hết ngày (UTC). Lệnh đang mở vẫn được quản lý.`);
    }
  }

  // ───────────────────────────── notifications ─────────────────────────────
  async htfSnapshot(symbol) {
    const out = [];
    for (const tf of this.cfg.htfTimeframes) {
      try {
        const ev = this.evaluateFn(await this.market.candles(symbol, tf), this.params(tf, symbol));
        const ls = ev.lastSignal;
        out.push({ tf, trend: ev.trend, lastSignal: ls ? (ls.dir === 1 ? 'MUA' : 'BÁN') + (ls.power ? '+' : '') : null, signalPrice: ls?.price ?? null, barsAgo: ls?.barsAgo ?? null, emaDistanceATR: Number.isFinite(ev.z) ? +ev.z.toFixed(2) : null });
      } catch {
        out.push({ tf, error: 'không đủ dữ liệu' });
      }
    }
    return out;
  }

  async announce(symbol, ev, action) {
    try {
      const tf = this.cfg.timeframe;
      const kind = ev.sig === 1 ? 'MUA' : 'BÁN';
      const pos = this.state.positions[symbol];
      const htf = await this.htfSnapshot(symbol);
      const ups = htf.filter(h => h.trend === 1).length, known = htf.filter(h => h.trend !== undefined).length;
      const lines = [
        `${ev.sig === 1 ? '🟢' : '🔴'} ${kind}${ev.power ? '+' : ''} ${symbol} ${tf} @ ${fmtPx(ev.close)}  [${this.broker.kind}]`,
        `→ ${action}`,
        pos ? `SL ${fmtPx(pos.sl)}${pos.tps.length ? ' | ' + pos.tps.map((t, k) => `TP${k + 1} ${fmtPx(t.px)}`).join(' | ') : ''}` : null,
        `EMA200: ${Number.isFinite(ev.z) ? `${ev.z >= 0 ? '+' : ''}${ev.z.toFixed(1)} ATR` : 'n/a'}`,
        `Khung lớn: ${htf.map(h => `${h.tf}${h.trend !== undefined ? arrow(h.trend) : '?'}`).join(' ')} (${ups}/${known} tăng)`,
      ].filter(Boolean);
      const comment = await this.ai.comment({
        symbol, timeframe: tf, signal: kind + (ev.power ? '+ (mạnh)' : ''), price: ev.close, action,
        stop: pos?.sl ?? ev.vs, takeProfits: pos?.tps.map(t => t.px) ?? null,
        emaDistanceATR: Number.isFinite(ev.z) ? +ev.z.toFixed(2) : null, higherTimeframes: htf,
        backtestNote: BACKTEST_NOTE[tf], tradeDirection: 'Long Only (BÁN = đóng lệnh mua)',
      });
      if (comment) lines.push('', `🤖 Claude: ${comment}`);
      await this.notifier.send(lines.join('\n'));
    } catch (err) {
      this.log(`[${symbol}] announce error: ${err.message}`); // notifications never break trading
    }
  }

  // ───────────────────────────── Telegram commands ─────────────────────────────
  async handleCommands() {
    const { commands, offset } = await this.notifier.poll(this.state.telegramOffset);
    this.state.telegramOffset = offset;
    for (const { command, args } of commands) {
      try {
        await this.runCommand(command, args);
      } catch (err) {
        await this.notifier.send(`⚠️ Lệnh ${command} lỗi: ${cleanErr(err)}`);
      }
    }
  }

  async runCommand(command, args) {
    switch (command) {
      case '/stop':
        this.state.halted = true;
        this.persist();
        return this.notifier.send('⏸️ Đã tạm dừng mở lệnh mới. Lệnh đang mở vẫn được quản lý TP/SL. Gõ /resume để chạy lại.');
      case '/resume':
        this.state.halted = false;
        this.persist();
        return this.notifier.send('▶️ Đã cho phép mở lệnh mới.');
      case '/closeall': {
        if (args[0] !== 'CONFIRM') return this.notifier.send('Để đóng TẤT CẢ lệnh bằng giá thị trường, gõ: /closeall CONFIRM');
        const failed = [];
        for (const s of Object.keys(this.state.positions)) {
          try { await this.closePosition(s, await this.price(s), 'Đóng thủ công (/closeall)'); } catch (err) { failed.push(`${s}: ${cleanErr(err)}`); }
        }
        return this.notifier.send(failed.length ? `⚠️ /closeall: chưa đóng được ${failed.join('; ')} (sẽ thử lại tự động)` : 'Đã đóng tất cả lệnh.');
      }
      case '/status':
      case '/positions':
        return this.notifier.send(await this.statusText());
      default:
        return this.notifier.send('Lệnh: /status, /positions, /stop, /resume, /closeall CONFIRM');
    }
  }

  async statusText() {
    const day = this.state.daily[utcDay(this.now())]?.realized || 0;
    const lines = [`📊 Agent [${this.broker.kind}] ${this.cfg.timeframe} | ${this.state.halted ? 'TẠM DỪNG' : 'đang chạy'} | lãi/lỗ hôm nay ${day.toFixed(2)} USDT`];
    for (const [s, p] of Object.entries(this.state.positions)) {
      const px = await this.price(s);
      const unreal = p.qty * px - p.cost * (p.qty / p.initialQty);
      lines.push(`${s}: ${fmtPx(p.qty)} @ ${fmtPx(p.entry)} | giá ${fmtPx(px)} | SL ${fmtPx(p.sl)}${this.exchange ? (p.stopId ? ' (có stop trên sàn)' : ' (CHƯA có stop trên sàn)') : ''} | chưa chốt ${unreal.toFixed(2)} USDT | TP ${p.tps.filter(t => t.hit).length}/${p.tps.length}`);
    }
    if (!Object.keys(this.state.positions).length) lines.push('Không có lệnh mở.');
    for (const s of Object.keys(this.state.pending)) lines.push(`${s}: lệnh mua đang chờ xác nhận`);
    for (const [s, ev] of Object.entries(this.lastEval)) lines.push(`${s}: xu hướng ${arrow(ev.trend)} | tín hiệu cuối ${ev.lastSignal ? (ev.lastSignal.dir === 1 ? 'MUA' : 'BÁN') + ` cách ${ev.lastSignal.barsAgo} nến` : 'n/a'} | EMA200 ${Number.isFinite(ev.z) ? ev.z.toFixed(1) : 'n/a'} ATR`);
    return lines.join('\n');
  }
}

module.exports = { Agent, BACKTEST_NOTE, TP_COUNT, TP_STEP_ATR, TP_SHARE, fmtPx, cleanErr };
