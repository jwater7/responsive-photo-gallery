// vim: tabstop=2 shiftwidth=2 expandtab
import useSWR from 'swr';

import { albumActivity } from '../lib/api';

// Live album-build activity for the admin page. Polls faster while builds are in
// progress, slower when idle.
export const useAlbumActivity = () => {
  const { data, error, mutate } = useSWR('album_activity', albumActivity, {
    refreshInterval: (latest) =>
      latest && latest.building && latest.building.length ? 2000 : 15000,
  });

  return {
    activity: data,
    error,
    isLoading: !data && !error,
    mutate,
  };
};
