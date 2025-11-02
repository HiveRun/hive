import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assemblePromptBundle,
  buildPromptBundle,
  deduplicateHeadings,
  estimateTokens,
  injectConstructContext,
  normalizePromptSources,
  readPromptFragments,
  resolvePromptPaths,
  substituteVariables,
} from "./index";

let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `prompts-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("normalizePromptSources", () => {
  it("normalizes string sources", () => {
    const sources = ["docs/prompts/basic.md", "docs/prompts/advanced.md"];
    const normalized = normalizePromptSources(sources);

    expect(normalized).toEqual([
      { path: "docs/prompts/basic.md", order: undefined },
      { path: "docs/prompts/advanced.md", order: undefined },
    ]);
  });

  it("preserves object sources with order", () => {
    const sources = [
      { path: "docs/base.md", order: 0 },
      "docs/prompts/feature.md",
    ];
    const normalized = normalizePromptSources(sources);

    expect(normalized).toEqual([
      { path: "docs/base.md", order: 0 },
      { path: "docs/prompts/feature.md", order: undefined },
    ]);
  });
});

describe("resolvePromptPaths", () => {
  it("resolves direct file paths", async () => {
    const testFile = join(tempDir, "test.md");
    await writeFile(testFile, "# Test");

    const sources = [{ path: "test.md", order: undefined }];
    const resolved = await resolvePromptPaths(sources, tempDir);

    expect(resolved).toHaveLength(1);
    expect(resolved[0].path).toBe(testFile);
  });

  it("resolves glob patterns", async () => {
    await mkdir(join(tempDir, "prompts"), { recursive: true });
    await writeFile(join(tempDir, "prompts", "one.md"), "# One");
    await writeFile(join(tempDir, "prompts", "two.md"), "# Two");

    const sources = [{ path: "prompts/*.md", order: undefined }];
    const resolved = await resolvePromptPaths(sources, tempDir);

    expect(resolved).toHaveLength(2);
    expect(resolved.map((r) => r.path)).toContain(
      join(tempDir, "prompts", "one.md")
    );
    expect(resolved.map((r) => r.path)).toContain(
      join(tempDir, "prompts", "two.md")
    );
  });

  it("preserves order from sources", async () => {
    const testFile = join(tempDir, "test.md");
    await writeFile(testFile, "# Test");

    const sources = [{ path: "test.md", order: 5 }];
    const resolved = await resolvePromptPaths(sources, tempDir);

    expect(resolved[0].order).toBe(5);
  });
});

describe("readPromptFragments", () => {
  it("reads prompt fragments from files", async () => {
    const file1 = join(tempDir, "one.md");
    const file2 = join(tempDir, "two.md");
    await writeFile(file1, "# Fragment One\n\nContent one");
    await writeFile(file2, "# Fragment Two\n\nContent two");

    const paths = [
      { path: file1, order: 0 },
      { path: file2, order: 1 },
    ];
    const fragments = await readPromptFragments(paths);

    expect(fragments).toHaveLength(2);
    expect(fragments[0].content).toBe("# Fragment One\n\nContent one");
    expect(fragments[0].order).toBe(0);
    expect(fragments[1].content).toBe("# Fragment Two\n\nContent two");
    expect(fragments[1].order).toBe(1);
  });

  it("trims whitespace from content", async () => {
    const file = join(tempDir, "test.md");
    await writeFile(file, "\n\n  # Test  \n\n");

    const paths = [{ path: file, order: 0 }];
    const fragments = await readPromptFragments(paths);

    expect(fragments[0].content).toBe("# Test");
  });

  it("throws error for missing files", async () => {
    const paths = [{ path: join(tempDir, "missing.md"), order: 0 }];
    await expect(readPromptFragments(paths)).rejects.toThrow(
      "Failed to read prompt file"
    );
  });
});

describe("deduplicateHeadings", () => {
  it("removes duplicate headings", () => {
    const fragments = [
      {
        path: "one.md",
        content: "# Title\n\nContent one",
        order: 0,
      },
      {
        path: "two.md",
        content: "# Title\n\nContent two",
        order: 1,
      },
    ];

    const deduped = deduplicateHeadings(fragments);

    expect(deduped[0].content).toBe("# Title\n\nContent one");
    expect(deduped[1].content).toBe("Content two");
  });

  it("preserves unique headings", () => {
    const fragments = [
      {
        path: "one.md",
        content: "# Title One\n\nContent",
        order: 0,
      },
      {
        path: "two.md",
        content: "# Title Two\n\nContent",
        order: 1,
      },
    ];

    const deduped = deduplicateHeadings(fragments);

    expect(deduped[0].content).toBe("# Title One\n\nContent");
    expect(deduped[1].content).toBe("# Title Two\n\nContent");
  });
});

describe("estimateTokens", () => {
  it("estimates tokens based on character count", () => {
    const text = "This is a test sentence.";
    const tokens = estimateTokens(text);

    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length); // Should be less than char count
  });

  it("handles empty strings", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("assemblePromptBundle", () => {
  it("assembles fragments in order", () => {
    const fragments = [
      {
        path: "two.md",
        content: "Fragment Two",
        order: 1,
      },
      {
        path: "one.md",
        content: "Fragment One",
        order: 0,
      },
    ];

    const bundle = assemblePromptBundle(fragments);

    expect(bundle.content).toBe("Fragment One\n\nFragment Two");
  });

  it("deduplicates headings", () => {
    const fragments = [
      {
        path: "one.md",
        content: "# Title\n\nContent one",
        order: 0,
      },
      {
        path: "two.md",
        content: "# Title\n\nContent two",
        order: 1,
      },
    ];

    const bundle = assemblePromptBundle(fragments);

    expect(bundle.content).toBe("# Title\n\nContent one\n\nContent two");
  });

  it("includes token estimate", () => {
    const fragments = [
      {
        path: "test.md",
        content: "# Test\n\nThis is a test.",
        order: 0,
      },
    ];

    const bundle = assemblePromptBundle(fragments);

    expect(bundle.tokenEstimate).toBeGreaterThan(0);
  });
});

describe("buildPromptBundle", () => {
  it("builds complete bundle from sources", async () => {
    await mkdir(join(tempDir, "prompts"), { recursive: true });
    await writeFile(join(tempDir, "prompts", "one.md"), "# One\n\nFirst");
    await writeFile(join(tempDir, "prompts", "two.md"), "# Two\n\nSecond");

    const sources = ["prompts/*.md"];
    const bundle = await buildPromptBundle(sources, tempDir);

    expect(bundle.content).toContain("# One");
    expect(bundle.content).toContain("# Two");
    expect(bundle.fragments).toHaveLength(2);
  });

  it("respects source ordering", async () => {
    await writeFile(join(tempDir, "base.md"), "# Base");
    await writeFile(join(tempDir, "feature.md"), "# Feature");

    const sources = [
      { path: "base.md", order: 0 },
      { path: "feature.md", order: 1 },
    ];
    const bundle = await buildPromptBundle(sources, tempDir);

    expect(bundle.content).toBe("# Base\n\n# Feature");
  });
});

describe("substituteVariables", () => {
  it("substitutes variables in content", () => {
    const content = "Hello ${name}, your ID is ${id}";
    const variables = { name: "Alice", id: "123" };

    const result = substituteVariables(content, variables);

    expect(result).toBe("Hello Alice, your ID is 123");
  });

  it("handles missing variables gracefully", () => {
    const content = "Hello ${name}";
    const variables = {};

    const result = substituteVariables(content, variables);

    expect(result).toBe("Hello ${name}");
  });

  it("handles multiple occurrences", () => {
    const content = "${var} and ${var} again";
    const variables = { var: "test" };

    const result = substituteVariables(content, variables);

    expect(result).toBe("test and test again");
  });
});

describe("injectConstructContext", () => {
  it("injects basic construct context", () => {
    const bundle = {
      content: "Construct: ${constructId}\nWorkspace: ${workspaceName}",
      fragments: [],
      tokenEstimate: 0,
    };

    const context = {
      constructId: "test-123",
      workspaceName: "my-project",
      constructDir: "/path/to/construct",
    };

    const result = injectConstructContext(bundle, context);

    expect(result).toContain("Construct: test-123");
    expect(result).toContain("Workspace: my-project");
  });

  it("injects service information", () => {
    const bundle = {
      content: "# Base Prompt",
      fragments: [],
      tokenEstimate: 0,
    };

    const context = {
      constructId: "test-123",
      workspaceName: "my-project",
      constructDir: "/path/to/construct",
      services: [
        {
          id: "web",
          name: "Web Server",
          ports: { http: 3000 },
          env: { NODE_ENV: "development" },
        },
      ],
    };

    const result = injectConstructContext(bundle, context);

    expect(result).toContain("## Construct Services");
    expect(result).toContain("Web Server");
    expect(result).toContain("http:3000");
  });

  it("handles environment variables", () => {
    const bundle = {
      content: "API URL: ${env.API_URL}",
      fragments: [],
      tokenEstimate: 0,
    };

    const context = {
      constructId: "test-123",
      workspaceName: "my-project",
      constructDir: "/path/to/construct",
      env: { API_URL: "http://localhost:3000" },
    };

    const result = injectConstructContext(bundle, context);

    expect(result).toContain("API URL: http://localhost:3000");
  });
});
