# 4. Triển khai mã nguồn

## 4.1 Công nghệ

| Thành phần | Lựa chọn |
|---|---|
| Ngôn ngữ / runtime | JavaScript (CommonJS), Node.js ≥ 22 (đang dùng 24) |
| Sàn | `ccxt` 4.5.x (Binance Spot, có testnet) |
| AI | `@anthropic-ai/sdk` 0.133, model `claude-opus-5-5`, effort `low` |
| Telegram | Bot API qua `fetch` (không thư viện ngoài) |
| Test | `node:test` + `node:assert` (không thư viện ngoài) |

Chỉ 2 thư viện phụ thuộc trực tiếp: giảm bề mặt tấn công chuỗi cung ứng.

## 4.2 Cấu trúc thư mục

```
trading-agent/
├── src/            mã nguồn (10 module, xem 03-design.md §3.2)
├── test/           7 file test, 61 test
├── docs/           tài liệu SDLC (thư mục này)
├── data/           trạng thái, nhật ký giao dịch, log (không commit)
├── config.json     tham số chiến lược và rủi ro (không chứa secret)
├── .env            chế độ và secret (không commit)
├── SECURITY.md     SDL / threat model
└── README.md       hướng dẫn sử dụng
../backtest/engine.cjs   engine tín hiệu dùng chung
```

## 4.3 Quy ước viết mã

- Hàm và module nhỏ, một trách nhiệm; phụ thuộc ngoài truyền qua constructor (xem NFR-10).
- **Không nuốt lỗi:** mỗi symbol chạy trong `guarded()` — lỗi được log, báo một lần mỗi 30 phút, symbol khác vẫn chạy.
- Mọi chuỗi lỗi ra ngoài đi qua `cleanErr()` / `redact()`.
- Không `console.log`; dùng `log()` (có dấu thời gian, đã redact).
- Kiểm tra đầu vào ở biên: cấu hình (`config.js`), dữ liệu sàn (`market.js`, `broker.js`), lệnh Telegram (`notifier.js`), file trạng thái (`state.js`).
- Số tiền / số lượng: luôn kiểm `Number.isFinite`; giá trị không hợp lệ thì ném lỗi, không dùng giá trị mặc định.

## 4.4 Quản lý cấu hình

| Nơi | Nội dung | Commit? |
|---|---|---|
| `config.json` | symbols, timeframe, quotePerTrade, maxOpenPositions, dailyLossLimit, presets, ai, live.maxQuotePerTrade… | Có (không chứa secret) |
| `.env` | `MODE`, `LIVE_CONFIRM`, `BINANCE_API_KEY/SECRET`, `TELEGRAM_BOT_TOKEN/CHAT_ID/ALLOWED_USER_IDS`, `ANTHROPIC_API_KEY` | **Không** (`.gitignore`) |
| GitHub Secrets | `TELEGRAM_*`, `ANTHROPIC_API_KEY` cho job paper | — (không bao giờ có key sàn) |

Mẫu: `config.example.json`, `.env.example`.

## 4.5 Quản lý phiên bản mã

- Phiên bản phần mềm theo SemVer trong `package.json` (hiện 1.1.0); engine tín hiệu có phiên bản riêng (`VERSION` trong `engine.cjs`, hiện 2.5.0) khớp với file Pine cùng số.
- Commit theo Conventional Commits (`feat:`, `fix:`, `docs:`…).
- Bản chạy trên GitHub nằm ở `thoaip/crypto-dashboard` (`agent/trading-agent`, `agent/backtest`); đồng bộ thủ công từ thư mục phát triển này.

## 4.6 Lệnh thường dùng

| Lệnh | Tác dụng |
|---|---|
| `npm ci` | Cài đúng phiên bản trong lockfile |
| `npm run once` | Báo cáo tín hiệu hiện tại, **không** đặt lệnh |
| `npm start` | Chạy vòng lặp theo `MODE` |
| `node src/index.js --tick` | Chạy một vòng rồi thoát (dùng cho lịch) |
| `npm test` | Chạy toàn bộ test |
| `npm run verify` | Test + kiểm tra lỗ hổng thư viện |
