# PROJECT CONTEXT — Hệ thống điều khiển đèn và quạt thông minh bằng cử chỉ tay kết hợp Web Dashboard

> **Mục đích:** File handoff cho AI agent/lập trình viên. Đây là context cô đọng nhưng đủ để hiểu đúng dự án, kiến trúc, phạm vi MVP, phần đã chốt, phần chưa chốt và các giả định không được tự bịa.
>
> **Tên ban đầu:** *Hệ thống bật tắt đèn/quạt dựa trên cử chỉ tay (Nhóm 25)*  
> **Tên hiện tại:** *Hệ thống điều khiển đèn và quạt thông minh bằng cử chỉ tay kết hợp Web Dashboard*  
> **Loại dự án:** Prototype môn Hệ thống nhúng; kết hợp Computer Vision + HCI + Web + IoT/Embedded.

---

## 1. Tóm tắt 30 giây

Người dùng thực hiện cử chỉ trước **camera laptop**. Laptop xử lý hình ảnh để phát hiện bàn tay, lấy hand landmark, nhận diện cử chỉ và/hoặc tính khoảng cách ngón cái–ngón trỏ. Kết quả được chuyển thành lệnh điều khiển.

Lệnh gửi qua WiFi đến **ESP32**. ESP32 **không xử lý camera/Computer Vision**; ESP32 là bộ điều khiển nhúng, nhận lệnh, quản lý trạng thái, xuất GPIO/PWM và điều khiển đèn/quạt thông qua **MOSFET/driver**.

Web Dashboard là trung tâm quan sát và quản lý: hiển thị camera/gesture/trạng thái, cho phép điều khiển thủ công, chuyển mode và nhận phản hồi trạng thái từ ESP32.

```text
Người dùng
   ↓ cử chỉ
Camera Laptop
   ↓
Computer Vision / Hand Landmark
   ↓
Gesture Recognition / Finger Distance
   ↓
Stability + Debounce + Command Processing
   ↓
Web / Communication Layer
   ↓ WiFi
ESP32
   ↓ GPIO / PWM
MOSFET / Driver
   ↓
Đèn / Quạt
   ↓ trạng thái
ESP32 → Laptop/Web Dashboard
```

---

## 2. Mục tiêu cốt lõi

- Nhận diện bàn tay và một số cử chỉ.
- Bật/tắt đèn.
- Bật/tắt quạt.
- Điều chỉnh độ sáng đèn.
- Điều chỉnh tốc độ/mức điều khiển quạt.
- Dùng khoảng cách ngón cái–ngón trỏ như một **gesture slider**.
- Gửi lệnh đến ESP32 qua WiFi.
- ESP32 điều khiển phần cứng thật.
- Web hiển thị camera, gesture, trạng thái, mode và manual control.
- ESP32 phản hồi trạng thái ngược về Web.

### So với ý tưởng ban đầu

| Nội dung | Ban đầu | Hiện tại |
|---|---|---|
| Điều khiển đèn | Có | Có |
| Điều khiển quạt | Chưa/hạn chế | Có |
| ON/OFF | Có | Có |
| Điều chỉnh mức | Chưa | Có |
| Hand gesture | Có | Có |
| Finger distance | Chưa | Có |
| Camera laptop | Có/đề xuất | Kiến trúc chính |
| Web Dashboard | Chưa | Có |
| Manual control | Chưa | Có |
| Feedback trạng thái | Chưa | Có |
| ESP32 | Bộ điều khiển | IoT/Embedded Controller |
| History | Chưa | Có thể triển khai |

---

## 3. Kiến trúc đã chốt

### Laptop/Computer chịu trách nhiệm

- Lấy hình từ webcam.
- Detect hand.
- Extract hand landmarks.
- Gesture recognition.
- Tính finger distance.
- Chuẩn hóa giá trị điều khiển.
- Gesture stability/debounce/cooldown.
- Command processing.
- Giao tiếp với ESP32.
- Chạy Web Dashboard/backend nếu cần.
- Hiển thị camera, gesture, mode, trạng thái, log.

### ESP32 chịu trách nhiệm

