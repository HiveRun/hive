const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
  openrouter: 5,
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  opencode: "(Recommended)",
  anthropic: "(Claude Max or API key)",
};

const ROUTER_PROVIDER_IDS = new Set(["opencode"]);

const DEFAULT_PRIORITY = 99;

export type ProviderMetadata = {
  id: string;
  priority: number;
  category: "Popular" | "Other";
  description?: string;
  includeAllModels: boolean;
};

export function resolveProviderMetadata(providerId: string): ProviderMetadata {
  const priority = PROVIDER_PRIORITY[providerId] ?? DEFAULT_PRIORITY;
  const includeAllModels = ROUTER_PROVIDER_IDS.has(providerId);
  return {
    id: providerId,
    priority,
    includeAllModels,
    description: PROVIDER_DESCRIPTIONS[providerId],
    category: providerId in PROVIDER_PRIORITY ? "Popular" : "Other",
  } satisfies ProviderMetadata;
}

export function sortProviderIds(
  providerIds: Iterable<string>
): ProviderMetadata[] {
  const deduped = new Map<string, ProviderMetadata>();
  for (const providerId of providerIds) {
    if (deduped.has(providerId)) {
      continue;
    }
    deduped.set(providerId, resolveProviderMetadata(providerId));
  }
  return Array.from(deduped.values()).sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id)
  );
}
