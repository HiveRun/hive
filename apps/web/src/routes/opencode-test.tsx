import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { opencodeMutations, opencodeQueries } from "@/queries/opencode";
import { DEFAULT_PORT, STATUS_REFETCH_INTERVAL } from "./opencode-test/types";

export type OpencodeContext = {
  serverUrl: string;
  port: number;
  isServerActive: boolean;
};

const OpencodeContextValue = createContext<OpencodeContext | null>(null);

export function useOpencodeContext() {
  const context = useContext(OpencodeContextValue);
  if (!context) {
    throw new Error(
      "useOpencodeContext must be used within OpencodeTestLayout"
    );
  }
  return context;
}

export const Route = createFileRoute("/opencode-test")({
  component: OpencodeTestLayout,
});

function OpencodeTestLayout() {
  const queryClient = useQueryClient();
  const [port, setPort] = useState(DEFAULT_PORT);

  const serverUrl = `http://127.0.0.1:${port}`;

  const { data: status, refetch } = useQuery({
    ...opencodeQueries.status(port),
    refetchInterval: STATUS_REFETCH_INTERVAL,
  });

  const initMutation = useMutation({
    ...opencodeMutations.init,
    onSuccess: (data) => {
      toast.success(data.message);
      queryClient.invalidateQueries({
        queryKey: ["opencode", "status", port],
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const shutdownMutation = useMutation({
    ...opencodeMutations.shutdown,
    onSuccess: (data) => {
      toast.success(data.message);
      queryClient.invalidateQueries({
        queryKey: ["opencode", "status", port],
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const isServerActive = Boolean(status?.active);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-bold text-3xl">OpenCode Server Test</h1>
        <Link to="/opencode-test">
          <Button variant="outline">Back to Sessions</Button>
        </Link>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Server Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                onChange={(e) => setPort(Number(e.target.value))}
                placeholder="5006"
                type="number"
                value={port}
              />
            </div>

            <div className="flex gap-2">
              <Button
                disabled={initMutation.isPending || isServerActive}
                onClick={() => initMutation.mutate(port)}
              >
                {initMutation.isPending ? "Spawning..." : "Spawn Server"}
              </Button>

              <Button
                disabled={shutdownMutation.isPending || !isServerActive}
                onClick={() => shutdownMutation.mutate(port)}
                variant="destructive"
              >
                {shutdownMutation.isPending ? "Shutting down..." : "Shutdown"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Server Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div
                  className={`h-3 w-3 rounded-full ${
                    isServerActive ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="font-medium">
                  {isServerActive ? "Running" : "Stopped"}
                </span>
              </div>

              <Button onClick={() => refetch()} size="sm" variant="outline">
                Refresh
              </Button>
            </div>

            {status?.serverUrl && (
              <div className="space-y-1">
                <Label>Server URL</Label>
                <p className="font-mono text-sm">{status.serverUrl}</p>
              </div>
            )}

            <div className="space-y-1">
              <Label>Status Message</Label>
              <p className="text-muted-foreground text-sm">{status?.message}</p>
            </div>
          </CardContent>
        </Card>

        {isServerActive && (
          <OpencodeContextValue.Provider
            value={{ serverUrl, port, isServerActive }}
          >
            <Outlet />
          </OpencodeContextValue.Provider>
        )}

        {!isServerActive && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                Start the OpenCode server to begin testing
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
