"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../content.js"), "utf8");

class TextNode {
  constructor(value) { this.nodeType = 3; this.nodeValue = value; this.parentElement = null; }
  get isConnected() { return this.parentElement?.isConnected || false; }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
}

class Element {
  constructor(tagName, id = "") {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.childNodes = [];
    this.parentElement = null;
    this.hidden = false;
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: value => this.classes.add(value),
      remove: value => this.classes.delete(value),
      contains: value => this.classes.has(value),
      toggle: (value, force) => { if (force) this.classes.add(value); else this.classes.delete(value); }
    };
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get isConnected() { return this.tagName === "HTML" || !!this.parentElement?.isConnected; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get nextSibling() { return this.parentElement?.childNodes[this.parentElement.childNodes.indexOf(this) + 1] || null; }
  get nextElementSibling() {
    const siblings = this.parentElement?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get textContent() { return this.childNodes.map(node => node.nodeType === 3 ? node.nodeValue : node.textContent).join(""); }
  set textContent(value) {
    for (const child of this.childNodes) child.parentElement = null;
    this.childNodes = [new TextNode(value)];
    this.childNodes[0].parentElement = this;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove?.();
      node.parentElement = this;
      this.childNodes.push(node);
    }
  }
  insertBefore(node, reference) {
    node.remove?.();
    node.parentElement = this;
    this.childNodes.splice(this.childNodes.indexOf(reference), 0, node);
  }
  after(node) {
    const siblings = this.parentElement.childNodes;
    node.remove?.();
    node.parentElement = this.parentElement;
    siblings.splice(siblings.indexOf(this) + 1, 0, node);
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  querySelector(selector) {
    if (selector.startsWith(":scope > .")) {
      const className = selector.slice(10);
      return this.children.find(node => node.classList.contains(className)) || null;
    }
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const nodes = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return nodes;
    if (selector === 'a[href*="/recommended/"]') {
      return nodes.filter(node => node.tagName === "A" && node.getAttribute("href")?.includes("/recommended/"));
    }
    if (selector === "button,textarea,input") {
      return nodes.filter(node => /^(?:BUTTON|TEXTAREA|INPUT)$/.test(node.tagName));
    }
    if (selector.includes(",")) {
      const selectors = selector.split(",");
      return nodes.filter(node => selectors.some(part =>
        /^[a-z]+$/i.test(part) ? node.tagName === part.toUpperCase() :
        part.startsWith(".") ? node.classList.contains(part.slice(1)) :
        part === "[role='button']" && node.getAttribute("role") === "button"));
    }
    return [];
  }
  closest(selector) {
    if (selector === "a[href]") {
      let node = this;
      while (node) {
        if (node.tagName === "A" && node.getAttribute("href")) return node;
        node = node.parentElement;
      }
    }
    return null;
  }
  getAttribute(key) { return this.attributes.get(key) || null; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  click() {
    this.listeners.get("click")?.({ preventDefault() {}, stopPropagation() {} });
  }
}

function setup(initialText = "This is a very hot song!!! 🔥", targets = {}, { deferTranslations = false } = {}) {
  const html = new Element("html");
  const body = new Element("div", "ReviewText");
  body.textContent = initialText;
  html.append(body);
  for (const node of Object.values(targets).flat()) {
    if (!node.parentElement) html.append(node);
  }
  let observer;
  let calls = 0;
  const requestedTexts = [];
  const requestedBatches = [];
  const pendingResponses = [];
  const document = {
    documentElement: html,
    createElement(tag) { return new Element(tag); },
    querySelector(selector) {
      return targets[selector]?.[0] || null;
    },
    querySelectorAll(selector) {
      if (selector === "#ReviewText") return html.children.filter(node => node.id === "ReviewText");
      return targets[selector] || [];
    }
  };
  const chrome = {
    runtime: {
      sendMessage(message, callback) {
        if (message.type === "TRANSLATE_TEXT" || message.type === "TRANSLATE_BATCH") {
          calls += 1;
          const texts = message.type === "TRANSLATE_BATCH" ? Array.from(message.texts) : [message.text];
          requestedTexts.push(...texts);
          if (message.type === "TRANSLATE_BATCH") requestedBatches.push(texts);
          if (deferTranslations) pendingResponses.push(callback);
          else queueMicrotask(() => callback(message.type === "TRANSLATE_BATCH"
            ? { ok: true, texts: texts.map(() => "これはとてもホットな曲です!!! 🔥") }
            : { ok: true, text: "これはとてもホットな曲です!!! 🔥" }));
        }
      },
      lastError: null
    }
  };
  class MutationObserver { constructor(callback) { observer = callback; } observe() {} }
  vm.runInNewContext(source, { document, chrome, MutationObserver, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    HTMLElement: Element, window: { setTimeout }, setTimeout }, { filename: "content.js" });
  return { html, body, observer: () => observer, calls: () => calls, requestedTexts, requestedBatches,
    respondNext(result) {
      assert.ok(pendingResponses.length, "未完了の翻訳要求が必要です");
      pendingResponses.shift()(result);
    }
  };
}

async function rescan(app) {
  app.observer()();
  await new Promise(resolve => setTimeout(resolve, 220));
}

// 前の調査で確認した現在のSteamストアDOM。生成クラス名は省き、
// 無料製品ラベル、本文Panel、PC仕様、投票Panelの入れ子を再現する。
function storeCard(text, { labels = [], expandable = false } = {}) {
  const card = new Element("div");
  const link = new Element("a");
  link.setAttribute("href", "https://steamcommunity.com/id/fixture/recommended/1285190/");
  link.textContent = "Private Steam User";
  const details = new Element("div");
  const date = new Element("div");
  const dateText = new Element("div");
  dateText.textContent = "投稿日：9月13日";
  date.append(dateText, new Element("div"));
  details.append(date);
  const labelElements = labels.map(text => {
    const label = new Element("div");
    label.textContent = text;
    details.append(label);
    return label;
  });
  const area = new Element("div");
  area.className = "Panel Focusable";
  const wrapper = new Element("div");
  const body = new Element("div");
  body.textContent = text;
  wrapper.append(body);
  area.append(wrapper);
  const expand = new Element("button");
  expand.textContent = "詳細を読む";
  let expansions = 0;
  expand.addEventListener("click", () => { expansions += 1; });
  if (expandable) area.append(expand);
  const specs = new Element("div");
  const specsLabel = new Element("div");
  specsLabel.textContent = "レビュアーのPCの仕様：";
  const os = new Element("div");
  os.textContent = "Windows 11";
  specs.append(specsLabel, os);
  const votes = new Element("div");
  votes.className = "Panel Focusable";
  const voteLabel = new Element("div");
  voteLabel.textContent = "このレビューは参考になりましたか？";
  const voteButtons = new Element("div");
  const yes = new Element("button");
  yes.textContent = "はい";
  let votesClicked = 0;
  yes.addEventListener("click", () => { votesClicked += 1; });
  voteButtons.append(yes);
  votes.append(voteLabel, voteButtons);
  details.append(area, specs, new Element("hr"), votes);
  card.append(link, details);
  return { card, body, area, wrapper, labels: labelElements, specs, yes, expand,
    expansions: () => expansions, votesClicked: () => votesClicked };
}

test("詳細を読むボタンがある長いストアレビューも検出して既存操作を維持する", async () => {
  const root = new Element("div", "app_reviews_hash");
  const item = storeCard("The complete long review.\nWith additional paragraphs.",
    { labels: ["無料で入手した製品"], expandable: true });
  root.append(item.card);
  const app = setup("", { "#app_reviews_hash": [root] });
  const action = item.area.children.find(node => node.classList.contains("srt-controls"))?.firstElementChild;
  assert.ok(action);
  action.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["The complete long review.\nWith additional paragraphs."]);
  item.expand.click();
  assert.equal(item.expansions(), 1);
  assert.equal(item.expand.parentElement, item.area);
  assert.equal(item.expand.classList.contains("srt-hidden"), false);
  await rescan(app);
  assert.equal(item.area.children.filter(node => node.classList.contains("srt-controls")).length, 1);
});

test("ストアの無料製品・早期アクセス表示の有無にかかわらず本文だけを検出する", async () => {
  const root = new Element("div", "app_reviews_hash");
  const cards = [
    storeCard("A fun game."),
    storeCard("'Borderlands 4 is a premium game made for premium gamers'", { labels: ["無料で入手した製品"] }),
    storeCard("Очень интересная игра.", { labels: ["早期アクセスレビュー", "無料で入手した製品"] }),
    storeCard("这是一个非常有趣的游戏。", { labels: ["無料で入手した製品"] }),
    storeCard("これは面白いゲームです。", { labels: ["無料で入手した製品"] })
  ];
  root.append(...cards.map(item => item.card));
  const app = setup("", { "#app_reviews_hash": [root] });
  for (const item of cards.slice(0, 4)) {
    const controls = item.area.children.filter(node => node.classList.contains("srt-controls"));
    assert.equal(controls.length, 1);
    controls[0].firstElementChild.click();
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cards[4].area.children.some(node => node.classList.contains("srt-controls")), false);
  assert.deepEqual(app.requestedTexts, cards.slice(0, 4).map(item => item.body.textContent));
  assert.equal(app.requestedTexts.join(" ").includes("Private Steam User"), false);
  assert.equal(app.requestedTexts.join(" ").includes("Windows 11"), false);
  for (const item of cards.slice(0, 4)) {
    assert.equal(item.body.classList.contains("srt-hidden"), true);
    assert.equal(item.specs.classList.contains("srt-hidden"), false);
    for (const label of item.labels) assert.equal(label.classList.contains("srt-hidden"), false);
    item.yes.click();
    assert.equal(item.votesClicked(), 1, "Steamの既存イベントを維持する");
  }
  await rescan(app);
  for (const item of cards.slice(0, 4)) {
    assert.equal(item.area.children.filter(node => node.classList.contains("srt-controls")).length, 1);
    const action = item.area.children.find(node => node.classList.contains("srt-controls")).firstElementChild;
    action.click();
    assert.equal(item.body.classList.contains("srt-hidden"), false);
    action.click();
    assert.equal(item.body.classList.contains("srt-hidden"), true);
  }
  assert.equal(app.calls(), 4, "切り替えと再走査ではAPIを再呼び出ししない");
});

test("ストアへの動的なレビュー追加・本文変更にもリンクが重複しない", async () => {
  const root = new Element("div", "app_reviews_hash");
  const app = setup("", { "#app_reviews_hash": [root] });
  const item = storeCard("A newly loaded review.", { labels: ["無料で入手した製品"] });
  root.append(item.card);
  await rescan(app);
  let controls = item.area.children.filter(node => node.classList.contains("srt-controls"));
  assert.equal(controls.length, 1);
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  item.body.textContent = "Expanded review with the full text.";
  await rescan(app);
  controls = item.area.children.filter(node => node.classList.contains("srt-controls"));
  assert.equal(controls.length, 1);
  assert.equal(controls[0].firstElementChild.textContent, "日本語に翻訳");
  assert.equal(item.body.classList.contains("srt-hidden"), false);
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["A newly loaded review.", "Expanded review with the full text."]);
});

test("未翻訳応答のエラーでは原文を残し、手動再試行だけを送る", async () => {
  const app = setup(undefined, {}, { deferTranslations: true });
  const controls = app.html.children.find(node => node.classList.contains("srt-controls"));
  const action = controls.firstElementChild;
  action.click();
  action.click();
  assert.equal(app.calls(), 1);
  app.respondNext({ ok: false, code: "UNTRANSLATED", message: "日本語への翻訳を確認できませんでした。" });
  assert.equal(action.textContent, "再試行");
  assert.equal(action.getAttribute("aria-disabled"), null);
  assert.equal(app.body.classList.contains("srt-hidden"), false);
  assert.equal(app.body.nextSibling.hidden, true);
  assert.match(controls.textContent, /翻訳を確認できません/);
  await rescan(app);
  assert.equal(app.calls(), 1, "自動再試行しない");
  action.click();
  app.respondNext({ ok: true, text: "これはとてもホットな曲です!!! 🔥" });
  assert.equal(app.body.classList.contains("srt-hidden"), true);
  action.click();
  action.click();
  assert.equal(app.calls(), 2);
});

test("翻訳待ち中にUIを再作成しても古い応答が本文を隠さない", async () => {
  const app = setup(undefined, {}, { deferTranslations: true });
  const oldTranslation = app.body.nextSibling;
  const oldControls = app.html.children.find(node => node.classList.contains("srt-controls"));
  oldControls.firstElementChild.click();
  oldTranslation.remove();
  oldControls.remove();
  await rescan(app);
  const currentTranslation = app.body.nextSibling;
  const currentAction = app.html.children.find(node => node.classList.contains("srt-controls")).firstElementChild;
  currentAction.click();
  app.respondNext({ ok: true, text: "古い応答" });
  assert.equal(app.body.classList.contains("srt-hidden"), false);
  assert.equal(currentTranslation.hidden, true);
  assert.equal(currentAction.textContent, "翻訳中…");
  app.respondNext({ ok: true, text: "現在の応答" });
  assert.equal(app.body.classList.contains("srt-hidden"), true);
  assert.equal(currentTranslation.hidden, false);
  assert.equal(currentTranslation.textContent, "現在の応答");
  currentAction.click();
  currentAction.click();
  assert.equal(app.calls(), 2);
});

test("UIが切り離された直後の応答も無視する", () => {
  const app = setup(undefined, {}, { deferTranslations: true });
  const controls = app.html.children.find(node => node.classList.contains("srt-controls"));
  controls.firstElementChild.click();
  controls.remove();
  app.respondNext({ ok: true, text: "切り離されたUIへの応答" });
  assert.equal(app.body.classList.contains("srt-hidden"), false);
  assert.equal(app.body.nextSibling.hidden, true);
});

test("レビュー本文だけを差し替えても古い訳文とリンクを残さない", async () => {
  const app = setup();
  const oldTranslation = app.body.nextSibling;
  const oldControls = app.html.children.find(node => node.classList.contains("srt-controls"));
  oldControls.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  app.body.remove();
  const next = new Element("div", "ReviewText");
  next.textContent = "A replacement review";
  app.html.append(next);
  await rescan(app);
  assert.equal(oldTranslation.isConnected, false);
  assert.equal(oldControls.isConnected, false);
  assert.equal(app.body.classList.contains("srt-hidden"), false);
  const controls = app.html.children.filter(node => node.classList.contains("srt-controls"));
  assert.equal(controls.length, 1);
  assert.equal(app.html.children.filter(node => node.classList.contains("srt-translation")).length, 1);
  oldControls.firstElementChild.click();
  assert.equal(app.calls(), 1, "古いリンクから再送しない");
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requestedTexts[1], "A replacement review");
  assert.equal(next.classList.contains("srt-hidden"), true);
});

