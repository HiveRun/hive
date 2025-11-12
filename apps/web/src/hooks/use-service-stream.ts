import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  type ConstructServiceSummary,
  constructQueries,
} from "@/queries/constructs";

export function useServiceStream(constructId: string, enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const source = new EventSource(
      `/api/constructs/${constructId}/services/stream`
    );

    const upsertService = (service: ConstructServiceSummary) => {
      queryClient.setQueryData<ConstructServiceSummary[] | undefined>(
        constructQueries.services(constructId).queryKey,
        (current) => {
          if (!current || current.length === 0) {
            return [service];
          }

          const index = current.findIndex((item) => item.id === service.id);
          if (index === -1) {
            return [...current, service];
          }

          const next = current.slice();
          next[index] = service;
          return next;
        }
      );
    };

    const serviceListener = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as ConstructServiceSummary;
        upsertService(payload);
      } catch {
        // ignore malformed events
      }
    };

    source.addEventListener("service", serviceListener as EventListener);
    source.addEventListener("error", () => {
      queryClient.invalidateQueries({
        queryKey: constructQueries.services(constructId).queryKey,
      });
    });

    return () => {
      source.removeEventListener("service", serviceListener as EventListener);
      source.close();
    };
  }, [constructId, enabled, queryClient]);
}
