// Execution layer. Same interface for paper and exchange trading:
//   init(), price(symbol), freeQuote(), heldBase(symbol)
//   marketBuy(symbol, quoteUsdt, refPrice, clientOrderId) -> { qty, price, fee }
//   findBuy(symbol, clientOrderId) -> { qty, price, fee } | null       (recover a buy after a crash)
//   marketSell(symbol, qty, refPrice) -> { qty, price, fee }            (never sells more than is held)
//   sellable(symbol, qty, price) -> boolean                              (lot size + min notional)
//   placeStop(symbol, qty, stopPrice) -> orderId | null
//   stopStatus(symbol, orderId) -> { status, filled, price }            (filled = cumulative base qty)
//   cancelStop(symbol, orderId) -> { status, filled, price }            (status after the cancel attempt)
const PAPER_FEE = 0.001;  // Binance spot taker fee
const EST_FEE = 0.001;    // used when the exchange reports a fee in a third currency (e.g. BNB)

const num = v => (v === undefined || v === null || v === '' ? NaN : Number(v));

class PaperBroker {
  /** @param {{ paper: { usdt: number, base: Record<string, number> } }} state @param {(s: string) => Promise<number>} priceFn */
  constructor(state, priceFn) {
    this.state = state;
    this.priceFn = priceFn;
    this.kind = 'paper';
  }

  async init() {}
  async price(symbol) { return this.priceFn(symbol); }
  async freeQuote() { return this.state.paper.usdt; }
  async heldBase(symbol) { return this.state.paper.base[symbol] || 0; }
  async totalBase(symbol) { return this.heldBase(symbol); }
  sellable(symbol, qty) { return qty > 0; }
  isRejection() { return false; }

  async marketBuy(symbol, quote, refPrice) {
    const usdt = this.state.paper.usdt;
    if (!(Number.isFinite(usdt) && quote <= usdt)) throw new Error(`Paper balance ${Number(usdt).toFixed(2)} USDT < ${quote}`);
    if (!(refPrice > 0)) throw new Error(`Bad reference price ${refPrice}`);
    const fee = quote * PAPER_FEE;
    const qty = (quote - fee) / refPrice;
    this.state.paper.usdt -= quote;
    this.state.paper.base[symbol] = (this.state.paper.base[symbol] || 0) + qty;
    return { qty, price: refPrice, fee };
  }

  async findBuy() { return null; }

  async marketSell(symbol, qty, refPrice) {
    const held = this.state.paper.base[symbol] || 0;
    const q = Math.min(qty, held);
    const gross = q * refPrice, fee = gross * PAPER_FEE;
    this.state.paper.base[symbol] = held - q;
    this.state.paper.usdt += gross - fee;
    return { qty: q, price: refPrice, fee };
  }

  // Paper stops are enforced by the agent loop.
  async placeStop() { return null; }
  async stopStatus() { return { status: 'none', filled: 0, price: NaN }; }
  async cancelStop() { return { status: 'none', filled: 0, price: NaN }; }
}

class ExchangeBroker {
  /** @param {{ apiKey: string, secret: string, sandbox: boolean, stopLimitBuffer: number, ccxt?: any }} opts */
  constructor({ apiKey, secret, sandbox, stopLimitBuffer, ccxt = require('ccxt') }) {
    this.kind = sandbox ? 'testnet' : 'live';
    this.ccxt = ccxt;
    this.buffer = stopLimitBuffer;
    this.ex = new ccxt.binance({ apiKey, secret, enableRateLimit: true, options: { defaultType: 'spot' } });
    if (sandbox) this.ex.setSandboxMode(true);
  }

  async init() { await this.ex.loadMarkets(); }

  market(symbol) {
    const m = this.ex.markets?.[symbol];
    if (!m) throw new Error(`${symbol} is not a spot market on ${this.kind}`);
    return m;
  }

  // Execution decisions use the venue's own price (testnet prices differ from mainnet).
  async price(symbol) {
    const t = await this.ex.fetchTicker(symbol);
    const px = num(t.last ?? t.close);
    if (!(px > 0)) throw new Error(`No price for ${symbol} on ${this.kind}`);
    return px;
  }

  async freeQuote() {
    const bal = await this.ex.fetchBalance();
    return num(bal.free?.USDT ?? 0) || 0;
  }

  async heldBase(symbol) {
    const bal = await this.ex.fetchBalance();
    return num(bal.free?.[this.market(symbol).base] ?? 0) || 0;
  }

  // Free + locked (e.g. in our own stop order): what the account really holds.
  async totalBase(symbol) {
    const bal = await this.ex.fetchBalance();
    return num(bal.total?.[this.market(symbol).base] ?? 0) || 0;
  }

  // Definitive exchange rejections (safe to forget a pending buy); everything else may have reached the exchange.
  isRejection(err) {
    const c = this.ccxt;
    return err instanceof c.InvalidOrder || err instanceof c.InsufficientFunds || err instanceof c.PermissionDenied || err instanceof c.AuthenticationError || err instanceof c.BadSymbol;
  }

