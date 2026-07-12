// vim: tabstop=2 shiftwidth=2 expandtab
//
// Admin page: composition + the cross-panel state only. Each card lives in
// components/admin/<Panel>.js and owns its own fetch/mutation state (via
// data/use-on-demand-fetch where it's an on-demand snapshot), so one panel's
// state changes no longer re-render the whole page. What stays here is what
// genuinely spans panels: the polled enrichment status (feeds the status
// panel, the reap result line, and the shared `unreachable` flag), the polled
// album activity, and the scan/reap trigger pair — those two share one busy
// flag + one result Alert on purpose (only one background trigger at a time).

import { useState } from 'react';
import Link from 'next/link';
import { Breadcrumb, Alert } from 'react-bootstrap';
import { usePing } from '../data/use-ping';
import { useEnrichStatus } from '../data/use-enrich-status';
import { useAlbumActivity } from '../data/use-album-activity';
import { albumRebuild } from '../lib/api';
import { triggerEnrichmentSync, triggerReap } from '../lib/enrich-api';
import ScanPanel from '../components/admin/ScanPanel';
import StatusPanel from '../components/admin/StatusPanel';
import CoveragePanel from '../components/admin/CoveragePanel';
import ConfigPanel from '../components/admin/ConfigPanel';
import ReapPanel from '../components/admin/ReapPanel';
import UsersPanel from '../components/admin/UsersPanel';
import ExcludesPanel from '../components/admin/ExcludesPanel';
import AlbumBuildsPanel from '../components/admin/AlbumBuildsPanel';

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

  const runTrigger = async (fn, okText) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      setMessage({ variant: 'success', text: r.message || okText });
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

  const runSync = (type, opts = {}) =>
    runTrigger(
      () => triggerEnrichmentSync(type, opts),
      'Enrichment scan started.'
    );
  const runReap = () => runTrigger(triggerReap, 'Index cleanup started.');

  if (isPingLoading) return <></>;
  if (!loggedIn) return <>Redirecting...</>;

  const unreachable = !!error;

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

        <ScanPanel busy={busy} unreachable={unreachable} onRunSync={runSync} />
        <StatusPanel
          status={status}
          isLoading={isStatusLoading}
          unreachable={unreachable}
        />
        <CoveragePanel unreachable={unreachable} />
        <ConfigPanel unreachable={unreachable} />
        <ReapPanel
          busy={busy}
          unreachable={unreachable}
          lastReap={status?.lastReap}
          onReap={runReap}
        />

        <h4 className="mb-3 mt-4">Users</h4>
        <UsersPanel loggedIn={loggedIn} />

        <h4 className="mb-3 mt-4">Excluded directories</h4>
        <ExcludesPanel loggedIn={loggedIn} />

        <h4 className="mb-3 mt-4">Album cache</h4>
        <AlbumBuildsPanel activity={activity} onRebuild={albumRebuild} loggedIn={loggedIn} />
      </main>
    </div>
  );
}
