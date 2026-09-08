import { describe, expect, it } from "vitest";
import {
  classifyWechatPublishError,
  extractWechatAllowlistIps,
} from "./wechatPublishErrors";

describe("classifyWechatPublishError", () => {
  it("maps missing credentials and title", () => {
    expect(
      classifyWechatPublishError("WeChat AppID is required for publishing."),
    ).toBe("appId");
    expect(
      classifyWechatPublishError(
        "WeChat AppSecret is required for publishing.",
      ),
    ).toBe("appSecret");
    expect(classifyWechatPublishError("WeChat draft title is required.")).toBe(
      "title",
    );
  });

  it("maps IP allowlist failures", () => {
    expect(
      classifyWechatPublishError(
        "WeChat API error 40164 during fetching access token: invalid ip 1.2.3.4, not in whitelist",
      ),
    ).toBe("ipAllowlist");
  });

  it("extracts blocked IPv4s from WeChat 40164 errmsgs", () => {
    expect(
      extractWechatAllowlistIps(
        "WeChat API error 40164 during fetching access token: invalid ip 1.2.3.4, not in whitelist",
      ),
    ).toEqual(["1.2.3.4"]);
    expect(
      extractWechatAllowlistIps(
        "invalid ip 10.0.0.1 ipv6 ::ffff:10.0.0.1, not in whitelist",
      ),
    ).toEqual(["10.0.0.1"]);
    expect(extractWechatAllowlistIps("invalid ip, not in whitelist")).toEqual(
      [],
    );
  });

  it("maps invalid AppID and AppSecret", () => {
    expect(
      classifyWechatPublishError(
        "WeChat API error 40013 during fetching access token: invalid appid",
      ),
    ).toBe("invalidAppId");
    expect(
      classifyWechatPublishError(
        "WeChat API error 40125 during fetching access token: invalid appsecret",
      ),
    ).toBe("invalidSecret");
    expect(
      classifyWechatPublishError(
        "WeChat API error 40001 during fetching access token: invalid credential",
      ),
    ).toBe("invalidSecret");
  });

  it("maps quota, media, permission, and network failures", () => {
    expect(
      classifyWechatPublishError(
        "WeChat API error 45009 during creating draft: api daily quota must not exceed",
      ),
    ).toBe("quota");
    expect(
      classifyWechatPublishError(
        "WeChat API error 40007 during uploading thumbnail image: invalid media",
      ),
    ).toBe("media");
    expect(
      classifyWechatPublishError(
        "WeChat API error 48001 during creating draft: api unauthorized",
      ),
    ).toBe("permission");
    expect(
      classifyWechatPublishError(
        "Failed to request WeChat access token: error sending request",
      ),
    ).toBe("network");
  });

  it("returns null for unrelated errors", () => {
    expect(
      classifyWechatPublishError("OpenAI request failed with status 401."),
    ).toBe(null);
    expect(classifyWechatPublishError("Custom backend failure")).toBe(null);
  });
});
