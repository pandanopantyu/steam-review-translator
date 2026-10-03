"use strict";

(() => {
  const mounted = new WeakMap();
  const activeStates = new Set();
  const splitRoots = new WeakSet();
  const PROTECTED_CONTENT = "img,picture,video,audio,iframe,object,embed,canvas,svg,button,input,textarea,select,[role='button'],.bb_img_ctn";
  const STORE_ROOT = "#app_reviews_hash";
  const COMMUNITY_TEXT_SELECTORS = [
    [".forum_op > .topic", "discussion"],
    [".forum_op > .content", "discussion"],
    [".commentthread_comment_text", "comment"],
    [".workshopItemTitle", "title"],
    [".workshopItemShortDesc", "summary"],
    [".guideTopDescription", "guide"],
    [".subSectionTitle", "title"],
    [".subSectionDesc", "guide"],
    ["#highlightContent.workshopItemDescription", "workshop"],
    [".screenshotDescription", "caption"],
    [".nonScreenshotDescription", "caption"],
    [".apphub_CardContentTitle", "title"],
    [".apphub_CardContentNewsTitle", "title"],
    [".EventDetailsBody [role='paragraph']", "article"]
  ];
  let scanTimer = 0;

  function isProtectedElement(element) {
    return /^(?:IMG|PICTURE|VIDEO|AUDIO|IFRAME|OBJECT|EMBED|CANVAS|SVG|BUTTON|INPUT|TEXTAREA|SELECT)$/.test(element.tagName) ||
      element.getAttribute("role") === "button" || element.classList.contains("bb_img_ctn");
  }

  function isOwnUI(element) {
    return element.classList.contains("srt-translation") || element.classList.contains("srt-controls");
  }

  function isExcludedText(element) {
    return isOwnUI(element) || isProtectedElement(element) || element.classList.contains("bb_quoteauthor") ||
      /^(?:SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(element.tagName) ||
      (element.tagName === "A" &&
        /^(?:https:\/\/steamcommunity\.com)?\/(?:id|profiles)\//i.test(element.getAttribute("href") || ""));
  }

  function hasProtectedContent(element) {
    return isProtectedElement(element) || !!element.querySelector(PROTECTED_CONTENT);
  }

  function textOf(node) {
    let output = "";
    function visit(current) {
      if (current.nodeType === Node.TEXT_NODE) {
        output += current.nodeValue;
        return;
      }
      if (current.nodeType !== Node.ELEMENT_NODE) return;
      const element = current;
      if (isExcludedText(element)) return;
      if (element.tagName === "BR") {
        output += "\n";
        return;
      }
      const block = /^(?:DIV|P|LI|BLOCKQUOTE)$/.test(element.tagName);
      if (block && output && !output.endsWith("\n")) output += "\n";
      for (const child of element.childNodes) visit(child);
      if (block && !output.endsWith("\n")) output += "\n";
    }
    visit(node);
    return output.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  }

  function isJapanese(text, element) {
    const declared = element.closest("[data-review-language],[data-language],[lang]:not(html)");
    const language = declared?.getAttribute("data-review-language") ||
      declared?.getAttribute("data-language") || declared?.getAttribute("lang") || "";
    if (/^(?:ja|japanese)(?:-|$)/i.test(language)) return true;
    if (language && !/^(?:ja|japanese)(?:-|$)/i.test(language)) return false;
    const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
    const letters = (text.match(/[\p{L}]/gu) || []).length;
    return kana >= 2 && kana / Math.max(letters, 1) >= 0.08;
  }

  function findStoreBodies() {
    const root = document.querySelector(STORE_ROOT);
    if (!root) return [];
    const found = new Set();
    // 実ページで確認した本文Panelの構造を探す。投稿日と本文の間には
    // 無料製品・早期アクセスなどの表示が入るため、子要素の順番に依存しない。
    for (const link of root.querySelectorAll('a[href*="/recommended/"]')) {
      const card = link.parentElement;
      if (!card || card.firstElementChild !== link) continue;
      const details = link.nextElementSibling;
      for (const section of details?.children || []) {
        // 本文より後のPC仕様・投票数などを誤って翻訳しない。
        if (section.tagName === "HR") break;
        if (!section.classList.contains("Panel")) continue;
        // 長い本文では兄弟に「詳細を読む」BUTTONがある。本文ラッパーだけを数える。
        const children = [...section.children].filter(child => child.tagName === "DIV" &&
          !child.classList.contains("srt-controls") && !child.classList.contains("srt-translation"));
        if (children.length !== 1) continue;
        const body = children[0].firstElementChild;
        if (!(body instanceof HTMLElement) || body.tagName !== "DIV" ||
            body.querySelector("button,textarea,input") || !textOf(body)) continue;
        found.add(body);
        break;
      }
    }
    return [...found];
  }

  function createLink(label, onClick) {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = label;
    link.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    link.addEventListener("mousedown", event => event.stopPropagation());
    return link;
  }

  function makeBodyForCommunity(container) {
    if (hasProtectedContent(container) || splitRoots.has(container)) {
      return container.querySelector(":scope > .date_posted") ? container : null;
    }
    let body = container.querySelector(":scope > .srt-original");
    if (body) return body;
    const date = container.querySelector(":scope > .date_posted");
    if (!date) return null;
    body = document.createElement("span");
    body.className = "srt-original";
    while (date.nextSibling) body.append(date.nextSibling);
    container.append(body);
    return body;
  }

  function makeBodyForForumTopic(container) {
    if (hasProtectedContent(container) || splitRoots.has(container)) return container;
    let body = container.querySelector(":scope > .srt-original");
    if (body) return body;
    const label = container.querySelector(":scope > .forum_topic_label");
    const start = label ? [...container.childNodes].indexOf(label) + 1 : 0;
    const source = [...container.childNodes].slice(start).map(textOf).join(" ").trim();
    if (!source || isJapanese(source, container)) return null;
    body = document.createElement("span");
    body.className = "srt-original";
    if (label) {
      while (label.nextSibling) body.append(label.nextSibling);
    } else {
      while (container.firstChild) body.append(container.firstChild);
    }
    container.append(body);
    return body;
  }

  function makeBodyForStoreDescription(container) {
    // 動画・画像・操作ボタンを移動しない。媒体のある説明欄は後で文章だけに分ける。
    if (hasProtectedContent(container) || splitRoots.has(container)) return container;
    let body = container.querySelector(":scope > .srt-original");
    if (body) return body;
    const heading = container.firstElementChild?.tagName === "H2"
      ? container.firstElementChild : null;
    const start = heading ? [...container.childNodes].indexOf(heading) + 1 : 0;
    const source = [...container.childNodes].slice(start).map(textOf).join(" ").trim();
    if (!source || isJapanese(source, container)) return null;
    body = document.createElement("div");
    body.className = "srt-original";
    if (heading) {
      while (heading.nextSibling) body.append(heading.nextSibling);
    } else {
      while (container.firstChild) body.append(container.firstChild);
    }
    container.append(body);
    return body;
  }

  function makeTextPieces(container, skipElement = null) {
    const pieces = [];
    function walk(parent) {
      let run = [];
      function flush() {
        const nodes = run;
        run = [];
        const source = nodes.map(textOf).join(" ").trim();
        if (!source || isJapanese(source, parent)) return;
        const original = document.createElement("span");
        original.className = "srt-original srt-media-text";
        // 移動するのは文章とインライン装飾だけ。プレイヤー本体・親要素には触れない。
        parent.insertBefore(original, nodes[0]);
        original.append(...nodes);
        pieces.push(original);
      }
      for (const node of [...parent.childNodes]) {
        if (node === skipElement) { flush(); continue; }
        if (node.nodeType === Node.TEXT_NODE) { run.push(node); continue; }
        if (node.nodeType !== Node.ELEMENT_NODE) { flush(); continue; }
        if (isExcludedText(node)) { flush(); continue; }
        if (node.classList.contains("srt-media-text") && !hasProtectedContent(node) && !splitRoots.has(node)) {
          flush();
          pieces.push(node);
        } else if (hasProtectedContent(node) || splitRoots.has(node) ||
            /^(?:DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|SECTION|ARTICLE|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|DL|DT|DD)$/.test(node.tagName)) {
          flush();
          // 一度分割した親を媒体の削除後に丸ごと翻訳すると、子の訳文と重複する。
          splitRoots.add(node);
          walk(node);
        } else {
          run.push(node);
        }
      }
      flush();
    }
    walk(container);
    return pieces;
  }

  function createPart(original, kind) {
    const source = textOf(original);
    const translated = document.createElement("span");
    translated.className = `srt-translation srt-text-${kind}`;
    if (original.classList.contains("srt-media-text")) translated.classList.add("srt-media-translation");
    translated.hidden = true;
    translated.lang = "ja";
    const style = window.getComputedStyle?.(original);
    if (style && translated.style) {
      translated.style.font = style.font;
      translated.style.color = style.color;
      translated.style.lineHeight = style.lineHeight;
      translated.style.letterSpacing = style.letterSpacing;
    }
    original.after(translated);
    return { original, translated, source };
  }

  function groupPieces(body, kind) {
    const skipElement = kind === "community" ? body.querySelector(":scope > .date_posted") :
      kind === "forum-title" ? body.querySelector(":scope > .forum_topic_label") :
      kind === "store-description" && body.id === "game_area_description" &&
        body.firstElementChild?.tagName === "H2" ? body.firstElementChild : null;
    return makeTextPieces(body, skipElement).filter(piece => {
      const source = textOf(piece);
      return source && !isJapanese(source, piece);
    });
  }

  function register(original, placement, kind, pieces = null) {
    if (!original || mounted.has(original) || !original.isConnected) return;
    const grouped = pieces !== null;
    if (grouped ? !pieces.length : hasProtectedContent(original)) return;
    const source = textOf(original);
    if (!grouped && (!source || isJapanese(source, original))) return;
    const parts = (pieces || [original]).map(piece => createPart(piece, kind));

    const controls = document.createElement("div");
    controls.className = `srt-controls srt-${kind}`;
    const action = createLink("日本語に翻訳", () => onAction(state));
    const status = document.createElement("span");
    status.className = "srt-status";
    status.setAttribute("role", "status");
    const settings = createLink("設定を開く", () => chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }));
    settings.className = "srt-settings";
    settings.hidden = true;
    controls.append(action, status, settings);
    if (kind === "forum-title") {
      placement.append(controls);
    } else if (grouped && kind === "store-description" && original.id === "game_area_description") {
      // Steamの折りたたみ範囲の末尾に操作リンクを隠さない。
      const heading = original.firstElementChild;
      if (heading?.tagName === "H2") heading.after(controls);
      else original.append(controls);
    } else {
      // ガイド一覧などでは本文が<a>内にある。操作リンクを入れ子にしない。
      const parentLink = original.closest("a[href]");
      (parentLink || (placement === original && !grouped ? parts[0].translated : placement)).after(controls);
    }
    if (kind === "community") {
      const main = placement.closest(".apphub_CardContentMain");
      if (main && placement.getBoundingClientRect().bottom + 28 > main.getBoundingClientRect().bottom) {
        controls.classList.add("srt-community-clipped");
        main.append(controls);
      }
    }

    const state = { original, parts, grouped, kind, controls, action, status, settings,
      source: grouped ? JSON.stringify(parts.map(part => part.source)) : source,
      translation: null, showingTranslation: false, loading: false, revision: 0 };
    mounted.set(original, state);
    activeStates.add(state);
  }

  function isMounted(state) {
    return mounted.get(state.original) === state && state.original.isConnected &&
      state.controls.isConnected && (state.grouped || state.parts[0].translated.isConnected);
  }

  function dispose(state) {
    // 再描画前の状態を無効にし、遅れて届く応答から現在の本文を守る。
    state.revision += 1;
    state.loading = false;
    if (mounted.get(state.original) === state) {
      mounted.delete(state.original);
    }
    for (const part of state.parts) {
      part.original.classList.remove("srt-hidden");
      part.translated.remove();
    }
    state.controls.remove();
    activeStates.delete(state);
  }

  function display(state, translationVisible) {
    state.showingTranslation = translationVisible;
    for (const part of state.parts) {
      part.original.classList.toggle("srt-hidden", translationVisible);
      part.translated.hidden = !translationVisible;
    }
    state.action.textContent = translationVisible
      ? "原文を見る（Geminiによる翻訳）"
      : "日本語訳を見る（Geminiによる翻訳）";
    state.status.textContent = "";
    state.settings.hidden = true;
  }

  function showError(state, result) {
    state.action.textContent = "再試行";
    state.status.textContent = result?.message || "翻訳に失敗しました。";
    state.settings.hidden = result?.code !== "NO_KEY" && result?.code !== "AUTH";
  }

  function refresh(state) {
    if (!isMounted(state)) return;
    if (state.grouped) {
      // 媒体が追加された文章ラッパーは、走査や応答の時点で直ちに元へ戻す。
      for (const part of state.parts) {
        if (hasProtectedContent(part.original)) part.original.classList.remove("srt-hidden");
      }
      const pieces = groupPieces(state.original, state.kind);
      const current = JSON.stringify(pieces.map(textOf));
      const changed = current !== state.source || pieces.length !== state.parts.length ||
        pieces.some((piece, index) => piece !== state.parts[index].original ||
          !state.parts[index].translated.isConnected);
      if (!changed) return;
      for (const part of state.parts) {
        part.original.classList.remove("srt-hidden");
        part.translated.remove();
      }
      state.parts = pieces.map(piece => createPart(piece, state.kind));
      state.source = current;
    } else {
      const current = textOf(state.original);
      if (current === state.source) return;
      state.source = current;
      state.parts[0].source = current;
    }
    state.revision += 1;
    state.translation = null;
    state.loading = false;
    state.showingTranslation = false;
    for (const part of state.parts) {
      part.original.classList.remove("srt-hidden");
      part.translated.hidden = true;
      part.translated.textContent = "";
    }
    state.action.textContent = "日本語に翻訳";
    state.action.removeAttribute("aria-disabled");
    state.status.textContent = "";
    state.settings.hidden = true;
    state.controls.hidden = state.grouped ? !state.parts.length :
      !state.source || isJapanese(state.source, state.original);
  }

  function onAction(state) {
    if (!isMounted(state)) return;
    if (!state.grouped && hasProtectedContent(state.original)) {
      dispose(state);
      scheduleScan();
      return;
    }
    refresh(state);
    if (state.loading || !state.source || state.controls.hidden) return;
    if (state.translation !== null) {
      display(state, !state.showingTranslation);
      return;
    }
    state.loading = true;
    const revision = state.revision;
    const source = state.source;
    state.action.textContent = "翻訳中…";
    state.action.setAttribute("aria-disabled", "true");
    state.status.textContent = "";
    state.settings.hidden = true;
    const message = state.grouped
      ? { type: "TRANSLATE_BATCH", texts: state.parts.map(part => part.source) }
      : { type: "TRANSLATE_TEXT", text: source };
    chrome.runtime.sendMessage(message, result => {
      // 無視する応答でもlastErrorを読み、未処理エラーを残さない。
      const runtimeError = chrome.runtime.lastError;
      if (!isMounted(state)) return;
      if (!state.grouped && hasProtectedContent(state.original)) {
        dispose(state);
        scheduleScan();
        return;
      }
      refresh(state);
      if (revision !== state.revision || source !== state.source) return;
      state.loading = false;
      state.action.removeAttribute("aria-disabled");
      if (runtimeError) {
        showError(state, { message: "拡張機能と通信できませんでした。ページを再読み込みしてください。" });
      } else if (!result?.ok) {
        showError(state, result);
      } else {
        const texts = state.grouped ? result.texts : [result.text];
        if (!Array.isArray(texts) || texts.length !== state.parts.length ||
            texts.some(text => typeof text !== "string" || !text.trim())) {
          showError(state, { message: "翻訳結果の対応を確認できませんでした。再試行してください。" });
          return;
        }
        state.translation = texts;
        state.parts.forEach((part, index) => { part.translated.textContent = texts[index]; });
        display(state, true);
      }
    });
  }

  function scan() {
    scanTimer = 0;
    // WeakMapだけでは削除済み本文を列挙できないため、全種類のUIを追跡する。
    for (const state of activeStates) {
      // 翻訳後に媒体が挿入された場合も、親ごと隠したままにしない。
      if (!isMounted(state) || (!state.grouped && hasProtectedContent(state.original))) dispose(state);
    }
    function ensure(body, placement, kind) {
      if (isProtectedElement(body)) return;
      const state = mounted.get(body);
      if (state?.grouped && isMounted(state)) {
        refresh(state);
        return;
      }
      if (hasProtectedContent(body) || splitRoots.has(body)) {
        if (state) dispose(state);
        splitRoots.add(body);
        register(body, placement, kind, groupPieces(body, kind));
        return;
      }
      if (state && isMounted(state)) {
        refresh(state);
        return;
      }
      if (state) dispose(state);
      register(body, placement, kind);
    }
    for (const body of findStoreBodies()) {
      ensure(body, body.parentElement, "store");
    }
    for (const container of document.querySelectorAll(".apphub_CardTextContent")) {
      const body = makeBodyForCommunity(container);
      if (body) {
        ensure(body, container, "community");
      } else if (container.closest(".Announcement_Card")) {
        for (const piece of container.querySelectorAll("p.bb_paragraph, .bb_h1, .bb_h2, .bb_h3, li")) {
          if (piece.tagName === "LI" && piece.querySelector("p.bb_paragraph")) continue;
          ensure(piece, piece, "article");
        }
      }
    }
    for (const body of document.querySelectorAll("#ReviewText")) {
      ensure(body, body, "individual");
    }
    for (const container of document.querySelectorAll(".forum_topic_name")) {
      const body = makeBodyForForumTopic(container);
      const authorLine = container.parentElement?.querySelector(":scope > .forum_topic_op");
      if (body && authorLine) {
        ensure(body, authorLine, "forum-title");
      }
    }
    const storeDescription = document.querySelector("#game_area_description");
    if (storeDescription) {
      const body = makeBodyForStoreDescription(storeDescription);
      if (body) {
        ensure(body, body, "store-description");
      }
    }
    for (const body of document.querySelectorAll(".game_description_snippet")) {
      ensure(body, body, "store-description");
    }
    for (const [selector, kind] of COMMUNITY_TEXT_SELECTORS) {
      for (const body of document.querySelectorAll(selector)) ensure(body, body, kind);
    }
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(scan, 160);
  }

  scan();
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true, characterData: true, subtree: true
  });
})();
