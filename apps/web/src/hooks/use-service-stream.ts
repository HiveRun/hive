import { useEffect, useState } from "react";
import type { ConstructServiceSummary } from "@/queries/constructs";

export function useServiceStream(constructId: string) {
  const [services, setServices] = useState<ConstructServiceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!constructId || typeof window === "undefined") {
      return;
    }

    let isActive = true;
    setServices([]);
    setIsLoading(true);
    setError(undefined);

    const source = new EventSource(
      `/api/constructs/${constructId}/services/stream`
    );

    const upsertService = (service: ConstructServiceSummary) => {
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
        const payload = JSON.parse(event.data) as ConstructServiceSummary;
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
  }, [constructId]);

  return { services, isLoading, error };
}
