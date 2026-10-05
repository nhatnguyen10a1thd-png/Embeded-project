
const $ = (id) => document.getElementById(id);
const ui = {
  video: $("webcam"), canvas: $("overlay"), cameraButton: $("cameraButton"),
  cameraPlaceholder: $("cameraPlaceholder"), cameraBadge: $("cameraBadge"),
  cameraMessage: $("cameraMessage"), cameraStage: document.querySelector(".camera-stage"),
  gestureName: $("gestureName"), gestureSubtitle: $("gestureSubtitle"), gestureIcon: $("gestureIcon"),
  gestureOrb: $("gestureOrb"), selectedDevice: $("selectedDevice"), pinchRatio: $("pinchRatio"),
  pinchLevel: $("pinchLevel"), pinchBar: $("pinchBar"), handedness: $("handedness"), fps: $("fpsValue"),
  connectionBadge: $("connectionBadge"), connectionText: $("connectionText"), transport: $("transportLabel"),
  manualMode: $("manualModeBtn"), gestureMode: $("gestureModeBtn"), modeLabel: $("modeLabel"),
  lightState: $("lightState"), lightValue: $("lightValue"), lightMeter: $("lightMeter"),
  lightSlider: $("lightSlider"), lightOutput: $("lightOutput"), lightControls: $("lightControls"),
  fanState: $("fanState"), fanValue: $("fanValue"), fanMeter: $("fanMeter"),
  fanSlider: $("fanSlider"), fanOutput: $("fanOutput"), fanControls: $("fanControls"),
  fanIcon: document.querySelector(".fan-icon"), allOff: $("allOffButton"), log: $("activityLog"),
  clearLog: $("clearLogButton"), toast: $("toast")
};

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]
];

// Các giá trị dưới đây là cấu hình đề xuất cho demo, không phải ràng buộc phần cứng.
const VISION_CONFIG = {
  stableFrames: 10,
  actionCooldownMs: 900,
  levelSendIntervalMs: 260,
  levelDeadband: 5,
  pinchEnterRatio: 0.34,
  pinchExitRatio: 1.32,
  pinchMinRatio: 0.18,
  pinchMaxRatio: 1.05,
  smoothingAlpha: 0.22
};

let mode = "manual";
let selectedDevice = "light";
let deviceState = { light: { on: false, brightness: 0 }, fan: { on: false, speed: 0 } };
let connected = false;
let cameraStream = null;
let handLandmarker = null;
let cameraRunning = false;
let lastVideoTime = -1;
let lastFrameAt = performance.now();
let fpsAverage = 0;
let candidateGesture = "NONE";
let candidateFrames = 0;
let lastTriggeredGesture = "NONE";
let lastActionAt = 0;
let pinchActive = false;
let smoothedLevel = 0;
let lastSentLevel = -100;
let lastLevelSentAt = 0;
let stateRequestBusy = false;
let commandBusy = false;
let controlEpoch = 0;
const sliderTimers = new Map();
let toastTimer = null;

const gestureMeta = {
  NONE: ["Không thấy tay", "Đưa một bàn tay vào khung hình", "✋"],
  UNKNOWN: ["Chưa xác định", "Giữ tay thẳng và ổn định", "◌"],
  POINT: ["Một ngón", "Chọn điều khiển đèn", "☝"],
  VICTORY: ["Hai ngón", "Chọn điều khiển quạt", "✌"],
  OPEN: ["Xòe bàn tay", "Bật thiết bị đang chọn", "✋"],
  FIST: ["Nắm bàn tay", "Tắt thiết bị đang chọn", "✊"],
  PINCH: ["Gesture slider", "Chụm/mở ngón cái và ngón trỏ", "🤏"]
};

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)); }
function nowTime() { return new Date().toLocaleTimeString("vi-VN", { hour12: false }); }

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2600);
}

function addLog(source, action) {
  const empty = ui.log.querySelector(".empty-log");
  if (empty) empty.remove();
  const item = document.createElement("div");
  item.className = "log-item";
  item.innerHTML = `<span class="log-time">${nowTime()}</span><span class="log-source">${source}</span><span class="log-action"></span>`;
  item.querySelector(".log-action").textContent = action;
  ui.log.prepend(item);
  while (ui.log.children.length > 30) ui.log.lastElementChild.remove();
}

