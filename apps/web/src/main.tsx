import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router";
import "./index.css";

const apiUrl = import.meta.env.VITE_API_URL?.trim();
if (!apiUrl || apiUrl === "undefined") {
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