test("返信本文の削除時にも追加UIを後始末する", async () => {
  const comment = new Element("div");
  comment.textContent = "An old reply";
  const comments = [comment];
  const app = setup("", { ".commentthread_comment_text": comments });
  const oldControls = app.html.children.find(node => node.classList.contains("srt-controls"));
  comment.remove();
  const next = new Element("div");
  next.textContent = "A new reply";
  comments.splice(0, 1, next);
  app.html.append(next);
  await rescan(app);
  assert.equal(oldControls.isConnected, false);
  const controls = app.html.children.filter(node => node.classList.contains("srt-controls"));
  assert.equal(controls.length, 1);
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["A new reply"]);
});

test("個別レビューで本文をその場で切り替え、APIを再呼び出ししない", async () => {
  const app = setup();
  let controls = app.html.children.find(node => node.classList.contains("srt-controls"));
  assert.ok(controls);
  assert.equal(controls.firstElementChild.textContent, "日本語に翻訳");
  controls.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls(), 1);
  assert.ok(app.body.classList.contains("srt-hidden"));
  assert.equal(app.body.nextSibling.textContent, "これはとてもホットな曲です!!! 🔥");
  assert.equal(controls.firstElementChild.textContent, "原文を見る（Geminiによる翻訳）");
  assert.equal(app.body.nextSibling.nextSibling, controls);
  controls.firstElementChild.click();
  assert.equal(app.body.classList.contains("srt-hidden"), false);
  assert.equal(controls.firstElementChild.textContent, "日本語訳を見る（Geminiによる翻訳）");
  controls.firstElementChild.click();
  assert.equal(app.calls(), 1);
  assert.ok(app.body.classList.contains("srt-hidden"));
});

