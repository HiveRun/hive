import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { RunOptions } from "./cli";
import { runSg } from "./cli";
import { CLI_LANGUAGES } from "./constants";
import type { CliLanguage, SgResult } from "./types";
import { formatReplaceResult, formatSearchResult } from "./utils";

type JsonSchema = Readonly<Record<string, unknown>>;

type AstGrepToolDefinition = {
  name: string;
  description: string;
  input: JsonSchema;
  options: { codemode: false };
};

type AstGrepToolExecutor = {
  execute: (
    input: unknown,
    context: unknown
  ) => Promise<{ content: string; metadata: { output: string } }>;
};

export type AstGrepV2Tool = AstGrepToolDefinition & AstGrepToolExecutor;

const FUNCTION_PATTERN_HINT_REGEX =
  /^(export\s+)?(async\s+)?function\s+\$[A-Z_]+\s*$/iu;

const stringArg = (description: string): JsonSchema => ({
  type: "string",
  description,
});

const commonSearchProperties = () => ({
  lang: {
    type: "string",
    enum: CLI_LANGUAGES,
    description: "Target language",
  },
  paths: {
    type: "array",
    items: { type: "string" },
    description: "Paths to search",
  },
  globs: {
    type: "array",
    items: { type: "string" },
    description: "Include/exclude globs",
  },
});

const objectInput = (
  properties: Record<string, JsonSchema>,
  required: string[]
): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const runTool = async (action: () => Promise<string>) => {
  let output: string;
  try {
    output = await action();
  } catch (error) {
    output = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
  return { content: output, metadata: { output } };
};

const baseRunArgs = (
  cwd: string,
  args: {
    pattern: string;
    lang: string;
    paths?: string[];
    globs?: string[];
  }
) => ({
  cwd,
  pattern: args.pattern,
  lang: args.lang as CliLanguage,
  paths: args.paths,
  globs: args.globs,
});

const executeSgTool = (
  options: RunOptions,
  format: (result: SgResult) => string,
  validate?: () => Promise<void> | void
) =>
  runTool(async () => {
    await validate?.();
    return format(await runSg(options));
  });

async function canonicalizePath(path: string): Promise<string> {
  const missingSegments: string[] = [];
  let candidate = resolve(path);

  while (true) {
    try {
      return resolve(await realpath(candidate), ...missingSegments.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      missingSegments.push(candidate.slice(parent.length + 1));
      candidate = parent;
    }
  }
}

async function isWithin(root: string, target: string): Promise<boolean> {
  const path = relative(
    await canonicalizePath(root),
    await canonicalizePath(target)
  );
  if (path === "") {
    return true;
  }
  if (isAbsolute(path) || path === "..") {
    return false;
  }
  return !path.startsWith(`..${sep}`);
}

async function validatePaths(
  cwd: string,
  paths: string[] | undefined,
  allowedRoots: string[]
): Promise<void> {
  for (const path of paths ?? ["."]) {
    const target = resolve(cwd, path);
    const allowed = await Promise.all(
      allowedRoots.map((root) => isWithin(root, target))
    );
    if (!allowed.some(Boolean)) {
      throw new Error(
        `Path is outside the allowed workspace boundary: ${path}`
      );
    }
  }
}

const getEmptyResultHint = (
  pattern: string,
  lang: CliLanguage
): string | null => {
  const src = pattern.trim();

  if (lang === "python") {
    if (src.startsWith("class ") && src.endsWith(":")) {
      const withoutColon = src.slice(0, -1);
      return `\n\nHint: Remove trailing colon. Try: "${withoutColon}"`;
    }
    if (
      (src.startsWith("def ") || src.startsWith("async def ")) &&
      src.endsWith(":")
    ) {
      const withoutColon = src.slice(0, -1);
      return `\n\nHint: Remove trailing colon. Try: "${withoutColon}"`;
    }
  }

  if (
    ["javascript", "typescript", "tsx"].includes(lang) &&
    FUNCTION_PATTERN_HINT_REGEX.test(src)
  ) {
    return '\n\nHint: Function patterns need params and body. Try "function $NAME($$$) { $$$ }"';
  }

  return null;
};

function createSearchTool(cwd: string, readableRoots: string[]): AstGrepV2Tool {
  return {
    name: "ast_grep_search",
    options: { codemode: false },
    description:
      "Search code patterns across filesystem using AST-aware matching. Supports 25 languages. " +
      "Use meta-variables: $VAR (single node), $$$ (multiple nodes). " +
      "IMPORTANT: Patterns must be complete AST nodes (valid code). " +
      "For functions, include params and body: 'export async function $NAME($$$) { $$$ }' not 'export async function $NAME'. " +
      "Examples: 'console.log($MSG)', 'def $FUNC($$$):', 'async function $NAME($$$)'",
    input: objectInput(
      {
        pattern: stringArg(
          "AST pattern with meta-variables ($VAR, $$$). Must be complete AST node."
        ),
        ...commonSearchProperties(),
        context: {
          type: "number",
          description: "Context lines around match",
        },
      },
      ["pattern", "lang"]
    ),
    execute(input) {
      const args = input as {
        pattern: string;
        lang: CliLanguage;
        paths?: string[];
        globs?: string[];
        context?: number;
      };
      return executeSgTool(
        {
          ...baseRunArgs(cwd, args),
          context: args.context,
        },
        (result) => {
          let output = formatSearchResult(result);
          if (result.matches.length === 0 && !result.error) {
            output += getEmptyResultHint(args.pattern, args.lang) ?? "";
          }
          return output;
        },
        () => validatePaths(cwd, args.paths, readableRoots)
      );
    },
  };
}

function createReplaceTool(
  cwd: string,
  readableRoots: string[],
  worktreeRoot: string
): AstGrepV2Tool {
  return {
    name: "ast_grep_replace",
    options: { codemode: false },
    description:
      "Replace code patterns across filesystem with AST-aware rewriting. " +
      "Dry-run by default. Use meta-variables in rewrite to preserve matched content. " +
      "Example: pattern='console.log($MSG)' rewrite='logger.info($MSG)'",
    input: objectInput(
      {
        pattern: stringArg("AST pattern to match"),
        rewrite: stringArg("Replacement pattern (can use $VAR from pattern)"),
        ...commonSearchProperties(),
        dryRun: {
          type: "boolean",
          description: "Preview changes without applying (default: true)",
        },
      },
      ["pattern", "rewrite", "lang"]
    ),
    execute(input) {
      const args = input as {
        pattern: string;
        rewrite: string;
        lang: CliLanguage;
        paths?: string[];
        globs?: string[];
        dryRun?: boolean;
      };
      return executeSgTool(
        {
          ...baseRunArgs(cwd, args),
          rewrite: args.rewrite,
          updateAll: args.dryRun === false,
        },
        (result) => formatReplaceResult(result, args.dryRun !== false),
        () =>
          validatePaths(
            cwd,
            args.paths,
            args.dryRun === false ? [worktreeRoot] : readableRoots
          )
      );
    },
  };
}

export function createAstGrepTools(
  cwd: string,
  referenceRoots: string[] = [],
  worktreeRoot = cwd
): AstGrepV2Tool[] {
  const readableRoots = [worktreeRoot, ...referenceRoots];
  return [
    createSearchTool(cwd, readableRoots),
    createReplaceTool(cwd, readableRoots, worktreeRoot),
  ];
}
