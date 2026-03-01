import type { Preview } from "@storybook/react";
import "../src/index.css";
import "./storybook.css";
import { withAppProviders } from "../src/storybook/decorators";

const preview: Preview = {
  decorators: [withAppProviders],
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
