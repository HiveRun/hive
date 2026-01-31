import { EventEmitter } from "node:events";
import type { CellStatus } from "../schema/cells";

export type ServiceUpdateEvent = {
  cellId: string;
  serviceId: string;
};

export type CellStatusEvent = {
  workspaceId: string;
  cellId: string;
  status: CellStatus;
  lastSetupError?: string | null;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function emitServiceUpdate(event: ServiceUpdateEvent): void {
  emitter.emit(event.cellId, event);
}

export function subscribeToServiceEvents(
  cellId: string,
  listener: (event: ServiceUpdateEvent) => void
): () => void {
  emitter.on(cellId, listener);
  return () => {
    emitter.off(cellId, listener);
  };
}

export function emitCellStatusUpdate(event: CellStatusEvent): void {
  emitter.emit(`workspace:${event.workspaceId}`, event);
}

export function subscribeToCellStatusEvents(
  workspaceId: string,
  listener: (event: CellStatusEvent) => void
): () => void {
  const channel = `workspace:${workspaceId}`;
  emitter.on(channel, listener);
  return () => {
    emitter.off(channel, listener);
  };
}
