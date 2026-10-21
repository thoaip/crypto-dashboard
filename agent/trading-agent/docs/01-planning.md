# 1. Lập kế hoạch

## 1.1 Bối cảnh

Chỉ báo *Waves Trend Toolkit [CR]* (Pine Script, TradingView) được viết lại theo kiểu clean-room và backtest trên dữ liệu Binance 2017–2026. Người dùng cần một agent tự động giao dịch đúng theo các luật đã backtest, có thông báo qua Telegram và nhận xét bằng Claude, chạy được cả trên máy cá nhân lẫn GitHub Actions.

## 1.2 Mục tiêu

| Mã | Mục tiêu | Thước đo |
|---|---|---|
| G1 | Giao dịch **đúng** luật đã backtest | Tín hiệu live trùng 100% với backtest trên cùng dữ liệu (test parity) |
| G2 | **Không mất tiền vì lỗi phần mềm** | Không bán quá số dư, không mua trùng, luôn có stop trên sàn |
| G3 | Người dùng **luôn biết** chuyện gì đang xảy ra | Mọi lệnh / lỗi / chạm TP-SL đều có thông báo |
| G4 | **An toàn** khi chạm tới tiền thật | Live phải qua nhiều cổng xác nhận; secret không bao giờ lộ |
| G5 | Vận hành **không cần máy chạy 24/7** | Chạy theo lịch trên GitHub Actions ở chế độ paper |

## 1.3 Phạm vi

**Trong phạm vi:** Binance Spot, cặp `*/USDT`, chỉ LONG; khung 4H–1W; chế độ paper / testnet / live; Telegram (thông báo + lệnh điều khiển); Claude nhận xét tín hiệu; chạy liên tục hoặc theo lịch (`--tick`).

**Ngoài phạm vi:** Futures / margin / SHORT; nhiều sàn; tối ưu tham số tự động khi đang chạy; giao diện web điều khiển (trang `/wtt/` chỉ hiển thị).

## 1.4 Các bên liên quan

| Vai trò | Trách nhiệm |
|---|---|
| Chủ sở hữu / người vận hành (người dùng) | Cấp API key, chọn chế độ, đặt giới hạn rủi ro, nhận thông báo, ra lệnh dừng |
| Nhóm phát triển (Claude Code) | Phân tích, thiết kế, viết mã, kiểm thử, tài liệu |
| Dịch vụ ngoài | Binance (dữ liệu + khớp lệnh), Telegram, Anthropic, GitHub Actions |

## 1.5 Rủi ro dự án

| Mã | Rủi ro | Khả năng | Ảnh hưởng | Giảm thiểu |
|---|---|---|---|---|
| R1 | Kết quả backtest không lặp lại khi chạy thật (overfit) | Trung bình | Cao | Kiểm tra trên 30% dữ liệu cuối chưa dùng, trên 11 coin, so với vào lệnh ngẫu nhiên; bắt đầu bằng paper |
| R2 | Lỗi phần mềm gây lệnh sai trên sàn | Thấp | Rất cao | Test đường đi sàn giả lập (FakeExchange), cổng live, trần khối lượng, giới hạn lỗ ngày |
| R3 | Lộ API key / token | Thấp | Rất cao | SDL: redact, quyền file, key chỉ quyền Spot, không rút tiền |
| R4 | Sàn chặn IP (ví dụ HTTP 451 trên máy Mỹ) | Đã xảy ra | Trung bình | Dùng mirror `data-api.binance.vision`, lần chạy lỗi toàn bộ trả mã thoát 1 |
| R5 | Dịch vụ ngoài sập (Telegram, Anthropic) | Trung bình | Thấp | Thông báo và nhận xét không bao giờ chặn giao dịch |

## 1.6 Mốc phiên bản

| Phiên bản | Nội dung |
|---|---|
| 1.0.0 | Agent paper/testnet/live, Telegram, Claude, sửa 13 lỗi từ review đường đi sàn |
| 1.0.x | Chạy theo lịch trên GitHub Actions, mirror dữ liệu Binance |
| (engine) 2.4.0 | Bộ lọc nhiễu theo khung thời gian |
| (engine) 2.5.0 | MUA SỚM khi phá đường xu hướng giảm |
| 1.1.0 | Gia cố bảo mật theo SDL, tài liệu SDLC |
