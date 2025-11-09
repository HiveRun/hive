import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { opencodeQueries } from "@/queries/opencode";
import { useOpencodeContext } from "../opencode-test";
import { useSessionChatMessages, useSessionEventStream } from "./hooks";

export const Route = createFileRoute("/opencode-test/$sessionId")({
  component: SessionChatPage,
});

function SessionChatPage() {
  const { sessionId } = Route.useParams();
  const { serverUrl, isServerActive } = useOpencodeContext();

  const { data: initialMessages } = useQuery({
    ...opencodeQueries.sessionMessages(serverUrl, sessionId),
    enabled: isServerActive,
  });

  const { events, isStreaming, clearEvents } = useSessionEventStream(
    serverUrl,
    sessionId,
    isServerActive
  );

  const chatMessages = useSessionChatMessages(events, initialMessages);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-xl">Session Chat</h2>
        <div className="flex gap-2">
          <Link params={{ sessionId }} to="/opencode-test/$sessionId/events">
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
    </div>
  );
}
