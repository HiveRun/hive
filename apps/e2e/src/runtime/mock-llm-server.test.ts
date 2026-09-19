import { expect, test } from "bun:test";
import { startMockLlmServer } from "./mock-llm-server";

const HTTP_OK = 200;

test("streams an exact fixture response over the OpenAI chat protocol", async () => {
  const server = startMockLlmServer();

  try {
    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "hive-e2e",
        stream: true,
        messages: [
          {
            role: "user",
            content: "Reply with exactly HIVE_E2E_PROTOCOL_SMOKE",
          },
        ],
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(body).toContain('"content":"HIVE_E2E_PROTOCOL_SMOKE"');
    expect(body).toEndWith("data: [DONE]\n\n");
  } finally {
    await server.stop();
  }
});
