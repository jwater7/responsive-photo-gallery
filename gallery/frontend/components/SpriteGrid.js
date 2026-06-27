// vim: tabstop=2 shiftwidth=2 expandtab
//
// Fixed square-cell album grid rendered from the manifest + sprite sheets.
// Cells are drawn by the shared <SpriteCell> (percentage background technique),
// so pinch-zoom / the zoom buttons only change `columns` + CSS — one sheet
// resolution serves every size. Group headers carry refs for skip-to-month.

import { useRef } from 'react'

import { albumSpriteUrl } from '../lib/api'
import SpriteCell from './SpriteCell'

const touchDistance = (touches) =>
  Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  )

export default function SpriteGrid({
  album,
  groups,
  columns,
  onSelect,
  registerGroupRef,
  onPinch,
}) {
  const pinchStart = useRef(0)

  const onTouchStart = (e) => {
    if (onPinch && e.touches.length === 2) pinchStart.current = touchDistance(e.touches)
  }
  const onTouchMove = (e) => {
    if (!onPinch || e.touches.length !== 2 || !pinchStart.current) return
    const ratio = touchDistance(e.touches) / pinchStart.current
    if (ratio > 1.25) {
      onPinch((c) => Math.max(c - 1, 1)) // fingers apart -> fewer cols -> zoom in
      pinchStart.current = touchDistance(e.touches)
    } else if (ratio < 0.8) {
      onPinch((c) => Math.min(c + 1, 12)) // pinch -> more cols -> zoom out
      pinchStart.current = touchDistance(e.touches)
    }
  }

  return (
    // `touch-action: pan-y` lets the page still scroll vertically but stops the
    // browser's native pinch-zoom over the grid, so a two-finger pinch only drives
    // our column zoom (onPinch) instead of also scaling the whole page chrome on
    // mobile (TODO Bugfix #2).
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} style={{ touchAction: 'pan-y' }}>
      {groups.map((g) => (
        <section
          key={g.key}
          ref={registerGroupRef ? registerGroupRef(g.key) : undefined}
          style={{ scrollMarginTop: 110 }}
        >
          <h5 style={{ overflow: 'hidden', margin: '14px 4px 6px' }}>{g.label}</h5>
          <div
            style={{
              display: 'grid',
              // minmax(0, 1fr) — not the bare `1fr` (== minmax(auto, 1fr)) — so
              // tracks may shrink below content min-size and the grid can never
              // force horizontal overflow as column count grows (TODO Bugfix #2).
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: 2,
            }}
          >
            {g.cells.map((entry) => (
              <SpriteCell
                key={entry.image}
                spriteUrl={albumSpriteUrl(album, entry.sheet.file)}
                cols={entry.sheet.columns}
                rows={entry.sheet.rows}
                x={entry.x}
                y={entry.y}
                w={entry.w}
                h={entry.h}
                format={entry.format}
                label={entry.image}
                onClick={() => onSelect(entry.globalIndex)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
