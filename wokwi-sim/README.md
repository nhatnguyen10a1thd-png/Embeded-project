# Mô phỏng phần cứng Wokwi — ESP32 điều khiển đèn và quạt

Project mô phỏng phần embedded của hệ thống trong
`PROJECT_CONTEXT_Gesture_ESP32_WebDashboard_Nhom25 (1).md`. Camera, nhận diện
cử chỉ và Web Dashboard chạy trên laptop; ESP32 nhận lệnh, quản lý trạng thái và
điều khiển tải.

## Cấu hình Wokwi

- ESP32 DevKit V1.
- Đèn được biểu diễn bằng LED trắng có PWM.
- Quạt được biểu diễn bằng stepper NEMA17 và driver A4988 vì Wokwi hiển thị
  chuyển động của stepper rõ ràng và ổn định.
- Nguồn VMOT 12 V tách khỏi nguồn logic; tất cả các khối nối mass chung.
- Tụ 100 µF mắc sát VMOT/GND của A4988.
- Hai nút và hai biến trở là phần tử kiểm thử cục bộ trong mô phỏng.
- Logic analyzer ghi lại PWM đèn, xung STEP và mức DIR.
  STEP của quạt.

> Stepper chỉ là phần tử **đại diện trực quan cho quạt trong Wokwi**. Khi lắp
> phần cứng thật, quạt DC 5/12 V phải dùng MOSFET/driver phù hợp và nguồn ngoài;
> không nối tải trực tiếp vào GPIO ESP32.

## Sơ đồ chân

| Chức năng | GPIO | Kết nối |
|---|---:|---|
| PWM đèn | 25 | Điện trở 220 Ω → LED mô phỏng |
| Xung tốc độ quạt | 26 | A4988 `STEP` |
| Chiều quay quạt | 27 | A4988 `DIR` |
| Nút bật/tắt đèn | 32 | `INPUT_PULLUP`, nhấn nối GND |
| Nút bật/tắt quạt | 33 | `INPUT_PULLUP`, nhấn nối GND |
| Biến trở độ sáng | 34 | ADC 0…3,3 V |
| Biến trở tốc độ | 35 | ADC 0…3,3 V |

A4988 dùng full-step (`MS1/MS2/MS3 = LOW`), `ENABLE = LOW`, còn `RESET` và
`SLEEP` được kéo lên 3,3 V. Nguồn motor nối vào `VMOT/GND.2`; nguồn logic nối
vào `VDD/GND.1`.

## Hành vi điều khiển

- Đèn thay đổi độ sáng theo dốc PWM, tránh nhảy mức đột ngột.
- Tốc độ quạt ánh xạ từ 0…100% sang 40…500 step/giây.
- Tốc độ stepper tăng/giảm theo dốc để tránh đổi tốc độ tức thời.
- Biến trở được lấy mẫu mỗi 50 ms và cập nhật khi thay đổi từ 1%, vì vậy xoay
  núm sẽ phản hồi gần như ngay lập tức.
- Đèn và quạt mặc định bật ở 70%/60% để kiểm tra ngay khi chạy Wokwi.
- Trước khi dùng code cho phần cứng thật, nên đặt `lightOn` và `fanOn` mặc định
  thành `false`.

## Chạy bằng VS Code

1. Mở thư mục `wokwi-sim`.
2. Build firmware bằng PlatformIO: `pio run`.
3. Nhấn `F1` và chọn `Wokwi: Start Simulator`.
4. Nhấn `L`/`F`, xoay biến trở hoặc gửi lệnh trong Serial Monitor.

## Chạy Web Dashboard và camera

Sau khi Wokwi Simulator đã chạy, mở Terminal mới ở thư mục gốc dự án:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-Dashboard.ps1
```

Dashboard mở tại `http://localhost:8080`. Chọn **Bật camera**, cấp quyền camera rồi
chuyển sang chế độ **Cử chỉ**. Cấu hình `rfc2217ServerPort = 4000` trong
`wokwi.toml` cho phép dashboard gửi lệnh Serial vào ESP32 mô phỏng và nhận JSON
trạng thái phản hồi. Hướng dẫn đầy đủ nằm trong `web-dashboard/README.md`.

Để xoay biến trở chính xác, bấm vào núm rồi dùng chuột; cũng có thể dùng phím
`Left/Right`, `Page Up/Page Down`, `Home/End`. Hai núm khởi tạo tại khoảng 70%
và 60%, đồng bộ với trạng thái ban đầu của firmware.

## Logic analyzer là gì?

`wokwi-logic-analyzer` là dụng cụ đo ảo, không phải linh kiện bắt buộc trong
sản phẩm. Ngoài đời có thể dùng USB logic analyzer hoặc oscilloscope và đặt đầu
đo vào GPIO25, GPIO26, GPIO27. Các đèn xanh trên thiết bị Wokwi báo kênh đang có
hoạt động; khi dừng mô phỏng, dữ liệu được lưu vào `wokwi.vcd`.

## Lệnh Serial

```text
LIGHT_ON
LIGHT_OFF
LIGHT_LEVEL:75
FAN_ON
FAN_OFF
FAN_SPEED:60
ALL_OFF
STATE
HELP
```

Mỗi thay đổi hợp lệ phát lại trạng thái ESP32 dưới dạng JSON:

```json
{"esp32":"connected","ip":"10.10.0.2","light":{"on":true,"brightness":75},"fan":{"on":true,"speed":60},"source":"SERIAL"}
```

## HTTP REST mẫu

```text
GET  /api/state
GET  /api/light?on=1&level=75
POST /api/fan?on=1&level=60
POST /api/all-off
POST /api/command?value=LIGHT_ON
```

Dashboard nên dùng trạng thái JSON do ESP32 phản hồi làm nguồn dữ liệu chính,
không chỉ cập nhật giao diện trước rồi coi đó là trạng thái thực tế.