function setMode(nextMode) {
  controlEpoch++;
  sliderTimers.forEach(clearTimeout);
  sliderTimers.clear();
  candidateGesture = "NONE";
  candidateFrames = 0;
  lastTriggeredGesture = "NONE";
  lastSentLevel = -100;
  mode = nextMode;
  const manual = mode === "manual";
  ui.manualMode.classList.toggle("active", manual);
  ui.gestureMode.classList.toggle("active", !manual);
  ui.modeLabel.textContent = manual ? "THỦ CÔNG" : "CỬ CHỈ";
  ui.lightControls.disabled = !manual || !connected;
  ui.fanControls.disabled = !manual || !connected;
  addLog("HỆ THỐNG", `Chuyển sang chế độ ${manual ? "Thủ công" : "Cử chỉ"}`);
}

function selectDevice(device, fromGesture = false) {
  if (selectedDevice === device && fromGesture) return;
  selectedDevice = device;
  lastSentLevel = -100;
  ui.selectedDevice.textContent = device === "light" ? "Đèn" : "Quạt";
  if (fromGesture) addLog("CỬ CHỈ", `Chọn ${device === "light" ? "đèn" : "quạt"}`);
}

function renderConnection(isConnected, transport = "wokwi-rfc2217") {
  connected = isConnected;
  ui.connectionBadge.classList.toggle("online", connected);
  ui.connectionBadge.classList.toggle("offline", !connected);
  ui.connectionText.textContent = connected ? "ESP32 đã kết nối" : "ESP32 chưa kết nối";
  ui.transport.textContent = transport === "http" ? "ESP32 WIFI HTTP" : "WOKWI SERIAL BRIDGE";
  ui.allOff.disabled = !connected;
  ui.lightControls.disabled = mode !== "manual" || !connected;
  ui.fanControls.disabled = mode !== "manual" || !connected;
}

function renderState(state) {
  if (!state?.light || !state?.fan) return;
  deviceState = state;
  const lightLevel = Number(state.light.brightness || 0);
  const fanLevel = Number(state.fan.speed || 0);
  ui.lightState.textContent = state.light.on ? "ON" : "OFF";
  ui.lightState.classList.toggle("on", state.light.on);
  ui.lightState.classList.toggle("off", !state.light.on);
  ui.lightValue.textContent = lightLevel;
  ui.lightMeter.style.width = `${state.light.on ? lightLevel : 0}%`;
  if (document.activeElement !== ui.lightSlider) ui.lightSlider.value = lightLevel;
  ui.lightOutput.textContent = `${lightLevel}%`;

  ui.fanState.textContent = state.fan.on ? "ON" : "OFF";
  ui.fanState.classList.toggle("on", state.fan.on);
  ui.fanState.classList.toggle("off", !state.fan.on);
  ui.fanValue.textContent = fanLevel;
  ui.fanMeter.style.width = `${state.fan.on ? fanLevel : 0}%`;
  if (document.activeElement !== ui.fanSlider) ui.fanSlider.value = fanLevel;
  ui.fanOutput.textContent = `${fanLevel}%`;
  ui.fanIcon.classList.toggle("spinning", state.fan.on && fanLevel > 0);
}

