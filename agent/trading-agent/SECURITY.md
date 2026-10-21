# Bảo mật — WTT Trading Agent (SDL v1.1.0, 2026-10-21)

Tài liệu này theo các giai đoạn của Microsoft SDL: yêu cầu → thiết kế (threat model) → triển khai → kiểm thử → phát hành/vận hành.

## 1. Tài sản cần bảo vệ

| Tài sản | Vì sao quan trọng |
|---|---|
| Binance API key/secret | Đặt lệnh bằng tiền thật (testnet/live) |
| Telegram bot token + chat id | Ai nắm được có thể gửi lệnh `/closeall`, `/stop` |
| Anthropic API key | Chi phí API |
| `data/state-<mode>.json` | Số lượng coin agent cho là mình đang giữ — sai thì bán nhầm |
| Vốn trên sàn | Mục tiêu cuối cùng của mọi tấn công |

## 2. Ranh giới tin cậy và luồng dữ liệu

```
.env / config.json ──► agent (Node.js) ──► Binance (REST, ký HMAC)
                         ▲        │
Telegram (lệnh, KHÔNG tin cậy) ◄─┘──► Telegram (thông báo)
Binance market data (KHÔNG tin cậy) ──► strategy ──► quyết định
Claude (chỉ nhận xét, KHÔNG ảnh hưởng quyết định)
```

## 3. Threat model (STRIDE)

| # | Mối đe dọa | Loại | Biện pháp | Nằm ở |
|---|---|---|---|---|
| T1 | Người lạ / thành viên nhóm gửi `/closeall` | Spoofing, Elevation | Chỉ nhận từ `TELEGRAM_CHAT_ID`, chat **riêng** (id dương), tùy chọn `TELEGRAM_ALLOWED_USER_IDS` | `notifier.js`, `config.js` |
| T2 | Lệnh cũ gửi lúc agent tắt bị chạy lại sau nhiều giờ | Tampering (replay) | Bỏ lệnh cũ hơn 10 phút (`COMMAND_MAX_AGE_S`) | `notifier.js` |
| T3 | Lệnh dị dạng / spam lệnh | Tampering, DoS | Regex chặt, ≤ 64 ký tự, ≤ 5 lệnh mỗi lần đọc; offset vẫn tăng qua tin bị bỏ | `notifier.js` |
| T4 | Lộ key/token qua log, lỗi, Telegram | Information disclosure | `redact()` cho mọi dòng log, lỗi, tin gửi đi: giá trị secret đã đăng ký + mẫu token Telegram, key Anthropic, query string có chữ ký | `security.js`, `index.js`, `agent.js` |
| T5 | URL `api.telegram.org/bot<token>` lọt vào lỗi mạng | Information disclosure | Bọc lỗi fetch, redact trước khi ném/log | `notifier.js` |
| T6 | File trạng thái hỏng / bị sửa → bán số lượng sai | Tampering | Kiểm tra cấu trúc khi đọc, **dừng** nếu sai (fail closed); ghi nguyên tử; file mode 0600 | `state.js` |
| T7 | Hai agent cùng chạy → mua gấp đôi | Tampering | Khóa tạo bằng `O_EXCL` (`wx`), thay khóa của pid đã chết | `state.js` |
| T8 | Dữ liệu paper bị dùng cho tiền thật | Elevation | File trạng thái riêng mỗi chế độ, kiểm tra `mode` khi đọc | `state.js` |
| T9 | Vô tình chạy live | Elevation | `LIVE_CONFIRM=I_ACCEPT_REAL_MONEY_RISK` + trần `live.maxQuotePerTrade` + kill switch file `STOP` + giới hạn lỗ ngày | `config.js`, `agent.js` |
| T10 | Giá/fill bất thường từ sàn | Tampering | Kiểm tra giá dương, hữu hạn; fill NaN thì ném lỗi; không bán vượt số dư tự do | `market.js`, `broker.js` |
| T11 | Claude bị prompt-inject hoặc trả nội dung độc | Tampering | Claude chỉ nhận số liệu, không ra quyết định; trả lời gửi dạng **text thuần** (không `parse_mode`) | `ai.js`, `notifier.js` |
| T12 | Cấu hình độc (model id lạ, symbol trùng, giá trị âm) | Tampering | Validate toàn bộ `config.json`/`.env` lúc khởi động, fail fast | `config.js` |
| T13 | Thư viện phụ thuộc có lỗ hổng | Supply chain | `package-lock.json`, `npm ci`, `npm run audit` (2026-10-21: 0 lỗ hổng) | `package.json` |

## 4. Kiểm thử bảo mật

`npm run verify` = toàn bộ test + `npm audit`. Test riêng cho bảo mật: `test/security.test.js` (redaction, phân quyền Telegram, validate cấu hình, toàn vẹn trạng thái, khóa). Một lỗi thật đã được test phát hiện và sửa: token nằm ngay sau chữ `bot` trong URL Telegram không bị che.

## 5. Vận hành an toàn (checklist)

- [ ] Binance API key: **chỉ bật Spot Trading**, TẮT rút tiền, giới hạn IP nếu có thể.
- [ ] Bắt đầu bằng `MODE=paper`, rồi `testnet`, cuối cùng mới `live` với `quotePerTrade` nhỏ.
- [ ] `TELEGRAM_CHAT_ID` là chat riêng với bot; cân nhắc đặt `TELEGRAM_ALLOWED_USER_IDS`.
- [ ] Không commit `.env`, `data/` (đã có trong `.gitignore`). Trên GitHub Actions dùng Secrets, không truyền key sàn ở chế độ paper.
- [ ] Bị lộ key/token: thu hồi ngay trên Binance / @BotFather (`/revoke`), tạo mới.
- [ ] Dừng khẩn cấp: tạo file `STOP` cạnh `package.json` hoặc gõ `/stop` (chặn lệnh mới), `/closeall CONFIRM` (đóng hết).

## 6. Rủi ro còn lại (chấp nhận / chưa xử lý)

- Trên Windows, file mode 0600/0700 không có tác dụng — bảo vệ thư mục bằng quyền NTFS của tài khoản người dùng.
- `.env` lưu secret dạng rõ trên đĩa; nếu cần mức cao hơn hãy dùng secret manager của hệ điều hành.
- `agent.log` và `trades-*.jsonl` không tự xoay vòng — dọn định kỳ.
- Token Telegram nằm trong URL theo thiết kế của Telegram API (không tránh được); đã redact mọi chỗ in ra.
