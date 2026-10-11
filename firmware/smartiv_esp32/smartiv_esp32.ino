// ============================================================
// SMART IV UNIT  -  ESP32 + 2 Load Cells + 2 HX711 + Buzzer
// ============================================================
//
// Reports the volume left in each IV bag and the flow rate to the
// SmartIV server, once every 2 seconds, over HTTPS.
//
// HARDWARE
//   IV Bag 1 -> Load Cell 1 -> HX711 #1 -> bed BED_FOR_CHANNEL_1
//   IV Bag 2 -> Load Cell 2 -> HX711 #2 -> bed BED_FOR_CHANNEL_2
//   Buzzer  -> ESP32
//
// One unit covers two beds: channel 1 weighs the bag on the first bed,
// channel 2 weighs the bag on the second. The beds a unit is allowed to
// report for are set on the server when the unit is registered, so a unit
// that has been re-wired is rejected until it is registered again.
//
// PROTOTYPE ONLY
//   This is not a certified medical device.
//
// WHAT THE SERVER WORKS OUT
//   percentage    = volume_left / bag_size * 100
//   minutes_left  = volume_left / smoothed_flow_rate * 60
//   end_time      = now + minutes_left
//   So this sketch only has to report volume and flow accurately.
//
// SETUP
//   1. Copy config.h.example to config.h and fill it in. config.h holds the
//      Wi-Fi details, the server address and the device key, and must never
//      be committed.
//   2. npm run device:register -- --unit=IVU-01 --beds=1,2
//      Copy the printed device key into config.h.
//   3. Put BED_FOR_CHANNEL_1 / BED_FOR_CHANNEL_2 in the same order.
//   4. Calibrate each load cell and set EMPTY_BAG_MASS_G (see CALIBRATION).
//
// LIBRARIES (Arduino IDE Library Manager)
//   ArduinoJson          by Benoit Blanchon
//   HX711                by Bogdan Necula
// ============================================================

#include <Arduino.h>
#include "config.h"
#include <WiFi.h>
#include <HTTPClient.h>
#if API_USE_TLS
#include <WiFiClientSecure.h>
#endif
#include <time.h>
#include <ArduinoJson.h>
#include "HX711.h"

// ============================================================
// 1. PIN CONNECTIONS
// ============================================================

#define HX1_DT 4  // Load cell 1 data
#define HX1_SCK 5  // Load cell 1 clock
#define HX2_DT 15  // Load cell 2 data
#define HX2_SCK 16  // Load cell 2 clock
#define BUZZER_PIN 17

// ============================================================
// 2. HX711 OBJECTS
// ============================================================

HX711 scale1;
HX711 scale2;

// ============================================================
// 3. STATUS TYPES
// ============================================================

enum IvStatus
{
  STATUS_SENSOR_ERROR,
  STATUS_NORMAL,
  STATUS_WARNING,
  STATUS_CRITICAL
};

// One bag's latest state.
struct BagReading
{
  bool sensorReady = false;
  float volumeML = 0.0f;
  float flowMlH = 0.0f;
  IvStatus status = STATUS_SENSOR_ERROR;
};

// ============================================================
// 4. CALIBRATION
// ============================================================
//
// MEASURE THESE, DO NOT ASSUME THEM.
//
// EMPTY_BAG_MASS_G  weigh the empty bag plus the tubing that hangs from the
//                  load cell and put the number in config.h, per channel.
// CALIBRATION_FACTOR  every load cell and HX711 pair has its own factor.
//                  Start with the value in config.h, then calibrate:
//                    1. Put a known mass on the cell.
//                    2. Read the serial monitor.
//                    3. factor = known_mass / raw_reading
//                  A wrong factor reports a wrong volume, so a wrong
//                  end time. Do not trust the dashboard until it is set.
//
// FLUID_DENSITY  volume = fluid_mass / density.
//                1.0 assumes 1 g = 1 mL. Set it for the fluid in use.
//
// BAG_SIZE_ML  filled volume of the bag on the pole, 100 mL here.
// ============================================================

// ============================================================
// 5. FLOW RATE
// ============================================================
//
// Flow is the change in volume over time. A single 2 second delta is far
// too noisy to use directly, so the volume is sampled on a fixed tick and
// the flow is averaged over FLOW_WINDOW_SAMPLES ticks. The server applies
// its own moving average on top of this.
//
// With REPORT_INTERVAL_MS = 2000 and 5 samples, flow is measured over a
// 10 second window.
// ============================================================

