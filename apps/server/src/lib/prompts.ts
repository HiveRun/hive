import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fg from "fast-glob";
import type { PromptSource } from "./schema";

export type NormalizedPromptSource = {
  path: string;
  order?: number;
};

export type PromptFragment = {
  path: string;
  content: string;
  order: number;
};

export type PromptBundle = {
  content: string;
  fragments: PromptFragment[];
  tokenEstimate: number;
};

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

export async function resolvePromptPaths(
  sources: NormalizedPromptSource[],
  baseDir: string
): Promise<{ path: string; order?: number }[]> {
  const resolved: { path: string; order?: number }[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const pattern = resolve(baseDir, source.path);

    const addResolvedPath = (absolutePath: string) => {
      const normalized = resolve(absolutePath);
      if (seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      resolved.push({ path: normalized, order: source.order });
    };

    if (pattern.includes("*")) {
      const matches = await fg(pattern, {
        absolute: true,
        onlyFiles: true,
      });

      for (const match of matches) {
        addResolvedPath(match);
      }
    } else {
      addResolvedPath(pattern);
    }
  }

  return resolved;
}

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
        order: order ?? Number.MAX_SAFE_INTEGER,
      });
    } catch (error) {
      throw new Error(`Failed to read prompt file: ${path}`, { cause: error });
    }
  }

  return fragments;
}

export function deduplicateHeadings(
  fragments: PromptFragment[]
): PromptFragment[] {
  const seenHeadings = new Set<string>();

  return fragments.map((fragment) => {
    const lines = fragment.content.split("\n");
    const dedupedLines = lines.filter((line) => {
      if (line.trim().startsWith("#")) {
        const heading = line.trim();
        if (seenHeadings.has(heading)) {
          return false;
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

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function assemblePromptBundle(
  fragments: PromptFragment[]
): PromptBundle {
  const sorted = [...fragments].sort((a, b) => a.order - b.order);
  const deduped = deduplicateHeadings(sorted);
  const content = deduped.map((f) => f.content).join("\n\n");

  return {
    content,
    fragments: deduped,
    tokenEstimate: estimateTokens(content),
  };
}

export async function buildPromptBundle(
  sources: PromptSource[],
  baseDir: string
): Promise<PromptBundle> {
  const normalized = normalizePromptSources(sources);
  const paths = await resolvePromptPaths(normalized, baseDir);
  const fragments = await readPromptFragments(paths);
  return assemblePromptBundle(fragments);
}

export function substituteVariables(
  content: string,
  variables: Record<string, string>
): string {
  let result = content;

  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\$\\{${key}\\}`, "g");
    result = result.replace(pattern, value);
  }

  return result;
}

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

export function injectConstructContext(
  bundle: PromptBundle,
  context: ConstructContext
): string {
  const variables: Record<string, string> = {
    constructId: context.constructId,
    workspaceName: context.workspaceName,
    constructDir: context.constructDir,
  };

  if (context.env) {
    for (const [key, value] of Object.entries(context.env)) {
      variables[`env.${key}`] = value;
    }
  }

  let content = substituteVariables(bundle.content, variables);

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
