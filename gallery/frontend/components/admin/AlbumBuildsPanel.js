// vim: tabstop=2 shiftwidth=2 expandtab
//
// Album cache builds in progress (sprite/cover (re)builds). Presentational —
// the polling hook (useAlbumActivity) stays in the page.

import { Card, Badge } from 'react-bootstrap'

export default function AlbumBuildsPanel({ activity }) {
  return (
    <Card>
      <Card.Body>
        <Card.Title>
          Album builds{' '}
          {activity && activity.building.length > 0 ? (
            <Badge bg="primary">{activity.building.length} in progress</Badge>
          ) : (
            <Badge bg="secondary">idle</Badge>
          )}
        </Card.Title>
        <Card.Text className="text-muted">
          Sprite/cover caches being (re)built — e.g. when an album is first
          opened or its photos change. Builds run {activity?.concurrency ?? 0}{' '}
          at a time; the rest queue.
        </Card.Text>
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
