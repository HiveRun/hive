import type { CLI_LANGUAGES, NAPI_LANGUAGES } from "./constants";

export type CliLanguage = (typeof CLI_LANGUAGES)[number];
export type NapiLanguage = (typeof NAPI_LANGUAGES)[number];

export type Position = {
  line: number;
  column: number;
};

export type Range = {
  start: Position;
  end: Position;
};

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

export type SearchMatch = {
  file: string;
  text: string;
  range: Range;
  lines: string;
};

export type MetaVariable = {
  name: string;
  text: string;
  kind: string;
};

export type AnalyzeResult = {
  text: string;
  range: Range;
  kind: string;
  metaVariables: MetaVariable[];
};

export type TransformResult = {
  original: string;
  transformed: string;
  editCount: number;
};

export type SgResult = {
  matches: CliMatch[];
  totalMatches: number;
  truncated: boolean;
  truncatedReason?: "max_matches" | "max_output_bytes" | "timeout";
  error?: string;
};
