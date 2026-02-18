import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

export const createIDBPersister = (
  storageKey: IDBValidKey = "hive.react-query-cache"
): Persister => ({
  persistClient: async (client: PersistedClient) => {
    await set(storageKey, client);
  },
  restoreClient: async () =>
    (await get<PersistedClient>(storageKey)) ?? undefined,
  removeClient: async () => {
    await del(storageKey);
  },
});
