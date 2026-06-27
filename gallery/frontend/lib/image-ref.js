// Decompose an enrichment doc into the gallery's (album, image) addressing used
// by the image/video/thumb URLs and the tag store.
//
// An "album" is exactly one top-level directory under IMAGE_PATH — enforced by
// the gallery's albums() top-level readdir and the tag store keying on
// path.join(album, image) — and the enrichment doc carries it as its own
// `album` field. So `image` is `path` with that AUTHORITATIVE album prefix
// removed (it may itself be multi-level, e.g. album "vacation", image
// "2023/italy/beach.jpg"). We never re-split `path` to guess where the album
// ends; a doc whose path doesn't start with its album returns null rather than
// a wrong guess.
export const imageRef = (doc) => {
  if (!doc || !doc.album || !doc.path) return null;
  const prefix = doc.album + '/';
  if (!doc.path.startsWith(prefix)) return null;
  return { album: doc.album, image: doc.path.slice(prefix.length) };
};
