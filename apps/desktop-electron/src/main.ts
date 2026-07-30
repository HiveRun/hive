import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { registerIpcHandlers } from "./ipc";
import {
  installMediaPermissionHandlers,
  type MediaPermissionController,
} from "./media-permissions";
import { createDesktopStartupController } from "./startup-controller";

const DEFAULT_WINDOW_WIDTH = 1400;
const DEFAULT_WINDOW_HEIGHT = 900;
const moduleDir = import.meta.dirname;

if (process.env.HIVE_DISABLE_GPU === "1") {
  app.commandLine.appendSwitch("disable-gpu");
}

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

type IpcRegistry = ReturnType<typeof registerIpcHandlers>;

const createMainWindow = async (
  ipcRegistry: IpcRegistry,
  mediaPermissions: MediaPermissionController
) => {
  const window = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: join(moduleDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: "Hive Desktop",
  });

  const desktopUrl = process.env.HIVE_DESKTOP_URL;
  const rendererEntry = desktopUrl ? null : resolveRendererEntry();
  if (!(desktopUrl || rendererEntry)) {
    throw new Error(
      "Unable to resolve renderer entrypoint. Set HIVE_DESKTOP_RENDERER_PATH to apps/web/dist/index.html."
    );
  }
  const rendererUrl = desktopUrl ?? pathToFileURL(rendererEntry as string).href;

  mediaPermissions.registerTrustedRenderer(window.webContents, rendererUrl);
  const guardNavigation = (
    event: { preventDefault: () => void },
    url: string
  ) => {
    if (!mediaPermissions.isTrustedRendererUrl(window.webContents, url)) {
      event.preventDefault();
    }
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);
  window.webContents.on("did-navigate", (_event, url) => {
    if (!mediaPermissions.activateTrustedRenderer(window.webContents, url)) {
      ipcRegistry.detachWindow(window);
    }
  });

  ipcRegistry.attachWindow(window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    ipcRegistry.openExternal(url).catch(() => {
      /* ignore open failures */
    });
    return { action: "deny" };
  });

  window.on("closed", () => {
    ipcRegistry.detachWindow(window);
  });

  await window.loadURL(rendererUrl);
  return window;
};

const bootstrap = async () => {
  await app.whenReady();
  const mediaPermissions = installMediaPermissionHandlers(
    session.defaultSession
  );
  const startupController = createDesktopStartupController();
  const ipcRegistry = registerIpcHandlers({
    ipcMain,
    mediaPermissions,
    startupController,
  });
  startupController.start().catch((error) => {
    process.stderr.write(`Desktop startup failed: ${String(error)}\n`);
  });

  await createMainWindow(ipcRegistry, mediaPermissions);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(ipcRegistry, mediaPermissions).catch((error) => {
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
