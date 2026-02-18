import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getApiBase } from "@/lib/api-base";
import type { Cell } from "@/queries/cells";

const API_BASE = getApiBase();

type CellStatusStreamOptions = {
  enabled?: boolean;
};

export function useCellStatusStream(
  workspaceId: string,
  options: CellStatusStreamOptions = {}
) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!(enabled && workspaceId) || typeof window === "undefined") {
      return;
    }

    let isActive = true;

    const url = `${API_BASE}/api/cells/workspace/${workspaceId}/stream`;
    const source = new EventSource(url);

    const cellListener = (event: MessageEvent<string>) => {
      if (!isActive) {
        return;
      }
      try {
        const cellData = JSON.parse(event.data) as Cell;
        queryClient.setQueryData<Cell[]>(
          ["cells", workspaceId],
          (currentCells) => {
            if (!currentCells) {
              return currentCells;
            }
            return currentCells.map((cell) =>
              cell.id === cellData.id ? { ...cell, ...cellData } : cell
            );
          }
        );
        queryClient.setQueryData<Cell>(["cells", cellData.id], (currentCell) =>
          currentCell ? { ...currentCell, ...cellData } : cellData
        );
      } catch {
        /* ignore malformed events */
      }
    };

    const cellRemovedListener = (event: MessageEvent<string>) => {
      if (!isActive) {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as { id?: string };
        if (!payload.id) {
          return;
        }

        queryClient.setQueryData<Cell[]>(
          ["cells", workspaceId],
          (currentCells) => {
            if (!currentCells) {
              return currentCells;
            }

            return currentCells.filter((cell) => cell.id !== payload.id);
          }
        );
        queryClient.removeQueries({
          queryKey: ["cells", payload.id],
          exact: true,
        });
      } catch {
        /* ignore malformed events */
      }
    };

    const errorListener = () => {
      // Keep the stream open so EventSource can auto-reconnect.
    };

    source.addEventListener("cell", cellListener as EventListener);
    source.addEventListener(
      "cell_removed",
      cellRemovedListener as EventListener
    );
    source.addEventListener("error", errorListener);

    return () => {
      isActive = false;
      source.removeEventListener("cell", cellListener as EventListener);
      source.removeEventListener(
        "cell_removed",
        cellRemovedListener as EventListener
      );
      source.removeEventListener("error", errorListener);
      source.close();
    };
  }, [workspaceId, enabled, queryClient]);
}
