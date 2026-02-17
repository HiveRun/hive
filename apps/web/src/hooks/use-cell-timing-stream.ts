import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();

type CellTimingStreamOptions = {
  enabled?: boolean;
  workflow?: "all" | "create" | "delete";
};

export function useCellTimingStream(
  cellId: string,
  options: CellTimingStreamOptions = {}
) {
  const { enabled = true, workflow = "all" } = options;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!(enabled && cellId) || typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams();
    if (workflow !== "all") {
      params.set("workflow", workflow);
    }

    const query = params.toString();
    const source = new EventSource(
      `${API_BASE}/api/cells/${cellId}/timings/stream${query ? `?${query}` : ""}`
    );

    const refreshTimings = () => {
      queryClient.invalidateQueries({
        predicate: (queryEntry) => {
          const queryKey = queryEntry.queryKey;
          return (
            Array.isArray(queryKey) &&
            queryKey[0] === "cells" &&
            queryKey[1] === cellId &&
            queryKey[2] === "timings"
          );
        },
      });

      queryClient.invalidateQueries({
        queryKey: ["cells", "timings", "global"],
      });
    };

    const timingListener = () => {
      refreshTimings();
    };

    const snapshotListener = () => {
      refreshTimings();
    };

    const errorListener = () => {
      // Keep the stream open so EventSource can auto-reconnect.
    };

    source.addEventListener("timing", timingListener);
    source.addEventListener("snapshot", snapshotListener);
    source.addEventListener("error", errorListener);

    return () => {
      source.removeEventListener("timing", timingListener);
      source.removeEventListener("snapshot", snapshotListener);
      source.removeEventListener("error", errorListener);
      source.close();
    };
  }, [cellId, enabled, queryClient, workflow]);
}
