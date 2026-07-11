// vim: tabstop=2 shiftwidth=2 expandtab
//
// Index cleanup: prune index entries for deleted or edited-away photos. The
// trigger + result message live in the page (shared busy state with the scan
// action); `lastReap` rides on the polled enrichment status.

import { Card, Button } from 'react-bootstrap'
import InfoTip from './InfoTip'

export default function ReapPanel({ busy, unreachable, lastReap, onReap }) {
  return (
    <Card className="mt-3">
      <Card.Body>
        <Card.Title>
          Index cleanup{' '}
          <InfoTip id="reap-help" label="What does index cleanup do?">
            Removes search/map index entries for photos that no longer exist on
            disk — files you’ve <strong>deleted</strong>, plus leftover
            duplicates from files you’ve <strong>edited</strong> (the old
            version’s entry). It only deletes index data; your photo files and
            the album thumbnail cache are untouched.
            <hr className="my-2" />
            Safe by design: if the photo folder reads as empty (e.g. a storage
            hiccup), it does nothing rather than risk wiping the index.
          </InfoTip>
        </Card.Title>
        <Card.Text className="text-muted">
          Prune index entries for deleted or edited-away photos so they stop
          showing up in search and on the map. Runs in the background.
        </Card.Text>
        <Button
          variant="outline-danger"
          onClick={onReap}
          disabled={busy || unreachable}
          title="Remove index entries for photos that no longer exist on disk."
        >
          {busy ? 'Starting…' : 'Reap deleted'}
        </Button>
        {lastReap && (
          <div className="mt-3">
            {lastReap.skipped === 'empty-walk' ? (
              <span className="text-muted">
                Last cleanup: skipped — the photo folder looked empty (nothing
                was removed).
              </span>
            ) : (
              <span className="text-muted">
                Last cleanup: removed <strong>{lastReap.reaped}</strong>{' '}
                {lastReap.reaped === 1 ? 'entry' : 'entries'} (
                {lastReap.orphanPaths} deleted{' '}
                {lastReap.orphanPaths === 1 ? 'file' : 'files'},{' '}
                {lastReap.supersededHashes} superseded).
              </span>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  )
}
