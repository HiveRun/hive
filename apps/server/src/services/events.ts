import { EventEmitter } from "node:events";

export type ServiceUpdateEvent = {
  constructId: string;
  serviceId: string;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function emitServiceUpdate(event: ServiceUpdateEvent): void {
  emitter.emit(event.constructId, event);
}

export function subscribeToServiceEvents(
  constructId: string,
  listener: (event: ServiceUpdateEvent) => void
): () => void {
  emitter.on(constructId, listener);
  return () => {
    emitter.off(constructId, listener);
  };
}