#define FLOW_WINDOW_SAMPLES 5

static float volumeHistory[2][FLOW_WINDOW_SAMPLES] = {{0}};
static uint8_t historyCount = 0;
static uint8_t historyHead = 0;

static float lastVolume[2] = {-1.0f, -1.0f};
static unsigned long lastVolumeAtMs = 0;

// ============================================================
// 6. BUZZER
// ============================================================
//
// CRITICAL      -> continuous
// WARNING       -> intermittent
// NORMAL        -> off
// SENSOR ERROR  -> intermittent
//
// The buzzer is driven entirely from the readings below. It does not depend
// on Wi-Fi or on the server, so a nurse still gets an alarm when the network
// is down.
// ============================================================

#define WARNING_BEEP_INTERVAL_MS 500

static bool buzzerState = false;
static unsigned long lastBuzzerTime = 0;

static void updateBuzzer(IvStatus status1, IvStatus status2)
{
  if (status1 == STATUS_CRITICAL || status2 == STATUS_CRITICAL)
  {
    digitalWrite(BUZZER_PIN, HIGH);
    buzzerState = true;
    return;
  }

  if (status1 == STATUS_WARNING || status2 == STATUS_WARNING || status1 == STATUS_SENSOR_ERROR || status2 == STATUS_SENSOR_ERROR)
  {
    const unsigned long now = millis();
    if (now - lastBuzzerTime >= WARNING_BEEP_INTERVAL_MS)
    {
      lastBuzzerTime = now;
      buzzerState = !buzzerState;
      digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);
    }
    return;
  }

  digitalWrite(BUZZER_PIN, LOW);
  buzzerState = false;
}

// ============================================================
// 7. SENSOR READING  --  CHANGE THIS WHEN HARDWARE IS DECIDED
// ============================================================
//
// Everything hardware-specific is in this one function. The rest of the
// sketch only consumes the numbers it returns, so swapping the sensor means
// editing readBag() and nothing else.
//
// To change the sensor, keep the contract:
//   * set sensorReady to false when the reading cannot be trusted
//   * set volumeML to the filled volume in millilitres, 0 to BAG_SIZE_ML
//   * leave the flow calculation in averageFlow() alone
//
static bool readBag(HX711 &scale, float emptyBagMassG, float calibrationFactor, float &volumeML)
{
  // --- is the front end answering? -------------------------------------
  if (!scale.is_ready())
  {
    return false;
  }

  // --- raw count -> grams ----------------------------------------------
  scale.set_scale(calibrationFactor);
  const float measuredGrams = scale.get_units(5); // average 5 conversions

  // --- subtract the empty bag, then mass -> volume ---------------------
  float fluidMassG = measuredGrams - emptyBagMassG;
  if (fluidMassG < 0.0f)
  {
    fluidMassG = 0.0f; // a bag can never hold less than nothing
  }

  volumeML = (FLUID_DENSITY > 0.0f) ? (fluidMassG / FLUID_DENSITY) : 0.0f;

  // --- clamp to what the bag can physically hold -----------------------
  if (volumeML < 0.0f)
  {
    volumeML = 0.0f;
  }
  if (volumeML > BAG_SIZE_ML)
  {
    volumeML = BAG_SIZE_ML;
  }

  return true;
}

// ============================================================
// 8. FLOW AND SEVERITY
// ============================================================
//
// The limits below mirror the server's alert rules. They are duplicated here
// on purpose: the buzzer must work with no network. If an admin changes a
// limit in the dashboard, change the matching value in config.h too.
//
static IvStatus statusFor(float volumeML, float flowMlH)
{
  if (volumeML <= 0.0f || flowMlH <= 0.0f)
  {
    return STATUS_CRITICAL;
  }
  const float minutesLeft = volumeML / flowMlH * 60.0f;
  const float percentLeft = volumeML / BAG_SIZE_ML * 100.0f;
  if (minutesLeft <= CRIT_MINUTES || percentLeft <= CRIT_PERCENT)
  {
    return STATUS_CRITICAL;
  }
  if (minutesLeft <= WARN_MINUTES || percentLeft <= WARN_PERCENT)
  {
    return STATUS_WARNING;
  }
  return STATUS_NORMAL;
}

