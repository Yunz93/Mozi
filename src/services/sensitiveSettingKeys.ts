export const SENSITIVE_SETTING_KEYS = [
  "blogGithubToken",
  "wechatAppSecret",
  "wereadApiKey",
  "geminiApiKey",
  "codexApiKey",
  "deepseekApiKey",
  "glmApiKey",
  "kimiApiKey",
  "mimoApiKey",
  "embeddingApiKey",
  "imageHostingGithubToken",
  "imageHostingS3SecretAccessKey",
  "imageHostingOssAccessKeySecret",
  "imageHostingQiniuSecretKey",
] as const;

export type SensitiveSettingKey = (typeof SENSITIVE_SETTING_KEYS)[number];
