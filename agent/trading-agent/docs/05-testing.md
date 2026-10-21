# 5. Kiểm thử

## 5.1 Chiến lược

| Cấp | Phạm vi | Công cụ / cách làm |
|---|---|---|
| Unit | Cấu hình, redact, phân quyền Telegram, trạng thái, broker paper | `node:test`, dữ liệu giả |
| Tích hợp (giả lập sàn) | Agent + `FakeExchange` mô phỏng Binance: khớp một phần, stop đã khớp, lệnh mất, từ chối | `test/exchange-path.test.js`, `test/broker.test.js` (ccxt với HTTP giả) |
| Parity tín hiệu | Cửa sổ 1000 nến live = toàn bộ lịch sử backtest | `test/strategy.test.js` trên dữ liệu Binance thật |
| Hệ thống | `--once` với dữ liệu thật; paper trên GitHub Actions | Chạy thủ công / theo lịch |
| Chiến lược (ngoài agent) | Backtest, train 70% / test 30%, 11 coin, so với vào lệnh ngẫu nhiên | `backtest/*.cjs` |
| Bảo mật | Redact, phân quyền, validate, toàn vẹn trạng thái, khóa; `npm audit` | `test/security.test.js`, `npm run verify` |

**Tiêu chí đạt để phát hành:** 100% test pass, `npm audit` 0 lỗ hổng, parity tín hiệu 0 sai lệch, `--once` chạy được với dữ liệu thật.

## 5.2 Bộ test hiện tại (61 test, 7 file — tất cả pass ngày 2026-10-21)

| File | Số test | Nội dung |
|---|---|---|
| `agent.test.js` | 10 | Nến cũ lần đầu, TP1/TP2, trailing chỉ tăng, SELL đóng lệnh, stop vượt giá, giới hạn lệnh, bỏ BUY quá xa EMA200, `/closeall CONFIRM`, high/low giữa các lần chạy, thiếu số dư |
| `exchange-path.test.js` | 13 | Stop sàn cho toàn bộ số lượng, stop đã khớp + SELL không bán trùng, stop khớp một phần, TP nhỏ hơn mức tối thiểu, đặt lại stop sau TP, stop mất được đặt lại, khôi phục lệnh mua, từ chối xóa pending, SELL bị lỡ, mất dữ liệu nến vẫn quản lý stop, đối chiếu số dư, trạng thái theo chế độ, khóa |
| `broker.test.js` | 11 | Mua theo USDT và trừ phí, STOP_LOSS_LIMIT, lệnh dưới mức tối thiểu, symbol lạ, testnet, hủy stop đã khớp / khớp một phần, bán không vượt số dư, tìm lệnh theo client id, phí BNB, broker paper |
| `config.test.js` | 7 | Paper không cần key, testnet thiếu key, live thiếu xác nhận, trần live, đầu vào sai, tham số theo khung, preset BTC 8H |
| `security.test.js` | 10 | Redact, cleanErr, nhận lệnh hợp lệ, từ chối chat khác/nhóm/cũ/dị dạng/người lạ, giới hạn số lệnh, lỗi mạng không lộ token, validate Telegram/AI/symbol, trạng thái hỏng bị từ chối, khóa |
| `strategy.test.js` | 6 | Parity 1000 nến (BTC 4H, ETH 12H, SOL 1D), thiếu lịch sử, bộ lọc nhiễu không chặn SELL, MUA SỚM có stop dưới giá |
| `ai.test.js` | 4 | Đúng model/tham số, từ chối trả null, lỗi API không chặn giao dịch, tắt khi không có key |

## 5.3 Ma trận truy vết