async function fetchState(silent = true) {
  if (stateRequestBusy || commandBusy) return;
  stateRequestBusy = true;
  const epoch = controlEpoch;
  try {
    const response = await fetch("/api/state", { cache: "no-store", signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (epoch !== controlEpoch || commandBusy) return;
    renderConnection(Boolean(payload.connected), payload.transport);
    $("connectionHelp").hidden = Boolean(payload.connected);
    $("connectionHelp").textContent = payload.bridgeError || "Đang chờ ESP32 khởi động. Web tự kết nối lại.";
    if (payload.state) renderState(payload.state);
  } catch (error) {
    renderConnection(false);
    $("connectionHelp").hidden = false;
    $("connectionHelp").textContent = "Không kết nối được máy chủ. Chạy Start-Dashboard.ps1 và mở http://localhost:8080 (không mở bằng Live Server).";
    if (!silent) showToast(`Không đọc được trạng thái: ${error.message}`);
  } finally {
    stateRequestBusy = false;
  }
}

async function sendCommand(command, source = "WEB") {
  if (commandBusy) return false;
  if (source === "WEB" && mode !== "manual" && command !== "ALL_OFF") return false;
  if (source !== "WEB" && mode !== "gesture") return false;
  if (!connected) {
    showToast("Hãy chạy Wokwi trước để kết nối ESP32.");
    return false;
  }
  commandBusy = true;
  controlEpoch++;
  try {
    const response = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(5000)
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!payload.confirmed || !payload.state) throw new Error("Máy chủ cũ chưa hỗ trợ xác nhận. Khởi động lại Start-Dashboard.ps1.");
    renderState(payload.state);
    const readable = command.replace("LIGHT_LEVEL:", "Đèn ").replace("FAN_SPEED:", "Quạt ")
      .replace("LIGHT_ON", "Bật đèn").replace("LIGHT_OFF", "Tắt đèn")
      .replace("FAN_ON", "Bật quạt").replace("FAN_OFF", "Tắt quạt").replace("ALL_OFF", "Tắt toàn bộ");
    addLog(source, readable.includes("Đèn ") || readable.includes("Quạt ") ? `${readable}%` : readable);
    setTimeout(() => fetchState(), 90);
    return true;
  } catch (error) {
    showToast(`Gửi lệnh thất bại: ${error.message}`);
    fetchState();
    return false;
  } finally {
    commandBusy = false;
  }
}

function updateGestureUi(gesture, ratio = null, level = null) {
  const meta = gestureMeta[gesture] || gestureMeta.UNKNOWN;
  ui.gestureName.textContent = meta[0];
  ui.gestureSubtitle.textContent = mode === "manual" && gesture !== "NONE"
    ? `${meta[1]} · Chỉ hiển thị trong chế độ Thủ công`
    : meta[1];
  ui.gestureIcon.textContent = meta[2];
  ui.gestureOrb.classList.toggle("detected", gesture !== "NONE");
  ui.pinchRatio.textContent = ratio == null ? "—" : ratio.toFixed(2);
  ui.pinchLevel.textContent = level == null ? "—" : `${level}%`;
  ui.pinchBar.style.width = level == null ? "0%" : `${level}%`;
}

function fingerExtended(landmarks, tip, pip) {
  return landmarks[tip].y < landmarks[pip].y - 0.018;
}

function classifyGesture(landmarks) {
  const index = fingerExtended(landmarks, 8, 6);
  const middle = fingerExtended(landmarks, 12, 10);
  const ring = fingerExtended(landmarks, 16, 14);
  const pinky = fingerExtended(landmarks, 20, 18);
  const extendedCount = [index, middle, ring, pinky].filter(Boolean).length;
  const palmWidth = Math.max(distance(landmarks[5], landmarks[17]), 0.04);
  const ratio = distance(landmarks[4], landmarks[8]) / palmWidth;

  if (extendedCount === 0) pinchActive = false;
  if (!pinchActive && extendedCount > 0 && ratio <= VISION_CONFIG.pinchEnterRatio) pinchActive = true;
  if (pinchActive && ratio >= VISION_CONFIG.pinchExitRatio) pinchActive = false;

  if (extendedCount === 0) return { gesture: "FIST", ratio };
  if (pinchActive) return { gesture: "PINCH", ratio };
  if (index && !middle && !ring && !pinky) return { gesture: "POINT", ratio };
  if (index && middle && !ring && !pinky) return { gesture: "VICTORY", ratio };
  if (extendedCount === 4) return { gesture: "OPEN", ratio };
  return { gesture: "UNKNOWN", ratio };
}

async function processStableGesture(gesture, level) {
  if (gesture !== candidateGesture) {
    candidateGesture = gesture;
    candidateFrames = 1;
  } else {
    candidateFrames++;
  }

  if (gesture === "NONE" || gesture === "UNKNOWN") {
    lastTriggeredGesture = "NONE";
    return;
  }
  if (mode !== "gesture" || !connected || commandBusy) return;

  const now = performance.now();
  if (gesture === "PINCH") {
    if (candidateFrames < VISION_CONFIG.stableFrames) return;
    if (now - lastLevelSentAt < VISION_CONFIG.levelSendIntervalMs) return;
    const quantized = Math.round(level / VISION_CONFIG.levelDeadband) * VISION_CONFIG.levelDeadband;
    if (Math.abs(quantized - lastSentLevel) < VISION_CONFIG.levelDeadband) return;
    lastLevelSentAt = now;
    if (await sendCommand(selectedDevice === "light" ? `LIGHT_LEVEL:${quantized}` : `FAN_SPEED:${quantized}`, "PINCH")) lastSentLevel = quantized;
    return;
  }

  if (candidateFrames < VISION_CONFIG.stableFrames || gesture === lastTriggeredGesture) return;
  if (now - lastActionAt < VISION_CONFIG.actionCooldownMs) return;
  lastTriggeredGesture = gesture;
  lastActionAt = now;

  if (gesture === "POINT") selectDevice("light", true);
  if (gesture === "VICTORY") selectDevice("fan", true);
  if (gesture === "OPEN" || gesture === "FIST") {
    const wantedOn = gesture === "OPEN";
    if (deviceState[selectedDevice].on !== wantedOn) {
      const command = `${selectedDevice === "light" ? "LIGHT" : "FAN"}_${wantedOn ? "ON" : "OFF"}`;
      if (!await sendCommand(command, "CỬ CHỈ")) lastTriggeredGesture = "NONE";
    }
  }
}

function drawHand(landmarks) {
  const ctx = ui.canvas.getContext("2d");
  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(49, 215, 204, .82)";
  ctx.lineWidth = Math.max(2, ui.canvas.width / 320);
  for (const [from, to] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(landmarks[from].x * ui.canvas.width, landmarks[from].y * ui.canvas.height);
    ctx.lineTo(landmarks[to].x * ui.canvas.width, landmarks[to].y * ui.canvas.height);
    ctx.stroke();
  }
  landmarks.forEach((point, index) => {
    ctx.beginPath();
    ctx.fillStyle = index === 4 || index === 8 ? "#ffca63" : "#e9fbff";
    ctx.arc(point.x * ui.canvas.width, point.y * ui.canvas.height, index === 4 || index === 8 ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function handleVisionResult(result) {
  const landmarks = result.landmarks?.[0];
  if (!landmarks) {
    ui.canvas.getContext("2d").clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    pinchActive = false;
    candidateGesture = "NONE";
    candidateFrames = 0;
    updateGestureUi("NONE");
    ui.handedness.textContent = "NO HAND";
    lastTriggeredGesture = "NONE";
    return;
  }

  drawHand(landmarks);
  const category = result.handedness?.[0]?.[0];
  ui.handedness.textContent = `${category?.categoryName || "HAND"} ${Math.round((category?.score || 0) * 100)}%`;
  const { gesture, ratio } = classifyGesture(landmarks);
  const rawLevel = clamp((ratio - VISION_CONFIG.pinchMinRatio) /
    (VISION_CONFIG.pinchMaxRatio - VISION_CONFIG.pinchMinRatio) * 100, 0, 100);
  smoothedLevel += VISION_CONFIG.smoothingAlpha * (rawLevel - smoothedLevel);
  const level = Math.round(smoothedLevel);
  updateGestureUi(gesture, ratio, gesture === "PINCH" ? level : null);
  processStableGesture(gesture, level);
}

async function visionLoop() {
  if (!cameraRunning) return;
  const now = performance.now();
  const instantaneousFps = 1000 / Math.max(now - lastFrameAt, 1);
  fpsAverage = fpsAverage ? fpsAverage * .88 + instantaneousFps * .12 : instantaneousFps;
  lastFrameAt = now;
  ui.fps.textContent = `${Math.round(fpsAverage)} FPS`;

  if (ui.video.readyState >= 2 && ui.video.currentTime !== lastVideoTime) {
    lastVideoTime = ui.video.currentTime;
    try {
      const result = handLandmarker.detectForVideo(ui.video, now);
      handleVisionResult(result);
    } catch (error) {
      stopCamera();
      ui.cameraMessage.textContent = `Nhận diện bị lỗi: ${error.message}. Có thể thử bật camera lại.`;
      return;
    }
  }
  requestAnimationFrame(visionLoop);
}

async function createLandmarker() {
  if (handLandmarker) return handLandmarker;
  ui.cameraMessage.textContent = "Đang tải mô hình nhận diện bàn tay…";
  const { FilesetResolver, HandLandmarker } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  const options = {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  };
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, options);
  } catch {
    options.baseOptions.delegate = "CPU";
    handLandmarker = await HandLandmarker.createFromOptions(vision, options);
  }
  return handLandmarker;
}

async function startCamera() {
  ui.cameraButton.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Hãy mở web tại http://localhost:8080 bằng Chrome hoặc Edge.");
    await createLandmarker();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false
    });
    ui.video.srcObject = cameraStream;
    await ui.video.play();
    ui.canvas.width = ui.video.videoWidth || 1280;
    ui.canvas.height = ui.video.videoHeight || 720;
    cameraRunning = true;
    lastVideoTime = -1;
    lastFrameAt = performance.now();
    ui.cameraPlaceholder.classList.add("hidden");
    ui.cameraStage.classList.add("running");
    ui.cameraBadge.textContent = "Camera đang hoạt động";
    ui.cameraButton.textContent = "Tắt camera";
    ui.cameraButton.classList.add("stop");
    ui.cameraMessage.textContent = "Landmark được xử lý cục bộ trong trình duyệt.";
    addLog("CAMERA", "Bật nhận diện bàn tay");
    requestAnimationFrame(visionLoop);
  } catch (error) {
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;
    ui.cameraMessage.textContent = `Không thể bật camera: ${error.message}`;
    showToast(`Camera/MediaPipe lỗi: ${error.message}`);
  } finally {
    ui.cameraButton.disabled = false;
  }
}