- Kết nối WiFi.
- Nhận và parse command.
- Kiểm tra lệnh.
- Quản lý trạng thái thiết bị.
- Xuất GPIO/PWM.
- Điều khiển MOSFET/driver.
- Phản hồi trạng thái thiết bị.
- Có thể đọc nút vật lý nếu nhóm triển khai.

### ESP32 KHÔNG làm

- Không nhận diện camera.
- Không chạy OpenCV/MediaPipe cho luồng chính.
- Không cấp nguồn trực tiếp cho quạt/LED strip 5V/12V.
- Không thay thế tầng MOSFET/driver.

---

## 4. Kiến trúc điện/phần cứng quan trọng

ESP32 dùng logic GPIO khoảng 3.3V. Tải 5V/12V phải lấy năng lượng từ **nguồn ngoài phù hợp**.

```text
ESP32 GPIO/PWM 3.3V
        │ tín hiệu điều khiển
        ▼
MOSFET / Driver
        │ đóng/ngắt / PWM dòng tải
        ▼
Đèn / Quạt 5V hoặc 12V
        ▲
        │
Nguồn ngoài 5V/12V
```

**Không được mô tả:** “ESP32 cấp điện cho quạt/LED strip.”  
**Mô tả đúng:** “ESP32 xuất tín hiệu GPIO/PWM đến tầng driver/MOSFET; tải lấy nguồn từ nguồn DC ngoài.”

### Ví dụ nguồn 12V chung

```text
Nguồn 12V
   ├──> Quạt 12V
   ├──> LED strip 12V
   └──> Buck converter 12V → 5V → ESP32
```

### MOSFET và relay

- Relay: phù hợp ON/OFF.
- MOSFET/driver: phù hợp hơn nếu cần PWM để điều chỉnh mức.
- Không dùng relay làm giải pháp duy nhất cho brightness/speed.

### Phạm vi prototype

- Ưu tiên tải DC 5V/12V.
- Không dùng tải điện lưới trong MVP.
- Nếu sau này dùng tải điện áp cao: coi là thiết kế riêng cần cách ly và an toàn điện chuyên dụng.

---

## 5. Phần cứng đề xuất

### Cốt lõi

- 1 × ESP32 DevKit V1.
- 1 × breadboard.
- Dây jumper.
- 1 × quạt DC 5V hoặc 12V.
- 1 × LED nhỏ hoặc LED strip 5V/12V.
- MOSFET logic-level hoặc module MOSFET tương thích điều khiển 3.3V.
- Nguồn DC phù hợp với tải.
- Cáp USB ESP32.

### Tùy tải

- LED nhỏ: điện trở hạn dòng phù hợp.
- Quạt/tải cảm ứng: driver/module có bảo vệ phù hợp.
- LED strip/quạt dòng lớn hơn: chọn MOSFET/driver theo điện áp và dòng thực tế.

### Tùy chọn

- Push button.
- Relay cho ON/OFF riêng.
- Buck converter.
- Đồng hồ đo điện.

> **Không tự chốt MOSFET/nguồn cụ thể khi chưa biết điện áp và dòng định mức tải thật.**

---

## 6. Computer Vision và nhận diện cử chỉ

### Công nghệ có thể dùng

- OpenCV.
- MediaPipe Hands hoặc hand landmark tương đương.

Không tự khẳng định phiên bản thư viện nếu chưa được cung cấp.

### Pipeline

```text
Frame từ camera
   ↓
Detect Hand
   ↓
Extract Landmarks
   ↓
Recognize Gesture
   ├──> Discrete gesture → ON/OFF/Mode/Select
   └──> Pinch distance → Normalize → 0..100%
```

### Mapping gesture

**Chưa chốt cứng.** Có thể thử:

- open hand;
- fist;
- một ngón;
- hai ngón;
- pinch;
- gesture khác.

Agent **không được biến ví dụ thành yêu cầu bắt buộc**. Mapping phải ưu tiên dễ phân biệt, ít kích hoạt nhầm và demo ổn định.

### Mức độ “AI”

Nếu triển khai là:

```text
MediaPipe/hand landmarks + rule-based geometry
```

thì mô tả chính xác là:

- Computer Vision;
- hand landmark detection;
- rule-based gesture recognition.

