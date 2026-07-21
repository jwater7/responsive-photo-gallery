// vim: tabstop=2 shiftwidth=2 expandtab
//
// Album cache builds in progress (sprite/cover (re)builds) plus the on-demand
// "Rebuild" action: an album checkbox grid (same pattern as ExcludesPanel —
// the visible-album universe loaded once) and one button for the selection.
// The polling hook (useAlbumActivity) stays in the page; the API call comes
// in as `onRebuild`.

import { useState, useEffect } from 'react'
import { Row, Col, Card, Badge, Form, Button, Alert } from 'react-bootstrap'
import { albums as fetchAlbums } from '../../lib/api'
import InfoTip from './InfoTip'

export default function AlbumBuildsPanel({ activity, onRebuild, loggedIn }) {
  const [albumNames, setAlbumNames] = useState(null) // null while loading
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null) // { variant, text }

  useEffect(() => {
    if (!loggedIn) return
    let cancelled = false
    ;(async () => {
      try {
        const al = await fetchAlbums()
        if (!cancelled) setAlbumNames(Object.keys(al || {}).sort())
      } catch (err) {
        if (!cancelled) setAlbumNames([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loggedIn])

  const toggle = (name) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const runRebuild = async () => {
    const names = Array.from(selected).sort()
    if (!names.length || busy) return
    setBusy(true)
    setMessage(null)
    // Each POST just drops the manifest and enqueues the background build
    // (concurrency-capped server-side), so firing them back-to-back is cheap.
    const failed = []
    for (const name of names) {
      try {
        await onRebuild(name)
      } catch (err) {
        failed.push(`${name}: ${err.message}`)
      }
    }
    const started = names.length - failed.length
    setMessage(
      failed.length
        ? {
            variant: 'danger',
            text: `Started ${started} of ${names.length} — ${failed.join('; ')}`,
          }
        : {
            variant: 'success',
            text: `Rebuilding ${started} ${started === 1 ? 'album' : 'albums'} — progress shows below.`,
          }
    )
    if (!failed.length) setSelected(new Set())
    setBusy(false)
  }

  return (
    <Card>
      <Card.Body>
        <Card.Title>
          Album builds{' '}
          {activity && activity.building.length > 0 ? (
            <Badge bg="primary">{activity.building.length} in progress</Badge>
          ) : (
            <Badge bg="secondary">idle</Badge>
          )}{' '}
          <InfoTip id="album-rebuild-help" label="When do I need a rebuild?">
            The album cache only rebuilds itself when an album’s{' '}
            <strong>files</strong> change. After an app update that fixes how
            albums are built (e.g. video formats an older build skipped), the
            old cached album is still served — tick the album(s) and rebuild
            here to pick up the fix. Thumbnails and sprite sheets are
            regenerated in place; nothing else is touched.
          </InfoTip>
        </Card.Title>
        <Card.Text className="text-muted">
          Sprite/cover caches being (re)built — e.g. when an album is first
          opened or its photos change. Builds run {activity?.concurrency ?? 0}{' '}
          at a time; the rest queue.
        </Card.Text>

        {message && (
          <Alert
            variant={message.variant}
            dismissible
            onClose={() => setMessage(null)}
          >
            {message.text}
          </Alert>
        )}

        <div className="mb-3">
          <strong>Force a rebuild</strong>
          <div className="text-muted small mb-2">
            Tick the album(s) whose cache should be regenerated.
          </div>
          {albumNames === null ? (
            <span className="text-muted">Loading…</span>
          ) : albumNames.length === 0 ? (
            <span className="text-muted">No albums found.</span>
          ) : (
            <Row>
              {albumNames.map((name) => (
                <Col xs={12} sm={6} md={4} key={name}>
                  <Form.Check
                    type="checkbox"
                    id={`rebuild-${name}`}
                    label={name}
                    checked={selected.has(name)}
                    onChange={() => toggle(name)}
                  />
                </Col>
              ))}
            </Row>
          )}
          <Button
            variant="outline-primary"
            className="mt-2"
            onClick={runRebuild}
            disabled={busy || selected.size === 0}
            title="Drop the selected albums' cached manifests and rebuild them in the background."
          >
            {busy
              ? 'Starting…'
              : `Rebuild selected${selected.size ? ` (${selected.size})` : ''}`}
          </Button>
        </div>

        {!activity ? (
          <Card.Text>Loading…</Card.Text>
        ) : activity.building.length === 0 ? (
          <Card.Text className="text-muted">No builds in progress.</Card.Text>
        ) : (
          <ul className="list-unstyled mb-0">
            {activity.building.map((b) => (
              <li key={b.album}>
                <strong>{b.album}</strong>{' '}
                {b.total > 0 ? (
                  <span className="text-muted">
                    {b.done}/{b.total} images · {b.sheetsReady} sheets
                  </span>
                ) : (
                  <Badge bg="secondary">queued</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card.Body>
    </Card>
  )
}
