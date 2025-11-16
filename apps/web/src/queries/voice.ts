import { rpc } from "@/lib/rpc";

export type VoiceConfig = {
  enabled: boolean;
  allowBrowserRecording: boolean;
  mode: "local" | "remote" | null;
  provider: string | null;
  model: string | null;
  language: string | null;
};

export type VoiceTranscriptionResult = {
  text: string;
  language: string | null;
  durationInSeconds: number | null;
  segments: Array<{
    text: string;
    start: number | null;
    end: number | null;
  }>;
};

export const voiceQueries = {
  config: () => ({
    queryKey: ["voice-config"] as const,
    queryFn: async (): Promise<VoiceConfig> => {
      const { data, error } = await rpc.api.voice.config.get();
      if (error) {
        throw new Error("Failed to load voice configuration");
      }
      return data.voice as VoiceConfig;
    },
  }),
};

export const voiceMutations = {
  transcribe: {
    mutationFn: async (input: {
      audioBase64: string;
      mimeType?: string;
    }): Promise<VoiceTranscriptionResult> => {
      const { data, error } = await rpc.api.voice.transcriptions.post(input);
      if (error) {
        throw new Error("Failed to transcribe audio");
      }
      return data as VoiceTranscriptionResult;
    },
  },
};
