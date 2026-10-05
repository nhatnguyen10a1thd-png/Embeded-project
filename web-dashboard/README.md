# Web Dashboard điều khiển ESP32 bằng camera

Dashboard hiện thực luồng trong tài liệu dự án: camera laptop → MediaPipe Hand
Landmarker → nhận diện cử chỉ/gesture slider → lệnh → ESP32 → trạng thái phản hồi → Web.

## Chạy cùng Wokwi trong VS Code

1. Build firmware trong `wokwi-sim` bằng `pio run`.
2. Nhấn `F1` → `Wokwi: Start Simulator`.
3. Mở Terminal mới tại thư mục gốc và chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-Dashboard.ps1
```

4. Trình duyệt mở `http://localhost:8080`.
5. Chọn **Bật camera**, cho phép quyền camera và chờ mô hình tải lần đầu.
6. Chuyển sang **Cử chỉ** nếu muốn cử chỉ được quyền phát lệnh.

Nếu cổng 8080 đang bận:

```powershell
.\Start-Dashboard.ps1 -Port 8081
```

Dashboard dùng cổng serial RFC2217 `4000` của Wokwi để mô phỏng đường truyền tới
ESP32. Khi lắp ESP32 thật trong cùng mạng WiFi, dùng HTTP REST của firmware:

```powershell
.\Start-Dashboard.ps1 -Transport Http -Esp32Url http://192.168.1.123
```

Thay IP bằng địa chỉ ESP32 in trong Serial Monitor.

## Bản sửa kết nối

- `Start-Dashboard.ps1` tìm Python có sẵn của PlatformIO để chạy `dashboard_server.py`;
  không cần cài thêm package. Web và Serial chạy độc lập để việc đọc camera/API không chặn nhau.
- Cần **build firmware mới**: lệnh web có mã yêu cầu (`@1 LIGHT_ON`) và firmware trả
  `{"ack":1,"state":...}`. Dashboard chỉ báo thành công sau khi nhận đúng mã xác nhận.
- ESP32 TX0 nối `$serialMonitor:RX`, RX0 nối `$serialMonitor:TX` trong `diagram.json`.
- Máy chủ tự hỏi trạng thái mỗi giây và tự nối lại khi Wokwi chạy. Cổng TCP mở chưa
  được coi là ESP32 đã kết nối; phải nhận được JSON trạng thái hợp lệ.
- Chạy từ thư mục gốc hoặc VS Code → Terminal → Run Task → **Dashboard: Start**.
- Chỉ mở `http://localhost:8080`, không dùng Live Server hoặc mở file HTML trực tiếp.
- Nếu thấy thông báo **chưa có mô phỏng tại cổng 4000**, mở `wokwi-sim/diagram.json`
  rồi chọn **Wokwi: Start Simulator**. Nếu mạch đang tạm dừng, nhấn Play.
- Khi đổi firmware/sơ đồ, đóng tab mô phỏng cũ rồi Start Simulator lại để nạp đủ file mới.

Kiểm tra cầu nối tự động (dùng thiết bị giả lập kiểm thử, không thay Wokwi):

```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" -m unittest discover -s tests -v
```

## Mapping cử chỉ đề xuất cho prototype

| Cử chỉ | Hành động |
|---|---|
| Một ngón trỏ | Chọn đèn |
| Hai ngón | Chọn quạt |
| Xòe bàn tay | Bật thiết bị đang chọn |
| Nắm bàn tay | Tắt thiết bị đang chọn |
| Chụm/mở ngón cái–trỏ | Điều chỉnh độ sáng/tốc độ 0–100% |

Đây là cấu hình demo có thể hiệu chỉnh, không phải yêu cầu cố định của phần cứng.
Ứng dụng mặc định dùng 10 frame ổn định, cooldown 900 ms, smoothing và dead-band
5% để giảm rung/lệnh lặp. Khoảng cách ngón được chia cho bề rộng lòng bàn tay trước
khi ánh xạ sang phần trăm, không dùng khoảng cách pixel thô.

## Lưu ý

- Camera cần chạy từ `localhost` (hoặc HTTPS), không mở thẳng file HTML.
- MediaPipe và model được tải từ CDN chính thức ở lần chạy đầu, vì vậy máy cần Internet.
- Ở chế độ Thủ công, camera vẫn nhận diện và hiển thị nhưng không gửi lệnh.
- Giao diện chỉ cập nhật trạng thái thiết bị từ phản hồi ESP32, không tự giả lập ON/OFF.
- Nếu camera lỗi, điều khiển thủ công vẫn hoạt động.
