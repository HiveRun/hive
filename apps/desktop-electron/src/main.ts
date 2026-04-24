import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { registerIpcHandlers } from "./ipc";

const DEFAULT_WINDOW_WIDTH = 1400;
const DEFAULT_WINDOW_HEIGHT = 900;
const SPLASH_WINDOW_WIDTH = 440;
const SPLASH_WINDOW_HEIGHT = 320;
const MAIN_WINDOW_SHOW_FALLBACK_MS = 4000;
const HIVE_BACKGROUND = "#050708";
const moduleDir = import.meta.dirname;

app.commandLine.appendSwitch("disable-gpu");

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

const SPLASH_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Starting Hive Desktop</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #050708;
        --panel: #111416;
        --border: #2a2f32;
        --amber: #f5a524;
        --amber-soft: #ffc857;
        --text: #f7f4e9;
        --muted: #8d9298;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(245, 165, 36, 0.16), transparent 40%),
          linear-gradient(135deg, rgba(255, 200, 87, 0.08), transparent 50%),
          var(--bg);
        color: var(--text);
        font-family: Inter, system-ui, sans-serif;
      }
      body::before {
        content: "";
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(rgba(255, 200, 87, 0.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 200, 87, 0.06) 1px, transparent 1px);
        background-size: 44px 44px;
        mask-image: radial-gradient(circle at center, black 30%, transparent 85%);
        opacity: 0.7;
      }
      main {
        position: relative;
        width: min(360px, calc(100vw - 48px));
        border: 3px solid var(--border);
        background: linear-gradient(180deg, rgba(17, 20, 22, 0.98), rgba(10, 12, 14, 0.98));
        padding: 28px 24px 24px;
        box-shadow: 0 0 0 1px rgba(245, 165, 36, 0.22), 18px 18px 40px rgba(0, 0, 0, 0.45);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 18px;
        color: var(--amber-soft);
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .bee {
        width: 18px;
        height: 18px;
        display: inline-grid;
        place-items: center;
        background: linear-gradient(180deg, var(--amber-soft), var(--amber));
        color: #111416;
        clip-path: polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0% 50%);
        font-size: 11px;
        font-weight: 800;
      }
      h1 {
        margin: 0;
        font-size: 32px;
        line-height: 1;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      p {
        margin: 14px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.55;
      }
      .status { margin-top: 26px; }
      .bar {
        position: relative;
        height: 14px;
        border: 2px solid var(--border);
        background: rgba(255, 255, 255, 0.03);
        overflow: hidden;
      }
      .bar::before {
        content: "";
        position: absolute;
        inset: 0;
        background: repeating-linear-gradient(
          90deg,
          rgba(245, 165, 36, 0.9) 0 26px,
          rgba(255, 200, 87, 0.95) 26px 38px,
          rgba(245, 165, 36, 0.65) 38px 52px
        );
        transform: translateX(-45%);
        animation: pulse 1.1s linear infinite;
      }
      .steps {
        display: grid;
        gap: 6px;
        margin-top: 16px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .steps span { color: var(--muted); }
      .steps span:first-child { color: var(--amber-soft); }
      @keyframes pulse {
        from { transform: translateX(-45%); }
        to { transform: translateX(15%); }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="badge"><span class="bee">B</span> Hive Desktop</div>
      <h1>Waking the hive</h1>
      <p>Spinning up the desktop shell and connecting to your local workspace graph.</p>
      <section class="status" aria-label="Loading progress">
        <div class="bar"></div>
        <div class="steps">
          <span>Starting daemon</span>
          <span>Opening workspace</span>
          <span>Warming services</span>
        </div>
      </section>
    </main>
  </body>
</html>`;

const resolveSplashUrl = () =>
  `data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`;

const waitForMainWindowReady = (window: BrowserWindow) =>
  new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    window.once("ready-to-show", finish);
    window.webContents.once("did-finish-load", finish);
    window.webContents.once("did-fail-load", finish);
    setTimeout(finish, MAIN_WINDOW_SHOW_FALLBACK_MS);
  });

const createSplashWindow = async () => {
  const splash = new BrowserWindow({
    width: SPLASH_WINDOW_WIDTH,
    height: SPLASH_WINDOW_HEIGHT,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: HIVE_BACKGROUND,
    title: "Starting Hive Desktop",
  });

  await splash.loadURL(resolveSplashUrl());
  splash.show();
  return splash;
};

const createMainWindow = async (ipcRegistry: IpcRegistry) => {
  const window = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: HIVE_BACKGROUND,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: join(moduleDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: "Hive Desktop",
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

  const desktopUrl = process.env.HIVE_DESKTOP_URL;
  if (desktopUrl) {
    await window.loadURL(desktopUrl);
    return window;
  }

  const rendererEntry = resolveRendererEntry();
  if (!rendererEntry) {
    throw new Error(
      "Unable to resolve renderer entrypoint. Set HIVE_DESKTOP_RENDERER_PATH to apps/web/dist/index.html."
    );
  }

  await window.loadFile(rendererEntry);
  return window;
};

const bootstrap = async () => {
  await app.whenReady();
  const ipcRegistry = registerIpcHandlers({ ipcMain });

  const revealWindow = async (splash: BrowserWindow) => {
    const window = await createMainWindow(ipcRegistry);
    await waitForMainWindowReady(window);
    window.show();
    if (!splash.isDestroyed()) {
      splash.close();
    }
  };

  await revealWindow(await createSplashWindow());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow()
        .then(revealWindow)
        .catch((error) => {
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
