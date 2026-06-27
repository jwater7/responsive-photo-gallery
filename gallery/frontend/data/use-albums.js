// import useSWR from "swr";
import useSWRImmutable from 'swr/immutable'

import { albums } from '../lib/api';

export const useAlbums = () => {

  const { data, error, isLoading } = useSWRImmutable("api_albums", albums);

  return {
    albums: data,
    error,
    isLoading,
  };
}