| Yêu cầu | Module | Test chứng minh |
|---|---|---|
| FR-01, FR-02 | strategy, engine | strategy: *live 1000-bar window reproduces backtest signals* (×3) |
| FR-03 | config, engine | config: *strategy params match Pine defaults*, *BTC 8H preset*; strategy: *noise filter…*, *early BUY…* |
| FR-04 | agent | agent: *first run ignores a stale candle* |
| FR-10 | agent, broker | broker: *market buy spends a fixed USDT amount*; agent: *insufficient balance does not open* |
| FR-11 | agent, broker | exchange-path: *buy places an exchange stop*; agent: *trailing stop never moves down*; broker: *STOP_LOSS_LIMIT* |
| FR-12 | agent | agent: *TP1 and TP2 each sell 25%*; exchange-path: *TP sells re-place the stop* |
| FR-13 | agent | agent: *SELL signal closes the long*; *trend flip … exits at market* |
| FR-14 | broker, agent | broker: *market sell never exceeds the free balance*, *orders below the exchange minimum*; exchange-path: *TP slice below the minimum* |
| FR-15 | agent, broker | exchange-path: *stop already filled + SELL*, *partially filled stop*; broker: *cancelling a stop that already FILLED* |
| FR-16 | agent, broker | exchange-path: *buy times out … recovered*, *definitive rejection clears pending*; broker: *lost buy is found again* |
| FR-17 | agent | exchange-path: *startup reconciliation drops a position* |
| FR-18 | agent | exchange-path: *SELL missed while the agent was offline* |
| FR-19 | agent | agent: *scheduled paper runs: TP and stop touched between runs* |
| FR-20, FR-21, FR-22 | agent | agent: *risk: max open positions, kill switch, /stop and daily loss limit block new entries* |
| FR-23 | agent | agent: *skipped BUY (EMA200 stretch)* |
| FR-30, FR-32 | agent, notifier | agent: các test kiểm tra nội dung thông báo |
| FR-31 | agent, notifier | agent: */closeall needs CONFIRM*; security: *accepts a fresh command* |
| FR-33 | ai | ai: 4 test |
| NFR-01 | config | config: *live without the confirmation phrase*, *live trade size is capped* |
| NFR-02 | state | exchange-path: *state files are per mode*; security: *state with a bad position refuses to load* |
| NFR-03 | state | exchange-path: *single-instance lock*; security: *lock is exclusive … stale* |
| NFR-04 | security, notifier | security: *redact…*, *cleanErr…*, *network error never leaks the bot token* |
| NFR-05 | notifier, config | security: *rejects other chats…*, *caps the number of commands*, *config rejects unsafe Telegram…* |
| NFR-06 | agent, ai | exchange-path: *candle data outage still runs stop management*; ai: *errors never throw into the trading loop* |
| NFR-07 | state | security: *valid state round-trips* |
| NFR-12 | package | `npm run audit` (0 lỗ hổng) |

## 5.4 Kiểm thử chấp nhận (UAT) trước khi bật tiền thật

1. `npm run verify` xanh.
2. `MODE=paper` ít nhất 2 tuần: số lệnh, lãi/lỗ phù hợp với backtest cùng giai đoạn; không có cảnh báo lỗi lặp lại.
3. `MODE=testnet` ít nhất 1 tuần: kiểm tra trên giao diện testnet rằng mọi vị thế đều có stop, TP bán đúng 25%, `/closeall CONFIRM` đóng sạch.
4. Thử sự cố: tắt agent giữa chừng khi đang có lệnh, bật lại → vị thế được đối chiếu đúng.
5. `MODE=live` với `quotePerTrade` nhỏ nhất có thể, theo dõi sát tuần đầu.

## 5.5 Lỗi đã phát hiện nhờ kiểm thử (ví dụ)

| Lỗi | Phát hiện bởi | Đã sửa |
|---|---|---|
| Token bot nằm sau chữ `bot` trong URL Telegram không bị che | `security.test.js` | v1.1.0 |
| 13 lỗi đường đi sàn (dùng chung file trạng thái, stop khớp mà vẫn bán, mua trùng sau sự cố…) | Review + `exchange-path.test.js` | v1.0.0 |
| Lần chạy theo lịch thất bại âm thầm do sàn chặn IP (HTTP 451) | Theo dõi GitHub Actions | v1.0.x |
