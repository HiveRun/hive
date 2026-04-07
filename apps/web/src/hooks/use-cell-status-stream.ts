import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getApiBase } from "@/lib/api-base";
import { joinWorkspaceRealtimeChannel } from "@/lib/realtime-channels";
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

    const cellListener = (payload: unknown) => {
      if (!isActive) {
        return;
      }
      const cellData = payload as Cell;
      queryClient.setQueryData<Cell[]>(
        ["cells", workspaceId],
        (currentCells) => {
          if (!currentCells) {
            return currentCells;
          }

          const existingIndex = currentCells.findIndex(
            (cell) => cell.id === cellData.id
          );
          if (existingIndex === -1) {
            return [...currentCells, cellData];
          }

          const nextCells = [...currentCells];
          if (!nextCells[existingIndex]) {
            return currentCells;
          }

          nextCells[existingIndex] = cellData;
          return nextCells;
        }
      );
      queryClient.setQueryData<Cell>(["cells", cellData.id], cellData);
    };

    const cellRemovedListener = (payload: { id?: string }) => {
      if (!isActive) {
        return;
      }

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
    };

    const subscription = joinWorkspaceRealtimeChannel({
      apiBase: API_BASE,
      workspaceId,
      handlers: {
        cell_snapshot: cellListener,
        cell_removed: cellRemovedListener,
      },
      onJoin: () => {
        queryClient.invalidateQueries({ queryKey: ["cells", workspaceId] });
      },
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, [workspaceId, enabled, queryClient]);
}
