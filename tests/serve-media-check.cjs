"use strict";

// ブラウザで実DOM/CSSを検証するための開発用サーバー。拡張機能には読み込まれない。
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const files = new Map([
  ["/", ["tests/browser-media.html", "text/html; charset=utf-8"]],
  ["/content.js", ["content.js", "text/javascript; charset=utf-8"]],
  ["/background.js", ["background.js", "text/javascript; charset=utf-8"]],
  ["/content.css", ["content.css", "text/css; charset=utf-8"]]
]);
const server = http.createServer((request, response) => {
  const file = files.get(request.url);
  if (request.method !== "GET" || !file) {
    response.writeHead(404).end();
    return;
  }
  fs.readFile(path.join(root, file[0]), (error, data) => {
    if (error) { response.writeHead(500).end(); return; }
    response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
    response.end(data);
  });
});
server.listen(8765, "127.0.0.1", () => console.log("媒体検証: http://127.0.0.1:8765/ （Ctrl+Cで終了）"));
