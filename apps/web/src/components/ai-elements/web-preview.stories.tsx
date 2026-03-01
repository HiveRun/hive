import type { Meta, StoryObj } from "@storybook/react";
import { IconRefresh, IconWorld } from "@tabler/icons-react";
import type { ComponentProps } from "react";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewConsole,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  WebPreviewViewportControls,
} from "@/components/ai-elements/web-preview";

const PANEL_HEIGHT_CLASS = "h-[680px]";

type WebPreviewStoryProps = Pick<
  ComponentProps<typeof WebPreview>,
  "url" | "viewportPreset" | "isLoading" | "error"
>;

function WebPreviewStory(args: WebPreviewStoryProps) {
  return (
    <WebPreview {...args}>
      <WebPreviewNavigation>
        <div className="flex items-center gap-2">
          <WebPreviewNavigationButton disabled tooltip="Reload preview">
            <IconRefresh className="size-4" />
          </WebPreviewNavigationButton>
          <WebPreviewNavigationButton disabled tooltip="Open in browser">
            <IconWorld className="size-4" />
          </WebPreviewNavigationButton>
        </div>
        <WebPreviewUrl />
        <WebPreviewViewportControls />
      </WebPreviewNavigation>
      <WebPreviewBody />
      <WebPreviewConsole>
        <p className="font-mono text-muted-foreground text-xs">
          console.info(&quot;Storybook mock console output&quot;)
        </p>
      </WebPreviewConsole>
    </WebPreview>
  );
}

const meta: Meta<typeof WebPreviewStory> = {
  title: "Features/WebPreview",
  component: WebPreviewStory,
  args: {
    url: "https://example.com",
    viewportPreset: "desktop",
    isLoading: false,
    error: null,
  },
  decorators: [
    (StoryComponent) => (
      <div className={PANEL_HEIGHT_CLASS}>
        <StoryComponent />
      </div>
    ),
  ],
  tags: ["autodocs"],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    url: null,
  },
};

export const ErrorState: Story = {
  args: {
    error: "Unable to render preview. Service did not respond.",
  },
};
