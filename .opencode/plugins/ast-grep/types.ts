import type { CLI_LANGUAGES } from "./constants";

export type CliLanguage = (typeof CLI_LANGUAGES)[number];
export type CliMatch = {
  text: string;
  range: {
    byteOffset: { start: number; end: number };
    start: Position;
    end: Position;
  };
  file: string;
  lines: string;
  charCount: { leading: number; trailing: number };
  language: string;
};

export type SgResult = {
  matches: CliMatch[];
  totalMatches: number;
  truncated: boolean;
  truncatedReason?: "max_matches" | "max_output_bytes" | "timeout";
  error?: string;
};
