import { AlertCircle } from "lucide-react";
import { Button } from "./ui/button";

type ErrorPageProps = {
  error: Error;
  reset?: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 pt-8">
      <AlertCircle className="size-12 text-destructive" />
      <div className="text-center">
        <h2 className="font-semibold text-lg">Something went wrong</h2>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
      {reset && (
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
      )}
    </div>
  );
}
