import { faker } from "@faker-js/faker";
import type { Construct } from "@/queries/constructs";

const FIXTURE_SEED = 20_251_108;

faker.seed(FIXTURE_SEED);

export type ConstructFixture = Construct;

export function createConstructFixture(
  overrides: Partial<ConstructFixture> = {}
): ConstructFixture {
  const id = overrides.id ?? faker.string.uuid();

  const base: ConstructFixture = {
    id,
    name:
      overrides.name ??
      faker.helpers.arrayElement([
        "Snapshot Construct",
        "Synthetic Runtime",
        "Forest Engine",
      ]),
    description:
      overrides.description ??
      faker.helpers.maybe(() => faker.lorem.sentence({ min: 6, max: 12 }), {
        probability: 0.6,
      }) ??
      null,
    templateId: overrides.templateId ?? "synthetic-dev",
    workspacePath:
      overrides.workspacePath ?? `/home/synthetic/.synthetic/constructs/${id}`,
    createdAt:
      overrides.createdAt ??
      faker.date
        .past({ years: 1, refDate: "2024-01-01T00:00:00.000Z" })
        .toISOString(),
  };

  return { ...base, ...overrides };
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