// Averages the volume deltas over the window, which is what stops a single
// noisy load cell reading from swinging the reported flow rate.
static float averageFlow(int channel, float volumeML)
{
  const unsigned long now = millis();
  float flow = 0.0f;

  if (lastVolumeAtMs != 0)
  {
    const unsigned long elapsedMs = now - lastVolumeAtMs;
    if (elapsedMs > 0 && lastVolume[channel] >= 0.0f)
    {
      const float droppedML = lastVolume[channel] - volumeML;
      const float hours = elapsedMs / 3600000.0f;
      // A bag being filled or handled produces a negative drop; clamp to zero.
      flow = (droppedML > 0.0f) ? (droppedML / hours) : 0.0f;
    }
  }

  volumeHistory[channel][historyHead] = flow;
  lastVolume[channel] = volumeML;

  float sum = 0.0f;
  uint8_t samples = 0;
  for (uint8_t i = 0; i < FLOW_WINDOW_SAMPLES; i++)
  {
    if (volumeHistory[channel][i] > 0.0f)
    {
      sum += volumeHistory[channel][i];
      samples++;
    }
  }

  historyHead = (historyHead + 1) % FLOW_WINDOW_SAMPLES;
  if (historyCount < FLOW_WINDOW_SAMPLES)
  {
    historyCount++;
  }
  lastVolumeAtMs = now;

  return samples > 0 ? (sum / samples) : flow;
}

// ============================================================
// 9. HTTPS POST
// ============================================================

static unsigned long lastPostMs = 0;
static unsigned long backoffMs = 0;
static unsigned int consecutiveFailures = 0;

static const char *statusToString(IvStatus status)
{
  switch (status)
  {
    case STATUS_NORMAL:
      return "NORMAL";
    case STATUS_WARNING:
      return "WARNING";
    case STATUS_CRITICAL:
      return "CRITICAL";
    case STATUS_SENSOR_ERROR:
      return "SENSOR_ERROR";
    default:
      return "UNKNOWN";
  }
}

static bool sendReadings(const BagReading &bag1, const BagReading &bag2)
{
  if (WiFi.status() != WL_CONNECTED)
  {
    return false;
  }

  // Only the channels that read cleanly are reported. A channel that is
  // failing goes quiet, and the server marks that bed offline after 10
  // seconds, which is the honest thing to show a nurse.
  JsonDocument doc;
  JsonArray bags = doc["bags"].to<JsonArray>();

  if (bag1.sensorReady)
  {
    JsonObject first = bags.add<JsonObject>();
    first["channel"] = 1;
    first["bed"] = BED_FOR_CHANNEL_1;
    first["bag_ml"] = BAG_SIZE_ML;
    first["volume_ml"] = roundf(bag1.volumeML * 10.0f) / 10.0f;
    first["flow_ml_h"] = roundf(bag1.flowMlH * 10.0f) / 10.0f;
  }
  if (bag2.sensorReady)
  {
    JsonObject second = bags.add<JsonObject>();
    second["channel"] = 2;
    second["bed"] = BED_FOR_CHANNEL_2;
    second["bag_ml"] = BAG_SIZE_ML;
    second["volume_ml"] = roundf(bag2.volumeML * 10.0f) / 10.0f;
    second["flow_ml_h"] = roundf(bag2.flowMlH * 10.0f) / 10.0f;
  }

  if (bags.size() == 0)
  {
    Serial.println(F("no clean sensor reading, nothing sent"));
    return false;
  }

  char payload[512];
  size_t length = serializeJson(doc, payload, sizeof(payload));

#if API_USE_TLS
  if (strlen(ROOT_CA_PEM) == 0)
  {
    Serial.println(F("HTTPS is enabled but ROOT_CA_PEM is empty"));
    return false;
  }
  WiFiClientSecure client;
  client.setCACert(ROOT_CA_PEM);
#else
  WiFiClient client;
#endif
  HTTPClient http;
  const String scheme = API_USE_TLS ? "https://" : "http://";
  const String url = scheme + String(API_HOST) + ":" + String(API_PORT) + API_PATH;

  if (!http.begin(client, url))
  {
    return false;
  }
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  // The device key identifies the unit. The server checks it against the
  // beds this unit was registered with.
  http.addHeader("X-Device-Key", SMARTIV_DEVICE_KEY);

  const int status = http.POST((uint8_t *)payload, length);
  http.end();

  if (status == 202)
  {
    if (consecutiveFailures > 0)
    {
      Serial.printf("recovered after %u failures\n", consecutiveFailures);
    }
    consecutiveFailures = 0;
    backoffMs = 0;
    return true;
  }

  consecutiveFailures++;
  Serial.printf("POST %s -> %d\n", url.c_str(), status);
  // 401 and 403 will not fix themselves, so do not hammer the server.
  backoffMs = (status == 401 || status == 403) ? 60000UL : (backoffMs ? backoffMs * 2 : 1000UL);
  if (backoffMs > 60000UL)
  {
    backoffMs = 60000UL;
  }
  return false;
}

