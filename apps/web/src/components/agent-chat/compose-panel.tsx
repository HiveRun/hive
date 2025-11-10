import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ComposePanelProps = {
  provider: string;
  message: string;
  isSending: boolean;
  onMessageChange: (value: string) => void;
  onSend: () => void;
};

export function ComposePanel({
  provider,
  message,
  isSending,
  onMessageChange,
  onSend,
}: ComposePanelProps) {
  return (
    <section className="min-h-0 w-full overflow-y-auto border-[var(--chat-divider)] border-t-2 bg-[var(--chat-surface-alt)] p-3 text-[10px] text-[var(--chat-neutral-450)] uppercase tracking-[0.25em] lg:w-80 lg:border-t-0 lg:border-l-2">
      <div className="flex items-center justify-between">
        <span>Send Instructions</span>
        <span>{provider}</span>
      </div>
      <div className="mt-2 space-y-1.5">
        <Label
          className="text-[10px] text-[var(--chat-neutral-450)] uppercase tracking-[0.2em]"
          htmlFor="agent-message"
        >
          Message
        </Label>
        <Textarea
          className="min-h-[140px] border-2 border-[var(--chat-textarea-border)] bg-transparent text-[var(--chat-neutral-50)] text-sm placeholder:text-[var(--chat-neutral-450)] focus-visible:ring-[var(--chat-accent)]"
          disabled={isSending}
          id="agent-message"
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key === "Enter" &&
              !isSending
            ) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder="Describe the work you want completed"
          value={message}
        />
        <div className="flex items-center justify-between">
          <span>Ctrl+Enter to send</span>
          <Button
            className="border-2 border-[var(--chat-accent)] bg-[var(--chat-accent-dark)] px-3 py-1 text-[var(--chat-neutral-50)] text-xs hover:bg-[var(--chat-hover)] focus-visible:ring-[var(--chat-accent)]"
            disabled={isSending || !message.trim()}
            onClick={onSend}
            type="button"
          >
            {isSending ? "Sending..." : "Send"}
          </Button>
        </div>
      </div>
    </section>
  );
}