test("DOM再描画後の新しい本文にもリンクを1個だけ追加する", async () => {
  const app = setup();
  for (const child of [...app.html.children]) child.remove();
  const next = new Element("div", "ReviewText");
  next.textContent = "Another review";
  app.html.append(next);
  app.observer()();
  await new Promise(resolve => setTimeout(resolve, 220));
  app.observer()();
  await new Promise(resolve => setTimeout(resolve, 220));
  const controls = app.html.children.filter(node => node.classList.contains("srt-controls"));
  assert.equal(controls.length, 1);
  assert.equal(controls[0].firstElementChild.textContent, "日本語に翻訳");
});

test("本文が展開・変更されたら古い訳文を無効にする", async () => {
  const app = setup();
  const action = app.html.children.find(node => node.classList.contains("srt-controls")).firstElementChild;
  action.click();
  await new Promise(resolve => setImmediate(resolve));
  app.body.textContent = "Expanded review with more details.";
  app.observer()();
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(app.body.classList.contains("srt-hidden"), false);
  assert.equal(action.textContent, "日本語に翻訳");
  action.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls(), 2);
});

test("日本語レビューには翻訳リンクを出さない", () => {
  const app = setup("これはとても面白いゲームです。");
  assert.equal(app.html.children.some(node => node.classList.contains("srt-controls")), false);
});

test("詳細ポップアップのReviewText内にあるbb_h1と改行を本文として扱う", async () => {
  const app = setup("");
  const heading = new Element("div");
  heading.className = "bb_h1";
  heading.append(new TextNode("A great game"), new Element("br"), new TextNode("with friends!"));
  app.body.append(heading);
  app.observer()();
  await new Promise(resolve => setTimeout(resolve, 220));
  const controls = app.html.children.filter(node => node.classList.contains("srt-controls"));
  assert.equal(controls.length, 1);
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls(), 1);
  assert.equal(app.requestedTexts[0], "A great game\nwith friends!");
  assert.ok(app.body.classList.contains("srt-hidden"));
});

