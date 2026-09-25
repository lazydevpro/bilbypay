import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

/**
 * Loads data when the screen gains focus and on pull-to-refresh. Keeps the last good data on error
 * (so an offline refresh doesn't blank the screen) and exposes the error for an ErrorNote.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  const fetchNow = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      const id = ++seq.current;
      if (mode === "refresh") setRefreshing(true);
      try {
        const value = await run();
        if (id === seq.current) {
          setData(value);
          setError(null);
        }
      } catch (e) {
        if (id === seq.current) setError(e);
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [run],
  );

  useFocusEffect(
    useCallback(() => {
      void fetchNow();
    }, [fetchNow]),
  );

  return { data, setData, error, loading, refreshing, refresh: () => fetchNow("refresh"), reload: () => fetchNow() };
}
