const DEFAULT_SSE_WAIT_TIMEOUT_MS = 30_000;
const EVENT_PREFIX_LENGTH = 6;
const DATA_PREFIX_LENGTH = 5;
const FRAME_LINE_SPLIT_RE = /\r?\n/;

export type SseEvent = {
  event: string;
  data: unknown;
  rawData: string;
};

type WaitForEventOptions = {
  event: string;
  timeoutMs?: number;
  predicate?: (event: SseEvent) => boolean;
};

export class SseConnection {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private readonly abortController: AbortController;
  private buffer = "";
  private closed = false;

  constructor(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    abortController: AbortController
  ) {
    this.reader = reader;
    this.abortController = abortController;
  }

  async waitForEvent(options: WaitForEventOptions): Promise<SseEvent> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_SSE_WAIT_TIMEOUT_MS;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const event = await this.readNextEvent(timeoutMs);
      if (!event) {
        continue;
      }

      if (event.event !== options.event) {
        continue;
      }

      if (options.predicate && !options.predicate(event)) {
        continue;
      }

      return event;
    }

    throw new Error(`Timed out waiting for SSE event '${options.event}'`);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.abortController.abort();
    await this.reader.cancel();
  }

  private async readNextEvent(timeoutMs: number): Promise<SseEvent | null> {
    while (!this.closed) {
      const frame = this.tryConsumeFrame();
      if (frame) {
        return parseSseFrame(frame);
      }

      const chunk = await this.readChunk(timeoutMs);
      if (!chunk) {
        return null;
      }

      this.buffer += chunk;
    }

    return null;
  }

  private tryConsumeFrame(): string | null {
    const boundaryIndex = this.buffer.indexOf("\n\n");
    if (boundaryIndex < 0) {
      return null;
    }

    const frame = this.buffer.slice(0, boundaryIndex);
    this.buffer = this.buffer.slice(boundaryIndex + 2);
    return frame;
  }

  private async readChunk(timeoutMs: number): Promise<string | null> {
    const readResult = await Promise.race([
      this.reader.read(),
      timeoutAfter(timeoutMs),
    ]);

    if (readResult === "timeout") {
      return null;
    }

    if (readResult.done) {
      this.closed = true;
      return null;
    }

    return this.decoder.decode(readResult.value, { stream: true });
  }
}

function parseSseFrame(frame: string): SseEvent {
  const lines = frame.split(FRAME_LINE_SPLIT_RE);
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice(EVENT_PREFIX_LENGTH).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(DATA_PREFIX_LENGTH).trimStart());
    }
  }

  const rawData = dataLines.join("\n");
  const data = parseSseData(rawData);

  return { event, data, rawData };
}

function parseSseData(rawData: string): unknown {
  if (!rawData) {
    return null;
  }

  try {
    return JSON.parse(rawData);
  } catch {
    return rawData;
  }
}

async function timeoutAfter(ms: number): Promise<"timeout"> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
  return "timeout";
}

export async function connectSse(url: string): Promise<SseConnection> {
  const abortController = new AbortController();
  const response = await fetch(url, { signal: abortController.signal });

  if (!response.ok) {
    throw new Error(`Failed to connect to SSE endpoint: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("SSE endpoint returned empty body");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(`Expected text/event-stream, got '${contentType}'`);
  }

  const reader =
    response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  return new SseConnection(reader, abortController);
}
