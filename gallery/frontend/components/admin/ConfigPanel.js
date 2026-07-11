// vim: tabstop=2 shiftwidth=2 expandtab
//
// Read-only view of the enrichment service's effective env config, fetched on
// demand. No write path — config is compose-set, not changeable at runtime.

import { Card, Button } from 'react-bootstrap'
import { getEnrichConfig } from '../../lib/enrich-api'
import { useOnDemandFetch } from '../../data/use-on-demand-fetch'
import InfoTip from './InfoTip'

const ConfigCategories = ({ categories }) =>
  (categories || []).map((cat) => (
    <div key={cat.category} className="mb-2">
      <div className="fw-semibold">{cat.category}</div>
      <ul className="list-unstyled mb-0">
        {cat.items.map((it) => (
          <li key={it.env}>
            {it.label}: <strong>{String(it.value)}</strong>{' '}
            <span className="text-muted small">
              {it.env}
              {it.source === 'env' ? ' · set via env' : ' · built-in default'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ))

export default function ConfigPanel({ unreachable }) {
  const config = useOnDemandFetch(getEnrichConfig)

  return (
    <Card className="mt-3">
      <Card.Body>
        <Card.Title>
          Configuration{' '}
          <InfoTip id="config-help" label="What is this configuration?">
            The enrichment service’s effective settings.{' '}
            <strong>Read-only</strong> — config comes from the docker-compose
            env and isn’t changeable at runtime; secrets are omitted. Split by
            owner so no value is guessed: <strong>Worker</strong> (OCR, tags,
            scan, watcher) is reported by the worker itself;{' '}
            <strong>Service</strong> (search, connections) by the API. If the
            worker hasn’t reported yet, its section says so rather than
            assuming defaults.
          </InfoTip>
        </Card.Title>
        <Card.Text className="text-muted">
          Effective enrichment settings (read-only; set via docker-compose
          env). Press Show config for a current snapshot.
        </Card.Text>
        <Button
          variant="outline-secondary"
          onClick={config.run}
          disabled={config.busy || unreachable}
          title="Read-only snapshot of the enrichment service's effective configuration."
        >
          {config.busy ? 'Loading…' : 'Show config'}
        </Button>
        {config.error && (
          <div className="mt-3 text-danger">
            Could not load config — the enrichment service is unreachable.
          </div>
        )}
        {config.data && !config.error && (
          <div className="mt-3">
            <div className="fw-bold">Worker</div>
            {config.data.worker ? (
              <>
                {config.data.worker.at && (
                  <div className="text-muted small mb-1">
                    reported {new Date(config.data.worker.at).toLocaleString()}
                  </div>
                )}
                <ConfigCategories categories={config.data.worker.categories} />
              </>
            ) : (
              <div className="text-muted mb-2">
                The worker hasn’t reported its configuration yet (it publishes
                on boot). No values are assumed.
              </div>
            )}
            <div className="fw-bold mt-2">Service (API)</div>
            <ConfigCategories categories={config.data.service?.categories} />
          </div>
        )}
      </Card.Body>
    </Card>
  )
}
