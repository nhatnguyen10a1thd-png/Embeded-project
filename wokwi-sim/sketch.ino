#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>

// ===== Hardware assumptions for the Wokwi prototype =====
// ESP32 only outputs 3.3V control signals. In Wokwi, the light is represented
// by a PWM LED and the fan is represented by an A4988 + stepper motor.
constexpr uint8_t LIGHT_PWM_PIN = 25;
constexpr uint8_t FAN_STEP_PIN = 26;
constexpr uint8_t FAN_DIR_PIN = 27;
constexpr uint8_t LIGHT_BUTTON_PIN = 32;
constexpr uint8_t FAN_BUTTON_PIN = 33;
constexpr uint8_t LIGHT_POT_PIN = 34;
constexpr uint8_t FAN_POT_PIN = 35;

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint32_t BUTTON_DEBOUNCE_MS = 40;
constexpr uint32_t WIFI_RETRY_MS = 10000;
constexpr uint32_t PWM_RAMP_INTERVAL_MS = 8;
constexpr uint8_t PWM_RAMP_STEP = 3;
constexpr uint32_t FAN_RAMP_INTERVAL_MS = 20;
constexpr uint16_t FAN_RAMP_STEP_SPS = 8;
constexpr uint16_t FAN_MIN_STEPS_PER_SECOND = 40;
constexpr uint16_t FAN_MAX_STEPS_PER_SECOND = 500;
constexpr uint32_t POT_SAMPLE_INTERVAL_MS = 50;
constexpr uint8_t POT_PERCENT_DEADBAND = 1;

const char *WIFI_SSID = "Wokwi-GUEST";
const char *WIFI_PASSWORD = "";

WebServer server(80);

struct DeviceState {
  // Start ON in this Wokwi-only project so both loads are immediately visible.
  // Change both values to false for a physical installation that must power up
  // in a safe OFF state.
  bool lightOn = true;
  uint8_t brightness = 70;
  bool fanOn = true;
  uint8_t fanSpeed = 60;
  String lastSource = "BOOT";
};

struct ButtonState {
  uint8_t pin;
  bool stableLevel = HIGH;
  bool lastReading = HIGH;
  uint32_t changedAt = 0;

  explicit ButtonState(uint8_t pinValue) : pin(pinValue) {}
};

struct PotState {
  uint8_t pin;
  int lastAcceptedPercent = -1;
  bool initialized = false;

  explicit PotState(uint8_t pinValue) : pin(pinValue) {}
};

DeviceState state;
ButtonState lightButton{LIGHT_BUTTON_PIN};
ButtonState fanButton{FAN_BUTTON_PIN};
PotState lightPot{LIGHT_POT_PIN};
PotState fanPot{FAN_POT_PIN};

String serialLine;
bool httpServerStarted = false;
uint32_t lastWifiAttemptAt = 0;
uint32_t lastPotSampleAt = 0;
uint32_t lastPwmRampAt = 0;
uint32_t lastFanRampAt = 0;
uint32_t nextFanEdgeAtUs = 0;
uint8_t targetLightDuty = 0;
uint8_t appliedLightDuty = 0;
uint16_t targetFanStepsPerSecond = 0;
uint16_t appliedFanStepsPerSecond = 0;
bool fanStepLevel = LOW;

uint8_t clampPercent(int value) {
  return static_cast<uint8_t>(constrain(value, 0, 100));
}

uint8_t lightPercentToDuty(uint8_t percent) {
  return static_cast<uint8_t>(map(percent, 0, 100, 0, 255));
}

uint16_t fanPercentToStepsPerSecond(uint8_t percent) {
  if (percent == 0) return 0;
  return static_cast<uint16_t>(map(percent, 1, 100,
                                   FAN_MIN_STEPS_PER_SECOND,
                                   FAN_MAX_STEPS_PER_SECOND));
}

void applyOutputs() {
  targetLightDuty = state.lightOn ? lightPercentToDuty(state.brightness) : 0;
  targetFanStepsPerSecond =
      state.fanOn ? fanPercentToStepsPerSecond(state.fanSpeed) : 0;
}

