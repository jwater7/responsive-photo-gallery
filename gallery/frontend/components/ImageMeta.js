// vim: tabstop=2 shiftwidth=2 expandtab
//
// Exposes an image's enrichment metadata (AI-generated tags, OCR text,
// place/coords, capture date, type/size) inside the lightbox.
//
// Placement: a caption-area overlay pinned to the bottom of the lightbox,
// toggled by an "info" button in the toolbar (InfoToggleButton). Mobile-friendly
// by design — full width, height-capped + scrollable so it never covers the
// whole image, tags wrap, honours the bottom safe-area inset, and is dismissible.
//
// Fed the raw search-result document; renders safely with partial data. Used as a
// `render.slideFooter` by the Search and Map lightboxes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from 'react-bootstrap';

// Drives the metadata overlay's visibility like the album lightbox caption:
// it appears on open / slide-change and fades out after `delay` ms, unless the
// user pins it open via the info button. Pinning cancels the auto-hide and keeps
// it visible; un-pinning hides it. Wire `reveal` to the lightbox `on.view`,
// `toggle` to the info button, and pass `visible` to <ImageMeta>.
export function useTimedInfo(delay = 2500) {
  const [visible, setVisible] = useState(true);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  const timer = useRef(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const reveal = useCallback(() => {
    setVisible(true);
    clearTimer();
    if (!pinnedRef.current) {
      timer.current = setTimeout(() => setVisible(false), delay);
    }
  }, [delay]);

  const toggle = useCallback(() => {
    const next = !pinnedRef.current;
    pinnedRef.current = next;
    setPinned(next);
    clearTimer();
    setVisible(next); // pin -> keep visible; unpin -> hide
  }, []);

  useEffect(() => () => clearTimer(), []);

  return { visible, pinned, reveal, toggle };
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return Math.round(n / 1e3) + ' KB';
  return n + ' B';
}

function fmtDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toLocaleString();
}

// mlat/mlon drops a marker; the #map fragment sets the initial view (zoom 16).
function osmUrl(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

// Text-link styled control for the dark metadata panel.
const linkStyle = {
  color: '#6cb2ff',
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  cursor: 'pointer',
};

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {
      // clipboard API needs a secure context; coords stay visible to copy by hand
    }
  };
  return (
    <button type="button" onClick={copy} style={linkStyle}>
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

// Location line: 📍 place (or truncated coords when there's no place name),
// tappable to reveal exact coordinates with copy + an OpenStreetMap link.
// Renders nothing without a place or finite coords, so it degrades gracefully on
// un-geotagged images.
function ImageLocation({ meta }) {
  const [open, setOpen] = useState(false);
  const geo = meta._geo;
  const hasGeo = geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng);
  if (!meta.place && !hasGeo) return null;

  const label = meta.place || `${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`;
  const exact = hasGeo ? `${geo.lat}, ${geo.lng}` : '';
  const toggle = () => setOpen((o) => !o);

  return (
    <div>
      <span
        role={hasGeo ? 'button' : undefined}
        tabIndex={hasGeo ? 0 : undefined}
        aria-expanded={hasGeo ? open : undefined}
        title={hasGeo ? 'Show exact coordinates' : undefined}
        onClick={hasGeo ? toggle : undefined}
        onKeyDown={
          hasGeo
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
        style={hasGeo ? { cursor: 'pointer' } : undefined}
      >
        📍 {label}
        {meta.geo_source ? <span style={{ opacity: 0.7 }}> ({meta.geo_source})</span> : null}
        {hasGeo ? <span style={{ opacity: 0.7 }}> {open ? '▴' : '▾'}</span> : null}
      </span>

      {hasGeo && open && (
        <div
          style={{
            marginTop: 4,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
            fontSize: 12,
          }}
        >
          <code style={{ color: '#fff', opacity: 0.9 }}>{exact}</code>
          <CopyButton text={exact} />
          <a
            href={osmUrl(geo.lat, geo.lng)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#6cb2ff' }}
          >
            Open in OpenStreetMap ↗
          </a>
        </div>
      )}
    </div>
  );
}

// Toolbar toggle button for the metadata overlay. Styled with yatlbox's own
// button class so it matches the close/zoom controls (and their tap target).
export function InfoToggleButton({ active, onToggle }) {
  return (
    <button
      type="button"
      className="yarl__button"
      aria-label="Toggle image details"
      aria-pressed={active}
      onClick={onToggle}
      title="Image details"
      style={{ opacity: active ? 1 : 0.75 }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5a1.3 1.3 0 1 1 0 2.6A1.3 1.3 0 0 1 12 7zm1.4 10h-2.8v-1.2h.7v-3.2h-.7v-1.2h2.1v4.4h.7V17z" />
      </svg>
    </button>
  );
}

export default function ImageMeta({ meta, visible = true, actions = null }) {
  if (!meta) return null;

  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const caption = (meta.caption || '').trim();
  const ocr = (meta.content || '').trim();
  const conf = Number(meta.confidence);
  const taken = fmtDate(meta.taken_at);

  const facts = [
    taken && `Taken ${taken}`,
    meta.mime_type,
    meta.file_size && fmtBytes(meta.file_size),
  ].filter(Boolean);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 2,
        padding: '10px 16px',
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        background: 'rgba(0,0,0,0.72)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        maxHeight: 'min(45vh, 320px)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        fontSize: 14,
        lineHeight: 1.35,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.4s ease',
      }}
      // Keep taps inside the panel from closing the lightbox / changing slides.
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{meta.path}</div>

      {caption && (
        <div style={{ wordBreak: 'break-word' }}>
          <span style={{ opacity: 0.7 }}>Caption: </span>
          {caption}
        </div>
      )}

      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={{ opacity: 0.7 }}>Tags:</span>
          {tags.map((t) => (
            <Badge bg="info" key={t}>
              {t}
            </Badge>
          ))}
        </div>
      )}

      <ImageLocation meta={meta} />

      {ocr && (
        <div style={{ wordBreak: 'break-word' }}>
          <span style={{ opacity: 0.7 }}>Text: </span>
          {ocr}
          {Number.isFinite(conf) && conf > 0 ? (
            <span style={{ opacity: 0.7 }}> (OCR {Math.round(conf * 100)}%)</span>
          ) : null}
        </div>
      )}

      {facts.length > 0 && (
        <div style={{ opacity: 0.8, fontSize: 12 }}>{facts.join(' · ')}</div>
      )}

      {actions ? (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 2 }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
