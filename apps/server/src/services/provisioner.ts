import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import {
  type BetterSQLite3Database,
  createConstruct,
  generateId,
  schema,
  storeAgentMessage,
  updateAgentSession,
  updateConstruct,
} from "../db";
import { createAgentOrchestrator } from "../lib/agent";
import { buildPromptBundle, injectConstructContext } from "../lib/prompts";
import type {
  ConstructStatus,
  Service,
  SyntheticConfig,
  Template,
} from "../lib/schema";
import type { AgentStatus } from "../lib/types";
import { allocatePorts, createPortEnv } from "./port-allocator";
import { startService } from "./service-manager";

/**
 * Construct provisioning configuration
 */
export type ProvisionConstructConfig = {
  name: string;
  description?: string;
  templateId: string;
  workspacePath: string;
};

/**
 * Provisioned construct result
 */
export type ProvisionedConstruct = {
  constructId: string;
  constructPath: string;
  template: Template;
  ports: Record<string, number>;
  env: Record<string, string>;
};

/**
 * Find and validate template
 */
function findTemplate(config: SyntheticConfig, templateId: string) {
  const template = config.templates.find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  return template;
}

/**
 * Create construct directory and update record
 */
async function setupConstructDirectory(
  db: BetterSQLite3Database,
  construct: { id: string },
  workspacePath: string
): Promise<string> {
  const constructPath = join(workspacePath, ".constructs", construct.id);
  await mkdir(constructPath, { recursive: true });
  await updateConstruct(db, construct.id, { constructPath });
  return constructPath;
}

/**
 * Allocate ports and create environment mapping
 */
async function setupPortsAndEnvironment(
  template: Template
): Promise<{ portMap: Record<string, number>; env: Record<string, string> }> {
  const allPortRequests =
    template.services?.flatMap((s: Service) => s.ports || []) || [];
  const allocatedPorts = await allocatePorts(allPortRequests);

  const portMap: Record<string, number> = {};
  for (const allocation of allocatedPorts) {
    portMap[allocation.name] = allocation.port;
  }

  const portEnv = createPortEnv(allocatedPorts, allPortRequests);
  const env = {
    ...template.env,
    ...portEnv,
  };

  return { portMap, env };
}

/**
 * Bundle creation parameters
 */
type BundleParams = {
  db: BetterSQLite3Database;
  config: SyntheticConfig;
  input: ProvisionConstructConfig;
  constructId: string;
  constructPath: string;
  env: Record<string, string>;
};

/**
 * Create and store prompt bundle
 */
async function createAndStorePromptBundle(params: BundleParams): Promise<void> {
  const { db, config, input, constructId, constructPath, env } = params;

  const promptBundle = await buildPromptBundle(
    config.promptSources,
    input.workspacePath
  );

  const prompt = injectConstructContext(promptBundle, {
    constructId,
    workspaceName: input.workspacePath.split("/").pop() || "unknown",
    constructDir: constructPath,
    env,
  });

  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.promptBundles).values({
    id: generateId(),
    constructId,
    content: prompt,
    tokenEstimate: promptBundle.tokenEstimate,
    createdAt: now,
  });
}

/**
 * Service startup parameters
 */
type ServiceStartParams = {
  db: BetterSQLite3Database;
  template: Template;
  constructId: string;
  constructPath: string;
  templateEnv: Record<string, string>;
  portMap: Record<string, number>;
};

/**
 * Start template services
 */
async function startTemplateServices(
  params: ServiceStartParams
): Promise<void> {
  const { db, template, constructId, constructPath, templateEnv, portMap } =
    params;

  if (!template.services || template.services.length === 0) {
    return;
  }

  for (const service of template.services) {
    if (service.type === "process" && service.run) {
      try {
        await startService(db, {
          id: generateId(),
          constructId,
          serviceName: service.name,
          serviceType: "process",
          command: service.run,
          cwd: service.cwd || constructPath,
          env: { ...templateEnv, ...service.env },
          ports: portMap,
        });
      } catch {
        // Continue starting other services even if one fails
      }
    }
  }
}

/**
 * Provision a new construct from a template
 */