  sellable(symbol, qty, price) {
    const m = this.market(symbol);
    const amount = num(this.ex.amountToPrecision(symbol, qty));
    if (!(amount > 0) || amount < (m.limits?.amount?.min ?? 0)) return false;
    return amount * price >= (m.limits?.cost?.min ?? 0);
  }

  // Fill price + total fee in USDT, validated so NaN can never reach the P/L ledger.
  fillOf(order, base, refPrice) {
    const filled = num(order.filled);
    let price = num(order.average);
    if (!(price > 0)) price = num(order.cost) / filled;
    if (!(price > 0)) price = num(order.price);
    if (!(filled >= 0) || (filled > 0 && !(price > 0))) throw new Error(`Unreadable fill for order ${order.id}`);
    const fees = order.fees?.length ? order.fees : order.fee ? [order.fee] : [];
    let baseFee = 0, feeUsdt = 0;
    for (const f of fees) {
      const cost = num(f?.cost);
      if (!(cost > 0)) continue;
      if (f.currency === base) { baseFee += cost; feeUsdt += cost * price; }
      else if (f.currency === 'USDT') feeUsdt += cost;
      else feeUsdt += filled * price * EST_FEE; // e.g. BNB fee: estimate its USDT value
    }
    return { filled, price: price > 0 ? price : refPrice, baseFee, fee: feeUsdt };
  }

  async marketBuy(symbol, quote, refPrice, clientOrderId) {
    const m = this.market(symbol);
    const minCost = m.limits?.cost?.min;
    if (minCost && quote < minCost) throw new this.ccxt.InvalidOrder(`${quote} USDT below ${symbol} minimum order ${minCost}`);
    const order = await this.ex.createMarketBuyOrderWithCost(symbol, quote, clientOrderId ? { newClientOrderId: clientOrderId } : {});
    const full = num(order.filled) > 0 ? order : await this.ex.fetchOrder(order.id, symbol);
    const f = this.fillOf(full, m.base, refPrice);
    const qty = f.filled - f.baseFee;
    if (!(qty > 0)) throw new Error(`Buy ${symbol} returned no filled quantity (order ${order.id})`);
    return { qty, price: f.price, fee: f.fee, orderId: order.id };
  }

  async findBuy(symbol, clientOrderId, refPrice) {
    try {
      const o = await this.ex.fetchOrder(undefined, symbol, { origClientOrderId: clientOrderId });
      const f = this.fillOf(o, this.market(symbol).base, refPrice);
      return f.filled > 0 ? { qty: f.filled - f.baseFee, price: f.price, fee: f.fee } : null;
    } catch (err) {
      if (err instanceof this.ccxt.OrderNotFound) return null;
      throw err;
    }
  }

  async marketSell(symbol, qty, refPrice) {
    const free = await this.heldBase(symbol);
    const amount = num(this.ex.amountToPrecision(symbol, Math.min(qty, free)));
    if (!(amount > 0)) return { qty: 0, price: refPrice, fee: 0 };
    const order = await this.ex.createOrder(symbol, 'market', 'sell', amount);
    const full = num(order.filled) > 0 ? order : await this.ex.fetchOrder(order.id, symbol);
    const f = this.fillOf(full, this.market(symbol).base, refPrice);
    return { qty: f.filled, price: f.price, fee: f.fee, orderId: order.id };
  }

  // Exchange-side protective stop (STOP_LOSS_LIMIT): keeps the position protected if the agent goes offline.
  async placeStop(symbol, qty, stopPrice) {
    const amount = num(this.ex.amountToPrecision(symbol, qty));
    if (!(amount > 0)) return null;
    const stop = num(this.ex.priceToPrecision(symbol, stopPrice));
    const limit = num(this.ex.priceToPrecision(symbol, stopPrice * (1 - this.buffer)));
    const order = await this.ex.createOrder(symbol, 'limit', 'sell', amount, limit, { stopLossPrice: stop, timeInForce: 'GTC' });
    return order.id;
  }

  async stopStatus(symbol, orderId) {
    const o = await this.ex.fetchOrder(orderId, symbol);
    const f = this.fillOf(o, this.market(symbol).base, NaN);
    return { status: o.status, filled: f.filled, price: f.price, fee: f.fee };
  }

  // Cancel, then report what the order actually did: an already-filled stop is NOT silently "cancelled".
  async cancelStop(symbol, orderId) {
    try {
      await this.ex.cancelOrder(orderId, symbol);
    } catch (err) {
      if (!(err instanceof this.ccxt.OrderNotFound)) throw err;
    }
    return this.stopStatus(symbol, orderId);
  }
}

module.exports = { PaperBroker, ExchangeBroker, PAPER_FEE, EST_FEE };
