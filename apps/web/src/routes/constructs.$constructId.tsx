// biome-ignore lint/style/useFilenamingConvention: Route file naming is prescribed by TanStack Router

import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Play, Send, Square } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { agentMutations, agentQueries } from "@/queries/agents";
import { constructMutations, constructQueries } from "@/queries/constructs";
import type { AgentMessage, AgentSession } from "@/types/agent";
import type { Construct, ConstructStatus } from "@/types/construct";

const MESSAGE_POLL_INTERVAL_MS = 1000;

const messageSchema = z.object({
  content: z.string().min(1, "Message cannot be empty"),
});

export const Route = createFileRoute("/constructs/$constructId")({
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(constructQueries.detail(params.constructId)),
  component: ConstructDetailPage,
});

function ConstructDetailPage() {
  const { constructId } = Route.useParams();
  const { data: construct } = useSuspenseQuery(
    constructQueries.detail(constructId)
  );
  const typedConstruct = construct as Construct;

  const sessionQuery = agentQueries.session(constructId);
  const { data: session } = useQuery(sessionQuery);
  const sessionData = (session as AgentSession | undefined) ?? null;

  const messagesQuery = agentQueries.messages(sessionData?.sessionId ?? "");
  const { data: messages = [] } = useQuery({
    ...messagesQuery,
    enabled: Boolean(sessionData?.sessionId),
    refetchInterval:
      sessionData?.status === "working" ? MESSAGE_POLL_INTERVAL_MS : false,
  });
  const typedMessages = messages as AgentMessage[];

  const [messageValue, setMessageValue] = useState("");
  const [messageError, setMessageError] = useState<string | null>(null);

  const startAgentMutation = useMutation({
    ...constructMutations.startAgent,
    onSuccess: () => {
      toast.success("Agent started successfully");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const sendMessageMutation = useMutation({
    ...agentMutations.sendMessage,
    onSuccess: () => {
      setMessageValue("");
      setMessageError(null);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const stopAgentMutation = useMutation({
    ...agentMutations.stop,
    onSuccess: () => {
      toast.success("Agent stopped");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const result = messageSchema.safeParse({ content: messageValue });
    if (!result.success) {
      setMessageError(result.error.issues[0]?.message ?? "Message is required");
      return;
    }

    if (!sessionData?.sessionId) {
      setMessageError("Start the agent before sending messages.");
      return;
    }

    sendMessageMutation.mutate({
      sessionId: sessionData.sessionId,
      content: result.data.content,
    });
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="font-bold text-3xl">{typedConstruct.name}</h1>
            {typedConstruct.description && (
              <p className="mt-2 text-muted-foreground">
                {typedConstruct.description}
              </p>
            )}
          </div>
          <StatusBadge status={typedConstruct.status} />
        </div>

        <div className="flex gap-4 text-muted-foreground text-sm">
          <div>
            <span className="font-medium">Type:</span>{" "}
            <Badge variant="outline">{typedConstruct.type}</Badge>
          </div>
          <div>
            <span className="font-medium">Template:</span>{" "}
            {typedConstruct.templateId}
          </div>
          <div>
            <span className="font-medium">Created:</span>{" "}
            {new Date(typedConstruct.createdAt).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Agent Control</CardTitle>
              <CardDescription>
                Start and manage your AI agent session
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sessionData ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge>{sessionData.status}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Provider:</span>
                      <span className="font-medium">
                        {sessionData.provider}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Started:</span>
                      <span className="font-medium">
                        {new Date(sessionData.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <Separator />
                  <Button
                    className="w-full"
                    disabled={stopAgentMutation.isPending}
                    onClick={() =>
                      stopAgentMutation.mutate(sessionData.sessionId)
                    }
                    variant="destructive"
                  >
                    <Square className="mr-2 size-4" />
                    {stopAgentMutation.isPending ? "Stopping..." : "Stop Agent"}
                  </Button>
                </>
              ) : (
                <Button
                  className="w-full"
                  disabled={startAgentMutation.isPending}
                  onClick={() =>
                    startAgentMutation.mutate({
                      id: typedConstruct.id,
                      provider: "anthropic",
                    })
                  }
                >
                  <Play className="mr-2 size-4" />
                  {startAgentMutation.isPending ? "Starting..." : "Start Agent"}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="flex h-[600px] flex-col">
            <CardHeader>
              <CardTitle>Agent Chat</CardTitle>
              <CardDescription>Communicate with your AI agent</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border p-4">
                {typedMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                    No messages yet. Start the agent to begin.
                  </div>
                ) : (
                  typedMessages.map((message) => (
                    <div
                      className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                      key={message.id}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2 ${
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <div className="font-medium text-sm">
                          {message.role === "user" ? "You" : "Agent"}
                        </div>
                        <div className="mt-1 whitespace-pre-wrap">
                          {message.content}
                        </div>
                        <div className="mt-1 text-xs opacity-70">
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form className="mt-4" onSubmit={handleSendMessage}>
                <div className="flex gap-2">
                  <Input
                    disabled={
                      !sessionData || sessionData.status === "completed"
                    }
                    onChange={(event) => {
                      setMessageValue(event.target.value);
                      setMessageError(null);
                    }}
                    placeholder="Type a message..."
                    value={messageValue}
                  />
                  <Button
                    disabled={
                      !sessionData ||
                      sessionData.status === "completed" ||
                      sendMessageMutation.isPending ||
                      messageValue.trim().length === 0
                    }
                    type="submit"
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
                {messageError && (
                  <p className="mt-2 text-destructive text-sm">
                    {messageError}
                  </p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const STATUS_BADGE_VARIANTS: Record<
  ConstructStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "secondary",
  provisioning: "outline",
  active: "default",
  awaiting_input: "outline",
  reviewing: "outline",
  completed: "secondary",
  parked: "secondary",
  archived: "secondary",
  error: "destructive",
};

function StatusBadge({ status }: { status: ConstructStatus }) {
  return (
    <Badge variant={STATUS_BADGE_VARIANTS[status] ?? "outline"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
