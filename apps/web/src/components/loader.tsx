import { Loader2 } from "lucide-react";

export default function Loader() {
  return (
    <div
      className="flex h-full items-center justify-center pt-8"
      data-testid="app-loader"
    >
      <Loader2 className="animate-spin" />
    </div>
  );
}
