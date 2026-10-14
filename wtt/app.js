// Waves Trend signals dashboard - runs entirely in the browser.
// Data: Binance public klines (closed candles only). Logic: window.WTTEngine (same file as the backtest/agent).
(function () {
  'use strict';
  const E = window.WTTEngine;
  const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'LINK', 'AVAX', 'DOT', 'LTC'];
  const TFS = ['4h', '8h', '12h', '1d', '3d', '1w'];
  const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
  const LIMIT = 1000, MIN_BARS = 300, CONCURRENCY = 6, CHECK_EVERY_MS = 60_000, FEE = 0.0005;

  const cache = new Map();   // "BTC|4h" -> { rows, evalResult, nextClose }
  const ui = { coin: 'BTC', tf: '4h', chart: null, series: {} };
  const $ = id => document.getElementById(id);
  const fmtPx = n => (!Number.isFinite(n) ? '–' : n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : n >= 1 ? n.toFixed(3) : n.toPrecision(4));
  const fmtPct = n => (!Number.isFinite(n) ? '–' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
  const fmtDate = ms => new Date(ms).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function setStatus(text, state) {
    $('statusText').textContent = text;
    $('statusDot').className = 'dot' + (state ? ' ' + state : '');
  }

  // ───────────────────────── data ─────────────────────────
  async function fetchKlines(coin, tf) {
    let lastErr;
    for (const host of HOSTS) {
      try {
        const res = await fetch(`${host}/api/v3/klines?symbol=${coin}USDT&interval=${tf}&limit=${LIMIT}`, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        if (!Array.isArray(raw)) throw new Error('bad response');
        const now = Date.now();
        return raw.filter(k => k[6] < now).map(k => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
      } catch (err) { lastErr = err; }
    }
    throw lastErr;
  }

  function evaluate(rows, tf) {
    if (rows.length < MIN_BARS) return { error: `chỉ có ${rows.length} nến` };
    const p = E.defaultParams(tf);
    const D = E.prepare(rows);
    const S = E.signals(D, p);
    const i = rows.length - 1;
    let ls = null;
    for (let k = i; k >= 0; k--) if (S.sig[k] !== 0) { ls = { dir: S.sig[k], idx: k, price: rows[k][4], power: S.power[k], time: rows[k][0] }; break; }
    const close = rows[i][4];
    return {
      p, D, S, close, trend: S.dir[i], z: S.z[i], vs: S.vs[i],
      last: ls, barsAgo: ls ? i - ls.idx : null,
      pnl: ls ? (close / ls.price - 1) * 100 * ls.dir : NaN,
      against: ls ? S.dir[i] !== ls.dir : false,
    };
  }

  async function load(coin, tf, force = false) {
    const key = `${coin}|${tf}`;
    const hit = cache.get(key);
    if (hit && !force && Date.now() < hit.nextClose) return hit;
    const rows = await fetchKlines(coin, tf);
    const barMs = E.TF_SECONDS[tf] * 1000;
    const entry = { rows, ev: evaluate(rows, tf), nextClose: rows.length ? rows[rows.length - 1][0] + 2 * barMs + 5000 : 0 };
    cache.set(key, entry);
    return entry;
  }

  async function loadAll(force) {
    const jobs = [];
    for (const c of COINS) for (const tf of TFS) jobs.push([c, tf]);
    let done = 0, failed = 0;
    const worker = async () => {
      while (jobs.length) {
        const [c, tf] = jobs.shift();
        try { await load(c, tf, force); } catch { failed++; }
        done++;
        if (done % 6 === 0) { setStatus(`Đang tải ${done}/${COINS.length * TFS.length}…`); renderMatrix(); }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    renderMatrix();
    renderDetail();
    const t = new Date().toLocaleTimeString('vi-VN');
    if (failed) setStatus(`Cập nhật ${t} · ${failed} lỗi tải dữ liệu`, 'err');
    else setStatus(`Cập nhật ${t} · tự kiểm tra nến mới mỗi phút`, 'ok');
  }

  // ───────────────────────── matrix ─────────────────────────
  function cellHtml(entry) {
    if (!entry) return '<span class="cell na">…</span>';
    const ev = entry.ev;
    if (ev.error) return `<span class="cell na" title="${esc(ev.error)}">ít dữ liệu</span>`;
    const trendTxt = ev.trend === 1 ? '▲' : '▼';
    if (!ev.last) return `<span class="cell na"><span class="sig">—</span><span class="meta">${trendTxt} chưa có tín hiệu</span></span>`;
    const kind = ev.last.dir === 1 ? 'MUA' : 'BÁN';
    const cls = ev.against ? 'warn' : ev.last.dir === 1 ? 'buy' : 'sell';
    const pnlCls = ev.pnl >= 0 ? 'pos' : 'neg';
    const tip = `${kind}${ev.last.power ? '+' : ''} @ ${fmtPx(ev.last.price)} (${fmtDate(ev.last.time)})${ev.against ? ' · xu hướng đã đảo, tín hiệu ngược chiều bị bộ lọc chặn' : ''}`;
    return `<span class="cell ${cls}" title="${esc(tip)}"><span class="sig">${kind}${ev.last.power ? '+' : ''}${ev.against ? ' ⚠' : ''}</span>` +
      `<span class="meta">${trendTxt} · ${ev.barsAgo} nến · <span class="${pnlCls}">${fmtPct(ev.pnl)}</span></span></span>`;
  }

  function renderMatrix() {
    $('matrixHead').innerHTML = '<th scope="col">Coin</th>' + TFS.map(tf => `<th scope="col">${tf.toUpperCase()}</th>`).join('') + '<th scope="col">Đồng thuận</th>';
    $('matrixBody').innerHTML = COINS.map(c => {
      const entries = TFS.map(tf => cache.get(`${c}|${tf}`));
      const known = entries.filter(e => e && !e.ev.error);
      const ups = known.filter(e => e.ev.trend === 1).length;
      const price = cache.get(`${c}|4h`)?.ev?.close;
      const consCls = !known.length ? '' : ups >= known.length * 0.67 ? 'bull' : ups <= known.length * 0.33 ? 'bear' : 'mid';
      const consTxt = !known.length ? '…' : `${ups}/${known.length} ▲ ${consCls === 'bull' ? 'Nghiêng MUA' : consCls === 'bear' ? 'Nghiêng BÁN' : 'Giằng co'}`;
      return `<tr tabindex="0" data-coin="${c}" class="${c === ui.coin ? 'sel' : ''}">` +
        `<td><span class="coin">${c}<small>${fmtPx(price)}</small></span></td>` +
        entries.map(e => `<td>${cellHtml(e)}</td>`).join('') +
        `<td><span class="cons ${consCls}">${consTxt}</span></td></tr>`;
    }).join('');
  }

  // ───────────────────────── chart + trade + backtest ─────────────────────────
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function ensureChart() {
    if (ui.chart) return;
    const el = $('chart');
    ui.chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: css('--muted'), fontFamily: 'JetBrains Mono, monospace' },
      grid: { vertLines: { color: css('--line') }, horzLines: { color: css('--line') } },
      timeScale: { timeVisible: true, borderColor: css('--line') },
      rightPriceScale: { borderColor: css('--line') },
      crosshair: { mode: 0 },
    });
    ui.series.candles = ui.chart.addCandlestickSeries({ upColor: css('--up'), downColor: '#ff5d6c', wickUpColor: css('--up'), wickDownColor: '#ff5d6c', borderVisible: false });
    ui.series.ema = ui.chart.addLineSeries({ color: css('--ema'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    ui.series.vsUp = ui.chart.addLineSeries({ color: css('--up'), lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false });
    ui.series.vsDn = ui.chart.addLineSeries({ color: css('--down'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    ui.priceLines = [];
  }

  function renderDetail() {
    const entry = cache.get(`${ui.coin}|${ui.tf}`);
    $('detailTitle').textContent = `Biểu đồ ${ui.coin}/USDT · ${ui.tf.toUpperCase()}`;
    if (!entry || entry.ev.error) { $('tradeBox').innerHTML = `<div class="kv"><b>Trạng thái</b><span>${entry ? esc(entry.ev.error) : 'đang tải…'}</span></div>`; return; }
    const { rows, ev } = entry;
    ensureChart();
    const t = i => Math.floor(rows[i][0] / 1000);
    ui.series.candles.setData(rows.map((r, i) => ({ time: t(i), open: r[1], high: r[2], low: r[3], close: r[4] })));
    ui.series.ema.setData(rows.map((r, i) => (Number.isFinite(ev.D.ema200[i]) ? { time: t(i), value: ev.D.ema200[i] } : { time: t(i) })));
    ui.series.vsUp.setData(rows.map((r, i) => (ev.S.dir[i] === 1 && Number.isFinite(ev.S.vs[i]) && !(i > 0 && ev.S.dir[i - 1] !== 1) ? { time: t(i), value: ev.S.vs[i] } : { time: t(i) })));
    ui.series.vsDn.setData(rows.map((r, i) => (ev.S.dir[i] === -1 && Number.isFinite(ev.S.vs[i]) && !(i > 0 && ev.S.dir[i - 1] !== -1) ? { time: t(i), value: ev.S.vs[i] } : { time: t(i) })));
    const markers = [];
    ev.S.sig.forEach((s, i) => {
      if (s === 1) markers.push({ time: t(i), position: 'belowBar', color: css('--up'), shape: 'arrowUp', text: ev.S.power[i] ? 'MUA+' : 'MUA' });
      else if (s === -1) markers.push({ time: t(i), position: 'aboveBar', color: css('--down'), shape: 'arrowDown', text: ev.S.power[i] ? 'BÁN+' : 'BÁN' });
      else if (ev.S.skipped[i] === 1) markers.push({ time: t(i), position: 'belowBar', color: css('--muted'), shape: 'circle', text: '× EMA' });
    });
    ui.series.candles.setMarkers(markers);

    // Strategy state (Long Only) incl. the currently open trade
    const trades = E.simulate(ev.D, { ...ev.p, fee: FEE, includeOpen: true }).filter(x => x.dir === 1);
    const open = trades.find(x => x.open);
    ui.priceLines.forEach(l => ui.series.candles.removePriceLine(l));
    ui.priceLines = [];
    const addLine = (price, color, title, style = 2) => ui.priceLines.push(ui.series.candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    const boxes = [
      ['Giá đóng nến', fmtPx(ev.close)],
      ['Xu hướng', ev.trend === 1 ? '▲ Tăng' : '▼ Giảm'],
      ['Cách EMA200', Number.isFinite(ev.z) ? `${ev.z >= 0 ? '+' : ''}${ev.z.toFixed(1)} ATR` : '–'],
    ];
    if (open) {
      addLine(open.entry, css('--muted'), 'Vào', 1);
      open.tps.forEach((tp, k) => { if (!tp.hit) addLine(tp.px, css('--up'), `TP${k + 1}`); });
      addLine(open.sl, '#ff5d6c', 'SL', 0);
      boxes.push(['Lệnh đang mở', `MUA @ ${fmtPx(open.entry)}`], ['Lãi/lỗ', fmtPct((ev.close / open.entry - 1) * 100)], ['Stop', fmtPx(open.sl)],
        ['TP', open.tps.map((tp, k) => `${tp.hit ? '✔' : ''}TP${k + 1} ${fmtPx(tp.px)}`).join(' · ') || '—']);
    } else {
      boxes.push(['Lệnh đang mở', 'Không (đứng ngoài)']);
    }
    $('tradeBox').innerHTML = boxes.map(([k, v]) => `<div class="kv"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
    ui.chart.timeScale().setVisibleLogicalRange({ from: rows.length - 220, to: rows.length + 5 });

    // Quick backtest on the loaded candles
    const closed = trades.filter(x => !x.open);
    const st = E.stats(closed);
    $('btStats').innerHTML = [
      ['Số lệnh', st.n], ['Tỷ lệ thắng', st.n ? `${st.win.toFixed(0)}%` : '–'], ['Profit factor', st.n ? (st.pf >= 99 ? '∞' : st.pf.toFixed(2)) : '–'],
      ['Tổng lãi (cộng dồn)', st.n ? fmtPct(st.net) : '–'], ['Sụt giảm lớn nhất', st.n ? `${st.dd.toFixed(1)}%` : '–'],
      ['Giai đoạn', `${new Date(rows[0][0]).toLocaleDateString('vi-VN')} → nay (${rows.length} nến)`],
    ].map(([k, v]) => `<div class="stat"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
    const why = { SL: 'Stop', TP: 'Hết TP', Reverse: 'Tín hiệu BÁN' };
    $('btTrades').innerHTML = '<thead><tr><th>Vào lệnh</th><th>Giá vào</th><th>Thoát</th><th>Lý do</th><th>Kết quả</th></tr></thead><tbody>' +
      closed.slice(-10).reverse().map(x => `<tr><td>${fmtDate(rows[x.entryIdx][0])}</td><td>${fmtPx(x.entry)}${x.power ? ' <span class="tag warn">+</span>' : ''}</td>` +
        `<td>${fmtDate(rows[x.exitIdx][0])}</td><td>${why[x.why] || x.why}</td><td class="${x.pnl >= 0 ? 'pos' : 'neg'}">${fmtPct(x.pnl * 100)}</td></tr>`).join('') + '</tbody>';
  }

  // ───────────────────────── paper agent (GitHub Actions) ─────────────────────────
  const STATE_BASE = 'https://raw.githubusercontent.com/thoaip/crypto-dashboard/agent-state';

  async function loadPaper() {
    try {
      const res = await fetch(`${STATE_BASE}/state-paper.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 404) { renderPaper(null, []); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const state = await res.json();
      let trades = [];
      const tr = await fetch(`${STATE_BASE}/trades-paper.jsonl?t=${Date.now()}`, { cache: 'no-store' });
      if (tr.ok) trades = (await tr.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      renderPaper(state, trades);
    } catch (err) {
      $('paperStats').innerHTML = `<div class="stat"><b>Trạng thái</b><span>Không đọc được (${esc(err.message)})</span></div>`;
    }
  }

  function renderPaper(state, trades) {
    if (!state) {
      $('paperStats').innerHTML = '<div class="stat"><b>Trạng thái</b><span>Agent chưa chạy lần nào</span></div>';
      $('paperOpen').innerHTML = ''; $('paperTrades').innerHTML = '';
      return;
    }
    const lastPx = sym => cache.get(`${sym.split('/')[0]}|4h`)?.ev?.close;
    const positions = Object.values(state.positions || {});
    let posValue = 0;
    for (const p of positions) { const px = lastPx(p.symbol); posValue += Number.isFinite(px) ? p.qty * px : p.cost * (p.qty / p.initialQty); }
    const equity = state.paper.usdt + posValue;
    const start = 1000;
    const closed = trades.filter(t => t.type === 'close');
    const wins = closed.filter(t => t.realized > 0).length;
    const realized = closed.reduce((s, t) => s + t.realized, 0);
    const lastCheck = Math.max(0, ...Object.values(state.lastCheck || {}));
    $('paperStats').innerHTML = [
      ['Vốn ảo hiện tại', `${equity.toFixed(2)} USDT`],
      ['So với ban đầu', fmtPct((equity / start - 1) * 100)],
      ['Đã chốt', `${realized >= 0 ? '+' : ''}${realized.toFixed(2)} USDT`],
      ['Lệnh đã đóng', closed.length ? `${closed.length} (thắng ${Math.round((wins / closed.length) * 100)}%)` : '0'],
      ['Đang mở', String(positions.length)],
      ['Lần chạy gần nhất', lastCheck ? fmtDate(lastCheck) : '–'],
      ['Bắt đầu', state.startedAt ? new Date(state.startedAt).toLocaleDateString('vi-VN') : '–'],
      ['Trạng thái', state.halted ? 'Tạm dừng (/stop)' : 'Đang chạy'],
    ].map(([k, v]) => `<div class="stat"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('');
    $('paperOpen').innerHTML = positions.length
      ? '<thead><tr><th>Lệnh đang mở</th><th>Giá vào</th><th>Giá hiện tại</th><th>Stop</th><th>TP</th><th>Lãi/lỗ</th></tr></thead><tbody>' +
        positions.map(p => { const px = lastPx(p.symbol); const pnl = Number.isFinite(px) ? (px / p.entry - 1) * 100 : NaN;
          return `<tr><td>${esc(p.symbol)}</td><td>${fmtPx(p.entry)}</td><td>${fmtPx(px)}</td><td>${fmtPx(p.sl)}</td><td>${p.tps.map((t, k) => `${t.hit ? '✔' : ''}TP${k + 1} ${fmtPx(t.px)}`).join(' · ') || '—'}</td><td class="${pnl >= 0 ? 'pos' : 'neg'}">${fmtPct(pnl)}</td></tr>`; }).join('') + '</tbody>'
      : '';
    $('paperTrades').innerHTML = closed.length
      ? '<thead><tr><th>Đóng lúc</th><th>Coin</th><th>Lý do</th><th>Kết quả</th></tr></thead><tbody>' +
        closed.slice(-15).reverse().map(t => `<tr><td>${fmtDate(Date.parse(t.time))}</td><td>${esc(t.symbol)}</td><td>${esc(t.reason)}</td><td class="${t.realized >= 0 ? 'pos' : 'neg'}">${t.realized >= 0 ? '+' : ''}${t.realized.toFixed(2)} USDT (${fmtPct(t.pct)})</td></tr>`).join('') + '</tbody>'
      : '<tbody><tr><td class="hint">Chưa có lệnh nào đóng. Agent chỉ vào lệnh khi có tín hiệu MUA trên nến 4H vừa đóng.</td></tr></tbody>';
  }

  // ───────────────────────── wiring ─────────────────────────
  function initControls() {
    $('coinSel').innerHTML = COINS.map(c => `<option value="${c}">${c}/USDT</option>`).join('');
    $('tfSel').innerHTML = TFS.map(tf => `<option value="${tf}">${tf.toUpperCase()}</option>`).join('');
    $('coinSel').value = ui.coin; $('tfSel').value = ui.tf;
    $('coinSel').addEventListener('change', e => { ui.coin = e.target.value; renderMatrix(); renderDetail(); });
    $('tfSel').addEventListener('change', e => { ui.tf = e.target.value; renderDetail(); });
    const pick = tr => { if (!tr) return; ui.coin = tr.dataset.coin; $('coinSel').value = ui.coin; renderMatrix(); renderDetail(); $('chart').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    $('matrixBody').addEventListener('click', e => pick(e.target.closest('tr')));
    $('matrixBody').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target.closest('tr')); } });
    $('refreshBtn').addEventListener('click', () => loadAll(true));
    $('themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      document.documentElement.dataset.theme = cur === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('wtt-theme', document.documentElement.dataset.theme); } catch { /* storage unavailable */ }
      if (ui.chart) { ui.chart.remove(); ui.chart = null; renderDetail(); }
    });
    try { const saved = localStorage.getItem('wtt-theme'); if (saved) document.documentElement.dataset.theme = saved; } catch { /* storage unavailable */ }
  }

  if (!E || !window.LightweightCharts) { setStatus('Không tải được thư viện (engine hoặc biểu đồ).', 'err'); return; }
  initControls();
  renderMatrix();
  loadAll(false).then(loadPaper);
  setInterval(() => loadAll(false).then(loadPaper), CHECK_EVERY_MS); // only refetches series whose candle has closed
})();
