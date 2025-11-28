import { EventEmitter } from "node:events";

export type ServiceUpdateEvent = {
  cellId: string;
  serviceId: string;
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