test("スレッド一覧ではタイトルのみを翻訳し、作者名とピン留め表示を残す", async () => {
  const row = new Element("div");
  const title = new Element("div");
  title.className = "forum_topic_name";
  const label = new Element("span");
  label.className = "forum_topic_label";
  label.textContent = "ピン留め:";
  title.append(label, new TextNode("Status and Known Issues"));
  const author = new Element("div");
  author.className = "forum_topic_op";
  author.textContent = "AuthorName";
  row.append(title, author);
  const app = setup("", { ".forum_topic_name": [title], ".test-root": [row] });
  const action = author.children.find(node => node.classList.contains("srt-controls"))?.firstElementChild;
  assert.ok(action);
  action.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requestedTexts[0], "Status and Known Issues");
  assert.equal(label.textContent, "ピン留め:");
  assert.ok(author.textContent.includes("AuthorName"));
});

test("Steamがスレッドタイトルを再描画しても古いリンクを残さない", async () => {
  const row = new Element("div");
  const title = new Element("div");
  title.className = "forum_topic_name";
  title.textContent = "First topic";
  const author = new Element("div");
  author.className = "forum_topic_op";
  author.textContent = "AuthorName";
  row.append(title, author);
  const app = setup("", { ".forum_topic_name": [title], ".test-root": [row] });
  assert.equal(author.children.filter(node => node.classList.contains("srt-controls")).length, 1);
  title.textContent = "Updated topic";
  app.observer()();
  await new Promise(resolve => setTimeout(resolve, 220));
  const controls = author.children.filter(node => node.classList.contains("srt-controls"));
  assert.equal(controls.length, 1);
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requestedTexts[0], "Updated topic");
});

test("ガイド本文と返信は個別に翻訳し、引用の作者名を送らない", async () => {
  const section = new Element("div");
  section.className = "subSectionDesc";
  section.append(new TextNode("Use smoke grenades"), new Element("br"), new TextNode("Revive your team."));
  const comment = new Element("div");
  comment.className = "commentthread_comment_text";
  const quote = new Element("blockquote");
  const attribution = new Element("div");
  attribution.className = "bb_quoteauthor";
  attribution.textContent = "SteamUser の投稿を引用：";
  quote.append(attribution, new TextNode("An earlier comment."));
  const profile = new Element("a");
  profile.setAttribute("href", "https://steamcommunity.com/id/private-name/");
  profile.textContent = "PrivateName";
  comment.append(quote, new TextNode("I agree."), profile);
  const app = setup("", {
    ".subSectionDesc": [section],
    ".commentthread_comment_text": [comment]
  });
  const controls = app.html.children.filter(node => node.classList.contains("srt-controls"));
  assert.equal(controls.length, 2);
  for (const control of controls) control.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["Use smoke grenades\nRevive your team.", "An earlier comment.\nI agree."]);
  assert.equal(app.requestedTexts.join(" ").includes("SteamUser"), false);
  assert.equal(app.requestedTexts.join(" ").includes("PrivateName"), false);
});

test("ガイド一覧の翻訳リンクを作品リンクの内側に入れない", () => {
  const card = new Element("div");
  const anchor = new Element("a");
  anchor.setAttribute("href", "https://steamcommunity.com/sharedfiles/filedetails/?id=123");
  const title = new Element("div");
  title.className = "workshopItemTitle";
  title.textContent = "How to play together";
  anchor.append(title);
  card.append(anchor);
  const app = setup("", { ".workshopItemTitle": [title], ".test-root": [card] });
  assert.equal(anchor.children.some(node => node.classList.contains("srt-controls")), false);
  assert.equal(card.children.some(node => node.classList.contains("srt-controls")), true);
  assert.equal(app.html.children.includes(card), true);
});

test("ストアの説明見出しを残し、説明本文だけを翻訳する", async () => {
  const description = new Element("div", "game_area_description");
  const heading = new Element("h2");
  heading.textContent = "このゲームについて";
  description.append(heading, new TextNode("Explore a mysterious island."), new Element("br"),
    new TextNode("Play with friends."));
  const app = setup("", { "#game_area_description": [description] });
  const action = description.children.find(node => node.classList.contains("srt-controls"))?.firstElementChild;
  assert.ok(action);
  action.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requestedTexts[0], "Explore a mysterious island.\nPlay with friends.");
  assert.equal(heading.textContent, "このゲームについて");
  assert.equal(action.textContent, "原文を見る（Geminiによる翻訳）");
});

test("日本語のストア説明文はDOMを移動せずリンクも追加しない", () => {
  const description = new Element("div", "game_area_description");
  const heading = new Element("h2");
  heading.textContent = "このゲームについて";
  const original = new TextNode("これは協力プレイが楽しいゲームです。");
  description.append(heading, original);
  setup("", { "#game_area_description": [description] });
  assert.equal(description.childNodes[1], original);
  assert.equal(description.children.some(node => node.classList.contains("srt-controls")), false);
});

test("動的に追加されたニュース記事の段落も検出する", async () => {
  const paragraphs = [];
  const app = setup("", { ".EventDetailsBody [role='paragraph']": paragraphs });
  const paragraph = new Element("div");
  paragraph.textContent = "A new update is available.";
  app.html.append(paragraph);
  paragraphs.push(paragraph);
  app.observer()();
  await new Promise(resolve => setTimeout(resolve, 220));
  const controls = app.html.children.filter(node => node.classList.contains("srt-controls"));
  assert.equal(controls.length, 1);
});

function descendantsWithClass(root, className) {
  return root.querySelectorAll("*").filter(node => node.classList.contains(className));
}

function assertVisibleAncestors(node) {
  for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
    assert.equal(ancestor.hidden, false, `${ancestor.tagName}をhiddenにしない`);
    assert.equal(ancestor.classList.contains("srt-hidden"), false, `${ancestor.tagName}を丸ごと隠さない`);
  }
}