function stopCamera() {
  cameraRunning = false;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  ui.video.srcObject = null;
  ui.canvas.getContext("2d").clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  ui.cameraPlaceholder.classList.remove("hidden");
  ui.cameraStage.classList.remove("running");
  ui.cameraBadge.textContent = "Camera đang tắt";
  ui.cameraButton.textContent = "Bật camera";
  ui.cameraButton.classList.remove("stop");
  ui.cameraMessage.textContent = "Camera đã tắt; điều khiển thủ công vẫn hoạt động.";
  ui.handedness.textContent = "—";
  ui.fps.textContent = "0 FPS";
  updateGestureUi("NONE");
  addLog("CAMERA", "Tắt nhận diện bàn tay");
}

ui.cameraButton.addEventListener("click", () => cameraRunning ? stopCamera() : startCamera());
ui.manualMode.addEventListener("click", () => setMode("manual"));
ui.gestureMode.addEventListener("click", () => setMode("gesture"));
ui.allOff.addEventListener("click", async () => {
  setMode("manual");
  // Cancel gesture input, then wait for the previous confirmed command.
  while (commandBusy) await new Promise(resolve => setTimeout(resolve, 30));
  await sendCommand("ALL_OFF", "WEB");
});
ui.clearLog.addEventListener("click", () => { ui.log.innerHTML = '<div class="empty-log">Chưa có thao tác nào.</div>'; });

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => sendCommand(button.dataset.command, "WEB"));
});

function bindSlider(slider, output, prefix) {
  slider.addEventListener("input", () => {
    output.textContent = `${slider.value}%`;
    clearTimeout(sliderTimers.get(prefix));
    const value = slider.value;
    const send = () => {
      if (mode !== "manual") return;
      if (commandBusy) { sliderTimers.set(prefix, setTimeout(send, 100)); return; }
      sendCommand(`${prefix}:${value}`, "WEB");
    };
    sliderTimers.set(prefix, setTimeout(send, 140));
  });
}
bindSlider(ui.lightSlider, ui.lightOutput, "LIGHT_LEVEL");
bindSlider(ui.fanSlider, ui.fanOutput, "FAN_SPEED");

window.addEventListener("beforeunload", stopCamera);
setMode("manual");
fetchState(false);
setInterval(() => fetchState(), 800);
