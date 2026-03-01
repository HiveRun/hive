import type { Decorator } from "@storybook/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { createStorybookQueryClient } from "@/storybook/query-client";
import { StorybookRouter } from "@/storybook/router";

const STORYBOOK_THEME_KEY = "hive-storybook-theme";

export const withAppProviders: Decorator = (Story, context) => {
  const queryClient = createStorybookQueryClient();
  const story = <Story />;
  const withRouter = context.parameters.router === true;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey={STORYBOOK_THEME_KEY}>
        {withRouter ? <StorybookRouter>{story}</StorybookRouter> : story}
      </ThemeProvider>
    </QueryClientProvider>
  );
};
