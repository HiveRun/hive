import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PromptSource } from "@synthetic/config";
import fg from "fast-glob";

/**
 * Normalized prompt source with path and optional order
 */
export type NormalizedPromptSource = {
  path: string;
  order?: number;
};

/**
 * Prompt fragment with content and metadata
 */
export type PromptFragment = {
  path: string;
  content: string;
  order: number;
};

/**
 * Assembled prompt bundle
 */
export type PromptBundle = {
  content: string;
  fragments: PromptFragment[];
  tokenEstimate: number;
};

/**
 * Normalize prompt sources to a consistent format
 */
export function normalizePromptSources(
  sources: PromptSource[]
): NormalizedPromptSource[] {
  return sources.map((source) => {
    if (typeof source === "string") {
      return { path: source, order: undefined };
    }
    return source;
  });
}

/**
 * Resolve glob patterns to actual file paths
 */
export async function resolvePromptPaths(
  sources: NormalizedPromptSource[],
  baseDir: string
): Promise<{ path: string; order?: number }[]> {
  const resolved: { path: string; order?: number }[] = [];

  for (const source of sources) {
    const pattern = resolve(baseDir, source.path);

    // Check if it's a glob pattern
    if (pattern.includes("*")) {
      const matches = await fg(pattern, {
        absolute: true,
        onlyFiles: true,
      });

      for (const match of matches) {
        resolved.push({ path: match, order: source.order });
      }
    } else {
      // Direct file path
      resolved.push({ path: pattern, order: source.order });
    }
  }

  return resolved;
}

/**
 * Read prompt fragments from files
 */
export async function readPromptFragments(
  paths: { path: string; order?: number }[]
): Promise<PromptFragment[]> {
  const fragments: PromptFragment[] = [];

  for (const { path, order } of paths) {
    try {
      const content = await readFile(path, "utf-8");
      fragments.push({
        path,
        content: content.trim(),
        order: order ?? Number.MAX_SAFE_INTEGER, // Unordered items go last
      });
    } catch (error) {
      throw new Error(`Failed to read prompt file: ${path}`, { cause: error });
    }
  }

  return fragments;
}

/**
 * Deduplicate heading lines across fragments
 */
export function deduplicateHeadings(
  fragments: PromptFragment[]
): PromptFragment[] {
  const seenHeadings = new Set<string>();

  return fragments.map((fragment) => {
    const lines = fragment.content.split("\n");
    const dedupedLines = lines.filter((line) => {
      // Check if line is a heading
      if (line.trim().startsWith("#")) {
        const heading = line.trim();
        if (seenHeadings.has(heading)) {
          return false; // Skip duplicate heading
        }
        seenHeadings.add(heading);
      }
      return true;
    });

    return {
      ...fragment,
      content: dedupedLines.join("\n").trim(),
    };
  });
}

/**
 * Estimate token count (very rough estimate: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Assemble prompt fragments into a single bundle
 */
export function assemblePromptBundle(
  fragments: PromptFragment[]
): PromptBundle {
  // Sort by order (lower numbers first)
  const sorted = [...fragments].sort((a, b) => a.order - b.order);

  // Deduplicate headings
  const deduped = deduplicateHeadings(sorted);

  // Concatenate with double newlines between fragments
  const content = deduped.map((f) => f.content).join("\n\n");

  return {
    content,
    fragments: deduped,
    tokenEstimate: estimateTokens(content),
  };
}

/**
 * Build a complete prompt bundle from prompt sources
 */
export async function buildPromptBundle(
  sources: PromptSource[],
  baseDir: string
): Promise<PromptBundle> {
  const normalized = normalizePromptSources(sources);
  const paths = await resolvePromptPaths(normalized, baseDir);
  const fragments = await readPromptFragments(paths);
  return assemblePromptBundle(fragments);
}

/**
 * Variable substitution in prompt content
 */
export function substituteVariables(
  content: string,
  variables: Record<string, string>
): string {
  let result = content;

  for (const [key, value] of Object.entries(variables)) {
    // Replace ${key} with value
    const pattern = new RegExp(`\\$\\{${key}\\}`, "g");
    result = result.replace(pattern, value);
  }

  return result;
}

/**
 * Inject construct context into a prompt bundle
 */
export type ConstructContext = {
  constructId: string;
  workspaceName: string;
  constructDir: string;
  services?: Array<{
    id: string;
    name: string;
    ports?: Record<string, number>;
    env?: Record<string, string>;
  }>;
  env?: Record<string, string>;
};

/**
 * Create a context-aware prompt from a bundle and construct context
 */
export function injectConstructContext(
  bundle: PromptBundle,
  context: ConstructContext
): string {
  const variables: Record<string, string> = {
    constructId: context.constructId,
    workspaceName: context.workspaceName,
    constructDir: context.constructDir,
  };

  // Add environment variables
  if (context.env) {
    for (const [key, value] of Object.entries(context.env)) {
      variables[`env.${key}`] = value;
    }
  }

  let content = substituteVariables(bundle.content, variables);

  // Append service context if provided
  if (context.services && context.services.length > 0) {
    content += "\n\n## Construct Services\n\n";
    content += "The following services are configured for this construct:\n\n";
    content += "| Service | ID | Ports | Environment |\n";
    content += "|---------|-------|-------|-------------|\n";

    for (const service of context.services) {
      const ports = service.ports
        ? Object.entries(service.ports)
            .map(([name, port]) => `${name}:${port}`)
            .join(", ")
        : "none";

      const env = service.env ? Object.keys(service.env).join(", ") : "none";

      content += `| ${service.name} | ${service.id} | ${ports} | ${env} |\n`;
    }
  }

  return content;
}
