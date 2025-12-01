import { Effect, Layer } from "effect";
import { AgentRuntimeLayer } from "./agents/service";
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
import { WorktreeManagerLayer } from "./worktree/manager";

const baseLayers = Layer.mergeAll(HiveConfigLayer, DatabaseLayer, LoggerLayer);

export const serverLayer = Layer.mergeAll(
  ServiceRepositoryLayer,
  PortManagerLayer,
  ServiceSupervisorLayer,
  WorkspaceRegistryLayer,
  WorktreeManagerLayer,
  AgentRuntimeLayer
).pipe(Layer.provideMerge(baseLayers));

type ServerLayerServices = Layer.Layer.Success<typeof serverLayer>;

const provideServerLayer = Effect.provide(serverLayer);

export const runServerEffect = <A, E>(
  effect: Effect.Effect<A, E, ServerLayerServices>
) => Effect.runPromise(provideServerLayer(effect));

export const runSupervisorEffect = <A>(
  selector: (service: ServiceSupervisorService) => Effect.Effect<A, unknown>
) => runServerEffect(Effect.flatMap(ServiceSupervisorService, selector));
