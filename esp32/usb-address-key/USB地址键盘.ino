/*
 * 一键地址键盘 (ESP32-S3 / USB HID)
 * -----------------------------------------------------------------------------
 * 原理：ESP32-S3 插到手机上会被识别成普通 USB 键盘。
 *       按下一个物理键 → 键盘"打"出一小串 ASCII 触发词（如 dzx）
 *       → 手机输入法把这个触发词自动展开成完整的中文收货地址字段。
 *
 * 这样绕开了"键盘打不出中文"的死结：中文由输入法负责，硬件只发字母。
 *
 * 默认按键分配（对应收货地址表单的三个字段，可按需改 KEYS 表）：
 *   GPIO4  → dzx  (收件人姓名)
 *   GPIO5  → dzt  (手机号)
 *   GPIO6  → dzd  (详细地址：省市区+路名+门牌，一次填完)
 *   GPIO7  → 剪贴板粘贴 (Ctrl+V)，长按触发，用于临时粘一段文字
 *
 * 接线：按键一端接对应 GPIO，另一端接 GND（使用芯片内部上拉，不要接 3.3V）
 * 开发板：ESP32-S3-DevKitC-1 或任何带原生 USB 的 S3 板
 * 库：Arduino-ESP32 核心自带（USB.h / USBHIDKeyboard.h）
 */

#include "USB.h"
#include "USBHIDKeyboard.h"

USBHIDKeyboard Keyboard;

struct KeyDef {
  int         pin;
  const char* trigger;
  const char* label;
};

KeyDef KEYS[] = {
  { 4, "dzx", "姓名" },
  { 5, "dzt", "电话" },
  { 6, "dzd", "详细地址" },
};
const int KEY_COUNT = sizeof(KEYS) / sizeof(KEYS[0]);

const int PASTE_PIN        = 7;
const int LED_PIN          = 21;
const int DEBOUNCE_MS      = 30;
const int PASTE_HOLD_MS    = 1200;

bool     lastState[8];
uint32_t lastChange[8];
uint32_t pressStart = 0;
bool     pasteArmed = false;

void setup() {
  for (int i = 0; i < KEY_COUNT; i++) {
    pinMode(KEYS[i].pin, INPUT_PULLUP);
    lastState[i]  = HIGH;
    lastChange[i] = 0;
  }
  pinMode(PASTE_PIN, INPUT_PULLUP);

  if (LED_PIN >= 0) {
    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);
  }

  USB.begin();
  Keyboard.begin();

  delay(1200);
}

void blink(int times) {
  if (LED_PIN < 0) return;
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(60);
    digitalWrite(LED_PIN, LOW);
    delay(60);
  }
}

void sendTrigger(const char* text) {
  Keyboard.print(text);
  blink(1);
}

void sendPaste() {
  Keyboard.press(KEY_LEFT_CTRL);
  delay(80);
  Keyboard.press('v');
  delay(120);
  Keyboard.release('v');
  Keyboard.releaseAll();
  blink(3);
}

void loop() {
  for (int i = 0; i < KEY_COUNT; i++) {
    bool now = digitalRead(KEYS[i].pin);
    if (now != lastState[i]) {
      if (millis() - lastChange[i] > DEBOUNCE_MS) {
        lastChange[i] = millis();
        lastState[i]  = now;
        if (now == LOW) {
          sendTrigger(KEYS[i].trigger);
        }
      }
    }
  }

  bool pv = digitalRead(PASTE_PIN);
  if (pv == LOW) {
    if (!pasteArmed) {
      pasteArmed  = true;
      pressStart  = millis();
    } else if (millis() - pressStart > PASTE_HOLD_MS) {
      sendPaste();
      pasteArmed = false;
    }
  } else {
    pasteArmed = false;
  }

  delay(5);
}
