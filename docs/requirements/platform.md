# Platform Modalities

- **Web app**: ship the full experience in the browser (SSR/SPA) for zero-install access.
- **Desktop app (Electron)**: wrap the web UI in Electron to unlock native notifications, tray integration, and richer OS hooks while keeping JS tooling and Chromium rendering parity. We can explore Tauri later if bundle size becomes critical.
- **Parity expectations**: desktop and web share features and code paths; desktop adds native notifications and future enhancements (tray, auto-launch) without diverging UX.
