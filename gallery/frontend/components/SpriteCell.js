// vim: tabstop=2 shiftwidth=2 expandtab
//
// One square cell drawn as a crop of a sprite sheet, via the percentage
// background technique — so it stays crisp and responsive at any rendered size
// (the album grid and the home cover both reuse this). `spriteUrl` is the sheet
// image; `cols`/`rows` are that sheet's packing; `x`/`y`/`w`/`h` are the cell's
// baked pixel geometry (w === h === cell size).

function PlayBadge() {
  return (
    <svg
      viewBox="0 0 26 26"
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '34%',
        opacity: 0.55,
        fill: '#fff',
        pointerEvents: 'none',
      }}
    >
      <polygon points="9.33 6.69 9.33 19.39 19.3 13.04 9.33 6.69" />
      <path d="M26,13A13,13,0,1,1,13,0,13,13,0,0,1,26,13ZM13,2.18A10.89,10.89,0,1,0,23.84,13.06,10.89,10.89,0,0,0,13,2.18Z" />
    </svg>
  )
}

export default function SpriteCell({
  spriteUrl,
  cols,
  rows,
  x,
  y,
  w,
  h,
  format,
  label,
  onClick,
}) {
  // Column/row of this cell within its sheet (x/y are in baked cell-size units).
  const cx = w ? x / w : 0
  const cy = h ? y / h : 0
  // CSS background-position percentage formula for an N-cell strip.
  const posX = cols > 1 ? (cx / (cols - 1)) * 100 : 0
  const posY = rows > 1 ? (cy / (rows - 1)) * 100 : 0
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={label}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick()
            }
          : undefined
      }
      style={{
        aspectRatio: '1 / 1',
        backgroundColor: '#111',
        backgroundImage: `url(${spriteUrl})`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${posX}% ${posY}%`,
        backgroundRepeat: 'no-repeat',
        borderRadius: 2,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
      }}
    >
      {format === 'video' && <PlayBadge />}
    </div>
  )
}
