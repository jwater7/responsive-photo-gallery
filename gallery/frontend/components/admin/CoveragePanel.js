// vim: tabstop=2 shiftwidth=2 expandtab
//
// Enrichment coverage: one-shot snapshots, fetched only on button press.
// Deliberately NOT polled (cf. the live Status card) so it never adds
// background load and never races a running scan. Coverage is a cheap
// index-metadata read; OCR detail scans every doc's OCR fields, so it's
// behind its own button.

import { useState } from 'react'
import { Card, Button } from 'react-bootstrap'
import {
  getEnrichIndexStats,
  getEnrichOcrStats,
  clearEnrichFailedTasks,
} from '../../lib/enrich-api'
import { useOnDemandFetch } from '../../data/use-on-demand-fetch'
import InfoTip from './InfoTip'

export default function CoveragePanel({ unreachable }) {
  const coverage = useOnDemandFetch(getEnrichIndexStats)
  const ocr = useOnDemandFetch(getEnrichOcrStats)

  // Delete Meili's retained FAILED task history, resetting the failedTasks
  // health signal. Meant for AFTER the underlying cause is fixed (otherwise it
  // just climbs again), so it's confirmed and only offered when the count is
  // nonzero. Failures report into the coverage panel's error slot.
  const [clearingTasks, setClearingTasks] = useState(false)
  const clearFailedTasks = async () => {
    if (
      !window.confirm(
        'Delete the retained failed-task history in the search index? ' +
          'Do this only after the cause of the failures is fixed — otherwise ' +
          'the count will just climb again. This does not touch your photos or ' +
          'their data.'
      )
    )
      return
    setClearingTasks(true)
    try {
      await clearEnrichFailedTasks()
      // Deletion is async on the Meili side; give it a moment, then re-read the
      // coverage snapshot so the failedTasks line reflects the drop.
      await new Promise((r) => setTimeout(r, 1200))
      await coverage.run()
    } catch (err) {
      coverage.setError(true)
    } finally {
      setClearingTasks(false)
    }
  }

  return (
    <Card className="mt-3">
      <Card.Body>
        <Card.Title>
          Enrichment coverage{' '}
          <InfoTip id="coverage-help" label="What is enrichment coverage?">
            A one-shot snapshot of how much of the search/map index carries
            each enrichment. Fetched only on demand (it isn’t polled), and it’s
            a cheap index-metadata read — safe to hit while a scan is running;
            it won’t interrupt enrichment.
            <hr className="my-2" />
            <strong>OCR processed</strong> counts photos the text stage ran on
            (some have no readable text). <strong>Geo-checked</strong> is
            photos inspected for GPS; <strong>with location</strong> is the
            subset that actually had coordinates.
          </InfoTip>
        </Card.Title>
        <Card.Text className="text-muted">
          How many indexed photos have embeddings, OCR, geo, and other
          enrichments. Press Fetch for a current snapshot.
        </Card.Text>
        <Button
          variant="outline-secondary"
          onClick={coverage.run}
          disabled={coverage.busy || unreachable}
          title="Fetch a one-shot enrichment coverage snapshot. Does not interrupt scanning."
        >
          {coverage.busy ? 'Fetching…' : 'Fetch'}
        </Button>{' '}
        <Button
          variant="outline-secondary"
          onClick={ocr.run}
          disabled={ocr.busy || unreachable}
          title="OCR quality detail: text yield, confidence distribution, and failures. Scans every doc's OCR fields (heavier than coverage); read-only, safe mid-scan."
        >
          {ocr.busy ? 'Computing…' : 'OCR detail'}
        </Button>
        {coverage.error && (
          <div className="mt-3 text-danger">
            Could not fetch coverage — the enrichment service is unreachable.
          </div>
        )}
        {coverage.data && !coverage.error && (
          <>
            <ul className="list-unstyled mb-0 mt-3">
              <li>
                Indexed photos: <strong>{coverage.data.totalDocs}</strong>
              </li>
              {(() => {
                const total = coverage.data.totalDocs || 0
                const c = coverage.data.coverage || {}
                const pct = (n) =>
                  total > 0 ? ` (${Math.round((n / total) * 100)}%)` : ''
                const rows = [
                  ['Embeddings (semantic search)', c.embeddings],
                  ['OCR processed', c.ocrProcessed],
                  ['Geo-checked', c.geoChecked],
                  ['With location', c.withLocation],
                  ['With place name', c.withPlaceName],
                  ['With capture date', c.withCaptureDate],
                  ['With tags', c.withTags],
                ]
                return rows.map(([label, n]) => (
                  <li key={label}>
                    {label}: <strong>{n || 0}</strong>
                    <span className="text-muted">{pct(n || 0)}</span>
                  </li>
                ))
              })()}
            </ul>
            {coverage.data.failedTasks != null && (
              <div
                className={`mt-2 small ${
                  coverage.data.failedTasks > 0 ? 'text-danger' : 'text-muted'
                }`}
              >
                Failed index tasks (Meili):{' '}
                <strong>{coverage.data.failedTasks}</strong>
                {coverage.data.failedTasks > 0 && (
                  <>
                    {' — cumulative; a nonzero value means document writes were' +
                      ' rejected downstream (e.g. a doc missing its embedding' +
                      ' vector). Investigate, then clear once resolved.'}
                    <Button
                      variant="outline-danger"
                      size="sm"
                      className="ms-2 py-0"
                      onClick={clearFailedTasks}
                      disabled={clearingTasks || unreachable}
                      title="Delete the retained failed-task history. Do this only after the cause is fixed."
                    >
                      {clearingTasks ? 'Clearing…' : 'Clear'}
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
        {ocr.error && (
          <div className="mt-3 text-danger">
            Could not compute OCR stats — the enrichment service is
            unreachable.
          </div>
        )}
        {ocr.data && !ocr.error && (
          <div className="mt-3">
            <hr />
            <div className="fw-semibold mb-1">OCR detail</div>
            {(() => {
              const stats = ocr.data
              const n = stats.totalDocs || 0
              const pct = (k) => (n > 0 ? ` (${Math.round((k / n) * 100)}%)` : '')
              const conf = stats.confidence
              const len = stats.contentLength
              const pc = (v) => `${Math.round((v || 0) * 100)}%`
              const versions = Object.entries(stats.versions || {})
                .map(([v, c]) => `${v === 'unstamped' ? 'unstamped' : 'v' + v}=${c}`)
                .join(', ')
              return (
                <ul className="list-unstyled mb-0">
                  <li>
                    With text: <strong>{stats.withText}</strong>
                    <span className="text-muted">{pct(stats.withText)}</span>
                  </li>
                  <li>
                    Empty (no text): <strong>{stats.empty}</strong>
                    <span className="text-muted">{pct(stats.empty)}</span>
                  </li>
                  <li className={stats.withError ? 'text-danger' : undefined}>
                    Failed: <strong>{stats.withError}</strong>
                    <span className="text-muted">{pct(stats.withError)}</span>
                  </li>
                  {conf && (
                    <li>
                      Confidence: <strong>{pc(conf.mean)}</strong> mean
                      <span className="text-muted">
                        {' '}
                        (median {pc(conf.median)}, p10 {pc(conf.p10)})
                      </span>
                    </li>
                  )}
                  {len && (
                    <li className="text-muted">
                      Text length: mean {len.mean}, median {len.median}, max{' '}
                      {len.max} chars
                    </li>
                  )}
                  {versions && (
                    <li className="text-muted">Version stamps: {versions}</li>
                  )}
                  {stats.errors && stats.errors.length > 0 && (
                    <li className="mt-1">
                      <span className="text-danger">Sample failures:</span>
                      <ul className="mb-0">
                        {stats.errors.map((e) => (
                          <li key={e.path} className="text-muted small">
                            {e.path}: {e.error}
                          </li>
                        ))}
                      </ul>
                    </li>
                  )}
                </ul>
              )
            })()}
          </div>
        )}
      </Card.Body>
    </Card>
  )
}
