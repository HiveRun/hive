import { useCallback, useRef } from "react";
import { getApiBase } from "@/lib/api-base";
import { isMouseMovementInputChunk } from "@/lib/terminal-input";

export const API_BASE = getApiBase();
const OUTPUT_BUFFER_LIMIT = 250_000;
export const SOCKET_RECONNECT_DELAY_MS = 800;
const INPUT_BATCH_BASE_WINDOW_MS = 16;
const INPUT_BATCH_MAX_WINDOW_MS = 24;
const INPUT_BATCH_WINDOW_STEP_MS = 8;
const INPUT_BATCH_HIGH_CHUNK_THRESHOLD = 6;
const INPUT_BATCH_FLUSH_SIZE = 1024;
const INPUT_BATCH_HIGH_CHUNK_MIN_BUFFER = 256;
export const TERMINAL_FONT_FAMILY =
  '"JetBrainsMono Nerd Font", "MesloLGS NF", "CaskaydiaMono Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font Mono", "Geist Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Noto Color Emoji", monospace';

export const appendTerminalOutput = (
  current: string,
  chunk: string
): string => {
  const next = `${current}${chunk}`;
  if (next.length <= OUTPUT_BUFFER_LIMIT) {
    return next;
  }
  return next.slice(next.length - OUTPUT_BUFFER_LIMIT);
};

const shouldFlushTerminalInputBatch = (bufferedLength: number) =>
  bufferedLength >= INPUT_BATCH_FLUSH_SIZE;

export const useTerminalInputBatcher = (args: {
  enabled: boolean;
  sendInputMessage: (data: string) => void;
}) => {
  const inputBufferRef = useRef("");
  const inputFlushTimeoutRef = useRef<number | null>(null);
  const inputBatchWindowMsRef = useRef(INPUT_BATCH_BASE_WINDOW_MS);
  const inputBatchChunkCountRef = useRef(0);

  const updateBatchWindow = useCallback(
    (chunkCount: number, queuedLength: number, forceImmediate: boolean) => {
      if (forceImmediate) {
        inputBatchWindowMsRef.current = INPUT_BATCH_BASE_WINDOW_MS;
        return;
      }

      if (
        chunkCount >= INPUT_BATCH_HIGH_CHUNK_THRESHOLD &&
        queuedLength >= INPUT_BATCH_HIGH_CHUNK_MIN_BUFFER
      ) {
        inputBatchWindowMsRef.current = Math.min(
          INPUT_BATCH_MAX_WINDOW_MS,
          inputBatchWindowMsRef.current + INPUT_BATCH_WINDOW_STEP_MS
        );
        return;
      }

      inputBatchWindowMsRef.current = Math.max(
        INPUT_BATCH_BASE_WINDOW_MS,
        inputBatchWindowMsRef.current - INPUT_BATCH_WINDOW_STEP_MS
      );
    },
    []
  );

  const resetInputBatcher = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      inputFlushTimeoutRef.current !== null
    ) {
      window.clearTimeout(inputFlushTimeoutRef.current);
      inputFlushTimeoutRef.current = null;
    }

    inputBufferRef.current = "";
    inputBatchChunkCountRef.current = 0;
    inputBatchWindowMsRef.current = INPUT_BATCH_BASE_WINDOW_MS;
  }, []);

  const flushQueuedInput = useCallback(
    (forceImmediate = false) => {
      if (
        typeof window !== "undefined" &&
        inputFlushTimeoutRef.current !== null
      ) {
        window.clearTimeout(inputFlushTimeoutRef.current);
        inputFlushTimeoutRef.current = null;
      }

      const queued = inputBufferRef.current;
      if (queued.length === 0) {
        return;
      }

      const chunkCount = inputBatchChunkCountRef.current;
      inputBufferRef.current = "";
      inputBatchChunkCountRef.current = 0;
      updateBatchWindow(chunkCount, queued.length, forceImmediate);
      args.sendInputMessage(queued);
    },
    [args.sendInputMessage, updateBatchWindow]
  );

  const sendInput = useCallback(
    (data: string) => {
      if (!(args.enabled && data.length > 0)) {
        return;
      }

      if (!isMouseMovementInputChunk(data)) {
        resetInputBatcher();
        args.sendInputMessage(data);
        return;
      }

      inputBufferRef.current += data;
      inputBatchChunkCountRef.current += 1;
      if (shouldFlushTerminalInputBatch(inputBufferRef.current.length)) {
        flushQueuedInput(true);
        return;
      }

      if (typeof window === "undefined") {
        return;
      }

      if (inputFlushTimeoutRef.current !== null) {
        return;
      }

      inputFlushTimeoutRef.current = window.setTimeout(() => {
        inputFlushTimeoutRef.current = null;
        flushQueuedInput();
      }, inputBatchWindowMsRef.current);
    },
    [args.enabled, args.sendInputMessage, flushQueuedInput, resetInputBatcher]
  );

  return { flushQueuedInput, resetInputBatcher, sendInput };
};
