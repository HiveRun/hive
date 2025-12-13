import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  type ModelSelection,
  ModelSelector,
} from "@/components/model-selector";
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
  isModelChanging?: boolean;
  onSend: (content: string) => Promise<void>;
  sessionId: string;
  selectedModel?: ModelSelection;
  onModelChange: (model: ModelSelection) => void;
  onInterrupt: () => void;
  canInterrupt: boolean;
  isInterrupting: boolean;
  showInterruptHint: boolean;
  readOnly?: boolean;
  readOnlyMessage?: string;
};

type ComposeValues = z.infer<typeof formSchema>;

const validateMessage = (value: string) => {
  const result = formSchema.shape.message.safeParse(value);
  return result.success || result.error.issues[0]?.message;
};

export function ComposePanel({
  provider: agentProvider,
  isSending,
  isModelChanging = false,
  onSend,
  sessionId,
  selectedModel,
  onModelChange,
  onInterrupt,
  canInterrupt,
  isInterrupting,
  showInterruptHint,
  readOnly = false,
  readOnlyMessage,
}: ComposePanelProps) {
  const form = useForm<ComposeValues>({
    defaultValues: { message: "" },
    mode: "onChange",
  });
  const composerDisabled = readOnly || isSending;

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSend(values.message.trim());
    form.reset();
  });

  const interruptButtonLabel = (() => {
    if (isInterrupting) {
      return "Interrupting...";
    }
    if (canInterrupt) {
      return "Abort Response";
    }
    return "Interrupt Unavailable";
  })();

  return (
    <section className="min-h-0 w-full overflow-y-auto border border-border/60 bg-card p-3 text-[10px] text-muted-foreground uppercase tracking-[0.25em] lg:w-80 lg:border-l-2">
      <div className="flex items-center justify-between">
        <span>Send Instructions</span>
        <span>{agentProvider}</span>
      </div>
      {readOnly ? (
        <div className="mt-3 rounded-md border border-border/70 bg-muted/10 p-3 text-[11px] text-muted-foreground normal-case tracking-normal">
          {readOnlyMessage ??
            "Archived cells are read-only. Restore the branch to resume chatting."}
        </div>
      ) : null}
      <div className="mt-3">
        <label
          className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]"
          htmlFor="model-selector"
        >
          Model
        </label>
        <ModelSelector
          disabled={composerDisabled || isModelChanging}
          id="model-selector"
          onModelChange={onModelChange}
          providerId={agentProvider}
          selectedModel={selectedModel}
          sessionId={sessionId}
        />
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
                    disabled={composerDisabled}
                    onKeyDown={(event) => {
                      if (
                        (event.ctrlKey || event.metaKey) &&
                        event.key === "Enter" &&
                        !composerDisabled
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
                  Ctrl+Enter to send
                </span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
                  Esc twice to interrupt
                </span>
                {showInterruptHint ? (
                  <span className="text-[10px] text-primary uppercase tracking-[0.2em]">
                    Press Esc again to confirm interrupt
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Button
                  className="w-full border border-primary bg-primary px-3 py-1 text-primary-foreground text-xs hover:bg-primary/90 focus-visible:ring-primary sm:w-40"
                  disabled={composerDisabled || !form.formState.isValid}
                  type="submit"
                >
                  {isSending ? "Sending..." : "Send"}
                </Button>
                <Button
                  className="w-full border border-primary/70 bg-transparent px-3 py-1 text-primary text-xs hover:bg-primary/10 focus-visible:ring-primary disabled:text-muted-foreground disabled:opacity-50 sm:w-40"
                  disabled={readOnly || !canInterrupt || isInterrupting}
                  onClick={onInterrupt}
                  type="button"
                  variant="outline"
                >
                  {interruptButtonLabel}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Form>
    </section>
  );
}
