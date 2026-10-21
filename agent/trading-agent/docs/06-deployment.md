# 6. Triển khai vận hành

## 6.1 Môi trường

| Môi trường | Tiền | Ở đâu | Key sàn | Cổng an toàn |
|---|---|---|---|---|
| **paper** | Ảo (1000 USDT mặc định) | Máy cá nhân hoặc GitHub Actions | Không cần | — |
| **testnet** | Ảo trên Binance testnet | Máy cá nhân | Key testnet | Thiếu key thì không chạy |
| **live** | **Thật** | Máy cá nhân / VPS | Key thật (chỉ quyền Spot) | `LIVE_CONFIRM`, trần `live.maxQuotePerTrade`, giới hạn lỗ ngày, file `STOP` |

Quy tắc: luôn đi **paper → testnet → live**; không bao giờ đặt key sàn vào GitHub Actions.

## 6.2 Cài đặt trên máy cá nhân

1. Node.js ≥ 22.
2. `npm ci`
3. Sao chép `config.example.json` → `config.json` và `.env.example` → `.env`, điền giá trị.
4. `npm run verify` phải xanh.
5. `npm run once` để xem tín hiệu hiện tại (không đặt lệnh).
6. `npm start` để chạy.

## 6.3 Triển khai theo lịch trên GitHub Actions (paper)

| Mục | Giá trị |
|---|---|
| Repo | `thoaip/crypto-dashboard`, mã ở `agent/trading-agent` và `agent/backtest` |
| Workflow | `.github/workflows/wtt-agent.yml` — "WTT paper agent" |
| Lịch | Phút 7, 22, 37, 52 mỗi giờ (mỗi 15 phút); chạy thêm khi push vào `agent/**` hoặc bấm tay |
| Chế độ | `MODE: paper` cố định; job chỉ nhận secret Telegram và Anthropic |
| Trạng thái | Lưu ở nhánh `agent-state` (`state-paper.json`, `trades-paper.jsonl`); trang `/wtt/` đọc từ đây |
| Đồng thời | `concurrency: wtt-paper-agent`, không hủy lần đang chạy |
| Phát hiện lỗi | Mọi symbol lỗi thì mã thoát 1 (lần chạy hiện đỏ) |

## 6.4 Quy trình phát hành

1. Cập nhật mã trong thư mục phát triển; tăng phiên bản (`package.json`, và `VERSION` của engine nếu luật tín hiệu đổi).
2. `npm run verify` xanh; nếu đổi luật tín hiệu: chạy lại backtest và cập nhật file Pine cùng số phiên bản.
3. Cập nhật tài liệu: `README.md`, `SECURITY.md` (nếu đổi bề mặt bảo mật), `docs/`.
4. Đồng bộ `src/`, `package*.json`, `backtest/engine.cjs` sang repo GitHub; `git pull --rebase` trước khi push.
5. Sau khi push: kiểm tra lần chạy Actions đầu tiên thành công và `agent-state` có commit mới.
6. Với live: dừng agent → cập nhật → `npm ci` → `npm run verify` → khởi động lại → theo dõi thông báo khởi động và đối chiếu số dư.

## 6.5 Hoàn tác (rollback)

- GitHub: `git revert` commit lỗi; lần chạy theo lịch kế tiếp dùng bản cũ. Trạng thái paper ở nhánh riêng nên không bị ảnh hưởng.
- Máy cá nhân: dừng agent, quay lại bản trước, khởi động lại. Vị thế mở được đối chiếu với sàn khi khởi động; stop trên sàn vẫn bảo vệ trong lúc agent tắt.

## 6.6 Danh sách kiểm tra trước khi bật live

- [ ] UAT ở [05-testing.md §5.4](05-testing.md#54-kiểm-thử-chấp-nhận-uat-trước-khi-bật-tiền-thật) đã đạt.
- [ ] API key: chỉ Spot Trading, **tắt rút tiền**, giới hạn IP.
- [ ] `quotePerTrade`, `maxOpenPositions`, `dailyLossLimit` phù hợp số vốn chấp nhận mất.
- [ ] `TELEGRAM_CHAT_ID` là chat riêng; đã thử `/status` và `/stop`.
- [ ] Biết cách dừng khẩn cấp: file `STOP`, `/stop`, `/closeall CONFIRM`.
