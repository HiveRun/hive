import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createAgentOrchestrator } from "@synthetic/agent";
import type { SyntheticConfig, Template } from "@synthetic/config";
import {
  createConstruct,
  generateId,
  schema,
  updateConstruct,
} from "@synthetic/db";
import { buildPromptBundle, injectConstructContext } from "@synthetic/prompts";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { allocatePorts, createPortEnv } from "./port-allocator";

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
 * Provision a new construct from a template
 */
export async function provisionConstruct(
  db: BetterSQLite3Database<typeof schema.schema>,
  config: SyntheticConfig,
  input: ProvisionConstructConfig
): Promise<ProvisionedConstruct> {
  // Find template
  const template = config.templates.find((t) => t.id === input.templateId);
  if (!template) {
    throw new Error(`Template not found: ${input.templateId}`);
  }

  // Create construct record
  const construct = await createConstruct(db, {
    templateId: input.templateId,
    name: input.name,
    description: input.description,
    type: template.type,
    workspacePath: input.workspacePath,
  });

  try {
    // Update status to provisioning
    await updateConstruct(db, construct.id, { status: "provisioning" });

    // Create construct directory
    const constructPath = join(
      input.workspacePath,
      ".constructs",
      construct.id
    );
    await mkdir(constructPath, { recursive: true });

    // Update with construct path
    await updateConstruct(db, construct.id, { constructPath });

    // Allocate ports for all services
    const allPortRequests =
      template.services?.flatMap((s) => s.ports || []) || [];
    const allocatedPorts = await allocatePorts(allPortRequests);

    // Create port mapping
    const portMap: Record<string, number> = {};
    for (const allocation of allocatedPorts) {
      portMap[allocation.name] = allocation.port;
    }

    // Create environment variables from ports
    const portEnv = createPortEnv(allocatedPorts, allPortRequests);

    // Merge with template-level environment
    const env = {
      ...template.env,
      ...portEnv,
    };

    // Build prompt bundle
    const promptBundle = await buildPromptBundle(
      config.promptSources,
      input.workspacePath
    );

    // Inject construct context
    const prompt = injectConstructContext(promptBundle, {
      constructId: construct.id,
      workspaceName: input.workspacePath.split("/").pop() || "unknown",
      constructDir: constructPath,
      env,
    });

    // Store prompt bundle in database
    await db.insert(schema.schema.promptBundles).values({
      id: generateId(),
      constructId: construct.id,
      content: prompt,
      tokenEstimate: promptBundle.tokenEstimate,
    });

    // Update status to active
    await updateConstruct(db, construct.id, { status: "draft" });

    return {
      constructId: construct.id,
      constructPath,
      template,
      ports: portMap,
      env,
    };
  } catch (error) {
    // Mark as error if provisioning fails
    await updateConstruct(db, construct.id, {
      status: "error",
      metadata: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

/**
 * Start an agent session for a construct
 */
export async function startConstructAgent(
  db: BetterSQLite3Database<typeof schema.schema>,
  constructId: string,
  provider: "anthropic" | "openai" = "anthropic"
) {
  // Get construct
  const construct = await db.query.constructs.findFirst({
    where: (constructs, { eq }) => eq(constructs.id, constructId),
  });

  if (!construct) {
    throw new Error(`Construct not found: ${constructId}`);
  }

  // Get prompt bundle
  const promptBundle = await db.query.promptBundles.findFirst({
    where: (bundles, { eq }) => eq(bundles.constructId, constructId),
    orderBy: (bundles, { desc }) => [desc(bundles.createdAt)],
  });

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
  await db.insert(schema.schema.agentSessions).values({
    id: session.id,
    constructId,
    sessionId: session.id,
    provider,
    status: "starting",
  });

  // Update construct status
  await updateConstruct(db, constructId, { status: "active" });

  return session;
}
