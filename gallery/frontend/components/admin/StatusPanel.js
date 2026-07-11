// vim: tabstop=2 shiftwidth=2 expandtab
//
// Live enrichment status: queue depth, per-scan progress, last/next scan.
// Purely presentational — the polling hook (useEnrichStatus) stays in the
// page, which also derives `unreachable` from it for every enrichment panel.

import { Card, Badge } from 'react-bootstrap'

export default function StatusPanel({ status, isLoading, unreachable }) {
  const inProgress = status?.inProgress
  const q = status?.queue
  const prog = status?.progress

  return (
    <Card>
      <Card.Body>
        <Card.Title>
          Status{' '}
          {!unreachable &&
            (inProgress ? (
              <Badge bg="primary">running</Badge>
            ) : status?.queueStatus === 'unknown' ? (
              <Badge bg="warning" text="dark">
                unknown
              </Badge>
            ) : (
              <Badge bg="secondary">idle</Badge>
            ))}
        </Card.Title>
        {isLoading ? (
          <Card.Text>Loading…</Card.Text>
        ) : unreachable ? (
          <Card.Text className="text-muted">Unavailable.</Card.Text>
        ) : (
          <ul className="list-unstyled mb-0">
            <li>
              Enqueuing files: <strong>{status.enqueuing ? 'yes' : 'no'}</strong>
            </li>
            {q ? (
              <>
                <li>
                  Active jobs: <strong>{q.active || 0}</strong>
                </li>
                <li>
                  Waiting: <strong>{(q.waiting || 0) + (q.delayed || 0)}</strong>
                </li>
                {'failed' in q && (
                  <li>
                    Failed: <strong>{q.failed}</strong>
                  </li>
                )}
              </>
            ) : (
              <>
                <li className="text-muted">
                  Queue status unknown — the broker is unreachable, or the
                  worker is busy and the status read timed out.
                </li>
                {prog && (
                  <li>
                    Active jobs (worker): <strong>{prog.active}</strong>
                  </li>
                )}
              </>
            )}
            {prog && prog.completed > 0 && (
              <li>
                Processed this scan: <strong>{prog.completed}</strong>{' '}
                <span className="text-muted">
                  ({prog.enriched} enriched, {prog.skipped} already current)
                </span>
              </li>
            )}
            {prog && prog.failed > 0 && (
              <li className="text-danger">
                Failed this scan: <strong>{prog.failed}</strong>
                {prog.failedByStage &&
                  Object.keys(prog.failedByStage).length > 0 && (
                    <span className="text-muted">
                      {' '}
                      (
                      {Object.entries(prog.failedByStage)
                        .map(([stage, n]) => `${stage}: ${n}`)
                        .join(', ')}
                      )
                    </span>
                  )}{' '}
                — see the enrichment logs for reasons; a Full scan retries them.
              </li>
            )}
            {status.lastScan && (
              <li>
                Last scan:{' '}
                <strong>
                  {status.lastScan.type === 'delta' ? 'Delta' : 'Full'}
                </strong>{' '}
                <span className="text-muted">
                  ({status.lastScan.enqueued} queued
                  {status.lastScan.type === 'delta'
                    ? `, ${status.lastScan.skipped} unchanged`
                    : ''}
                  )
                </span>
              </li>
            )}
            {status.nextScheduledScan && (
              <li>
                Next scheduled scan:{' '}
                <strong>
                  {new Date(status.nextScheduledScan).toLocaleString()}
                </strong>
              </li>
            )}
          </ul>
        )}
      </Card.Body>
    </Card>
  )
}
