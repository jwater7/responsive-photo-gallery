// vim: tabstop=2 shiftwidth=2 expandtab
//
// Turn an enrichment doc into a lightbox slide, shared by the map and search
// views (both address slides from enrichment docs). A video doc (mime_type
// video/*) becomes a Video-plugin slide that MetaLightbox plays fully-buffered
// (see BufferedVideo); everything else is a plain image slide.
//
// `width`/`height` (captured by the geo enricher for videos) let the player size
// to the clip's aspect ratio. We intentionally do NOT set `preload: 'auto'` —
// BufferedVideo downloads the whole file itself, and eager preload is flagged for
// removal in TODO Video #1.

import { imageRef } from './image-ref';
import { imageurl, videourl } from './api';

// Lightbox video poster size — larger than a grid/marker thumb.
const POSTER = '256x256';

export function docToSlide(doc) {
  const ref = imageRef(doc);
  if (!ref) return null;
  if (typeof doc.mime_type === 'string' && doc.mime_type.startsWith('video/')) {
    return {
      type: 'video',
      poster: imageurl({ ...ref, thumb: POSTER }),
      sources: [{ src: videourl(ref), type: 'video/mp4' }],
      download: videourl(ref),
      ...(doc.width && doc.height ? { width: doc.width, height: doc.height } : {}),
      meta: doc,
    };
  }
  return { src: imageurl(ref), meta: doc };
}
