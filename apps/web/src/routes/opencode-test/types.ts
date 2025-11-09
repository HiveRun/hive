export const DEFAULT_PORT = 5006;
export const COPY_FEEDBACK_DURATION = 2000;
export const STATUS_REFETCH_INTERVAL = 5000;
export const SESSIONS_REFETCH_INTERVAL = 5000;

export type Session = {
  id: string;
  title?: string;
  parentID?: string;
};

export type OpencodeEvent = {
  type: string;
  properties?: Record<string, unknown>;
  timestamp: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  isComplete: boolean;
};
