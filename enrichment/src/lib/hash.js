// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
};

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

function mimeFor(relPath) {
  return MIME_BY_EXT[path.extname(relPath).toLowerCase()] ||
    "application/octet-stream";
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
