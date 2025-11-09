import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { opencodeMutations, opencodeQueries } from "@/queries/opencode";
import { useOpencodeContext } from "../../opencode-test";
import { useSessionChatMessages, useSessionEventStream } from "../hooks";

const sessionSearchSchema = z.object({
  sessionTitle: z.string().optional(),
});

export const Route = createFileRoute("/opencode-test/$sessionId/")({
  component: SessionChatPage,
  validateSearch: sessionSearchSchema,
});

function SessionChatPage() {
  const { sessionId } = Route.useParams();
  const search = Route.useSearch();
  const { serverUrl, isServerActive } = useOpencodeContext();
  const [messageText, setMessageText] = useState("");

  const { data: sessionDetail } = useQuery({
    ...opencodeQueries.sessionDetail(serverUrl, sessionId),
    enabled: isServerActive,
  });

  const sessionDirectory = sessionDetail?.directory;

  const { data: opencodeConfig } = useQuery({
    ...opencodeQueries.config(serverUrl, sessionDirectory),
    enabled: isServerActive,
  });

  const { data: initialMessages } = useQuery({
    ...opencodeQueries.sessionMessages(serverUrl, sessionId, sessionDirectory),
    enabled: isServerActive,
  });

  const { events, isStreaming, clearEvents } = useSessionEventStream(
    serverUrl,
    sessionId,
    isServerActive
  );

  const chatMessages = useSessionChatMessages(events, initialMessages);

  const detailTitle = sessionDetail?.title?.trim();
  const sessionTitle =
    detailTitle || search.sessionTitle?.trim() || "Untitled Session";

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

    sendMessageMutation.mutate({
      baseUrl: serverUrl,
      sessionId,
      text: messageText,
      directory: sessionDirectory,
      agent: resolvedAgent,
      model: resolvedModel,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-xl">{sessionTitle}</h2>
          <p className="text-muted-foreground text-sm">ID: {sessionId}</p>
          <p className="text-muted-foreground text-xs">
            Agent: {resolvedAgent} · Model:{" "}
            {resolvedModel
              ? `${resolvedModel.providerID}/${resolvedModel.modelID}`
              : "server default"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            params={{ sessionId }}
            search={{ sessionTitle }}
            to="/opencode-test/$sessionId/events"
          >
            <Button variant="outline">View Events</Button>
          </Link>
          <Link to="/opencode-test">
            <Button variant="outline">Back to Sessions</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Chat Messages</CardTitle>
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
