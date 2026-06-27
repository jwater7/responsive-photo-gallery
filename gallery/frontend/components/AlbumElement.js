// vim: tabstop=2 shiftwidth=2 expandtab
//
// Home-page album preview: a responsive grid of evenly-sampled thumbnails drawn
// from the album's cached cover sprite sheet. The grid adapts its column count to
// the viewport (CSS auto-fill), so the same one cached request looks right on
// phone and desktop — no per-screen server variants. Height-capped so it stays a
// compact banner (and many-album home pages don't get tall).

import { useAlbum } from '../data/use-album'
import { albumCoverUrl } from '../lib/api'
import SpriteCell from './SpriteCell'

// Fixed-size square cells so rows have a known height; cap to a whole number of
// rows (the clip lands exactly on a row boundary — never mid-cell). auto-fill
// keeps it responsive: a wide screen shows everything in ~3 rows, while a narrow
// screen fits more columns *and* uses more of the row budget — so small screens
// still show a useful count (~25), not just one short row.
const COVER_CELL = 72
const COVER_ROWS = 5
const COVER_GAP = 2

export const AlbumElement = ({ album }) => {
  const { manifest, building, status } = useAlbum(album)
  const cover = manifest?.cover

  if (cover?.cells?.length) {
    const url = albumCoverUrl(album, manifest.albumHash)
    return (
      <div
        style={{
          maxHeight: COVER_ROWS * COVER_CELL + (COVER_ROWS - 1) * COVER_GAP,
          overflow: 'hidden',
          borderRadius: 4,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, ${COVER_CELL}px)`,
            justifyContent: 'space-between',
            gap: COVER_GAP,
          }}
        >
          {cover.cells.map((c, i) => (
            <SpriteCell
              key={`${c.image}-${i}`}
              spriteUrl={url}
              cols={cover.columns}
              rows={cover.rows}
              x={c.x}
              y={c.y}
              w={c.w}
              h={c.h}
              format={c.format}
              label={c.image}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: 120,
        borderRadius: 4,
        background: '#f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#888',
        fontSize: 14,
      }}
    >
      {building
        ? `Building… ${status?.done ?? 0}/${status?.total ?? '?'}`
        : 'Loading…'}
    </div>
  )
}
