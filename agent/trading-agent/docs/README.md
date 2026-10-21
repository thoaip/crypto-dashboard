# Tài liệu SDLC — WTT Trading Agent

| Mục | Giá trị |
|---|---|
| Sản phẩm | WTT Trading Agent — bot giao dịch spot Binance theo tín hiệu *Waves Trend Toolkit [CR]* |
| Phiên bản phần mềm | 1.1.0 (engine tín hiệu v2.5.0) |
| Ngày lập | 2026-10-21 |
| Mô hình vòng đời | Lặp tăng dần (iterative-incremental): mỗi phiên bản đi qua đủ 7 giai đoạn dưới đây |
| Trạng thái | Đang vận hành ở chế độ **paper** (GitHub Actions); testnet/live sẵn sàng nhưng chưa bật |

## Các giai đoạn

| # | Giai đoạn | Tài liệu | Đầu ra chính |
|---|---|---|---|
| 1 | Lập kế hoạch | [01-planning.md](01-planning.md) | Mục tiêu, phạm vi, rủi ro dự án, mốc phiên bản |
| 2 | Phân tích yêu cầu | [02-requirements.md](02-requirements.md) | Đặc tả yêu cầu (SRS): FR-xx, NFR-xx |
| 3 | Thiết kế | [03-design.md](03-design.md) | Kiến trúc, module, luồng dữ liệu, mô hình trạng thái |
| 4 | Triển khai mã | [04-implementation.md](04-implementation.md) | Cấu trúc mã nguồn, quy ước, quản lý cấu hình |
| 5 | Kiểm thử | [05-testing.md](05-testing.md) | Kế hoạch kiểm thử, ma trận truy vết yêu cầu ↔ test |
| 6 | Triển khai vận hành | [06-deployment.md](06-deployment.md) | Môi trường, quy trình phát hành, cổng an toàn |
| 7 | Bảo trì | [07-maintenance.md](07-maintenance.md) | Giám sát, xử lý sự cố, quản lý thay đổi |

Tài liệu liên quan: [../SECURITY.md](../SECURITY.md) (SDL / threat model), [../README.md](../README.md) (hướng dẫn sử dụng).

## Lịch sử tài liệu

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-10-21 | Bản đầu, lập cho phần mềm v1.1.0 |
