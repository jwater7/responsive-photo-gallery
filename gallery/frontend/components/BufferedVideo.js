// vim: tabstop=2 shiftwidth=2 expandtab
//
// Fully-buffered video slide for the lightbox.
//
// The serving box can't keep up with a 4K original's bitrate over the wire
// (~50 Mbps demand vs ~13 Mbps pipe — see TODO Video #1), so progressive
// <video> streaming stutters: play ~1s, stall ~3s, repeat. This component sniffs
// the whole file FIRST (fetch + ReadableStream for a real progress bar), holds it
// as a Blob, and plays from an in-memory object URL — so playback runs entirely
// off RAM with zero re-buffering and instant, end-to-end seeking. We trade a
// one-time front-loaded wait (which the user accepted) for smooth playback.
//
// Only the ACTIVE slide (offset 0) downloads — neighbours are huge, so a fetch is
// never started for an off-screen video, and an in-flight download is aborted +
// its Blob revoked the moment the slide goes inactive or unmounts (frees RAM).

import { useEffect, useRef, useState } from 'react';

const fmtMB = (bytes) => (bytes / (1024 * 1024)).toFixed(0);

export default function BufferedVideo({ slide, active, onReady }) {
  const src = slide?.sources?.[0]?.src || slide?.download || null;
  const type = slide?.sources?.[0]?.type || 'video/mp4';

  // 'idle' | 'loading' | 'ready' | 'error'
  const [status, setStatus] = useState('idle');
  const [loaded, setLoaded] = useState(0); // bytes downloaded
  const [total, setTotal] = useState(0); // bytes expected (0 = unknown)
  const [blobUrl, setBlobUrl] = useState(null);
  const videoRef = useRef(null);

  useEffect(() => {
    // Only the current slide buffers; reset (and free memory) otherwise.
    if (!active || !src) {
      setStatus('idle');
      setLoaded(0);
      setTotal(0);
      return undefined;
    }

    const abort = new AbortController();
    let objectUrl = null;
    let cancelled = false;

    (async () => {
      setStatus('loading');
      setLoaded(0);
      try {
        const res = await fetch(src, { credentials: 'include', signal: abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const len = Number(res.headers.get('Content-Length')) || 0;
        if (!cancelled) setTotal(len);

        // Stream the body so we can show download progress; fall back to a plain
        // blob() if the runtime doesn't expose a readable body.
        let blob;
        if (res.body && res.body.getReader) {
          const reader = res.body.getReader();
          const chunks = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (!cancelled) setLoaded(received);
          }
          blob = new Blob(chunks, { type });
        } else {
          blob = await res.blob();
        }
        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setStatus('ready');
      } catch (err) {
        if (cancelled || abort.signal.aborted) return;
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBlobUrl(null);
    };
  }, [active, src, type]);

  // Try to start playback once buffered (a click opened the lightbox, but the
  // long buffer wait may exceed the autoplay grace window — controls are the
  // fallback, so a blocked play() is harmless). Also re-reveal the metadata
  // overlay: it's shown (then auto-hidden) when the slide opens, but for video
  // that happens during the buffering screen, so without this the info panel
  // (location/date/"open in map") would already be gone by the time the clip
  // actually appears.
  useEffect(() => {
    if (status === 'ready') {
      if (videoRef.current) videoRef.current.play().catch(() => {});
      if (onReady) onReady();
    }
  }, [status, onReady]);

  const wrap = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  const media = { maxWidth: '100%', maxHeight: '100%', display: 'block' };

  if (status === 'ready' && blobUrl) {
    return (
      <div style={wrap}>
        <video
          ref={videoRef}
          src={blobUrl}
          poster={slide.poster}
          controls
          autoPlay
          playsInline
          style={media}
        />
      </div>
    );
  }

  if (status === 'error') {
    // Prebuffering failed (network/auth) — degrade to direct streaming so the
    // clip still plays, even if it may stutter.
    return (
      <div style={wrap}>
        <video src={src} poster={slide.poster} controls playsInline style={media} />
      </div>
    );
  }

  // idle / loading: show the poster with a progress overlay.
  const pct = total ? Math.round((loaded / total) * 100) : null;
  return (
    <div style={wrap}>
      {slide.poster ? (
        <img src={slide.poster} alt="" style={{ ...media, opacity: 0.4 }} />
      ) : null}
      <div
        style={{
          position: 'absolute',
          color: '#fff',
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
          textShadow: '0 1px 3px rgba(0,0,0,.8)',
        }}
      >
        <div style={{ fontSize: 15, marginBottom: 8 }}>
          {pct != null ? `Buffering ${pct}%` : 'Buffering…'}
        </div>
        {total ? (
          <>
            <div
              style={{
                width: 200,
                height: 4,
                background: 'rgba(255,255,255,.25)',
                borderRadius: 2,
                overflow: 'hidden',
                margin: '0 auto',
              }}
            >
              <div
                style={{
                  width: `${pct ?? 0}%`,
                  height: '100%',
                  background: '#2b8cff',
                  transition: 'width .15s linear',
                }}
              />
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
              {fmtMB(loaded)} / {fmtMB(total)} MB
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