uint8_t approachDuty(uint8_t current, uint8_t target) {
  if (current < target) {
    const uint16_t next = static_cast<uint16_t>(current) + PWM_RAMP_STEP;
    return static_cast<uint8_t>(next > target ? target : next);
  }
  if (current > target) {
    const int next = static_cast<int>(current) - PWM_RAMP_STEP;
    return static_cast<uint8_t>(next < target ? target : next);
  }
  return current;
}

uint16_t approachRate(uint16_t current, uint16_t target) {
  if (current < target) {
    const uint32_t next = static_cast<uint32_t>(current) + FAN_RAMP_STEP_SPS;
    return static_cast<uint16_t>(next > target ? target : next);
  }
  if (current > target) {
    const int32_t next = static_cast<int32_t>(current) - FAN_RAMP_STEP_SPS;
    return static_cast<uint16_t>(next < target ? target : next);
  }
  return current;
}

void updateLightRamp() {
  const uint32_t now = millis();
  if (now - lastPwmRampAt < PWM_RAMP_INTERVAL_MS) return;
  lastPwmRampAt = now;

  const uint8_t nextLight = approachDuty(appliedLightDuty, targetLightDuty);
  if (nextLight != appliedLightDuty) {
    appliedLightDuty = nextLight;
    analogWrite(LIGHT_PWM_PIN, appliedLightDuty);
  }
}

void updateFanRamp() {
  const uint32_t now = millis();
  if (now - lastFanRampAt < FAN_RAMP_INTERVAL_MS) return;
  lastFanRampAt = now;
  appliedFanStepsPerSecond =
      approachRate(appliedFanStepsPerSecond, targetFanStepsPerSecond);
  if (appliedFanStepsPerSecond == 0) {
    fanStepLevel = LOW;
    digitalWrite(FAN_STEP_PIN, LOW);
  }
}

void updateFanStepPulse() {
  if (appliedFanStepsPerSecond == 0) return;

  const uint32_t nowUs = micros();
  if (static_cast<int32_t>(nowUs - nextFanEdgeAtUs) < 0) return;

  fanStepLevel = !fanStepLevel;
  digitalWrite(FAN_STEP_PIN, fanStepLevel);
  const uint32_t halfPeriodUs = 500000UL / appliedFanStepsPerSecond;
  nextFanEdgeAtUs = nowUs + halfPeriodUs;
}

void updateSmoothOutputs() {
  updateLightRamp();
  updateFanRamp();
  updateFanStepPulse();
}

void initializeOutputs() {
  pinMode(LIGHT_PWM_PIN, OUTPUT);
  pinMode(FAN_STEP_PIN, OUTPUT);
  pinMode(FAN_DIR_PIN, OUTPUT);
  analogWrite(LIGHT_PWM_PIN, 0);
  digitalWrite(FAN_STEP_PIN, LOW);
  digitalWrite(FAN_DIR_PIN, HIGH);
  nextFanEdgeAtUs = micros();
  applyOutputs();
}

void initializeInputs() {
  pinMode(LIGHT_BUTTON_PIN, INPUT_PULLUP);
  pinMode(FAN_BUTTON_PIN, INPUT_PULLUP);
  pinMode(LIGHT_POT_PIN, INPUT);
  pinMode(FAN_POT_PIN, INPUT);
  analogReadResolution(12);
}

void initializeHardware() {
  initializeOutputs();
  initializeInputs();
}

void printHardwareSummary() {
  Serial.println(F("Hardware: GPIO25=light PWM, GPIO26=fan STEP, GPIO27=fan DIR"));
  Serial.println(F("Fan model: A4988 + stepper, 40..500 steps/s"));
  Serial.println(F("External 12V supplies VMOT; ESP32 and driver share GND."));
}

