export const SENSITIVE_SETTING_KEYS = [
  "blogGithubToken",
  "wechatAppSecret",
  "wereadApiKey",
  "geminiApiKey",
  "codexApiKey",
  "deepseekApiKey",
  "embeddingApiKey",
  "imageHostingGithubToken",
  "imageHostingS3SecretAccessKey",
  "imageHostingOssAccessKeySecret",
  "imageHostingQiniuSecretKey",
] as const;

export type SensitiveSettingKey = (typeof SENSITIVE_SETTING_KEYS)[number];