// Slay the Spireの実ページで確認した動画・再生コントロールの構造。
function steamVideo() {
  const wrapper = new Element("span");
  wrapper.className = "bb_img_ctn";
  const video = new Element("video");
  video.className = "bb_img";
  video.currentTime = 12.5;
  video.paused = false;
  const sources = [new Element("source"), new Element("source")];
  video.append(...sources);
  const icons = new Element("div");
  icons.className = "bb_img_icons";
  const pause = new Element("div");
  pause.className = "bb_img_play_pause playing";
  pause.setAttribute("role", "button");
  const icon = new Element("img");
  icon.setAttribute("alt", "Pause animation");
  pause.append(icon);
  pause.addEventListener("click", () => { video.paused = !video.paused; });
  icons.append(pause);
  wrapper.append(video, icons);
  return { wrapper, video, sources, icons, pause, icon };
}

test("リンク1つでストア説明全文を切り替え、4本の動画と見出し・箇条書きを保持する", async () => {
  const description = new Element("div", "game_area_description");
  const title = new Element("h2");
  title.textContent = "About This Game";
  const videos = Array.from({ length: 4 }, steamVideo);
  const heading = new Element("h2");
  const strong = new Element("strong");
  strong.textContent = "Features";
  heading.append(strong);
  const list = new Element("ul");
  list.className = "bb_ul";
  const first = new Element("li");
  const italic = new Element("i");
  italic.textContent = "Dynamic Deck Building";
  first.append(italic, new TextNode(": Choose your cards wisely!"), new Element("br"));
  const second = new Element("li");
  second.textContent = "Discover powerful relics.";
  list.append(first, second);
  const paragraph = new Element("p");
  paragraph.textContent = "Play with friends. 🔥";
  description.append(new TextNode("\n"), title, videos[0].wrapper, new Element("br"),
    new TextNode("We fused card games and roguelikes."), new Element("br"),
    videos[1].wrapper, heading, list, videos[2].wrapper, paragraph, videos[3].wrapper);
  const app = setup("", { "#game_area_description": [description] });
  const controls = descendantsWithClass(description, "srt-controls");
  assert.equal(controls.length, 1);
  assert.equal(app.calls(), 0, "動画・文章の検出だけではAPIを使わない");
  assert.equal(title.nextElementSibling, controls[0], "折りたたみで隠れないよう主見出しの直後に置く");
  for (const control of controls) control.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["We fused card games and roguelikes.", "Features",
    "Dynamic Deck Building: Choose your cards wisely!", "Discover powerful relics.", "Play with friends. 🔥"]);
  assert.equal(title.textContent, "About This Game");
  assert.equal(descendantsWithClass(title, "srt-controls").length, 0);
  assert.equal(descendantsWithClass(heading, "srt-controls").length, 0, "DIVの操作UIをH2に入れない");
  assert.equal(descendantsWithClass(paragraph, "srt-controls").length, 0, "DIVの操作UIをPに入れない");
  assert.deepEqual(list.children, [first, second], "ULとLIを維持する");
  assert.equal(italic.isConnected, true, "原文のインライン装飾を保持する");
  for (const media of videos) {
    assert.equal(media.wrapper.parentElement, description);
    assert.equal(media.video.parentElement, media.wrapper);
    assert.deepEqual(media.video.children, media.sources);
    assert.equal(media.pause.parentElement, media.icons);
    assert.equal(media.video.currentTime, 12.5, "再生位置を初期化しない");
    assertVisibleAncestors(media.video);
    assertVisibleAncestors(media.pause);
    media.pause.click();
    assert.equal(media.video.paused, true, "Steam側の元のクリックリスナーを残す");
    media.pause.click();
    assert.equal(media.video.paused, false);
  }
  for (const control of controls) {
    control.firstElementChild.click();
    assert.equal(control.firstElementChild.textContent, "日本語訳を見る（Geminiによる翻訳）");
    control.firstElementChild.click();
  }
  await rescan(app);
  assert.equal(descendantsWithClass(description, "srt-controls").length, 1);
  assert.equal(descendantsWithClass(description, "srt-media-text").length, 5);
  assert.equal(app.calls(), 1, "全文の翻訳要求は1回、切り替えと再走査では送らない");
  assert.equal(app.requestedBatches.length, 1);
  assert.equal(app.requestedBatches[0].length, 5);
  controls[0].firstElementChild.click();
  assert.equal(italic.parentElement.classList.contains("srt-hidden"), false);
  assert.equal(first.textContent.startsWith("Dynamic Deck Building: Choose your cards wisely!"), true);
});

test("ガイド内の画像・iframe・音声・操作ラベルを文章から分離して保持する", async () => {
  const section = new Element("div");
  const paragraph = new Element("p");
  paragraph.textContent = "Explore this area.";
  const mediaGroup = new Element("div");
  const picture = new Element("picture");
  const image = new Element("img");
  image.setAttribute("alt", "A screenshot that must not be sent");
  picture.append(image);
  const frame = new Element("iframe");
  frame.textContent = "An embedded player fallback";
  const audio = new Element("audio");
  audio.textContent = "Audio fallback text";
  const button = new Element("button");
  button.textContent = "Play video";
  const roleButton = new Element("div");
  roleButton.setAttribute("role", "button");
  roleButton.textContent = "Pause animation";
  mediaGroup.append(picture, frame, audio, button, roleButton);
  const after = new Element("p");
  after.textContent = "Then turn left.";
  section.append(paragraph, mediaGroup, after);
  const app = setup("", { ".subSectionDesc": [section] });
  const controls = descendantsWithClass(app.html, "srt-controls");
  assert.equal(controls.length, 1);
  for (const control of controls) control.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["Explore this area.", "Then turn left."]);
  assert.equal(image.parentElement, picture);
  for (const media of [picture, frame, audio, button, roleButton]) {
    assert.equal(media.parentElement, mediaGroup);
    assertVisibleAncestors(media);
  }
  await rescan(app);
  assert.equal(descendantsWithClass(app.html, "srt-controls").length, 1);
  assert.equal(app.calls(), 1);
});

