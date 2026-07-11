// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

const fs = require("fs");
const crypto = require("crypto");

// Extension→MIME comes from the shared registry (the base doc's mime_type
// drives video-vs-image rendering on the frontend — map slide, lightbox).
const { mimeFor } = require("rpg-media-types");

/** SHA256 of a file's contents, streamed to avoid loading large files at once. */
function computeHash(absPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(absPath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function fileMtime(absPath) {
  try {
    return new Date(fs.statSync(absPath).mtime).toISOString();
  } catch (_) {
    return new Date().toISOString();
  }
}

function fileSize(absPath) {
  try {
    return fs.statSync(absPath).size;
  } catch (_) {
    return 0;
  }
}

module.exports = { computeHash, mimeFor, fileMtime, fileSize };
