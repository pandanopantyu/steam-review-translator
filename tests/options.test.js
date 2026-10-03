"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../options.js"), "utf8");

function createOptions() {
  const values = new Map();
  const nodes = new Map();
  for (const id of ["apiKey", "keyStatus", "cacheStatus", "saveKey", "deleteKey", "testKey", "clearCache"]) {
    nodes.set(id, { value: "", textContent: "", disabled: false, handlers: new Map(),
      addEventListener(type, fn) { this.handlers.set(type, fn); },
      async click() { await this.handlers.get("click")?.(); } });
  }
  const chrome = {
    storage: { local: {
      async get(key) { return values.has(key) ? { [key]: values.get(key) } : {}; },
      async set(items) { for (const [key, value] of Object.entries(items)) values.set(key, value); },
      async remove(key) { values.delete(key); }
    } },
    runtime: { async sendMessage(message) {
      if (message.type === "TEST_CONNECTION") return { ok: true, model: "gemini-3.1-flash-lite" };
      if (message.type === "CLEAR_CACHE") return { ok: true };
      return { ok: false };
    } }
  };
  vm.runInNewContext(source, { document: { getElementById(id) { return nodes.get(id); } }, chrome },
    { filename: "options.js" });
  return { values, nodes };
}

test("設定画面でAPIキーを保存・接続確認・削除できる", async () => {
  const { values, nodes } = createOptions();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.get("keyStatus").textContent, "APIキーは未設定です。");
  nodes.get("apiKey").value = "test-gemini-key";
  await nodes.get("saveKey").click();
  assert.equal(values.get("geminiApiKey"), "test-gemini-key");
  await nodes.get("testKey").click();
  assert.match(nodes.get("keyStatus").textContent, /gemini-3\.1-flash-lite/);
  await nodes.get("deleteKey").click();
  assert.equal(values.has("geminiApiKey"), false);
  assert.equal(nodes.get("apiKey").value, "");
});
