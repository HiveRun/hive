import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { opencodeQueries } from "@/queries/opencode";
import { useOpencodeContext } from "../../opencode-test";
import { useSessionEventStream } from "../hooks";

const sessionSearchSchema = z.object({
  sessionTitle: z.string().optional(),
});

export const Route = createFileRoute("/opencode-test/$sessionId/events")({
  component: SessionEventsPage,
  validateSearch: sessionSearchSchema,
});

function SessionEventsPage() {
  const { sessionId } = Route.useParams();
  const search = Route.useSearch();
  const { serverUrl, isServerActive } = useOpencodeContext();

  const { data: sessionDetail } = useQuery({
    ...opencodeQueries.sessionDetail(serverUrl, sessionId),
    enabled: isServerActive,
  });

  const { events, isStreaming, clearEvents } = useSessionEventStream(
    serverUrl,
    sessionId,
    isServerActive
  );

  const detailTitle = sessionDetail?.title?.trim();
  const sessionTitle =
    detailTitle || search.sessionTitle?.trim() || "Untitled Session";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-xl">{sessionTitle}</h2>
          <p className="text-muted-foreground text-sm">ID: {sessionId}</p>
        </div>
        <div className="flex gap-2">
          <Link
            params={{ sessionId }}
            search={{ sessionTitle }}
            to="/opencode-test/$sessionId"
          >
            <Button variant="outline">View Chat</Button>
          </Link>
          <Link to="/opencode-test">
            <Button variant="outline">Back to Sessions</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Event Stream</CardTitle>
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
            {events.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground text-sm">
                {isStreaming
                  ? "Waiting for events..."
                  : "No events received yet"}
              </p>
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {events.map((event, index) => (
                  <div
                    className="rounded-md border bg-muted p-3"
                    key={`${event.timestamp}-${index}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-1">
                        <p className="font-medium font-mono text-sm">
                          {event.type}
                        </p>
                        {event.properties && (
                          <pre className="overflow-x-auto font-mono text-muted-foreground text-xs">
                            {JSON.stringify(event.properties, null, 2)}
                          </pre>
                        )}
                      </div>
                      <span className="whitespace-nowrap text-muted-foreground text-xs">
                        {new Date(event.timestamp).toLocaleTimeString()}
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
