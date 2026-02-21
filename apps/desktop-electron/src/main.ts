import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { createIpcHandlers, IPC_CHANNELS } from "./ipc";

const DEFAULT_WINDOW_WIDTH = 1400;
const DEFAULT_WINDOW_HEIGHT = 900;
const moduleDir = import.meta.dirname;

const resolveWindowIcon = () => {
  const configuredPath = process.env.HIVE_DESKTOP_ICON_PATH;
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  const candidates = [
    join(process.cwd(), "apps", "desktop-electron", "resources", "icon.png"),
    join(process.cwd(), "resources", "icon.png"),
    join(moduleDir, "..", "resources", "icon.png"),
    join(process.resourcesPath, "icon.png"),
  ];

  return candidates.find((entry) => existsSync(entry));
};

const resolveRendererEntry = () => {
  const configuredPath = process.env.HIVE_DESKTOP_RENDERER_PATH;
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  const appPath = app.getAppPath();

  const candidates = [
    join(process.cwd(), "apps", "web", "dist", "index.html"),
    join(process.cwd(), "public", "index.html"),
    join(appPath, "public", "index.html"),
    join(appPath, "..", "public", "index.html"),
    join(appPath, "..", "web", "dist", "index.html"),
    join(moduleDir, "..", "..", "web", "dist", "index.html"),
    join(process.resourcesPath, "public", "index.html"),
  ];

  return candidates.find((entry) => existsSync(entry)) ?? null;
};

const createMainWindow = async () => {
  const window = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: join(moduleDir, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
    title: "Hive Desktop",
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    createIpcHandlers()
      .openExternal(url)
      .catch(() => {
        /* ignore open failures */
      });
    return { action: "deny" };
  });

  const desktopUrl = process.env.HIVE_DESKTOP_URL;
  if (desktopUrl) {
    await window.loadURL(desktopUrl);
    return;
  }

  const rendererEntry = resolveRendererEntry();
  if (!rendererEntry) {
    throw new Error(
      "Unable to resolve renderer entrypoint. Set HIVE_DESKTOP_RENDERER_PATH to apps/web/dist/index.html."
    );
  }

  await window.loadFile(rendererEntry);
};

const registerIpc = () => {
  const handlers = createIpcHandlers();
  ipcMain.handle(IPC_CHANNELS.getRuntimeInfo, () => handlers.getRuntimeInfo());
  ipcMain.handle(IPC_CHANNELS.notify, (_event, payload) =>
    handlers.notify(payload)
  );
  ipcMain.handle(IPC_CHANNELS.openExternal, (_event, url: string) =>
    handlers.openExternal(url)
  );
};

const bootstrap = async () => {
  registerIpc();

  await app.whenReady();
  await createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow().catch((error) => {
        process.stderr.write(
          `Failed to create desktop window: ${String(error)}\n`
        );
      });
    }
  });
};

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

bootstrap().catch((error) => {
  process.stderr.write(`Failed to start desktop runtime: ${String(error)}\n`);
  app.exit(1);
});
