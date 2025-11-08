import { base, en, Faker } from "@faker-js/faker";
import type { Template } from "@/queries/templates";

const TEMPLATE_FIXTURE_SEED = 20_251_109;

const templateFaker = new Faker({ locale: [en, base] });

templateFaker.seed(TEMPLATE_FIXTURE_SEED);

type TemplateServiceFixture = {
  type: string;
  run?: string;
  image?: string;
  file?: string;
  cwd?: string;
  env?: Record<string, string>;
  ports?: string[];
  volumes?: string[];
  setup?: string[];
  stop?: string;
  readyTimeoutMs?: number;
};

type TemplateConfigFixture = {
  id: string;
  label: string;
  type: string;
  summary: string;
  includePatterns?: string[];
  services?: Record<string, TemplateServiceFixture>;
  env?: Record<string, string>;
  prompts?: string[];
  teardown?: string[];
};

export type TemplateFixture = Omit<Template, "configJson"> & {
  configJson: TemplateConfigFixture;
};

const SERVICE_NAMES = ["api", "web", "worker", "agent"] as const;
const SUPPORT_SERVICE_NAMES = ["db", "queue", "cache"] as const;
const SERVICE_SUFFIXES = ["alpha", "delta", "omega", "prime"] as const;

function createServiceFixture(
  overrides: Partial<TemplateServiceFixture> = {}
): TemplateServiceFixture {
  const templateServiceBase: TemplateServiceFixture = {
    type: "process",
    run: "bun run dev",
    cwd: `./apps/${templateFaker.helpers.arrayElement(["web", "server"])}`,
    env: {
      NODE_ENV: "development",
      FEATURE_FLAG: templateFaker.hacker.verb().toUpperCase(),
    },
    ports: ["3000:3000"],
    setup: ["bun install"],
    stop: "bunx stop",
    readyTimeoutMs: templateFaker.number.int({ min: 2000, max: 6000 }),
  };

  return {
    ...templateServiceBase,
    ...overrides,
    env: {
      ...templateServiceBase.env,
      ...overrides.env,
    },
  };
}

export function createTemplateFixture(
  overrides: Partial<TemplateFixture> = {}
): TemplateFixture {
  const id =
    overrides.id ??
    templateFaker.helpers
      .slugify(templateFaker.commerce.department())
      .toLowerCase();

  const label =
    overrides.label ??
    `${templateFaker.company.catchPhraseAdjective()} ${templateFaker.commerce.product()}`;

  const type =
    overrides.type ??
    templateFaker.helpers.arrayElement([
      "manual",
      "implementation",
      "planning",
    ]);

  const primaryServiceName = `${templateFaker.helpers.arrayElement(
    SERVICE_NAMES
  )}-${templateFaker.helpers.arrayElement(SERVICE_SUFFIXES)}`;
  const supportServiceName = `${templateFaker.helpers.arrayElement(
    SUPPORT_SERVICE_NAMES
  )}-${templateFaker.helpers.arrayElement(SERVICE_SUFFIXES)}`;

  const baseConfig: TemplateConfigFixture = {
    id,
    label,
    type,
    summary:
      overrides.configJson?.summary ??
      templateFaker.lorem.sentence({ min: 6, max: 12 }),
    includePatterns: overrides.configJson?.includePatterns ?? [
      ".env*",
      "*.local",
    ],
    services: overrides.configJson?.services ?? {
      [primaryServiceName]: createServiceFixture(),
      [supportServiceName]: createServiceFixture({
        type: "docker",
        run: undefined,
        cwd: undefined,
        image: "ghcr.io/synthetic/runtime:latest",
        ports: ["5432:5432"],
        env: {
          NODE_ENV: "production",
          DATABASE_URL: "postgres://synthetic@localhost:5432/runtime",
        },
      }),
    },
    env: overrides.configJson?.env ?? {
      API_URL: "http://localhost:3000",
      STORAGE_ROOT: `/var/synthetic/${id}`,
    },
    prompts: overrides.configJson?.prompts ?? [
      templateFaker.hacker.phrase(),
      templateFaker.company.catchPhrase(),
    ],
    teardown: overrides.configJson?.teardown ?? [
      "bun run cleanup",
      `rm -rf .synthetic/${id}`,
    ],
  };

  const baseFixture: TemplateFixture = {
    id,
    label,
    type,
    configJson: baseConfig,
  };

  return {
    ...baseFixture,
    ...overrides,
    configJson: {
      ...baseConfig,
      ...overrides.configJson,
      includePatterns:
        overrides.configJson?.includePatterns ?? baseConfig.includePatterns,
      services: overrides.configJson?.services ?? baseConfig.services,
      env: overrides.configJson?.env ?? baseConfig.env,
      prompts: overrides.configJson?.prompts ?? baseConfig.prompts,
      teardown: overrides.configJson?.teardown ?? baseConfig.teardown,
    },
  };
}

export const templateSnapshotFixture: TemplateFixture[] = [
  createTemplateFixture({
    id: "synthetic-dev",
    label: "Synthetic Dev",
    type: "implementation",
    configJson: {
      id: "synthetic-dev",
      label: "Synthetic Dev",
      type: "implementation",
      summary: "Deterministic fixture used for Playwright snapshots.",
      includePatterns: [".env*", "*.db"],
      services: {
        web: createServiceFixture({
          cwd: "./apps/web",
          env: {
            NODE_ENV: "development",
            VITE_API_URL: "http://localhost:3000",
          },
        }),
        server: createServiceFixture({
          cwd: "./apps/server",
          env: {
            NODE_ENV: "development",
            DATABASE_URL: "file:dev.db",
          },
        }),
      },
      env: {
        API_URL: "http://localhost:3000",
        STORAGE_ROOT: "/var/synthetic/synthetic-dev",
      },
      prompts: ["Synchronize runtime state", "Validate construct scaffolding"],
      teardown: ["bun run cleanup", "rm -rf .synthetic/synthetic-dev"],
    },
  }),
  createTemplateFixture(),
];
