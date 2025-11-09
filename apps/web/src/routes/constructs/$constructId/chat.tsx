import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { constructQueries } from "@/queries/constructs";
import { opencodeMutations, opencodeQueries } from "@/queries/opencode";
import {
  useSessionChatMessages,
  useSessionEventStream,
} from "@/routes/opencode-test/hooks";

export const Route = createFileRoute("/constructs/$constructId/chat")({
  component: ConstructChatPage,
});

function ConstructChatPage() {
  const { constructId } = Route.useParams();
  const [messageText, setMessageText] = useState("");

  const { data: construct } = useQuery(constructQueries.detail(constructId));

  const serverUrl = construct?.opencodeServerUrl ?? "";
  const sessionId = construct?.opencodeSessionId ?? "";
  const directory = construct?.workspacePath;
  const isServerActive = Boolean(serverUrl && sessionId);

  const { data: opencodeConfig } = useQuery({
    ...opencodeQueries.config(serverUrl, directory),
    enabled: isServerActive,
  });

  const { data: initialMessages } = useQuery({
    ...opencodeQueries.sessionMessages(serverUrl, sessionId, directory),
    enabled: isServerActive,
  });

  const { events, isStreaming, clearEvents } = useSessionEventStream(
    serverUrl,
    sessionId,
    isServerActive
  );

  const chatMessages = useSessionChatMessages(events, initialMessages);

  const resolvedAgent = useMemo(() => {
    if (!opencodeConfig?.agent) {
      return "build";
    }

    if (opencodeConfig.agent.build) {
      return "build";
    }

    const availableAgents = Object.keys(opencodeConfig.agent).filter(Boolean);
    return availableAgents[0] ?? "build";
  }, [opencodeConfig?.agent]);

  const resolvedModel = useMemo(() => {
    const modelString = opencodeConfig?.model?.trim();
    if (!modelString) {
      return;
    }

    const [providerID, ...rest] = modelString.split("/");
    const modelID = rest.join("/");

    if (!(providerID && modelID)) {
      return;
    }

    return {
      providerID,
      modelID,
    };
  }, [opencodeConfig?.model]);

  const sendMessageMutation = useMutation({
    ...opencodeMutations.sendMessage,
    onSuccess: () => {
      setMessageText("");
    },
    onError: (error) => {
      toast.error(`Failed to send message: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) {
      return;
    }

    if (!(serverUrl && sessionId)) {
      toast.error("OpenCode server not available for this construct");
      return;
    }

    sendMessageMutation.mutate({
      baseUrl: serverUrl,
      sessionId,
      text: messageText,
      directory,
      agent: resolvedAgent,
      model: resolvedModel,
    });
  };

  if (!construct) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground">Loading construct...</p>
      </div>
    );
  }

  if (!(serverUrl && sessionId)) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader>
            <CardTitle>OpenCode Not Available</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This construct doesn't have an active OpenCode server. This might
              be because:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground text-sm">
              <li>The construct was created before OpenCode integration</li>
              <li>The server was shut down</li>
              <li>There was an error during construct creation</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-xl">{construct.name}</h2>
          <p className="text-muted-foreground text-sm">Session: {sessionId}</p>
          <p className="text-muted-foreground text-xs">
            Agent: {resolvedAgent} · Model:{" "}
            {resolvedModel
              ? `${resolvedModel.providerID}/${resolvedModel.modelID}`
              : "server default"}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Chat</CardTitle>
            <div className="flex items-center gap-2">
              {isStreaming && (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  <span className="text-muted-foreground text-xs">
                    Streaming
                  </span>
                </div>
              )}
              <Button onClick={clearEvents} size="sm" variant="outline">
                Clear
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {chatMessages.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground text-sm">
                {isStreaming ? "Waiting for messages..." : "No messages yet"}
              </p>
            ) : (
              <div className="max-h-96 space-y-4 overflow-y-auto">
                {chatMessages.map((message) => (
                  <div
                    className={`rounded-md border p-4 ${
                      message.role === "user"
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                        : "border-green-500 bg-green-50 dark:bg-green-950"
                    }`}
                    key={message.id}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-medium text-sm ${
                              message.role === "user"
                                ? "text-blue-700 dark:text-blue-300"
                                : "text-green-700 dark:text-green-300"
                            }`}
                          >
                            {message.role === "user" ? "User" : "Assistant"}
                          </span>
                          {!message.isComplete && (
                            <div className="flex items-center gap-1">
                              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                              <span className="text-muted-foreground text-xs">
                                typing...
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap font-mono text-sm">
                          {message.text}
                        </p>
                      </div>
                      <span className="whitespace-nowrap text-muted-foreground text-xs">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send Message</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Input
                disabled={sendMessageMutation.isPending}
                id="message"
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type your message here..."
                value={messageText}
              />
            </div>
            <Button
              disabled={!messageText.trim() || sendMessageMutation.isPending}
              type="submit"
            >
              {sendMessageMutation.isPending ? "Sending..." : "Send Message"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