test("媒体のみ・日本語だけの説明欄にはリンクを出さずDOMも動かさない", async () => {
  const description = new Element("div", "game_area_description");
  const heading = new Element("h2");
  heading.textContent = "このゲームについて";
  const video = steamVideo();
  const text = new TextNode("これは協力プレイが楽しいゲームです。");
  description.append(heading, video.wrapper, text);
  const originalNodes = [...description.childNodes];
  const app = setup("", { "#game_area_description": [description] });
  await rescan(app);
  assert.deepEqual(description.childNodes, originalNodes);
  assert.equal(descendantsWithClass(description, "srt-controls").length, 0);
  assert.equal(app.calls(), 0);
});

test("コミュニティレビューの動画を動かさず、投稿日を翻訳に含めない", async () => {
  const card = new Element("div");
  const date = new Element("div");
  date.className = "date_posted";
  date.textContent = "Posted: October 1";
  const video = steamVideo();
  card.append(date, new TextNode("This is a great game."), video.wrapper, new TextNode("Watch the clip."));
  const app = setup("", { ".apphub_CardTextContent": [card] });
  for (const control of descendantsWithClass(app.html, "srt-controls")) control.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["This is a great game.", "Watch the clip."]);
  assert.equal(date.parentElement, card);
  assert.equal(video.wrapper.parentElement, card);
  assertVisibleAncestors(video.video);
  await rescan(app);
  assert.equal(descendantsWithClass(app.html, "srt-controls").length, 1);
});

test("翻訳済みの説明欄に動画が追加されたら本文を分割し、プレイヤーを再表示する", async () => {
  const description = new Element("div", "game_area_description");
  const heading = new Element("h2");
  heading.textContent = "About This Game";
  description.append(heading, new TextNode("An adventure awaits."));
  const app = setup("", { "#game_area_description": [description] });
  const oldBody = description.children.find(node => node.classList.contains("srt-original"));
  const oldControl = descendantsWithClass(description, "srt-controls")[0];
  oldControl.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(oldBody.classList.contains("srt-hidden"), true);
  const video = steamVideo();
  oldBody.append(video.wrapper, new TextNode("New content is available."));
  await rescan(app);
  assert.equal(oldControl.isConnected, false);
  assert.equal(oldBody.classList.contains("srt-hidden"), false);
  assert.equal(video.wrapper.parentElement, oldBody, "追加先の親を変えない");
  assertVisibleAncestors(video.video);
  const controls = descendantsWithClass(description, "srt-controls");
  assert.equal(controls.length, 1);
  for (const control of controls) control.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["An adventure awaits.", "An adventure awaits.", "New content is available."]);
  assertVisibleAncestors(video.video);
});

test("翻訳応答直前に挿入された動画も古い応答で隠さない", async () => {
  const app = setup("A review with a clip.", {}, { deferTranslations: true });
  const oldControl = descendantsWithClass(app.html, "srt-controls")[0];
  oldControl.firstElementChild.click();
  const video = steamVideo();
  app.body.append(video.wrapper, new TextNode("The clip explains it."));
  app.respondNext({ ok: true, text: "古い応答" });
  assert.equal(oldControl.isConnected, false);
  assertVisibleAncestors(video.video);
  await rescan(app);
  const controls = descendantsWithClass(app.html, "srt-controls");
  assert.equal(controls.length, 1);
  for (const control of controls) {
    assert.equal(control.firstElementChild.textContent, "日本語に翻訳");
    control.firstElementChild.click();
    app.respondNext({ ok: true, texts: ["新しい訳文", "次の文章の訳文"] });
  }
  assertVisibleAncestors(video.video);
  assert.equal(app.calls(), 2);
});

test("動画の動的な追加・削除後も親子で重複した翻訳を作らない", async () => {
  const description = new Element("div", "game_area_description");
  const firstVideo = steamVideo();
  description.append(firstVideo.wrapper, new TextNode("First part."));
  const app = setup("", { "#game_area_description": [description] });
  const outerPiece = descendantsWithClass(description, "srt-media-text")[0];
  const oldControl = descendantsWithClass(description, "srt-controls")[0];
  oldControl.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  const secondVideo = steamVideo();
  outerPiece.append(secondVideo.wrapper, new TextNode("Second part."));
  await rescan(app);
  assert.equal(oldControl.isConnected, true, "一括切り替えリンクを維持する");
  assert.equal(secondVideo.wrapper.parentElement, outerPiece);
  assertVisibleAncestors(secondVideo.video);
  firstVideo.wrapper.remove();
  secondVideo.wrapper.remove();
  await rescan(app);
  await rescan(app);
  const controls = descendantsWithClass(description, "srt-controls");
  assert.equal(controls.length, 1);
  assert.equal(outerPiece.classList.contains("srt-hidden"), false);
  for (const control of controls) control.firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["First part.", "First part.", "Second part."]);
  assert.equal(outerPiece.classList.contains("srt-hidden"), false, "分割した親を隠さない");
  assert.equal(descendantsWithClass(description, "srt-translation").length, 2);
});

test("媒体を含む段落の再描画時に古いUIと応答を破棄し、新しい文章を検出する", async () => {
  const description = new Element("div", "game_area_description");
  const video = steamVideo();
  const paragraph = new Element("p");
  paragraph.textContent = "An older paragraph.";
  description.append(video.wrapper, paragraph);
  const app = setup("", { "#game_area_description": [description] }, { deferTranslations: true });
  const oldControl = descendantsWithClass(description, "srt-controls")[0];
  oldControl.firstElementChild.click();
  paragraph.textContent = "A replacement paragraph.";
  await rescan(app);
  assert.equal(oldControl.isConnected, true, "本文の一部の再描画で操作リンクを増やさない");
  const controls = descendantsWithClass(description, "srt-controls");
  assert.equal(controls.length, 1);
  app.respondNext({ ok: true, texts: ["古い段落への応答"] });
  assert.equal(descendantsWithClass(paragraph, "srt-hidden").length, 0);
  controls[0].firstElementChild.click();
  app.respondNext({ ok: true, texts: ["現在の段落の訳文"] });
  assert.deepEqual(app.requestedTexts, ["An older paragraph.", "A replacement paragraph."]);
  assertVisibleAncestors(video.video);
});

