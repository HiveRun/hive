import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { opencodeMutations, opencodeQueries } from "@/queries/opencode";
import { useOpencodeContext } from "../opencode-test";
import { COPY_FEEDBACK_DURATION, SESSIONS_REFETCH_INTERVAL } from "./types";

export const Route = createFileRoute("/opencode-test/")({
  component: SessionListPage,
});

function SessionListPage() {
  const { serverUrl } = useOpencodeContext();
  const queryClient = useQueryClient();
  const [sessionTitle, setSessionTitle] = useState("");
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const { data: sessions, refetch: refetchSessions } = useQuery({
    ...opencodeQueries.sessions(serverUrl),
    refetchInterval: SESSIONS_REFETCH_INTERVAL,
  });

  const createSessionMutation = useMutation({
    ...opencodeMutations.createSession,
    onSuccess: (data) => {
      toast.success(`Session created: ${data.title || data.id}`);
      setSessionTitle("");
      queryClient.invalidateQueries({
        queryKey: ["opencode", "sessions", serverUrl],
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const handleCopySessionId = async (sessionId: string) => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopiedCommand(sessionId);
      toast.success("Session ID copied to clipboard!");
      setTimeout(() => setCopiedCommand(null), COPY_FEEDBACK_DURATION);
    } catch {
      toast.error("Failed to copy session ID");
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Sessions</CardTitle>
          <Button onClick={() => refetchSessions()} size="sm" variant="outline">
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sessionTitle">Create New Session</Label>
          <div className="flex gap-2">
            <Input
              id="sessionTitle"
              onChange={(e) => setSessionTitle(e.target.value)}
              placeholder="Session title (optional)"
              value={sessionTitle}
            />
            <Button
              disabled={createSessionMutation.isPending}
              onClick={() =>
                createSessionMutation.mutate({
                  baseUrl: serverUrl,
                  title: sessionTitle || undefined,
                })
              }
            >
              {createSessionMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>

        {sessions && sessions.length > 0 ? (
          <div className="space-y-2">
            <Label>Existing Sessions</Label>
            <div className="space-y-2">
              {sessions.map((session) => {
                const sessionDisplayName =
                  session.title?.trim() || "Untitled Session";

                return (
                  <div className="rounded-md border p-3" key={session.id}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-sm">
                          {sessionDisplayName}
                        </p>

                        <p className="font-mono text-muted-foreground text-xs">
                          {session.id}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleCopySessionId(session.id)}
                          size="sm"
                          variant="outline"
                        >
                          {copiedCommand === session.id ? "Copied!" : "Copy ID"}
                        </Button>
                        <Link
                          params={{ sessionId: session.id }}
                          search={{ sessionTitle: sessionDisplayName }}
                          to="/opencode-test/$sessionId"
                        >
                          <Button size="sm">View Chat</Button>
                        </Link>
                        <Link
                          params={{ sessionId: session.id }}
                          search={{ sessionTitle: sessionDisplayName }}
                          to="/opencode-test/$sessionId/events"
                        >
                          <Button size="sm" variant="outline">
                            View Events
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No sessions yet. Create one above!
          </p>
        )}
      </CardContent>
    </Card>
  );
}
