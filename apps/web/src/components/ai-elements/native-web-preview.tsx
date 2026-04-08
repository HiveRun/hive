import type { RefObject } from "react";

type NativeWebPreviewProps = {
  containerRef: RefObject<HTMLElement | null>;
  title: string;
};

export const NativeWebPreview = ({
  containerRef,
  title,
}: NativeWebPreviewProps) => (
  <section
    className="h-full w-full bg-background"
    data-testid="native-web-preview"
    ref={containerRef}
    title={title}
  />
);