Không cường điệu thành deep-learning model tự huấn luyện nếu thực tế không có.

---

## 7. Gesture slider bằng khoảng cách ngón tay

```text
Ngón gần nhau → mức thấp
Ngón xa nhau  → mức cao
```

Áp dụng cho:

- brightness đèn;
- speed/control level quạt.

### Không dùng pixel thô trực tiếp

Sai:

```text
finger_distance_px = 84
→ brightness = 84%
```

Nên chuẩn hóa:

```text
normalized_distance =
    distance(thumb_tip, index_tip)
    / hand_reference_size
```

Sau đó:

```text
clamp → map → 0..100%
```

Có thể bổ sung smoothing, dead zone, quantization, hysteresis. Tham số cụ thể phải benchmark.

---

## 8. Chống nhiễu và lệnh lặp

Nếu camera thấy:

```text
OPEN
OPEN
OPEN
OPEN
...
```

không được gửi:

```text
LIGHT_ON
LIGHT_ON
LIGHT_ON
...
```

### Nên có

- **Gesture stability**: gesture phải ổn định đủ lâu/số frame.
- **Debounce**: bỏ dao động ngắn.
- **Cooldown**: khóa tạm sau action ON/OFF.
- **State-aware command**: đã ON thì không gửi ON lặp.
- **Threshold/dead zone**: tránh slider rung.
- **Confidence gate**: nếu thuật toán có confidence phù hợp.

Không tự gán số millisecond/số frame trước khi đo thực tế.

---

## 9. Web Dashboard

Web **không chỉ là camera viewer**.

### Camera View

Có thể hiển thị:

- video camera;
- landmarks;
- current gesture;
- confidence nếu có;
- finger distance;
- normalized value.

### Device Status

```text
ESP32
Connected / Disconnected

LIGHT
ON / OFF
Brightness: XX%

FAN
ON / OFF
Speed: XX%
```

### Manual Control

Light:

- ON;
- OFF;
- brightness slider.

Fan:

- ON;
- OFF;
- speed slider.

### Mode Switching

```text
GESTURE CONTROL
MANUAL WEB CONTROL
```

Khuyến nghị:

- chỉ một nguồn có quyền phát lệnh tại một thời điểm;
- ở Manual Mode vẫn có thể nhận diện gesture để hiển thị nhưng không gửi command;
- tránh gesture ghi đè manual control.

### Turn Off All

Có thể có:

```text
TURN OFF ALL
```

### History / Activity Log

| Time | Source/Gesture | Device | Action |
|---|---|---|---|
| 08:21:05 | Gesture | Light | ON |
| 08:21:16 | Pinch | Light | 40% |
| 08:21:32 | Pinch | Light | 70% |
| 08:22:10 | Gesture | Light | OFF |
| 08:23:01 | Manual | Fan | ON |

MVP có thể chỉ lưu RAM/file ngắn. Database dài hạn là mở rộng nếu chưa làm.

---

## 10. Communication Laptop/Web ↔ ESP32

### Đã chốt

- WiFi.
- Command xuống ESP32.
- Status feedback ngược lên.

### Chưa chốt protocol

- HTTP REST.
- WebSocket.
- MQTT.

Đây là **implementation decision**, không được tự biến thành yêu cầu cố định.

### Ví dụ command logic

```text
LIGHT_ON
LIGHT_OFF
FAN_ON
FAN_OFF
LIGHT_LEVEL:75
FAN_SPEED:60
```

Có thể hiện thực bằng JSON/MQTT topic/WebSocket/REST tùy stack.

### Feedback mẫu — chỉ là đề xuất

```json
{
  "esp32": "connected",
  "light": {
    "on": true,
    "brightness": 75
  },
  "fan": {
    "on": true,
    "speed": 60
  }
}
```

---

## 11. Luồng điều khiển hai chiều

```text
Gesture / Web Command
        ↓
Laptop / Command Processing
        ↓
      WiFi
        ↓
      ESP32
        ↓
Driver / MOSFET
        ↓
   Light / Fan
        ↓
ESP32 cập nhật state
        ↓
Status Feedback
        ↓
Laptop / Web Dashboard
```

Dashboard nên hiển thị trạng thái **được ESP32 xác nhận**, không chỉ đổi UI rồi coi đó là trạng thái thật.

