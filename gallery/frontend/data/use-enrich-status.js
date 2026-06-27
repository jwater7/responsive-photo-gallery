// vim: tabstop=2 shiftwidth=2 expandtab
import useSWR from 'swr';

import { getEnrichStatus } from '../lib/enrich-api';

// Live enrichment status for the admin page. Polls faster while a scan is in
// progress so the queue depth updates responsively, slower when idle.
export const useEnrichStatus = () => {
  const { data, error, mutate } = useSWR('enrich_status', getEnrichStatus, {
    refreshInterval: (latest) => (latest?.inProgress ? 2000 : 15000),
  });

  return {
    status: data,
    error,
    isLoading: !data && !error,
    mutate,
  };
};
