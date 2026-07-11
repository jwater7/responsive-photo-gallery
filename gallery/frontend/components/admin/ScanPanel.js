// vim: tabstop=2 shiftwidth=2 expandtab
//
// Scan & enrich: a 3-way mode switch (delta/full/force) + one Scan button.
// The scope controls (stage + path) only apply in "force" mode. The actual
// trigger + result message live in the page (shared with the reap action);
// this panel owns only the mode/scope selection and the force confirm.

import { useState } from 'react'
import {
  Row,
  Col,
  Button,
  Card,
  Form,
  ToggleButton,
  ToggleButtonGroup,
} from 'react-bootstrap'
import InfoTip from './InfoTip'

export default function ScanPanel({ busy, unreachable, onRunSync }) {
  const [scanMode, setScanMode] = useState('delta')
  // Stage scope for force: 'all' -> force:true, or a single enricher name ->
  // [name]. The names mirror enrichment/src/enrichers (ocr, visual, geo,
  // caption).
  const [forceStage, setForceStage] = useState('all')
  const [forcePath, setForcePath] = useState('')

  // Translate the scan-mode switch into a /enrichment-sync call. "force"
  // re-runs enrichers even on up-to-date docs, scoped by stage (all or one
  // enricher) and an optional path (album / sub-folder / file); it's a full
  // enqueue under the hood. Confirm first since it ignores the up-to-date skip
  // and is slow.
  const runScan = () => {
    if (scanMode !== 'force') return onRunSync(scanMode)
    const force = forceStage === 'all' ? true : [forceStage]
    const path = forcePath.trim()
    const where = path ? `everything under "${path}"` : 'the WHOLE library'
    const what = forceStage === 'all' ? 'all enrichers' : forceStage.toUpperCase()
    if (
      !window.confirm(
        `Force re-enrich ${what} on ${where}? This ignores up-to-date docs and can be slow.`
      )
    )
      return
    return onRunSync('full', { force, ...(path ? { path } : {}) })
  }

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title>
          Scan &amp; enrich{' '}
          <InfoTip
            id="scan-help"
            label="What’s the difference between Delta and Full?"
          >
            <strong>Delta scan</strong> (also runs automatically each day):
            quickly finds new or changed photos by file size + modified time.
            Fast — it doesn’t re-read the whole library.
            <hr className="my-2" />
            <strong>Full scan</strong>: re-reads every photo to re-hash it.
            Slower, but also catches edits that kept the same size and date.
            Run it on demand.
            <hr className="my-2" />
            <strong>Force</strong>: re-runs enrichers even on already-processed
            photos (ignores the up-to-date skip) — for testing pipeline
            changes. Scope it to one stage and an optional album/folder/file.
            Slow; use sparingly.
            <hr className="my-2" />
            Delta and Full skip already-enriched photos; all return immediately
            and run in the background.
          </InfoTip>
        </Card.Title>
        <Card.Text className="text-muted">
          New and changed photos are picked up automatically (a delta scan runs
          daily). Pick a mode and run it now: <em>delta</em> for new/changed
          photos, <em>full</em> to re-hash everything, or <em>force</em> to
          re-run enrichers even on already-processed photos (for testing
          pipeline changes).
        </Card.Text>
        <Row className="g-2 align-items-center">
          <Col xs="auto">
            <ToggleButtonGroup
              type="radio"
              name="scanMode"
              value={scanMode}
              onChange={setScanMode}
            >
              <ToggleButton
                id="scan-mode-delta"
                value="delta"
                variant="outline-secondary"
                disabled={busy || unreachable}
              >
                Delta
              </ToggleButton>
              <ToggleButton
                id="scan-mode-full"
                value="full"
                variant="outline-secondary"
                disabled={busy || unreachable}
              >
                Full
              </ToggleButton>
              <ToggleButton
                id="scan-mode-force"
                value="force"
                variant="outline-secondary"
                disabled={busy || unreachable}
              >
                Force
              </ToggleButton>
            </ToggleButtonGroup>
          </Col>
          <Col xs="auto">
            <Button onClick={runScan} disabled={busy || unreachable}>
              {busy ? 'Starting…' : 'Scan'}
            </Button>
          </Col>
        </Row>
        {scanMode === 'force' && (
          <Row className="g-2 align-items-center mt-1">
            <Col xs="auto">
              <Form.Select
                aria-label="Force which enricher stage"
                value={forceStage}
                onChange={(e) => setForceStage(e.target.value)}
                disabled={busy || unreachable}
                style={{ width: 'auto' }}
              >
                {/* names mirror enrichment/src/enrichers */}
                <option value="all">All stages</option>
                <option value="ocr">OCR</option>
                <option value="visual">Visual / CLIP</option>
                <option value="geo">Geo</option>
                <option value="caption">Caption</option>
              </Form.Select>
            </Col>
            <Col xs="auto" className="flex-grow-1">
              <Form.Control
                type="text"
                placeholder="album, sub-folder, or file path — blank = whole library"
                value={forcePath}
                onChange={(e) => setForcePath(e.target.value)}
                disabled={busy || unreachable}
              />
            </Col>
          </Row>
        )}
      </Card.Body>
    </Card>
  )
}