---

## 12. Vai trò từng thành phần

| Thành phần | Vai trò |
|---|---|
| Webcam Laptop | Thu hình |
| Computer Vision | Detect hand |
| Hand Landmark | Tọa độ điểm bàn tay |
| Gesture Recognition | Phân loại gesture |
| Distance Measurement | Tính pinch distance |
| Normalization | Chuyển distance → 0..100% |
| Gesture Stability | Chống nhiễu |
| Command Processing | Sinh/điều phối lệnh |
| Web Dashboard | Quan sát + quản lý + manual control |
| WiFi/Protocol | Giao tiếp laptop ↔ ESP32 |
| ESP32 | Embedded/IoT controller |
| GPIO/PWM | Tín hiệu điều khiển |
| MOSFET/Driver | Tầng công suất |
| LED/Light | Output 1 |
| Fan | Output 2 |

---

## 13. Trạng thái chức năng

### Cốt lõi / kiến trúc đã chốt

- camera laptop;
- CV trên laptop;
- ESP32 làm embedded controller;
- light control;
- fan control;
- ON/OFF;
- điều chỉnh mức;
- Web Dashboard;
- Gesture Mode;
- Manual Web Control;
- WiFi;
- status feedback;
- MOSFET/driver giữa ESP32 và tải.

### MVP đề xuất

1. Detect hand.
2. Nhận diện một số gesture chính.
3. Light ON/OFF.
4. Fan ON/OFF.
5. Brightness control.
6. Fan speed/control level.
7. Pinch distance normalized.
8. Gửi command đến ESP32.
9. ESP32 điều khiển phần cứng.
10. Web hiển thị camera + status.
11. Manual control.
12. Mode switching.
13. Status feedback.

### Đề xuất, chưa mặc định đã làm

- physical button;
- Turn Off All;
- activity history chi tiết;
- confidence display;
- lưu file/log;
- protocol cụ thể;
- gesture mapping cụ thể.

### Future Development

- nhiều phòng;
- nhiều ESP32;
- nhiều thiết bị;
- tài khoản/phân quyền;
- database;
- dashboard thống kê;
- remote qua Internet;
- ESP32-CAM;
- camera riêng;
- edge device/SBC;
- voice control;
- cảm biến nhiệt độ/ánh sáng;
- automation;
- MQTT architecture mở rộng.

---

## 14. Hạn chế prototype

- Phụ thuộc webcam laptop.
- Phụ thuộc ánh sáng/góc tay/khoảng cách.
- Gesture tương tự nhau có thể bị nhầm.
- Phụ thuộc WiFi.
- Laptop phải chạy để Gesture Control hoạt động.
- MVP chỉ nên dùng ít thiết bị.
- Tải công suất lớn cần thiết kế driver riêng.
- Gesture slider có thể rung nếu thiếu smoothing/dead-zone.
- Chưa mặc định hỗ trợ Internet.

---

## 15. Failure handling nên có

### ESP32 mất kết nối

```text
ESP32: DISCONNECTED
```

- Web cảnh báo/disable control phù hợp.
- Không giả trạng thái mới nếu command chưa được xác nhận.

### Camera lỗi

- Báo camera unavailable.
- Manual Web Control vẫn có thể hoạt động nếu communication vẫn chạy.

### Không thấy tay

- Không gửi command.
- Giữ trạng thái thiết bị.
- Hiển thị no-hand/no-gesture.

### Gesture không ổn định

- Bỏ qua.
- Không phát action.

### Command trùng

```text
current_light = ON
new_command = LIGHT_ON
```

→ có thể bỏ qua.

---

## 16. Cấu trúc phần mềm gợi ý

> Đây là cấu trúc logic, không khóa framework/ngôn ngữ.

```text
project/
├── vision/
│   ├── camera/
│   ├── hand_detector/
│   ├── landmark/
│   ├── gesture_recognizer/
│   ├── distance_normalizer/
│   └── gesture_stability/
│
├── control/
│   ├── command_processor/
│   ├── mode_manager/
│   ├── device_state/
│   └── safety_rules/
│
├── communication/
│   ├── esp32_client/
│   ├── protocol/
│   └── connection_manager/
│
├── web/
│   ├── dashboard/
│   ├── manual_control/
│   ├── video_stream/
│   └── activity_log/
│
├── firmware/
│   └── esp32/
│       ├── wifi/
│       ├── command_handler/
│       ├── pwm/
│       ├── device_control/
│       └── status_feedback/
│
└── docs/
```