export async function provisionConstruct(
  db: BetterSQLite3Database,
  config: SyntheticConfig,
  input: ProvisionConstructConfig
): Promise<ProvisionedConstruct> {
  const template = findTemplate(config, input.templateId);

  const construct = await createConstruct(db, {
    id: generateId(),
    templateId: input.templateId,
    name: input.name,
    description: input.description,
    type: template.type,
    workspacePath: input.workspacePath,
  });

  if (!construct) {
    throw new Error("Failed to create construct");
  }

  const constructId = construct.id;

  try {
    await updateConstruct(db, constructId, { status: "provisioning" });

    const constructPath = await setupConstructDirectory(
      db,
      construct,
      input.workspacePath
    );
    const { portMap, env } = await setupPortsAndEnvironment(template);

    await createAndStorePromptBundle({
      db,
      config,
      input,
      constructId,
      constructPath,
      env,
    });
    await startTemplateServices({
      db,
      template,
      constructId,
      constructPath,
      templateEnv: template.env || {},
      portMap,
    });

    await updateConstruct(db, constructId, { status: "draft" });

    return {
      constructId,
      constructPath,
      template,
      ports: portMap,
      env,
    };
  } catch (error) {
    await updateConstruct(db, constructId, {
      status: "error",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      } as Record<string, unknown>,
    });
    throw error;
  }
}

/**
 * Start an agent session for a construct
 */
export async function startConstructAgent(
  db: BetterSQLite3Database,
  constructId: string,
  provider: "anthropic" | "openai" = "anthropic"
) {
  // Get construct
  const constructs = await db
    .select()
    .from(schema.constructs)
    .where(eq(schema.constructs.id, constructId))
    .limit(1);

  const construct = constructs[0];
  if (!construct) {
    throw new Error(`Construct not found: ${constructId}`);
  }

  // Get prompt bundle
  const promptBundles = await db
    .select()
    .from(schema.promptBundles)
    .where(eq(schema.promptBundles.constructId, constructId))
    .orderBy(desc(schema.promptBundles.createdAt))
    .limit(1);

  const promptBundle = promptBundles[0];
  if (!promptBundle) {
    throw new Error(`No prompt bundle found for construct: ${constructId}`);
  }

  // Create agent session
  const orchestrator = createAgentOrchestrator();
  const session = await orchestrator.createSession({
    constructId,
    provider,
    prompt: promptBundle.content,
    workingDirectory: construct.constructPath || undefined,
  });

  // Store agent session in database
  const now = Math.floor(Date.now() / 1000);
  await db.insert(schema.agentSessions).values({
    id: session.id,
    constructId,
    sessionId: session.id,
    provider,
    status: session.status,
    createdAt: now,
    updatedAt: now,
  });

  const persistMessage = async (message: {
    role: string;
    content: string;
    timestamp: Date;
  }) => {
    await storeAgentMessage(db, {
      sessionId: session.id,
      constructId,
      role: message.role,
      content: message.content,
      createdAt: Math.floor(message.timestamp.getTime() / 1000),
    });
  };

  const existingMessages = await session.getMessages();
  for (const message of existingMessages) {
    await persistMessage(message);
  }

  session.onMessage(async (message) => {
    try {
      await persistMessage(message);
    } catch {
      // Swallow persistence errors to avoid crashing orchestration loop
    }
  });

  session.onStatusChange(async (status) => {
    const statusUpdate: Parameters<typeof updateAgentSession>[2] = {
      status,
    };
    if (status === "completed") {
      statusUpdate.completedAt = Math.floor(Date.now() / 1000);
    }
    if (status === "error") {
      statusUpdate.errorMessage = "Agent reported an error";
    } else {
      statusUpdate.errorMessage = null;
    }

    try {
      await updateAgentSession(db, session.id, statusUpdate);
    } catch {
      // Ignore persistence errors
    }

    const constructStatusMapping: Record<AgentStatus, ConstructStatus> = {
      starting: "active",
      working: "active",
      awaiting_input: "awaiting_input",
      completed: "completed",
      error: "error",
    };

    const nextStatus = constructStatusMapping[status];
    if (nextStatus) {
      try {
        await updateConstruct(db, constructId, { status: nextStatus });
      } catch {
        // Ignore persistence errors in status listener
      }
    }
  });

  // Ensure construct reflects active session on launch
  await updateConstruct(db, constructId, { status: "active" });

  return session;
}