String jsonState() {
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  String json = "{";
  json += "\"esp32\":\"";
  json += wifiConnected ? "connected" : "disconnected";
  json += "\",\"ip\":\"";
  json += wifiConnected ? WiFi.localIP().toString() : "";
  json += "\",\"light\":{\"on\":";
  json += state.lightOn ? "true" : "false";
  json += ",\"brightness\":" + String(state.brightness) + "}";
  json += ",\"fan\":{\"on\":";
  json += state.fanOn ? "true" : "false";
  json += ",\"speed\":" + String(state.fanSpeed) + "}";
  json += ",\"source\":\"" + state.lastSource + "\"}";
  return json;
}

void emitState() {
  Serial.println(jsonState());
}

void commitState(const String &source) {
  state.lastSource = source;
  applyOutputs();
  emitState();
}

void setLight(bool on, int level, const String &source) {
  if (level >= 0) {
    state.brightness = clampPercent(level);
    state.lightOn = state.brightness > 0;
  } else {
    state.lightOn = on;
    if (state.lightOn && state.brightness == 0) state.brightness = 100;
  }
  commitState(source);
}

void setFan(bool on, int level, const String &source) {
  if (level >= 0) {
    state.fanSpeed = clampPercent(level);
    state.fanOn = state.fanSpeed > 0;
  } else {
    state.fanOn = on;
    if (state.fanOn && state.fanSpeed == 0) state.fanSpeed = 100;
  }
  commitState(source);
}

void turnOffAll(const String &source) {
  state.lightOn = false;
  state.fanOn = false;
  commitState(source);
}

void printHelp() {
  Serial.println(F("Commands:"));
  Serial.println(F("  LIGHT_ON | LIGHT_OFF | LIGHT_LEVEL:0..100"));
  Serial.println(F("  FAN_ON   | FAN_OFF   | FAN_SPEED:0..100"));
  Serial.println(F("  ALL_OFF  | STATE     | HELP"));
}

void processCommand(String command, const String &source = "SERIAL") {
  command.trim();
  command.toUpperCase();
  if (command.isEmpty()) return;

  if (command == "LIGHT_ON") {
    setLight(true, -1, source);
  } else if (command == "LIGHT_OFF") {
    setLight(false, -1, source);
  } else if (command == "FAN_ON") {
    setFan(true, -1, source);
  } else if (command == "FAN_OFF") {
    setFan(false, -1, source);
  } else if (command == "ALL_OFF" || command == "TURN_OFF_ALL") {
    turnOffAll(source);
  } else if (command == "STATE") {
    emitState();
  } else if (command == "HELP") {
    printHelp();
  } else if (command.startsWith("LIGHT_LEVEL:")) {
    setLight(true, command.substring(12).toInt(), source);
  } else if (command.startsWith("FAN_SPEED:")) {
    setFan(true, command.substring(10).toInt(), source);
  } else {
    Serial.println(F("ERR: unknown command. Type HELP."));
  }
}

void handleSerial() {
  while (Serial.available()) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      if (!serialLine.isEmpty()) {
        if (serialLine.startsWith("@")) {
          const int separator = serialLine.indexOf(' ');
          if (separator > 1) {
            const uint32_t requestId = serialLine.substring(1, separator).toInt();
            processCommand(serialLine.substring(separator + 1), "WEB");
            Serial.print("{\"ack\":");
            Serial.print(requestId);
            Serial.print(",\"state\":");
            Serial.print(jsonState());
            Serial.println("}");
          }
        } else {
          processCommand(serialLine);
        }
        serialLine = "";
      }
    } else if (serialLine.length() < 80) {
      serialLine += c;
    }
  }
}

bool buttonPressed(ButtonState &button) {
  const bool reading = digitalRead(button.pin);
  const uint32_t now = millis();
  if (reading != button.lastReading) {
    button.lastReading = reading;
    button.changedAt = now;
  }
  if (now - button.changedAt >= BUTTON_DEBOUNCE_MS && reading != button.stableLevel) {
    button.stableLevel = reading;
    return button.stableLevel == LOW;
  }
  return false;
}

