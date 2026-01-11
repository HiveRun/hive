import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router";
import "./index.css";

const envApiUrl = import.meta.env.VITE_API_URL?.trim();
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let apiUrl: string | undefined;

if (envApiUrl && envApiUrl !== "undefined") {
  apiUrl = envApiUrl;
} else if (isTauri) {
  apiUrl = "http://localhost:3000";
} else if (typeof window !== "undefined") {
  apiUrl = window.location.origin;
}

if (!apiUrl) {
  // Fail fast and loudly so dev notices misconfig immediately
  // biome-ignore lint/suspicious/noConsole: explicit startup guard
  console.error(
    "VITE_API_URL is required. Set it to your API origin, e.g. http://localhost:3000"
  );
  throw new Error(
    "VITE_API_URL is required. Set it to your API origin, e.g. http://localhost:3000"
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
