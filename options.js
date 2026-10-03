"use strict";

const apiKeyInput = document.getElementById("apiKey");
const keyStatus = document.getElementById("keyStatus");
const cacheStatus = document.getElementById("cacheStatus");
const saveButton = document.getElementById("saveKey");
const deleteButton = document.getElementById("deleteKey");
const testButton = document.getElementById("testKey");
const clearButton = document.getElementById("clearCache");

function setBusy(busy) {
  for (const button of [saveButton, deleteButton, testButton]) button.disabled = busy;
}

async function loadKey() {
  try {
    const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
    apiKeyInput.value = geminiApiKey || "";
    keyStatus.textContent = geminiApiKey ? "APIキーは保存されています。" : "APIキーは未設定です。";
  } catch (_) {
    keyStatus.textContent = "保存内容を読み込めませんでした。";
  }
}

saveButton.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyStatus.textContent = "APIキーを入力してください。";
    return;
  }
  setBusy(true);
  try {
    await chrome.storage.local.set({ geminiApiKey: key });
    keyStatus.textContent = "APIキーを保存しました。";
  } catch (_) {
    keyStatus.textContent = "APIキーを保存できませんでした。";
  } finally {
    setBusy(false);
  }
});

deleteButton.addEventListener("click", async () => {
  setBusy(true);
  try {
    await chrome.storage.local.remove("geminiApiKey");
    apiKeyInput.value = "";
    keyStatus.textContent = "APIキーを削除しました。";
  } catch (_) {
    keyStatus.textContent = "APIキーを削除できませんでした。";
  } finally {
    setBusy(false);
  }
});

testButton.addEventListener("click", async () => {
  setBusy(true);
  keyStatus.textContent = "接続テスト中…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
    if (!result?.ok) {
      keyStatus.textContent = result?.message || "接続テストに失敗しました。";
    } else if (result.model) {
      keyStatus.textContent = `接続成功。利用可能なモデル: ${result.model}`;
    } else {
      keyStatus.textContent = "接続成功。";
    }
  } catch (_) {
    keyStatus.textContent = "バックグラウンドとの通信に失敗しました。";
  } finally {
    setBusy(false);
  }
});

clearButton.addEventListener("click", async () => {
  clearButton.disabled = true;
  cacheStatus.textContent = "削除中…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "CLEAR_CACHE" });
    cacheStatus.textContent = result?.ok ? "翻訳キャッシュを削除しました。" : "キャッシュを削除できませんでした。";
  } catch (_) {
    cacheStatus.textContent = "キャッシュを削除できませんでした。";
  } finally {
    clearButton.disabled = false;
  }
});

loadKey();