// ============================================================
// 10. SETUP
// ============================================================

void setup()
{
  Serial.begin(115200);
  delay(800);

  Serial.println();
  Serial.println("==========================================");
  Serial.println("        SMART IV UNIT");
  Serial.printf("  unit %s  beds %d / %d\n", UNIT_LABEL, BED_FOR_CHANNEL_1, BED_FOR_CHANNEL_2);
  Serial.println("==========================================");

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  scale1.begin(HX1_DT, HX1_SCK);
  scale2.begin(HX2_DT, HX2_SCK);
  // Read once so the first real reading is not a warm-up artefact.
  scale1.tare();
  scale2.tare();
  delay(1000);

  Serial.print("HX711 #1: ");
  Serial.println(scale1.is_ready() ? "READY" : "NOT READY");
  Serial.print("HX711 #2: ");
  Serial.println(scale2.is_ready() ? "READY" : "NOT READY");

  Serial.print(F("connecting to "));
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int attempt = 0; attempt < 40 && WiFi.status() != WL_CONNECTED; attempt++)
  {
    delay(500);
    Serial.print('.');
  }
  if (WiFi.status() != WL_CONNECTED)
  {
    // Keep going: the buzzer still works, so an offline unit is not silent.
    Serial.println();
    Serial.println(F("Wi-Fi failed. Readings continue locally; the server will time this unit out."));
  }
  else
  {
    Serial.printf("\nconnected, ip %s\n", WiFi.localIP().toString().c_str());
    // TLS needs a correct clock.
    configTime(0, 0, NTP_SERVER);
    struct tm timeinfo;
    while (!getLocalTime(&timeinfo, 10000))
    {
      Serial.print('.');
    }
    Serial.println();
  }

  historyCount = 0;
  historyHead = 0;
  lastVolumeAtMs = 0;
  lastVolume[0] = -1.0f;
  lastVolume[1] = -1.0f;
}

// ============================================================
// 11. LOOP
// ============================================================

void loop()
{
  BagReading bag1;
  BagReading bag2;

  bag1.sensorReady = readBag(scale1, EMPTY_BAG_MASS_G_CHANNEL_1, CALIBRATION_FACTOR_CHANNEL_1, bag1.volumeML);
  bag2.sensorReady = readBag(scale2, EMPTY_BAG_MASS_G_CHANNEL_2, CALIBRATION_FACTOR_CHANNEL_2, bag2.volumeML);

  // The window advances once per loop, so both channels share the same tick.
  if (bag1.sensorReady)
  {
    bag1.flowMlH = averageFlow(0, bag1.volumeML);
  }
  if (bag2.sensorReady)
  {
    bag2.flowMlH = averageFlow(1, bag2.volumeML);
  }

  bag1.status = bag1.sensorReady ? statusFor(bag1.volumeML, bag1.flowMlH) : STATUS_SENSOR_ERROR;
  bag2.status = bag2.sensorReady ? statusFor(bag2.volumeML, bag2.flowMlH) : STATUS_SENSOR_ERROR;

  updateBuzzer(bag1.status, bag2.status);

  Serial.printf("CH1 %6.1f mL %5.1f mL/h %-13s", bag1.volumeML, bag1.flowMlH, statusToString(bag1.status));
  Serial.printf("  CH2 %6.1f mL %5.1f mL/h %-13s", bag2.volumeML, bag2.flowMlH, statusToString(bag2.status));
  Serial.println();

  const unsigned long now = millis();
  if (now - lastPostMs >= REPORT_INTERVAL_MS + backoffMs)
  {
    lastPostMs = now;
    sendReadings(bag1, bag2);
  }

  delay(200);
}
