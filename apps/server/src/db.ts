import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type * as schemaModule from "./schema/templates";
import { templates, templateType } from "./schema/templates";

const schema: typeof schemaModule = {
  templateType,
  templates,
};

const client = createClient({
  url: process.env.DATABASE_URL || "",
});

export const db = drizzle<typeof schemaModule>({ client, schema });
