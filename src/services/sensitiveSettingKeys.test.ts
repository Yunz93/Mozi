import { describe, expect, it } from "vitest";
import { SENSITIVE_SETTING_KEYS } from "./sensitiveSettingKeys";

describe("SENSITIVE_SETTING_KEYS", () => {
  it("stores the WeRead API key with other secrets", () => {
    expect(SENSITIVE_SETTING_KEYS).toContain("wereadApiKey");
  });
});
