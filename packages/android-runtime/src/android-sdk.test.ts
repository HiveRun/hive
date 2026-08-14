import { describe, expect, it } from "vitest";

import { selectLatestStableAndroidPlatform } from "../e2e/browser-microphone";

describe("Android SDK selection", () => {
  it("ignores preview platforms newer than installed stable platforms", () => {
    expect(
      selectLatestStableAndroidPlatform([
        "android-34",
        "android-35",
        "android-36.1",
      ])
    ).toBe("android-35");
  });
});