Agent có thể thay cấu trúc theo stack, nhưng phải giữ **separation of concerns**.

---

## 17. State model gợi ý

```text
System Mode:
- GESTURE
- MANUAL

ESP32 Connection:
- CONNECTED
- DISCONNECTED

Light:
- OFF
- ON
- brightness: 0..100

Fan:
- OFF
- ON
- speed: 0..100
```

Nên có **single source of truth** cho device state và cập nhật từ feedback ESP32.

---

## 18. Các quyết định chưa chốt — PHẢI hỏi hoặc giữ mở

Không được tự khẳng định:

1. Gesture nào bật đèn.
2. Gesture nào tắt đèn.
3. Gesture nào chọn quạt.
4. Gesture nào chọn đèn.
5. Ngưỡng distance cụ thể.
6. Số frame stability.
7. Thời gian cooldown.
8. Protocol cuối: HTTP/WebSocket/MQTT.
9. Backend framework.
10. Frontend framework.
11. Database.
12. MOSFET/module chính xác.
13. Quạt 5V hay 12V.
14. LED nhỏ hay LED strip.
15. Công suất nguồn.
16. Pin ESP32 cụ thể.
17. Tần số PWM.
18. Physical buttons có triển khai hay không.

Nếu một nhiệm vụ bắt buộc cần các quyết định trên, agent phải:

- hỏi lại user; hoặc
- ghi rõ **GIẢ ĐỊNH/ĐỀ XUẤT**.

---

## 19. Những điều agent KHÔNG được làm

- Không chuyển Computer Vision xuống ESP32 nếu user không yêu cầu.
- Không tự thêm ESP32-CAM vào MVP.
- Không nói ESP32 cấp nguồn cho quạt/LED strip.
- Không nối tải công suất trực tiếp vào GPIO.
- Không dùng relay làm giải pháp duy nhất cho brightness/speed.
- Không mô tả Web chỉ là camera viewer.
- Không bỏ feedback ESP32 → Web.
- Không mặc định database.
- Không mặc định cloud/Internet.
- Không gọi hệ thống là deep-learning AI nếu chỉ dùng landmark + rule.
- Không biến future feature thành chức năng đã có.
- Không dùng pixel distance thô làm mức điều khiển cuối.
- Không đưa tải điện lưới vào prototype hiện tại.

---

## 20. Quy tắc cho agent khi tiếp tục dự án

1. Đọc file này như **project source of truth**.
2. Phân loại mọi nội dung thành: **đã chốt / MVP / đề xuất / future**.
3. Nếu yêu cầu mới của user xung đột file này → yêu cầu mới nhất của user ưu tiên.
4. Không tự thêm công nghệ không cần thiết.
5. Ưu tiên: ổn định, dễ debug, dễ demo, dễ giải thích cho giảng viên.
6. Khi thiết kế luôn xem xét đầy đủ:

```text
Input → Processing → Communication → Embedded Controller
→ Driver → Actuator → Feedback
```

7. Khi viết báo cáo: văn phong kỹ thuật, không marketing, không phóng đại AI.

---

## 21. Mô tả hệ thống chuẩn để tái sử dụng

> Hệ thống sử dụng camera của laptop để thu hình ảnh bàn tay người dùng. Phần mềm Computer Vision chạy trên laptop phát hiện bàn tay, xác định các landmark, nhận diện cử chỉ và tính khoảng cách giữa ngón cái với ngón trỏ. Kết quả nhận diện được ổn định và chuyển thành lệnh điều khiển. Lệnh được truyền qua WiFi đến ESP32. ESP32 đóng vai trò bộ điều khiển nhúng, nhận lệnh, xuất GPIO/PWM đến tầng MOSFET/driver để điều khiển đèn và quạt sử dụng nguồn DC ngoài phù hợp. Web Dashboard cho phép theo dõi camera, gesture, trạng thái thiết bị, chuyển chế độ Gesture/Manual và điều khiển thủ công. Sau khi thực thi, ESP32 phản hồi trạng thái về laptop/Web để giao diện cập nhật theo trạng thái thiết bị thực tế.

