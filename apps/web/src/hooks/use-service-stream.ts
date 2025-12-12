import { useEffect, useState } from "react";
import type { CellServiceSummary } from "@/queries/cells";

export function useServiceStream(
  cellId: string,
  options: { enabled?: boolean } = {}
) {
  const { enabled = true } = options;
  const [services, setServices] = useState<CellServiceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!enabled) {
      setServices([]);
      setIsLoading(false);
      setError(undefined);
      return;
    }

    if (!cellId || typeof window === "undefined") {
      return;
    }

    let isActive = true;
    setServices([]);
    setIsLoading(true);
    setError(undefined);

    const source = new EventSource(`/api/cells/${cellId}/services/stream`);

    const upsertService = (service: CellServiceSummary) => {
      setServices((current) => {
        const index = current.findIndex((item) => item.id === service.id);
        if (index === -1) {
          return [...current, service];
        }
        const next = current.slice();
        next[index] = service;
        return next;
      });
      setIsLoading(false);
      setError(undefined);
    };

    const serviceListener = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as CellServiceSummary;
        upsertService(payload);
      } catch {
        /* ignore malformed events */
      }
    };

    const snapshotListener = () => {
      if (isActive) {
        setIsLoading(false);
      }
    };

    const errorListener = () => {
      if (isActive) {
        setError("Lost connection to service stream");
      }
    };

    source.addEventListener("service", serviceListener as EventListener);
    source.addEventListener("snapshot", snapshotListener);
    source.addEventListener("error", errorListener);

    return () => {
      isActive = false;
      source.removeEventListener("service", serviceListener as EventListener);
      source.removeEventListener("snapshot", snapshotListener);
      source.removeEventListener("error", errorListener);
      source.close();
    };
  }, [cellId, enabled]);

  return { services, isLoading, error };
}
