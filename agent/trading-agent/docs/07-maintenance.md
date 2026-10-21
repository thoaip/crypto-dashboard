# 7. Bảo trì và vận hành

## 7.1 Giám sát

| Tín hiệu | Nguồn | Bình thường | Cần xử lý khi |
|---|---|---|---|
| Thông báo khởi động | Telegram | Một lần khi chạy lần đầu | Không nhận được → kiểm token/chat id |
| Lần chạy theo lịch | GitHub Actions | Xanh mỗi 15 phút | Đỏ (mọi symbol lỗi) hoặc ngừng chạy |
| `tick done … errors: none` | `data/agent.log` | Mỗi vòng | Một symbol lỗi liên tục |
| Cảnh báo ⚠️ / 🚨 | Telegram | Hiếm | 🚨 "KHÔNG đặt được stop" → xử lý ngay |
| Lãi/lỗ ngày | Thông báo đóng lệnh | Trong giới hạn | Chạm `dailyLossLimit` (agent tự ngừng mở lệnh) |
| Trang `/wtt/` | GitHub Pages | Cập nhật theo `agent-state` | Dữ liệu cũ hơn vài giờ |

## 7.2 Xử lý sự cố (runbook)

| Tình huống | Agent tự làm | Người vận hành làm |
|---|---|---|
| Sàn chặn IP / mất dữ liệu nến | Thử host dữ liệu khác; vẫn quản lý stop bằng giá | Nếu kéo dài: đổi `BINANCE_DATA_HOSTS` hoặc nơi chạy |
| Không đặt được stop trên sàn | Thử lại mỗi vòng, tự theo dõi stop, cảnh báo 🚨 mỗi 30 phút | Kiểm số dư, quyền API, đặt stop thủ công nếu cần |
| Agent tắt đột ngột khi có lệnh | Stop trên sàn vẫn bảo vệ; khi chạy lại: khôi phục lệnh chờ, đối chiếu số dư, đóng nếu có SELL bị lỡ | Khởi động lại; đọc thông báo đối chiếu |
| Hai agent cùng chạy | Khóa chặn tiến trình thứ hai | Tắt tiến trình thừa |
| File trạng thái hỏng | **Từ chối khởi động** | Khôi phục bản sao lưu hoặc sửa file; đối chiếu với sàn |
| Lộ key/token | — | Thu hồi ngay (Binance, @BotFather `/revoke`), tạo mới, xem [../SECURITY.md](../SECURITY.md) |
| Thị trường bất thường | — | `/stop` (chặn lệnh mới) hoặc `/closeall CONFIRM` (đóng hết) hoặc tạo file `STOP` |

## 7.3 Quản lý thay đổi

| Loại thay đổi | Yêu cầu trước khi đưa vào chạy |
|---|---|
| Sửa lỗi | Test tái hiện lỗi (đỏ → xanh), `npm run verify` |
| Đổi luật tín hiệu / tham số | Backtest lại: train/test, nhiều coin, so với ngẫu nhiên; cập nhật engine + Pine cùng phiên bản; test parity |
| Đổi đường đi lệnh sàn | Test với `FakeExchange` cho mọi nhánh mới; chạy testnet trước |
| Đổi bề mặt bảo mật (lệnh mới, input mới, secret mới) | Cập nhật threat model `SECURITY.md`, thêm test bảo mật |
| Nâng thư viện | `npm ci`, `npm run verify`, chạy testnet |

## 7.4 Bảo trì định kỳ

| Tần suất | Việc |
|---|---|
| Hằng tuần | Xem lãi/lỗ so với backtest; xem cảnh báo lặp lại |
| Hằng tháng | `npm run audit`; dọn `agent.log` và `trades-*.jsonl` nếu lớn |
| Hằng quý | Chạy lại backtest với dữ liệu mới; xem lại ngưỡng rủi ro; xoay vòng API key |
| Khi đổi môi trường | Xem lại [06-deployment.md §6.6](06-deployment.md#66-danh-sách-kiểm-tra-trước-khi-bật-live) |

## 7.5 Nợ kỹ thuật và hướng phát triển

| Mục | Ghi chú |
|---|---|
| Bản trên GitHub đồng bộ thủ công | Có thể gộp thư mục phát triển và repo GitHub thành một |
| Log và nhật ký giao dịch không xoay vòng | Thêm giới hạn kích thước |
| File mode 0600 không có tác dụng trên Windows | Dựa vào quyền NTFS |
| Chưa có đo độ phủ mã (coverage) | `node --test --experimental-test-coverage` |
| `agent.js` gần 500 dòng | Có thể tách phần lệnh Telegram và thông báo ra module riêng |
