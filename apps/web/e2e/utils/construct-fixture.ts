import { base, en, Faker } from "@faker-js/faker";
import type { Construct } from "@/queries/constructs";

const FIXTURE_SEED = 20_251_108;
const DEFAULT_OPENCODE_PORT = 5000;

const constructFaker = new Faker({ locale: [en, base] });

constructFaker.seed(FIXTURE_SEED);

export type ConstructFixture = Construct;

export function createConstructFixture(
  overrides: Partial<ConstructFixture> = {}
): ConstructFixture {
  const id = overrides.id ?? constructFaker.string.uuid();

  const constructBase: ConstructFixture = {
    id,
    name:
      overrides.name ??
      constructFaker.helpers.arrayElement([
        "Snapshot Construct",
        "Synthetic Runtime",
        "Forest Engine",
      ]),
    description:
      overrides.description ??
      constructFaker.helpers.maybe(
        () => constructFaker.lorem.sentence({ min: 6, max: 12 }),
        {
          probability: 0.6,
        }
      ) ??
      null,
    templateId: overrides.templateId ?? "synthetic-dev",
    workspacePath:
      overrides.workspacePath ?? `/home/synthetic/.synthetic/constructs/${id}`,
    opencodeSessionId:
      overrides.opencodeSessionId ?? constructFaker.string.uuid(),
    opencodeServerUrl: overrides.opencodeServerUrl ?? "http://127.0.0.1:5000",
    opencodeServerPort: overrides.opencodeServerPort ?? DEFAULT_OPENCODE_PORT,
    createdAt:
      overrides.createdAt ??
      constructFaker.date
        .past({ years: 1, refDate: "2024-01-01T00:00:00.000Z" })
        .toISOString(),
  };

  return { ...constructBase, ...overrides };
}

export const constructSnapshotFixture: ConstructFixture[] = [
  createConstructFixture({
    id: "snapshot-construct",
    name: "Snapshot Construct",
    description: "Deterministic fixture used for visual regression tests.",
    workspacePath: "/home/synthetic/.synthetic/constructs/snapshot-construct",
    createdAt: "2024-01-01T12:00:00.000Z",
  }),
];
