import { Effect, Layer } from "effect";
import { HiveConfigLayer } from "./config/context";
import { DatabaseLayer } from "./db";
import { LoggerLayer } from "./logger";
import { PortManagerLayer } from "./services/port-manager";
import { ServiceRepositoryLayer } from "./services/repository";
import {
  ServiceSupervisorLayer,
  ServiceSupervisorService,
} from "./services/supervisor";
import { WorkspaceRegistryLayer } from "./workspaces/registry";

export const serverLayer = Layer.mergeAll(
  HiveConfigLayer,
  LoggerLayer,
  ServiceRepositoryLayer,
  PortManagerLayer,
  ServiceSupervisorLayer,
  WorkspaceRegistryLayer
).pipe(Layer.provideMerge(DatabaseLayer));

type ServerLayerServices = Layer.Layer.Success<typeof serverLayer>;

const provideServerLayer = Effect.provide(serverLayer);

export const runServerEffect = <A, E>(
  effect: Effect.Effect<A, E, ServerLayerServices>
) => Effect.runPromise(provideServerLayer(effect));

export const runSupervisorEffect = <A>(
  selector: (service: ServiceSupervisorService) => Effect.Effect<A, unknown>
) => runServerEffect(Effect.flatMap(ServiceSupervisorService, selector));