test("ガイドの画像リンク内に翻訳操作リンクを入れない", async () => {
  const section = new Element("div");
  const anchor = new Element("a");
  anchor.setAttribute("href", "https://example.com/screenshot");
  const image = new Element("img");
  image.setAttribute("alt", "Large screenshot");
  anchor.append(image, new TextNode("Open the map."));
  section.append(anchor);
  const app = setup("", { ".subSectionDesc": [section] });
  assert.equal(descendantsWithClass(anchor, "srt-controls").length, 0);
  const controls = descendantsWithClass(app.html, "srt-controls");
  assert.equal(controls.length, 1);
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["Open the map."]);
  assert.equal(image.parentElement, anchor);
  assertVisibleAncestors(image);
});

test("再走査前に動画が追加されても翻訳クリックで親全体を隠さない", async () => {
  const app = setup("A review without a clip.");
  const oldControl = descendantsWithClass(app.html, "srt-controls")[0];
  const video = steamVideo();
  app.body.append(video.wrapper);
  oldControl.firstElementChild.click();
  assert.equal(app.calls(), 0, "媒体を含む古い登録からAPIを呼ばない");
  assertVisibleAncestors(video.video);
  await rescan(app);
  assert.equal(descendantsWithClass(app.html, "srt-controls").length, 1);
});

test("画像リンク内の段落を分割しても操作リンクは既存リンクの外に置く", async () => {
  const section = new Element("div");
  const anchor = new Element("a");
  anchor.setAttribute("href", "https://example.com/map");
  const image = new Element("img");
  const paragraph = new Element("p");
  paragraph.append(new TextNode("Open the full map."), image);
  anchor.append(paragraph);
  section.append(anchor);
  const app = setup("", { ".subSectionDesc": [section] });
  assert.equal(descendantsWithClass(anchor, "srt-controls").length, 0);
  assert.equal(descendantsWithClass(paragraph, "srt-controls").length, 0);
  const controls = descendantsWithClass(app.html, "srt-controls");
  assert.equal(controls.length, 1);
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["Open the full map."]);
  assert.equal(image.parentElement, paragraph);
  assertVisibleAncestors(image);
});

test("媒体のあるスレッド一覧でもタイトルと操作リンクを分離する", async () => {
  const row = new Element("div");
  const title = new Element("div");
  const label = new Element("span");
  label.className = "forum_topic_label";
  label.textContent = "Pinned:";
  const image = new Element("img");
  title.append(label, image, new TextNode("Known Issues"));
  const author = new Element("div");
  author.className = "forum_topic_op";
  author.textContent = "PrivateAuthor";
  row.append(title, author);
  const app = setup("", { ".forum_topic_name": [title], ".test-root": [row] });
  assert.equal(descendantsWithClass(title, "srt-controls").length, 0);
  const controls = descendantsWithClass(author, "srt-controls");
  assert.equal(controls.length, 1);
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.requestedTexts, ["Known Issues"]);
  assert.equal(image.parentElement, title);
  assertVisibleAncestors(image);
  assertVisibleAncestors(label);
  await rescan(app);
  assert.equal(descendantsWithClass(author, "srt-controls").length, 1);
});

function groupFixture({ deferTranslations = true } = {}) {
  const description = new Element("div", "game_area_description");
  const video = steamVideo();
  const first = new Element("p");
  first.textContent = "First paragraph.";
  const second = new Element("p");
  second.textContent = "Second paragraph.";
  description.append(video.wrapper, first, second);
  const targets = { "#game_area_description": [description] };
  const app = setup("", targets, { deferTranslations });
  const controls = descendantsWithClass(description, "srt-controls")[0];
  return { ...app, description, video, first, second, targets, controls, action: controls.firstElementChild };
}

test("一括翻訳の連打・エラー・手動再試行でも部分表示やリンクの増加を起こさない", async () => {
  const app = groupFixture();
  app.action.click();
  app.action.click();
  assert.equal(app.calls(), 1);
  assert.equal(app.action.textContent, "翻訳中…");
  app.respondNext({ ok: false, code: "NO_KEY", message: "Gemini APIキーを設定してください。" });
  assert.equal(app.action.textContent, "再試行");
  assert.equal(app.controls.children[2].hidden, false, "設定を開くリンクを表示する");
  for (const part of descendantsWithClass(app.description, "srt-media-text")) assertVisibleAncestors(part);
  await rescan(app);
  assert.equal(app.calls(), 1, "自動では再試行しない");
  app.action.click();
  app.respondNext({ ok: true, texts: ["最初の段落です。", "次の段落です。"] });
  assert.equal(descendantsWithClass(app.description, "srt-hidden").length, 2);
  assert.equal(app.action.textContent, "原文を見る（Geminiによる翻訳）");
  assertVisibleAncestors(app.video.video);
  app.action.click();
  assert.equal(descendantsWithClass(app.description, "srt-hidden").length, 0);
  app.action.click();
  assert.equal(app.calls(), 2);
  assert.equal(descendantsWithClass(app.description, "srt-controls").length, 1);
});

test("一括応答の数や型が合わない時は全原文を保持し、訳文を一部だけ表示しない", () => {
  for (const texts of [["最初の段落だけです。"], ["最初です。", ""], ["最初です。", 1], "日本語訳です。", null]) {
    const app = groupFixture();
    app.action.click();
    app.respondNext({ ok: true, texts });
    assert.equal(app.action.textContent, "再試行");
    assert.equal(descendantsWithClass(app.description, "srt-hidden").length, 0);
    assert.equal(descendantsWithClass(app.description, "srt-translation").every(node => node.hidden), true);
    assertVisibleAncestors(app.video.video);
  }
});

test("一括の応答待ち中に本文が変わったら、再走査前でも古い訳文を適用しない", async () => {
  const app = groupFixture();
  app.action.click();
  app.second.textContent = "Expanded second paragraph.";
  app.respondNext({ ok: true, texts: ["古い最初の訳文です。", "古い次の訳文です。"] });
  assert.equal(app.action.textContent, "日本語に翻訳");
  assert.equal(descendantsWithClass(app.description, "srt-hidden").length, 0);
  assert.equal(app.calls(), 1);
  app.action.click();
  app.respondNext({ ok: true, texts: ["最初の段落です。", "展開後の段落です。"] });
  assert.deepEqual(app.requestedBatches, [["First paragraph.", "Second paragraph."],
    ["First paragraph.", "Expanded second paragraph."]]);
  assert.equal(descendantsWithClass(app.description, "srt-controls").length, 1);
  assertVisibleAncestors(app.video.video);
  await rescan(app);
  assert.equal(app.calls(), 2);
});

