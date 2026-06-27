import useSWR from "swr";
import Router from "next/router";
import { useEffect } from "react";

import { ping } from '../lib/api';

export const usePing = ( {redirect = false } = {}) => {
  // `ping` returns { loggedIn, features, degraded } — auth heartbeat and
  // enrichment feature flags in one request.
  const { data, error, isLoading, mutate } = useSWR("api_ping", ping, {
    refreshInterval: 30000,
  });
  const loggedIn = !!data?.loggedIn;

  // Feature flags default ON while loading; OFF when logged out or during
  // degraded operation (enrichment down), so the UI hides map/search and the
  // gallery keeps working.
  const features =
    error || data?.loggedIn === false
      ? { map: false, search: false }
      : data?.features || { map: true, search: true };

  // Redirect only on a *definitive* logged-out response (data.loggedIn === false,
  // i.e. the JWT gate returned 401/403). A transient/unknown ping failure leaves
  // `data` stale-or-undefined and sets `error`; SWR retries, and we must not
  // bounce a still-authenticated user on a cold reload (TODO Bugfix #1).
  useEffect(() => {
    if (data?.loggedIn === false && !isLoading && redirect) {
      console.log(`Logged out, redirecting to ${redirect}...`)
      Router.replace(redirect);
    }
  }, [data?.loggedIn, isLoading, redirect]);

  return {
    loggedIn,
    features,
    degraded: data?.degraded ?? false,
    isLoading,
    mutate,
  };
}
