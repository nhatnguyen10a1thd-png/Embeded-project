// Keep the Wokwi web sketch and the PlatformIO build on one source of truth.
// These explicit includes let PlatformIO's dependency scanner discover the
// ESP32 framework libraries before it expands the sketch include below.
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "../sketch.ino"
