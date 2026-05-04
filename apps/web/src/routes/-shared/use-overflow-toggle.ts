import type { DependencyList, RefObject } from "react";
import { useEffect, useState } from "react";

export function useOverflowToggle({
  canExpandFallback,
  deps,
  isExpanded,
  ref,
}: {
  canExpandFallback?: boolean;
  deps: DependencyList;
  isExpanded: boolean;
  ref: RefObject<HTMLElement | null>;
}) {
  const [canExpand, setCanExpand] = useState(Boolean(canExpandFallback));

  useEffect(() => {
    setCanExpand(Boolean(canExpandFallback));
  }, [canExpandFallback]);

  useEffect(() => {
    if (isExpanded) {
      return;
    }

    const element = ref.current;
    if (!element) {
      setCanExpand(Boolean(canExpandFallback));
      return;
    }

    const measure = () => {
      setCanExpand(
        Boolean(canExpandFallback) ||
          element.scrollHeight > element.clientHeight + 1
      );
    };

    let frameId: number | null = null;

    const runMeasure = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };

    runMeasure();

    const observer = new ResizeObserver(runMeasure);
    observer.observe(element);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      observer.disconnect();
    };
  }, [canExpandFallback, isExpanded, ref, ...deps]);

  return canExpand;
}