---

## 22. Demo flow mong muốn

```text
1. Khởi động hệ thống.
2. ESP32 kết nối WiFi.
3. Web hiển thị ESP32 Connected.
4. Camera bật.
5. Hand landmarks hiển thị.
6. User thực hiện gesture.
7. Gesture được giữ ổn định.
8. Web hiển thị recognized gesture.
9. Command được phát.
10. ESP32 nhận command.
11. MOSFET/driver thay đổi output.
12. Light/Fan thay đổi.
13. ESP32 feedback state.
14. Web cập nhật state.
```

Test thêm:

```text
Manual mode:
Web slider → ESP32 → PWM → device → feedback → Web

Disconnect:
ESP32 mất WiFi → Dashboard báo Disconnected

No hand:
Camera không thấy tay → không phát command
```

---

## 23. Checklist trước khi code full

- [ ] Chốt loại quạt + điện áp + dòng.
- [ ] Chốt loại đèn/LED strip + điện áp + dòng.
- [ ] Chọn MOSFET/driver phù hợp logic 3.3V.
- [ ] Chốt nguồn ngoài.
- [ ] Chốt protocol.
- [ ] Chốt gesture mapping.
- [ ] Chốt cách chọn Light/Fan.
- [ ] Chốt rule Gesture/Manual.
- [ ] Chốt normalized distance formula.
- [ ] Chốt stability/debounce sau benchmark.
- [ ] Chốt message format.
- [ ] Chốt device state schema.
- [ ] Test light riêng.
- [ ] Test fan riêng.
- [ ] Test PWM riêng.
- [ ] Test ESP32 communication riêng.
- [ ] Test CV riêng.
- [ ] Test Web riêng.
- [ ] Sau đó mới integration.

---

## 24. Thứ tự triển khai khuyến nghị

### Phase 1 — Hardware minimum

- ESP32.
- LED/quạt.
- Driver/MOSFET.
- Manual PWM test.

### Phase 2 — ESP32 firmware

- WiFi.
- Command parser.
- Light/fan control.
- Status feedback.

### Phase 3 — Computer Vision

- Camera.
- Hand landmarks.
- Gesture recognition.
- Pinch normalization.
- Stability.

### Phase 4 — Communication integration

- Laptop → ESP32.
- Feedback.
- Reconnect.

### Phase 5 — Web Dashboard

- Status.
- Manual control.
- Mode.
- Camera/gesture view.

### Phase 6 — Full integration

- Gesture → device.
- Manual → device.
- Feedback.
- Failure handling.
- Demo tuning.

---

## 25. Liên hệ kiến thức Hệ thống nhúng

- Hardware–Software Codesign.
- HW/SW Partitioning.
- Input–Processing–Output.
- Sensor/Input → Processor → Actuator.
- Interface Design.
- Reactive System.
- Near Real-time Control.
- Embedded Controller.
- I/O.
- PWM.
- Communication Interface.
- Reliability/stability.
- Integration & Testing.

Laptop là nền xử lý cấp cao; ESP32 + driver + tải là phần embedded/physical control.

---

## 26. Source-of-truth priority

Khi có nhiều prompt/tài liệu:

```text
1. Yêu cầu mới nhất của user
2. Các quyết định “đã chốt” trong file này
3. Báo cáo/thiết kế hiện có
4. Các phần “đề xuất”
5. Kiến thức chung
```

Nếu có mâu thuẫn, không âm thầm chọn một bên; phải nêu rõ.

---

## 27. Từ khóa tìm nhanh

```text
gesture control
hand landmark
pinch distance
normalized finger distance
OpenCV
MediaPipe Hands
ESP32
WiFi
PWM
MOSFET
driver
DC fan
LED strip
Web Dashboard
Manual Control
Gesture Mode
status feedback
debounce
cooldown
gesture stability
IoT
Embedded System
HW/SW partitioning
```

---

# END OF PROJECT CONTEXT
