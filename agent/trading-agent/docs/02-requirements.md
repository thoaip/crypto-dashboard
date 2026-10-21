# 2. Đặc tả yêu cầu (SRS)

Mức ưu tiên: **M** = bắt buộc, **S** = nên có. Mỗi yêu cầu được truy vết tới module và test ở [05-testing.md](05-testing.md#53-ma-trận-truy-vết).

## 2.1 Yêu cầu chức năng

### Tín hiệu
| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-01 | Tính tín hiệu chỉ trên **nến đã đóng**, dùng đúng engine của backtest (`backtest/engine.cjs`) | M |
| FR-02 | Tín hiệu từ cửa sổ 1000 nến gần nhất phải **trùng** với tín hiệu tính trên toàn bộ lịch sử | M |
| FR-03 | Áp dụng tham số mặc định theo khung (bộ lọc, EMA200, bộ lọc nhiễu, MUA SỚM) giống bản Pine | M |
| FR-04 | Lần chạy đầu chỉ hành động nếu nến cuối còn "tươi" (đóng trong 25% độ dài nến) | M |

### Giao dịch
| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-10 | BUY → mua thị trường đúng `quotePerTrade` USDT nếu qua kiểm tra rủi ro | M |
| FR-11 | Đặt **stop trên sàn** cho toàn bộ số lượng ngay sau khi mua; stop chỉ được nâng, không hạ | M |
| FR-12 | TP1 / TP2 ở +2 / +4 ATR, mỗi mức bán 25%; phần còn lại chạy theo trailing stop | M |
| FR-13 | SELL → đóng lệnh LONG (chỉ LONG, không mở SHORT) | M |
| FR-14 | Không bán vượt số dư tự do; phần TP nhỏ hơn mức tối thiểu của sàn gộp vào phần chạy | M |
| FR-15 | Trước khi bán: hủy stop và **ghi nhận phần stop đã khớp** (không bán trùng) | M |
| FR-16 | Ghi lệnh mua "đang chờ" trước khi gửi; khởi động lại thì khôi phục theo client order id | M |
| FR-17 | Khởi động: đối chiếu vị thế đã lưu với số dư thật trên sàn | M |
| FR-18 | SELL bị lỡ lúc agent tắt vẫn đóng lệnh khi chạy lại; BUY bị lỡ thì không đuổi theo | M |
| FR-19 | Chế độ chạy theo lịch: dùng high/low 5 phút giữa hai lần chạy để kiểm TP/stop (paper) | S |

### Quản trị rủi ro
| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-20 | Giới hạn số lệnh mở đồng thời (`maxOpenPositions`) | M |
| FR-21 | Giới hạn lỗ trong ngày UTC (`dailyLossLimit`): chạm thì ngừng mở lệnh mới | M |
| FR-22 | Kill switch: có file `STOP` thì không mở lệnh mới | M |
| FR-23 | Bỏ BUY khi giá quá xa EMA200 (theo ngưỡng của khung) và báo lý do | M |

### Thông báo và điều khiển
| Mã | Yêu cầu | Ưu tiên |
|---|---|---|
| FR-30 | Thông báo Telegram cho mỗi tín hiệu, lệnh, TP, SL, lỗi | M |
| FR-31 | Lệnh `/status`, `/positions`, `/stop`, `/resume`, `/closeall CONFIRM` | M |
| FR-32 | Kèm bảng xu hướng khung lớn trong thông báo tín hiệu | S |
| FR-33 | Claude viết nhận xét ngắn bằng tiếng Việt; không bao giờ thay đổi quyết định | S |

## 2.2 Yêu cầu phi chức năng

| Mã | Loại | Yêu cầu |
|---|---|---|
| NFR-01 | An toàn | Live chỉ chạy khi có `LIVE_CONFIRM=I_ACCEPT_REAL_MONEY_RISK` và `quotePerTrade ≤ live.maxQuotePerTrade` |
| NFR-02 | An toàn | Trạng thái tách riêng theo chế độ; file sai chế độ hoặc hỏng thì **từ chối chạy** |
| NFR-03 | An toàn | Chỉ một tiến trình agent mỗi chế độ (khóa nguyên tử) |
| NFR-04 | Bảo mật | Secret không xuất hiện trong log, lỗi, tin nhắn (redact); file dữ liệu quyền 0600 |
| NFR-05 | Bảo mật | Lệnh Telegram chỉ từ chat riêng đã cấu hình, mới hơn 10 phút, đúng định dạng |
| NFR-06 | Tin cậy | Lỗi ở một symbol không làm dừng symbol khác; lỗi dịch vụ phụ không chặn giao dịch |
| NFR-07 | Tin cậy | Trạng thái ghi nguyên tử sau mỗi lần khớp lệnh |
| NFR-08 | Hiệu năng | Một vòng kiểm tra 6 symbol < 30 giây; nhận xét Claude timeout 20 giây |
| NFR-09 | Khả chuyển | Node.js ≥ 22, chạy trên Windows và Linux (GitHub Actions) |
| NFR-10 | Khả kiểm thử | Mọi phụ thuộc ngoài (sàn, giá, Telegram, Claude, thời gian, file) tiêm được qua constructor |
| NFR-11 | Quan sát được | Log có dấu thời gian; lần chạy theo lịch lỗi toàn bộ trả mã thoát 1 |
| NFR-12 | Chuỗi cung ứng | Khóa phiên bản bằng `package-lock.json`; `npm audit` không có lỗ hổng |

## 2.3 Ràng buộc và giả định

- Binance Spot API; cặp quote USDT; khối lượng tối thiểu theo `market.limits` của sàn.
- Giá và nến lấy từ API công khai (không cần key); chế độ testnet vẫn dùng giá thật để tín hiệu giống TradingView.
- Người dùng tự chịu trách nhiệm về quyết định dùng tiền thật; phần mềm không phải lời khuyên đầu tư.
