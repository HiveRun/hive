import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { voiceQueries } from "@/queries/voice";
import { VoiceRecorderButton } from "./voice-recorder";

const MESSAGE_MAX_LENGTH = 5000;

const formSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message is required")
    .max(MESSAGE_MAX_LENGTH, "Message is too long"),
});

type ComposePanelProps = {
  provider: string;
  isSending: boolean;
  onSend: (content: string) => Promise<void>;
};

type ComposeValues = z.infer<typeof formSchema>;

const combineSegments = (...segments: string[]) =>
  segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(" ")
    .trim();

const validateMessage = (value: string) => {
  const result = formSchema.shape.message.safeParse(value);
  return result.success || result.error.issues[0]?.message;
};

export function ComposePanel({
  provider: agentProvider,
  isSending,
  onSend,
}: ComposePanelProps) {
  const form = useForm<ComposeValues>({
    defaultValues: { message: "" },
    mode: "onChange",
  });

  const voiceConfigQuery = useQuery(voiceQueries.config());
  const voiceConfig = voiceConfigQuery.data;

  const streamingSessionRef = useRef<{
    original: string;
    base: string;
    appended: string;
  } | null>(null);

  const beginStreamingInsert = useCallback(() => {
    const currentValue = form.getValues("message") ?? "";
    streamingSessionRef.current = {
      original: currentValue,
      base: currentValue.trim(),
      appended: "",
    };
  }, [form]);

  const insertStreamingChunk = useCallback(
    (partial: string) => {
      const trimmed = partial.trim();
      if (!(trimmed && streamingSessionRef.current)) {
        return;
      }
      const session = streamingSessionRef.current;
      session.appended = session.appended
        ? `${session.appended} ${trimmed}`
        : trimmed;
      const combined = combineSegments(session.base, session.appended);
      form.setValue("message", combined, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    },
    [form]
  );

  const resetStreamingInsert = useCallback(() => {
    if (!streamingSessionRef.current) {
      return;
    }
    form.setValue("message", streamingSessionRef.current.original, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    streamingSessionRef.current = null;
  }, [form]);

  const handleTranscriptionInsert = useCallback(
    (transcript: string) => {
      const trimmed = transcript.trim();
      if (!trimmed) {
        streamingSessionRef.current = null;
        return;
      }

      if (streamingSessionRef.current) {
        const session = streamingSessionRef.current;
        const combined = combineSegments(session.base, trimmed);
        form.setValue("message", combined, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        });
        streamingSessionRef.current = null;
        return;
      }

      const existing = form.getValues("message")?.trim();
      const nextValue = existing ? `${existing} ${trimmed}`.trim() : trimmed;
      form.setValue("message", nextValue, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    },
    [form]
  );

  const voiceSummary = useMemo(() => {
    if (!voiceConfig?.enabled) {
      return null;
    }

    let modeLabel = "Voice";
    if (voiceConfig.mode === "local") {
      modeLabel = "Local";
    } else if (voiceConfig.mode === "remote") {
      modeLabel = "Remote";
    }

    const providerLabel = voiceConfig.provider ?? "-";
    const modelLabel = voiceConfig.model ?? "-";
    return `${modeLabel} • ${providerLabel} • ${modelLabel}`;
  }, [voiceConfig]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSend(values.message.trim());
    form.reset();
  });

  return (
    <section className="min-h-0 w-full overflow-y-auto border border-border/60 bg-card p-3 text-[10px] text-muted-foreground uppercase tracking-[0.25em] lg:w-80 lg:border-l-2">
      <div className="flex items-center justify-between">
        <span>Send Instructions</span>
        <span>{agentProvider}</span>
      </div>
      <Form {...form}>
        <form className="mt-2 space-y-3" onSubmit={handleSubmit}>
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Message</FormLabel>
                <FormControl>
                  <Textarea
                    className="min-h-[140px] border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground focus-visible:ring-primary"
                    disabled={isSending}
                    onKeyDown={(event) => {
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        event.key === "Enter" &&
                        !isSending
                      ) {
                        event.preventDefault();
                        handleSubmit();
                      }
                    }}
                    placeholder="Describe the work you want completed"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
            rules={{ validate: validateMessage }}
          />
          <div className="flex flex-col gap-2">
            {voiceSummary ? (
              <span className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
                Voice Model · {voiceSummary}
              </span>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
                Ctrl+Enter to send
              </span>
              <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3">
                {voiceConfig?.enabled && voiceConfig.allowBrowserRecording ? (
                  <VoiceRecorderButton
                    config={voiceConfig}
                    disabled={isSending}
                    onStreamingError={resetStreamingInsert}
                    onStreamingPartial={insertStreamingChunk}
                    onStreamingStart={beginStreamingInsert}
                    onTranscription={handleTranscriptionInsert}
                  />
                ) : null}
                <Button
                  className="border border-primary bg-primary px-3 py-1 text-primary-foreground text-xs hover:bg-primary/90 focus-visible:ring-primary"
                  disabled={isSending || !form.formState.isValid}
                  type="submit"
                >
                  {isSending ? "Sending..." : "Send"}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Form>
    </section>
  );
}