test("媒体だけの追加・削除で取得済みの一括訳文を無効化しない", async () => {
  const app = groupFixture();
  app.action.click();
  app.respondNext({ ok: true, texts: ["最初の段落です。", "次の段落です。"] });
  const secondVideo = steamVideo();
  app.description.append(secondVideo.wrapper);
  await rescan(app);
  assert.equal(app.action.textContent, "原文を見る（Geminiによる翻訳）");
  assertVisibleAncestors(secondVideo.video);
  app.video.wrapper.remove();
  secondVideo.wrapper.remove();
  await rescan(app);
  app.action.click();
  app.action.click();
  assert.equal(app.calls(), 1);
  assert.equal(descendantsWithClass(app.description, "srt-controls").length, 1);
});

test("一括本文の追加・日本語への変更を反映し、リンクは常に1つに保つ", async () => {
  const app = groupFixture();
  app.action.click();
  app.respondNext({ ok: true, texts: ["最初の段落です。", "次の段落です。"] });
  app.first.textContent = "これはすでに日本語の文章です。";
  const third = new Element("p");
  third.textContent = "Newly loaded paragraph.";
  app.description.append(third);
  await rescan(app);
  assert.equal(app.action.textContent, "日本語に翻訳");
  assert.equal(app.calls(), 1);
  assert.equal(descendantsWithClass(app.description, "srt-controls").length, 1);
  app.action.click();
  assert.deepEqual(app.requestedBatches[1], ["Second paragraph.", "Newly loaded paragraph."]);
  app.respondNext({ ok: true, texts: ["次の段落です。", "追加された段落です。"] });
  assertVisibleAncestors(app.first);
  assert.equal(app.first.textContent, "これはすでに日本語の文章です。");
  assertVisibleAncestors(app.video.video);
});

test("一括本文全体の差し替えで古いUI・応答を破棄し、新しい本文だけを扱う", async () => {
  const app = groupFixture();
  app.action.click();
  app.description.remove();
  const replacement = new Element("div", "game_area_description");
  const video = steamVideo();
  replacement.append(video.wrapper, new TextNode("A replacement description."));
  app.targets["#game_area_description"].splice(0, 1, replacement);
  app.html.append(replacement);
  await rescan(app);
  assert.equal(app.controls.isConnected, false);
  const action = descendantsWithClass(replacement, "srt-controls")[0].firstElementChild;
  app.respondNext({ ok: true, texts: ["古い訳文です。", "古い訳文です。"] });
  assert.equal(action.textContent, "日本語に翻訳");
  app.action.click();
  assert.equal(app.calls(), 1, "切り離されたリンクから要求しない");
  action.click();
  app.respondNext({ ok: true, texts: ["差し替えられた説明文です。"] });
  assert.deepEqual(app.requestedBatches[1], ["A replacement description."]);
  assertVisibleAncestors(video.video);
});

test("Phasmophobiaの画像段落・入れ子のリスト段落・3本の動画でもリンクは1つだけ", async () => {
  const description = new Element("div", "game_area_description");
  const heading = new Element("h2");
  heading.textContent = "About This Game";
  const intro = new Element("p");
  intro.textContent = "Investigate haunted locations.";
  const imageParagraph = new Element("p");
  imageParagraph.className = "bb_paragraph";
  const image = new Element("img");
  image.setAttribute("alt", "INVESTIGATE");
  imageParagraph.append(image);
  const lists = Array.from({ length: 3 }, (_, index) => {
    const list = new Element("ul");
    const item = new Element("li");
    const paragraph = new Element("p");
    paragraph.className = "bb_paragraph";
    const strong = new Element("strong");
    strong.textContent = `Feature ${index}: `;
    paragraph.append(strong, new TextNode("Collect evidence together."));
    item.append(paragraph);
    list.append(item);
    return list;
  });
  const videos = Array.from({ length: 3 }, steamVideo);
  const videoParagraphs = videos.map(media => {
    const paragraph = new Element("p");
    paragraph.className = "bb_paragraph";
    paragraph.append(media.wrapper);
    return paragraph;
  });
  description.append(heading, intro, imageParagraph);
  lists.forEach((list, index) => description.append(list, videoParagraphs[index]));
  const app = setup("", { "#game_area_description": [description] });
  const controls = descendantsWithClass(description, "srt-controls");
  assert.equal(controls.length, 1);
  assert.equal(heading.nextElementSibling, controls[0]);
  controls[0].firstElementChild.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls(), 1);
  assert.deepEqual(app.requestedBatches[0], ["Investigate haunted locations.",
    "Feature 0: Collect evidence together.", "Feature 1: Collect evidence together.", "Feature 2: Collect evidence together."]);
  assert.equal(image.parentElement, imageParagraph);
  assertVisibleAncestors(image);
  videos.forEach((media, index) => {
    assert.equal(media.wrapper.parentElement, videoParagraphs[index]);
    assertVisibleAncestors(media.video);
    assert.equal(lists[index].children[0].children[0].tagName, "P");
  });
  await rescan(app);
  assert.equal(descendantsWithClass(description, "srt-controls").length, 1);
});

test("一括の操作UIが差し替えられた時は古い応答を無視し、UIを1つだけ再作成する", async () => {
  const app = groupFixture();
  app.action.click();
  app.controls.remove();
  await rescan(app);
  const controls = descendantsWithClass(app.description, "srt-controls");
  assert.equal(controls.length, 1);
  const action = controls[0].firstElementChild;
  action.click();
  app.respondNext({ ok: true, texts: ["古い最初の訳文です。", "古い次の訳文です。"] });
  assert.equal(action.textContent, "翻訳中…");
  assert.equal(descendantsWithClass(app.description, "srt-hidden").length, 0);
  app.respondNext({ ok: true, texts: ["最初の訳文です。", "次の訳文です。"] });
  assert.equal(action.textContent, "原文を見る（Geminiによる翻訳）");
  assert.equal(descendantsWithClass(app.description, "srt-translation").length, 2);
  assertVisibleAncestors(app.video.video);
});
