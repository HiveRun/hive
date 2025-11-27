export {};

process.env.DOTENV_CONFIG_SILENT ??= "true";

await import("./cli");
