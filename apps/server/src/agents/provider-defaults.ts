export function normalizeProviderDefaults(
  value: unknown
): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, string>
  >((defaults, [providerId, modelId]) => {
    if (typeof modelId === "string") {
      defaults[providerId] = modelId;
    }
    return defaults;
  }, {});
}