void handleLocalTestControls() {
  if (buttonPressed(lightButton)) setLight(!state.lightOn, -1, "BUTTON");
  if (buttonPressed(fanButton)) setFan(!state.fanOn, -1, "BUTTON");

  const uint32_t now = millis();
  if (now - lastPotSampleAt < POT_SAMPLE_INTERVAL_MS) return;
  lastPotSampleAt = now;

  const int lightRaw = analogRead(lightPot.pin);
  const int fanRaw = analogRead(fanPot.pin);
  const int lightPercent = map(lightRaw, 0, 4095, 0, 100);
  const int fanPercent = map(fanRaw, 0, 4095, 0, 100);

  if (!lightPot.initialized ||
      abs(lightPercent - lightPot.lastAcceptedPercent) >= POT_PERCENT_DEADBAND) {
    lightPot.lastAcceptedPercent = lightPercent;
    lightPot.initialized = true;
    setLight(true, lightPercent, "POT");
  }
  if (!fanPot.initialized ||
      abs(fanPercent - fanPot.lastAcceptedPercent) >= POT_PERCENT_DEADBAND) {
    fanPot.lastAcceptedPercent = fanPercent;
    fanPot.initialized = true;
    setFan(true, fanPercent, "POT");
  }
}

void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Cache-Control", "no-store");
}

void sendJsonState(int status = 200) {
  addCorsHeaders();
  server.send(status, "application/json", jsonState());
}

bool parseOnArgument(bool currentValue) {
  if (!server.hasArg("on")) return currentValue;
  String value = server.arg("on");
  value.toLowerCase();
  return value == "1" || value == "true" || value == "on";
}

void configureHttpApi() {
  server.on("/", HTTP_GET, []() {
    addCorsHeaders();
    server.send(200, "text/plain",
      "ESP32 light/fan controller\n"
      "GET /api/state\n"
      "GET/POST /api/light?on=1&level=75\n"
      "GET/POST /api/fan?on=1&level=60\n"
      "GET/POST /api/all-off\n"
      "GET/POST /api/command?value=LIGHT_ON\n");
  });

  server.on("/api/state", HTTP_GET, []() { sendJsonState(); });

  server.on("/api/light", HTTP_ANY, []() {
    const int level = server.hasArg("level") ? server.arg("level").toInt() : -1;
    setLight(parseOnArgument(state.lightOn), level, "HTTP");
    sendJsonState();
  });

  server.on("/api/fan", HTTP_ANY, []() {
    const int level = server.hasArg("level") ? server.arg("level").toInt() : -1;
    setFan(parseOnArgument(state.fanOn), level, "HTTP");
    sendJsonState();
  });

  server.on("/api/all-off", HTTP_ANY, []() {
    turnOffAll("HTTP");
    sendJsonState();
  });

  server.on("/api/command", HTTP_ANY, []() {
    if (!server.hasArg("value")) {
      addCorsHeaders();
      server.send(400, "application/json", "{\"error\":\"missing value\"}");
      return;
    }
    processCommand(server.arg("value"), "HTTP");
    sendJsonState();
  });

  server.onNotFound([]() {
    addCorsHeaders();
    server.send(404, "application/json", "{\"error\":\"not found\"}");
  });
}

void maintainWifi() {
  const uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED) {
    if (!httpServerStarted) {
      server.begin();
      httpServerStarted = true;
      Serial.print(F("HTTP API ready at http://"));
      Serial.println(WiFi.localIP());
      emitState();
    }
    server.handleClient();
    return;
  }

  httpServerStarted = false;
  if (lastWifiAttemptAt == 0 || now - lastWifiAttemptAt >= WIFI_RETRY_MS) {
    lastWifiAttemptAt = now;
    Serial.println(F("WiFi: connecting to Wokwi-GUEST..."));
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);
  }
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  serialLine.reserve(96);

  initializeHardware();
  configureHttpApi();
  WiFi.mode(WIFI_STA);

  Serial.println(F("\n=== NHOM 25 - ESP32 LIGHT/FAN WOKWI SIMULATION ==="));
  printHardwareSummary();
  printHelp();
  emitState();
  maintainWifi();
}

void loop() {
  handleSerial();
  handleLocalTestControls();
  updateSmoothOutputs();
  maintainWifi();
  delay(5);
}
