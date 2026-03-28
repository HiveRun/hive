import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getApiBase } from "@/lib/api-base";
import { joinServiceRealtimeChannel } from "@/lib/realtime-channels";
import { type CellServiceSummary, cellQueries } from "@/queries/cells";

const API_BASE = getApiBase();

export function useServiceStream(
  cellId: string,
  options: { enabled?: boolean; includeResources?: boolean } = {}
) {
  const { enabled = true, includeResources = false } = options;
  const queryClient = useQueryClient();

  const servicesQuery = useQuery({
    ...cellQueries.services(cellId, { includeResources }),
    enabled,
  });

  useEffect(() => {
    if (!(enabled && cellId) || typeof window === "undefined") {
      return;
    }

    const queryKey = cellQueries.services(cellId, {
      includeResources,
    }).queryKey;

    const subscription = joinServiceRealtimeChannel({
      apiBase: API_BASE,
      cellId,
      handlers: {
        service_snapshot: (payload) => {
          const service = payload as CellServiceSummary;

          queryClient.setQueryData<CellServiceSummary[]>(
            queryKey,
            (current = []) => {
              const services = current as CellServiceSummary[];
              const index = services.findIndex(
                (item) => item.id === service.id
              );
              if (index === -1) {
                return [...services, service];
              }

              const next = services.slice();
              next[index] = service;
              return next;
            }
          );
        },
      },
      onJoin: () => {
        queryClient.invalidateQueries({ queryKey });
      },
      onError: () => {
        queryClient.invalidateQueries({ queryKey });
      },
    });

    return subscription.unsubscribe;
  }, [cellId, enabled, includeResources, queryClient]);

  return {
    services: servicesQuery.data ?? [],
    isLoading: servicesQuery.isLoading,
    error:
      servicesQuery.error instanceof Error
        ? servicesQuery.error.message
        : undefined,
  };
}
