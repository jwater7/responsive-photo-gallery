// vim: tabstop=2 shiftwidth=2 expandtab
//
// Minimal admin page. First tool: trigger a (re)scan / enrichment pass and watch
// its progress live. Gated behind auth like the rest of the app; the enrichment
// controls degrade gracefully when the enrichment plane is unreachable.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Breadcrumb,
  Row,
  Col,
  Button,
  Card,
  Badge,
  Alert,
  Form,
  InputGroup,
  OverlayTrigger,
  Tooltip,
} from 'react-bootstrap';
import { usePing } from '../data/use-ping';
import { useEnrichStatus } from '../data/use-enrich-status';
import { useAlbumActivity } from '../data/use-album-activity';
import {
  triggerEnrichmentSync,
  triggerReap,
  getEnrichIndexStats,
  getEnrichOcrStats,
  getEnrichConfig,
} from '../lib/enrich-api';
import {
  albums as fetchAlbums,
  getExcludes,
  setExcludes,
  listUsers,
  createUser,
  setUserPassword,
  deleteUser,
} from '../lib/api';

export default function Admin() {
  const { loggedIn, isLoading: isPingLoading } = usePing({ redirect: '/' });
  const {
    status,
    error,
    isLoading: isStatusLoading,
    mutate,
  } = useEnrichStatus();
  const { activity } = useAlbumActivity();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // --- Enrichment coverage -------------------------------------------------
  // A one-shot snapshot of how much of the index carries each enrichment.
  // Deliberately NOT polled (cf. the live Status card): it's fetched only when
  // the user presses Fetch, so it never adds background load and never races a
  // running scan. The read is a cheap index-metadata lookup on the indexer side.
  const [coverage, setCoverage] = useState(null);
  const [coverageBusy, setCoverageBusy] = useState(false);
  const [coverageError, setCoverageError] = useState(false);

  const fetchCoverage = async () => {
    setCoverageBusy(true);
    setCoverageError(false);
    try {
      setCoverage(await getEnrichIndexStats());
    } catch (err) {
      setCoverageError(true);
    } finally {
      setCoverageBusy(false);
    }
  };

  // OCR detail: a richer, on-demand read than coverage. Scans every doc's OCR
  // fields (content yield, confidence distribution, failures), so it's its own
  // button and not auto-loaded.
  const [ocrStats, setOcrStats] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState(false);

  const fetchOcrStats = async () => {
    setOcrBusy(true);
    setOcrError(false);
    try {
      setOcrStats(await getEnrichOcrStats());
    } catch (err) {
      setOcrError(true);
    } finally {
      setOcrBusy(false);
    }
  };

  // Read-only view of the enrichment service's effective env config. No write
  // path — config is compose-set, not changeable at runtime.
  const [enrichConfig, setEnrichConfig] = useState(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [configError, setConfigError] = useState(false);

  const fetchConfig = async () => {
    setConfigBusy(true);
    setConfigError(false);
    try {
      setEnrichConfig(await getEnrichConfig());
    } catch (err) {
      setConfigError(true);
    } finally {
      setConfigBusy(false);
    }
  };

  const renderConfigCategories = (cats) =>
    (cats || []).map((cat) => (
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
    ));

  const runSync = async (type) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await triggerEnrichmentSync(type);
      setMessage({
        variant: 'success',
        text: r.message || 'Enrichment scan started.',
      });
      mutate(); // refresh status immediately
    } catch (err) {
      setMessage({
        variant: 'danger',
        text: 'Could not reach the enrichment service.',
      });
    } finally {
      setBusy(false);
    }
  };

  const runReap = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await triggerReap();
      setMessage({
        variant: 'success',
        text: r.message || 'Index cleanup started.',
      });
      mutate(); // refresh status immediately
    } catch (err) {
      setMessage({
        variant: 'danger',
        text: 'Could not reach the enrichment service.',
      });
    } finally {
      setBusy(false);
    }
  };

  // --- Excluded directories ------------------------------------------------
  // `excludes` is the working copy (null while loading); `albumNames` is the
  // list of currently-VISIBLE albums (the /albums route already hides excluded
  // ones, so the full top-level set = visible names ∪ top-level excludes).
  const [excludes, setExcludesState] = useState(null);
  const [albumNames, setAlbumNames] = useState([]);
  const [excludesBusy, setExcludesBusy] = useState(false);
  const [excludesMsg, setExcludesMsg] = useState(null);
  const [newPath, setNewPath] = useState('');

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const [ex, al] = await Promise.all([getExcludes(), fetchAlbums()]);
        if (cancelled) return;
        setExcludesState(ex);
        // The album universe shown as checkboxes. /albums already HIDES excluded
        // albums, so a currently-excluded top-level album is absent from `al` and
        // only re-enters the list via the excludes. Fold the loaded top-level
        // excludes in here so the universe is stable: unchecking one removes it
        // from the working excludes without making it vanish from the list (it
        // stays a visible, now-unticked checkbox until Save).
        const topEx = (ex || []).filter((e) => !e.includes('/'));
        setAlbumNames(
          Array.from(new Set([...Object.keys(al || {}), ...topEx])).sort()
        );
      } catch (err) {
        if (!cancelled) setExcludesState([]); // show the panel; albums may be empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  const toggleAlbum = (name) => {
    setExcludesState((cur) => {
      const set = new Set(cur || []);
      if (set.has(name)) set.delete(name);
      else set.add(name);
      return Array.from(set);
    });
  };

  const addNested = () => {
    const p = newPath.trim();
    if (!p) return;
    setExcludesState((cur) => Array.from(new Set([...(cur || []), p])));
    setNewPath('');
  };

  const removeEntry = (entry) => {
    setExcludesState((cur) => (cur || []).filter((e) => e !== entry));
  };

  const saveExcludes = async () => {
    setExcludesBusy(true);
    setExcludesMsg(null);
    try {
      const saved = await setExcludes(excludes || []);
      setExcludesState(saved); // server-normalized
      setExcludesMsg({
        variant: 'success',
        text: 'Saved. Excluded albums are now hidden; cache and index cleanup run in the background.',
      });
    } catch (err) {
      setExcludesMsg({ variant: 'danger', text: 'Could not save excludes.' });
    } finally {
      setExcludesBusy(false);
    }
  };

  // --- User management -----------------------------------------------------
  // `users` is null while loading. Reset-password is an inline per-row input
  // (toggled via `resetFor`) rather than a modal, to stay light.
  const [users, setUsers] = useState(null);
  const [usersMsg, setUsersMsg] = useState(null);
  const [userBusy, setUserBusy] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetFor, setResetFor] = useState(null);
  const [resetPw, setResetPw] = useState('');

  const loadUsers = async () => {
    try {
      setUsers(await listUsers());
    } catch (err) {
      setUsers([]);
      setUsersMsg({ variant: 'danger', text: 'Could not load users.' });
    }
  };

  useEffect(() => {
    if (!loggedIn) return;
    loadUsers();
  }, [loggedIn]);

  const addUser = async () => {
    setUserBusy(true);
    setUsersMsg(null);
    try {
      await createUser(newUsername.trim(), newPassword);
      setNewUsername('');
      setNewPassword('');
      setUsersMsg({ variant: 'success', text: `User "${newUsername.trim()}" created.` });
      await loadUsers();
    } catch (err) {
      setUsersMsg({ variant: 'danger', text: err.message || 'Could not create user.' });
    } finally {
      setUserBusy(false);
    }
  };

  const savePassword = async (username) => {
    setUserBusy(true);
    setUsersMsg(null);
    try {
      await setUserPassword(username, resetPw);
      setResetFor(null);
      setResetPw('');
      setUsersMsg({ variant: 'success', text: `Password updated for "${username}".` });
    } catch (err) {
      setUsersMsg({ variant: 'danger', text: err.message || 'Could not set password.' });
    } finally {
      setUserBusy(false);
    }
  };

  const removeUser = async (username) => {
    setUserBusy(true);
    setUsersMsg(null);
    try {
      await deleteUser(username);
      setUsersMsg({ variant: 'success', text: `User "${username}" deleted.` });
      await loadUsers();
    } catch (err) {
      setUsersMsg({ variant: 'danger', text: err.message || 'Could not delete user.' });
    } finally {
      setUserBusy(false);
    }
  };

  if (isPingLoading) return <></>;
  if (!loggedIn) return <>Redirecting...</>;

  const topLevelExcludes = (excludes || []).filter((e) => !e.includes('/'));
  const nestedExcludes = (excludes || []).filter((e) => e.includes('/'));
  const allAlbums = Array.from(
    new Set([...albumNames, ...topLevelExcludes])
  ).sort();

  const unreachable = !!error;
  const inProgress = status?.inProgress;
  const q = status?.queue;
  const prog = status?.progress;
  const lastReap = status?.lastReap;

  return (
    <div>
      <main>
        <Breadcrumb>
          <Breadcrumb.Item linkAs={Link} href="/home">
            Home
          </Breadcrumb.Item>
          <Breadcrumb.Item active>Admin</Breadcrumb.Item>
        </Breadcrumb>

        <h4 className="mb-3">Image enrichment</h4>

        {message && (
          <Alert
            variant={message.variant}
            dismissible
            onClose={() => setMessage(null)}
          >
            {message.text}
          </Alert>
        )}

        {unreachable && (
          <Alert variant="warning">
            The enrichment service is currently unreachable. Search, map, and
            scanning are unavailable until it is back.
          </Alert>
        )}

        <Card className="mb-3">
          <Card.Body>
            <Card.Title>
              Scan &amp; enrich{' '}
              <OverlayTrigger
                placement="right"
                overlay={
                  <Tooltip id="scan-help">
                    <div className="text-start">
                      <strong>Delta scan</strong> (also runs automatically each
                      day): quickly finds new or changed photos by file size +
                      modified time. Fast — it doesn’t re-read the whole
                      library.
                      <hr className="my-2" />
                      <strong>Full scan</strong>: re-reads every photo to
                      re-hash it. Slower, but also catches edits that kept the
                      same size and date. Run it on demand.
                      <hr className="my-2" />
                      Both skip photos that are already enriched, and both
                      return immediately and run in the background.
                    </div>
                  </Tooltip>
                }
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="What’s the difference between Delta and Full?"
                  style={{ cursor: 'help', fontSize: '0.85rem' }}
                  className="text-muted align-middle"
                >
                  ⓘ
                </span>
              </OverlayTrigger>
            </Card.Title>
            <Card.Text className="text-muted">
              New and changed photos are picked up automatically (a delta scan
              runs daily). Use these to enrich now — a quick <em>delta</em> for
              new/changed photos, or a thorough <em>full</em> re-hash.
            </Card.Text>
            <Row className="g-2 align-items-center">
              <Col xs="auto">
                <Button
                  onClick={() => runSync('delta')}
                  disabled={busy || unreachable}
                  title="Quick: enqueue only new or changed files (by size + modified time). Same as the daily automatic scan."
                >
                  {busy ? 'Starting…' : 'Delta scan'}
                </Button>
              </Col>
              <Col xs="auto">
                <Button
                  variant="outline-secondary"
                  onClick={() => runSync('full')}
                  disabled={busy || unreachable}
                  title="Thorough: re-read and re-hash every file. Catches edits that kept the same size and date. Slower."
                >
                  Full scan
                </Button>
              </Col>
            </Row>
          </Card.Body>
        </Card>

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
            {isStatusLoading ? (
              <Card.Text>Loading…</Card.Text>
            ) : unreachable ? (
              <Card.Text className="text-muted">Unavailable.</Card.Text>
            ) : (
              <ul className="list-unstyled mb-0">
                <li>
                  Enqueuing files:{' '}
                  <strong>{status.enqueuing ? 'yes' : 'no'}</strong>
                </li>
                {q ? (
                  <>
                    <li>
                      Active jobs: <strong>{q.active || 0}</strong>
                    </li>
                    <li>
                      Waiting:{' '}
                      <strong>{(q.waiting || 0) + (q.delayed || 0)}</strong>
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
                          {' '}(
                          {Object.entries(prog.failedByStage)
                            .map(([stage, n]) => `${stage}: ${n}`)
                            .join(', ')}
                          )
                        </span>
                      )}
                    {' '}— see the enrichment logs for reasons; a Full scan retries them.
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

        <Card className="mt-3">
          <Card.Body>
            <Card.Title>
              Enrichment coverage{' '}
              <OverlayTrigger
                placement="right"
                overlay={
                  <Tooltip id="coverage-help">
                    <div className="text-start">
                      A one-shot snapshot of how much of the search/map index
                      carries each enrichment. Fetched only on demand (it isn’t
                      polled), and it’s a cheap index-metadata read — safe to
                      hit while a scan is running; it won’t interrupt
                      enrichment.
                      <hr className="my-2" />
                      <strong>OCR processed</strong> counts photos the text
                      stage ran on (some have no readable text).{' '}
                      <strong>Geo-checked</strong> is photos inspected for GPS;{' '}
                      <strong>with location</strong> is the subset that actually
                      had coordinates.
                    </div>
                  </Tooltip>
                }
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="What is enrichment coverage?"
                  style={{ cursor: 'help', fontSize: '0.85rem' }}
                  className="text-muted align-middle"
                >
                  ⓘ
                </span>
              </OverlayTrigger>
            </Card.Title>
            <Card.Text className="text-muted">
              How many indexed photos have embeddings, OCR, geo, and other
              enrichments. Press Fetch for a current snapshot.
            </Card.Text>
            <Button
              variant="outline-secondary"
              onClick={fetchCoverage}
              disabled={coverageBusy || unreachable}
              title="Fetch a one-shot enrichment coverage snapshot. Does not interrupt scanning."
            >
              {coverageBusy ? 'Fetching…' : 'Fetch'}
            </Button>{' '}
            <Button
              variant="outline-secondary"
              onClick={fetchOcrStats}
              disabled={ocrBusy || unreachable}
              title="OCR quality detail: text yield, confidence distribution, and failures. Scans every doc's OCR fields (heavier than coverage); read-only, safe mid-scan."
            >
              {ocrBusy ? 'Computing…' : 'OCR detail'}
            </Button>
            {coverageError && (
              <div className="mt-3 text-danger">
                Could not fetch coverage — the enrichment service is
                unreachable.
              </div>
            )}
            {coverage && !coverageError && (
              <ul className="list-unstyled mb-0 mt-3">
                <li>
                  Indexed photos: <strong>{coverage.totalDocs}</strong>
                </li>
                {(() => {
                  const total = coverage.totalDocs || 0;
                  const c = coverage.coverage || {};
                  const pct = (n) =>
                    total > 0 ? ` (${Math.round((n / total) * 100)}%)` : '';
                  const rows = [
                    ['Embeddings (semantic search)', c.embeddings],
                    ['OCR processed', c.ocrProcessed],
                    ['Geo-checked', c.geoChecked],
                    ['With location', c.withLocation],
                    ['With place name', c.withPlaceName],
                    ['With capture date', c.withCaptureDate],
                    ['With tags', c.withTags],
                  ];
                  return rows.map(([label, n]) => (
                    <li key={label}>
                      {label}: <strong>{n || 0}</strong>
                      <span className="text-muted">{pct(n || 0)}</span>
                    </li>
                  ));
                })()}
              </ul>
            )}
            {ocrError && (
              <div className="mt-3 text-danger">
                Could not compute OCR stats — the enrichment service is
                unreachable.
              </div>
            )}
            {ocrStats && !ocrError && (
              <div className="mt-3">
                <hr />
                <div className="fw-semibold mb-1">OCR detail</div>
                {(() => {
                  const n = ocrStats.totalDocs || 0;
                  const pct = (k) =>
                    n > 0 ? ` (${Math.round((k / n) * 100)}%)` : '';
                  const conf = ocrStats.confidence;
                  const len = ocrStats.contentLength;
                  const pc = (v) => `${Math.round((v || 0) * 100)}%`;
                  const versions = Object.entries(ocrStats.versions || {})
                    .map(([v, c]) => `${v === 'unstamped' ? 'unstamped' : 'v' + v}=${c}`)
                    .join(', ');
                  return (
                    <ul className="list-unstyled mb-0">
                      <li>
                        With text: <strong>{ocrStats.withText}</strong>
                        <span className="text-muted">{pct(ocrStats.withText)}</span>
                      </li>
                      <li>
                        Empty (no text): <strong>{ocrStats.empty}</strong>
                        <span className="text-muted">{pct(ocrStats.empty)}</span>
                      </li>
                      <li className={ocrStats.withError ? 'text-danger' : undefined}>
                        Failed: <strong>{ocrStats.withError}</strong>
                        <span className="text-muted">{pct(ocrStats.withError)}</span>
                      </li>
                      {conf && (
                        <li>
                          Confidence:{' '}
                          <strong>{pc(conf.mean)}</strong> mean
                          <span className="text-muted">
                            {' '}(median {pc(conf.median)}, p10 {pc(conf.p10)})
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
                      {ocrStats.errors && ocrStats.errors.length > 0 && (
                        <li className="mt-1">
                          <span className="text-danger">Sample failures:</span>
                          <ul className="mb-0">
                            {ocrStats.errors.map((e) => (
                              <li key={e.path} className="text-muted small">
                                {e.path}: {e.error}
                              </li>
                            ))}
                          </ul>
                        </li>
                      )}
                    </ul>
                  );
                })()}
              </div>
            )}
          </Card.Body>
        </Card>

        <Card className="mt-3">
          <Card.Body>
            <Card.Title>
              Configuration{' '}
              <OverlayTrigger
                placement="right"
                overlay={
                  <Tooltip id="config-help">
                    <div className="text-start">
                      The enrichment service’s effective settings.{' '}
                      <strong>Read-only</strong> — config comes from the
                      docker-compose env and isn’t changeable at runtime; secrets
                      are omitted. Split by owner so no value is guessed:{' '}
                      <strong>Worker</strong> (OCR, tags, scan, watcher) is
                      reported by the worker itself; <strong>Service</strong>
                      {' '}(search, connections) by the API. If the worker hasn’t
                      reported yet, its section says so rather than assuming
                      defaults.
                    </div>
                  </Tooltip>
                }
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="What is this configuration?"
                  style={{ cursor: 'help', fontSize: '0.85rem' }}
                  className="text-muted align-middle"
                >
                  ⓘ
                </span>
              </OverlayTrigger>
            </Card.Title>
            <Card.Text className="text-muted">
              Effective enrichment settings (read-only; set via docker-compose
              env). Press Show config for a current snapshot.
            </Card.Text>
            <Button
              variant="outline-secondary"
              onClick={fetchConfig}
              disabled={configBusy || unreachable}
              title="Read-only snapshot of the enrichment service's effective configuration."
            >
              {configBusy ? 'Loading…' : 'Show config'}
            </Button>
            {configError && (
              <div className="mt-3 text-danger">
                Could not load config — the enrichment service is unreachable.
              </div>
            )}
            {enrichConfig && !configError && (
              <div className="mt-3">
                <div className="fw-bold">Worker</div>
                {enrichConfig.worker ? (
                  <>
                    {enrichConfig.worker.at && (
                      <div className="text-muted small mb-1">
                        reported{' '}
                        {new Date(enrichConfig.worker.at).toLocaleString()}
                      </div>
                    )}
                    {renderConfigCategories(enrichConfig.worker.categories)}
                  </>
                ) : (
                  <div className="text-muted mb-2">
                    The worker hasn’t reported its configuration yet (it
                    publishes on boot). No values are assumed.
                  </div>
                )}
                <div className="fw-bold mt-2">Service (API)</div>
                {renderConfigCategories(enrichConfig.service?.categories)}
              </div>
            )}
          </Card.Body>
        </Card>

        <Card className="mt-3">
          <Card.Body>
            <Card.Title>
              Index cleanup{' '}
              <OverlayTrigger
                placement="right"
                overlay={
                  <Tooltip id="reap-help">
                    <div className="text-start">
                      Removes search/map index entries for photos that no longer
                      exist on disk — files you’ve <strong>deleted</strong>,
                      plus leftover duplicates from files you’ve{' '}
                      <strong>edited</strong> (the old version’s entry). It only
                      deletes index data; your photo files and the album
                      thumbnail cache are untouched.
                      <hr className="my-2" />
                      Safe by design: if the photo folder reads as empty (e.g. a
                      storage hiccup), it does nothing rather than risk wiping
                      the index.
                    </div>
                  </Tooltip>
                }
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="What does index cleanup do?"
                  style={{ cursor: 'help', fontSize: '0.85rem' }}
                  className="text-muted align-middle"
                >
                  ⓘ
                </span>
              </OverlayTrigger>
            </Card.Title>
            <Card.Text className="text-muted">
              Prune index entries for deleted or edited-away photos so they stop
              showing up in search and on the map. Runs in the background.
            </Card.Text>
            <Button
              variant="outline-danger"
              onClick={runReap}
              disabled={busy || unreachable}
              title="Remove index entries for photos that no longer exist on disk."
            >
              {busy ? 'Starting…' : 'Reap deleted'}
            </Button>
            {lastReap && (
              <div className="mt-3">
                {lastReap.skipped === 'empty-walk' ? (
                  <span className="text-muted">
                    Last cleanup: skipped — the photo folder looked empty
                    (nothing was removed).
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

        <h4 className="mb-3 mt-4">Users</h4>

        <Card>
          <Card.Body>
            <Card.Title>
              User accounts{' '}
              <OverlayTrigger
                placement="right"
                overlay={
                  <Tooltip id="users-help">
                    <div className="text-start">
                      Create and remove accounts and reset passwords. New
                      passwords are stored hashed.
                      <hr className="my-2" />
                      There are no separate permission levels yet — every account
                      can sign in and reach this admin page. You can’t delete your
                      own account or the last remaining one.
                    </div>
                  </Tooltip>
                }
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="What can user accounts do?"
                  style={{ cursor: 'help', fontSize: '0.85rem' }}
                  className="text-muted align-middle"
                >
                  ⓘ
                </span>
              </OverlayTrigger>
            </Card.Title>

            {usersMsg && (
              <Alert
                variant={usersMsg.variant}
                dismissible
                onClose={() => setUsersMsg(null)}
              >
                {usersMsg.text}
              </Alert>
            )}

            {users === null ? (
              <Card.Text>Loading…</Card.Text>
            ) : (
              <>
                {users.length === 0 ? (
                  <Card.Text className="text-muted">No users.</Card.Text>
                ) : (
                  <ul className="list-unstyled mb-3">
                    {users.map((u) => (
                      <li key={u.username} className="mb-2">
                        <strong>{u.username}</strong>{' '}
                        {(u.roles || []).map((r) => (
                          <Badge bg="secondary" key={r} className="me-1">
                            {r}
                          </Badge>
                        ))}{' '}
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          className="py-0 px-1 ms-1"
                          onClick={() => {
                            setResetFor(resetFor === u.username ? null : u.username);
                            setResetPw('');
                          }}
                        >
                          Reset password
                        </Button>{' '}
                        <Button
                          size="sm"
                          variant="outline-danger"
                          className="py-0 px-1"
                          disabled={userBusy}
                          onClick={() => removeUser(u.username)}
                        >
                          Delete
                        </Button>
                        {resetFor === u.username && (
                          <InputGroup
                            className="mt-1"
                            style={{ maxWidth: '24rem' }}
                          >
                            <Form.Control
                              type="password"
                              placeholder="New password"
                              value={resetPw}
                              onChange={(e) => setResetPw(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (resetPw) savePassword(u.username);
                                }
                              }}
                            />
                            <Button
                              variant="outline-secondary"
                              disabled={userBusy || !resetPw}
                              onClick={() => savePassword(u.username)}
                            >
                              Save
                            </Button>
                          </InputGroup>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <strong>Add a user</strong>
                <Row className="g-2 mt-1" style={{ maxWidth: '32rem' }}>
                  <Col xs={12} sm={5}>
                    <Form.Control
                      placeholder="Username"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                    />
                  </Col>
                  <Col xs={12} sm={5}>
                    <Form.Control
                      type="password"
                      placeholder="Password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (newUsername.trim() && newPassword) addUser();
                        }
                      }}
                    />
                  </Col>
                  <Col xs="auto">
                    <Button
                      onClick={addUser}
                      disabled={userBusy || !newUsername.trim() || !newPassword}
                    >
                      {userBusy ? '…' : 'Add'}
                    </Button>
                  </Col>
                </Row>
              </>
            )}
          </Card.Body>
        </Card>

        <h4 className="mb-3 mt-4">Excluded directories</h4>

        <Card>
          <Card.Body>
            <Card.Title>
              Hidden albums &amp; folders{' '}
              <OverlayTrigger
                placement="right"
                overlay={
                  <Tooltip id="excludes-help">
                    <div className="text-start">
                      Excluded folders are invisible everywhere: the album list,
                      the thumbnail/sprite cache, and search/map enrichment.
                      <hr className="my-2" />
                      Tick a top-level album to hide the whole album. Add a{' '}
                      <strong>nested path</strong> (e.g. <code>work/scans</code>
                      ) to hide just a subfolder while the album still shows.
                      <hr className="my-2" />
                      Paths are relative to the photo root, using <code>
                        /
                      </code>{' '}
                      separators. Changes take effect on Save (cache + index
                      cleanup run in the background).
                    </div>
                  </Tooltip>
                }
              >
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="What does excluding a directory do?"
                  style={{ cursor: 'help', fontSize: '0.85rem' }}
                  className="text-muted align-middle"
                >
                  ⓘ
                </span>
              </OverlayTrigger>
            </Card.Title>

            {excludesMsg && (
              <Alert
                variant={excludesMsg.variant}
                dismissible
                onClose={() => setExcludesMsg(null)}
              >
                {excludesMsg.text}
              </Alert>
            )}

            {excludes === null ? (
              <Card.Text>Loading…</Card.Text>
            ) : (
              <>
                <div className="mb-3">
                  <strong>Albums</strong>
                  <div className="text-muted small mb-2">
                    Tick an album to hide it everywhere.
                  </div>
                  {allAlbums.length === 0 ? (
                    <span className="text-muted">No albums found.</span>
                  ) : (
                    <Row>
                      {allAlbums.map((name) => (
                        <Col xs={12} sm={6} md={4} key={name}>
                          <Form.Check
                            type="checkbox"
                            id={`exclude-${name}`}
                            label={name}
                            checked={topLevelExcludes.includes(name)}
                            onChange={() => toggleAlbum(name)}
                          />
                        </Col>
                      ))}
                    </Row>
                  )}
                </div>

                <div className="mb-3">
                  <strong>Nested paths</strong>
                  <div className="text-muted small mb-2">
                    Hide a subfolder inside an otherwise-visible album.
                  </div>
                  {nestedExcludes.length > 0 && (
                    <ul className="list-unstyled mb-2">
                      {nestedExcludes.map((entry) => (
                        <li key={entry} className="mb-1">
                          <code>{entry}</code>{' '}
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            className="py-0 px-1 ms-1"
                            onClick={() => removeEntry(entry)}
                            aria-label={`Remove ${entry}`}
                          >
                            ✕
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <InputGroup style={{ maxWidth: '24rem' }}>
                    <Form.Control
                      placeholder="e.g. work/scans"
                      value={newPath}
                      onChange={(e) => setNewPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addNested();
                        }
                      }}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={addNested}
                      disabled={!newPath.trim()}
                    >
                      Add
                    </Button>
                  </InputGroup>
                </div>

                <Button onClick={saveExcludes} disabled={excludesBusy}>
                  {excludesBusy ? 'Saving…' : 'Save excludes'}
                </Button>
              </>
            )}
          </Card.Body>
        </Card>

        <h4 className="mb-3 mt-4">Album cache</h4>

        <Card>
          <Card.Body>
            <Card.Title>
              Album builds{' '}
              {activity && activity.building.length > 0 ? (
                <Badge bg="primary">
                  {activity.building.length} in progress
                </Badge>
              ) : (
                <Badge bg="secondary">idle</Badge>
              )}
            </Card.Title>
            <Card.Text className="text-muted">
              Sprite/cover caches being (re)built — e.g. when an album is first
              opened or its photos change. Builds run{' '}
              {activity?.concurrency ?? 0} at a time; the rest queue.
            </Card.Text>
            {!activity ? (
              <Card.Text>Loading…</Card.Text>
            ) : activity.building.length === 0 ? (
              <Card.Text className="text-muted">
                No builds in progress.
              </Card.Text>
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
      </main>
    </div>
  );
}
