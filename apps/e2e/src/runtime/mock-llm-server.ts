type ChatMessageContent =
  | string
  | Array<{ type?: string; text?: string }>
  | undefined;

type ChatCompletionRequest = {
  messages?: Array<{ role?: string; content?: ChatMessageContent }>;
  model?: string;
  stream?: boolean;
};

export type MockLlmServer = {
  baseUrl: string;
  stop: () => Promise<void>;
};

const DEFAULT_RESPONSE = "Hive E2E assistant response";
const EXACT_REPLY_PATTERN = /reply with exactly\s+([A-Z0-9_]+)/i;
const MILLISECONDS_PER_SECOND = 1000;

function extractText(content: ChatMessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  return (content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function createResponseText(payload: ChatCompletionRequest): string {
  const userText = payload.messages
    ?.toReversed()
    .find((message) => message.role === "user");
  const prompt = extractText(userText?.content);
  const exactReply = prompt.match(EXACT_REPLY_PATTERN)?.[1];
  return (
    exactReply ?? (prompt ? `Hive E2E response: ${prompt}` : DEFAULT_RESPONSE)
  );
}

function jsonResponse(value: unknown): Response {
  return Response.json(value, {
    headers: { "cache-control": "no-store" },
  });
}

export function startMockLlmServer(): MockLlmServer {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/v1/models") {
        return jsonResponse({
          object: "list",
          data: [
            {
              id: "hive-e2e",
              object: "model",
              created: 0,
              owned_by: "hive-e2e",
            },
          ],
        });
      }

      if (
        request.method !== "POST" ||
        url.pathname !== "/v1/chat/completions"
      ) {
        return new Response("Not found", { status: 404 });
      }

      const payload = (await request.json()) as ChatCompletionRequest;
      const content = createResponseText(payload);
      const model = payload.model ?? "hive-e2e";
      const created = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
      const id = `chatcmpl-hive-e2e-${String(created)}`;

      if (payload.stream === false) {
        return jsonResponse({
          id,
          object: "chat.completion",
          created,
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        });
      }

      const chunks = [
        {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content },
              finish_reason: null,
            },
          ],
        },
        {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        },
      ];
      const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
      return new Response(body, {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/event-stream",
        },
      });
    },
  });

  return {
    baseUrl: `http://${server.hostname}:${String(server.port)}/v1`,
    stop: async () => {
      await server.stop(true);
    },
  };
}
