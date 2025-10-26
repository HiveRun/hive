import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/test-error")({
  loader: () => {
    throw new Error("This is a test error from the route loader");
  },
});
