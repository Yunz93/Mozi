import React, { useState } from "react";
import type {
  ImageHostingProvider,
  ImageHostingConfig,
  ImageHostingGitHubConfig,
  ImageHostingS3Config,
  ImageHostingAliyunOssConfig,
  ImageHostingQiniuConfig,
  ImageHostingCustomConfig,
} from "../../../types";
import { useI18n } from "../../../hooks/useI18n";
import type { TranslationKey } from "../../../utils/i18n";
import type { SettingsTabProps } from "../types";
import { useSecureSettings } from "../useSecureSettings";
import { testImageHostingConnection } from "../../../services/imageHostingService";
import { SettingsSelect } from "../SettingsSelect";

const PROVIDER_OPTIONS: {
  value: ImageHostingProvider;
  labelKey: TranslationKey | null;
  fixedLabel?: string;
}[] = [
  { value: "none", labelKey: "imageHosting_providerNone" },
  { value: "github", labelKey: null, fixedLabel: "GitHub" },
  { value: "s3", labelKey: "imageHosting_providerS3" },
  { value: "aliyun_oss", labelKey: "imageHosting_providerAliyunOss" },
  { value: "qiniu", labelKey: "imageHosting_providerQiniu" },
  { value: "custom", labelKey: "imageHosting_providerCustom" },
];

const QINIU_ZONES: { value: string; labelKey: TranslationKey }[] = [
  { value: "z0", labelKey: "imageHosting_qiniuZoneZ0" },
  { value: "z1", labelKey: "imageHosting_qiniuZoneZ1" },
  { value: "z2", labelKey: "imageHosting_qiniuZoneZ2" },
  { value: "na0", labelKey: "imageHosting_qiniuZoneNa0" },
  { value: "as0", labelKey: "imageHosting_qiniuZoneAs0" },
  { value: "cn-east-2", labelKey: "imageHosting_qiniuZoneCnEast2" },
];

const inputClass =
  "w-full px-3 py-2 border border-gray-200 dark:border-white/10 text-sm bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-accent-DEFAULT/20 focus:border-accent-DEFAULT transition-all rounded-xl";
const labelClass =
  "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5";
const descClass = "mt-1 text-[11px] text-gray-400 dark:text-gray-500";

export const ImageHostingTab: React.FC<SettingsTabProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const { t } = useI18n();
  const { handleSecureSettingChange, renderSecureSaveState } =
    useSecureSettings(onUpdateSettings);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testError, setTestError] = useState("");
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const ih = settings.imageHosting;

  const updateIH = (updates: Partial<ImageHostingConfig>) => {
    onUpdateSettings({ imageHosting: { ...ih, ...updates } });
  };

  const updateGitHub = (updates: Partial<ImageHostingGitHubConfig>) => {
    updateIH({ github: { ...ih.github, ...updates } });
  };

  const updateS3 = (updates: Partial<ImageHostingS3Config>) => {
    updateIH({ s3: { ...ih.s3, ...updates } });
  };

  const updateAliyunOss = (updates: Partial<ImageHostingAliyunOssConfig>) => {
    updateIH({ aliyunOss: { ...ih.aliyunOss, ...updates } });
  };

  const updateQiniu = (updates: Partial<ImageHostingQiniuConfig>) => {
    updateIH({ qiniu: { ...ih.qiniu, ...updates } });
  };

  const updateCustom = (updates: Partial<ImageHostingCustomConfig>) => {
    updateIH({ custom: { ...ih.custom, ...updates } });
  };

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestError("");
    try {
      await testImageHostingConnection(settings);
      setTestStatus("success");
      setTimeout(() => setTestStatus("idle"), 3000);
    } catch (err) {
      setTestStatus("error");
      setTestError(err instanceof Error ? err.message : String(err));
    }
  };

  const renderSecretInput = (
    secureKey:
      | "imageHostingGithubToken"
      | "imageHostingS3SecretAccessKey"
      | "imageHostingOssAccessKeySecret"
      | "imageHostingQiniuSecretKey",
    label: string,
    placeholder: string,
  ) => (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="relative">
        <input
          type={showSecrets[secureKey] ? "text" : "password"}
          value={(settings[secureKey] as string) ?? ""}
          onChange={(e) => handleSecureSettingChange(secureKey, e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} pr-10 font-mono`}
        />
        <button
          type="button"
          onClick={() => toggleSecret(secureKey)}
          className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          {showSecrets[secureKey] ? (
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {renderSecureSaveState(secureKey)}
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in-02s">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {t("imageHosting_title")}
        </h3>

        <div className="space-y-4">
          {/* Provider Selection */}
          <div>
            <label className={labelClass}>{t("imageHosting_provider")}</label>
            <SettingsSelect
              aria-label={t("imageHosting_provider")}
              value={ih.provider}
              options={PROVIDER_OPTIONS.map((opt) => ({
                value: opt.value,
                label: opt.labelKey
                  ? t(opt.labelKey)
                  : (opt.fixedLabel ?? opt.value),
              }))}
              onChange={(provider) =>
                updateIH({ provider: provider as ImageHostingProvider })
              }
            />
          </div>

          {ih.provider !== "none" && (
            <>
              {/* Paste Action */}
              <div>
                <label className={labelClass}>
                  {t("imageHosting_onPaste")}
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="pasteAction"
                      checked={ih.pasteAction === "upload"}
                      onChange={() => updateIH({ pasteAction: "upload" })}
                      className="accent-accent-DEFAULT"
                    />
                    {t("imageHosting_uploadToHosting")}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="pasteAction"
                      checked={ih.pasteAction === "local"}
                      onChange={() => updateIH({ pasteAction: "local" })}
                      className="accent-accent-DEFAULT"
                    />
                    {t("imageHosting_saveLocally")}
                  </label>
                </div>
              </div>

              {/* Keep Local Copy */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("imageHosting_keepLocalCopy")}
                  </label>
                  <p className={descClass}>
                    {t("imageHosting_keepLocalCopyDesc")}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ih.keepLocalCopy}
                  onClick={() => updateIH({ keepLocalCopy: !ih.keepLocalCopy })}
                  className={`w-10 h-6 rounded-full transition-colors duration-200 relative shrink-0 cursor-pointer ${
                    ih.keepLocalCopy
                      ? "bg-green-500"
                      : "bg-gray-200 dark:bg-gray-700"
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 shadow-sm pointer-events-none ${
                      ih.keepLocalCopy ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Provider-specific config */}
      {ih.provider === "github" && (
        <div className="space-y-4 pt-2 border-t border-gray-200/50 dark:border-white/5">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            GitHub
          </h4>
          <div>
            <label className={labelClass}>{t("imageHosting_repository")}</label>
            <input
              type="text"
              value={ih.github.repo}
              onChange={(e) => updateGitHub({ repo: e.target.value })}
              placeholder="owner/repo"
              className={inputClass}
            />
            <p className={descClass}>{t("imageHosting_repositoryDesc")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t("imageHosting_branch")}</label>
              <input
                type="text"
                value={ih.github.branch}
                onChange={(e) => updateGitHub({ branch: e.target.value })}
                placeholder="main"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t("imageHosting_path")}</label>
              <input
                type="text"
                value={ih.github.path}
                onChange={(e) => updateGitHub({ path: e.target.value })}
                placeholder="images/"
                className={inputClass}
              />
            </div>
          </div>
          {renderSecretInput(
            "imageHostingGithubToken",
            "Token",
            "github_pat_xxx...",
          )}
          <div>
            <label className={labelClass}>
              {t("imageHosting_customDomainOptional")}
            </label>
            <input
              type="text"
              value={ih.github.customDomain}
              onChange={(e) => updateGitHub({ customDomain: e.target.value })}
              placeholder="https://cdn.example.com"
              className={inputClass}
            />
            <p className={descClass}>{t("imageHosting_githubCdnDesc")}</p>
          </div>
        </div>
      )}

      {ih.provider === "s3" && (
        <div className="space-y-4 pt-2 border-t border-gray-200/50 dark:border-white/5">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("imageHosting_s3Compatible")}
          </h4>
          <div>
            <label className={labelClass}>Endpoint</label>
            <input
              type="text"
              value={ih.s3.endpoint}
              onChange={(e) => updateS3({ endpoint: e.target.value })}
              placeholder="s3.us-east-1.amazonaws.com"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Region</label>
              <input
                type="text"
                value={ih.s3.region}
                onChange={(e) => updateS3({ region: e.target.value })}
                placeholder="us-east-1"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Bucket</label>
              <input
                type="text"
                value={ih.s3.bucket}
                onChange={(e) => updateS3({ bucket: e.target.value })}
                placeholder="my-bucket"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t("imageHosting_pathPrefix")}</label>
            <input
              type="text"
              value={ih.s3.pathPrefix}
              onChange={(e) => updateS3({ pathPrefix: e.target.value })}
              placeholder="images/"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Access Key ID</label>
            <input
              type="text"
              value={ih.s3.accessKeyId}
              onChange={(e) => updateS3({ accessKeyId: e.target.value })}
              placeholder="AKIAIOSFODNN7EXAMPLE"
              className={`${inputClass} font-mono`}
            />
          </div>
          {renderSecretInput(
            "imageHostingS3SecretAccessKey",
            "Secret Access Key",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          )}
          <div>
            <label className={labelClass}>
              {t("imageHosting_customDomainOptional")}
            </label>
            <input
              type="text"
              value={ih.s3.customDomain}
              onChange={(e) => updateS3({ customDomain: e.target.value })}
              placeholder="https://cdn.example.com"
              className={inputClass}
            />
          </div>
        </div>
      )}

      {ih.provider === "aliyun_oss" && (
        <div className="space-y-4 pt-2 border-t border-gray-200/50 dark:border-white/5">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("imageHosting_providerAliyunOss")}
          </h4>
          <div>
            <label className={labelClass}>Endpoint</label>
            <input
              type="text"
              value={ih.aliyunOss.endpoint}
              onChange={(e) => updateAliyunOss({ endpoint: e.target.value })}
              placeholder="oss-cn-hangzhou.aliyuncs.com"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Bucket</label>
            <input
              type="text"
              value={ih.aliyunOss.bucket}
              onChange={(e) => updateAliyunOss({ bucket: e.target.value })}
              placeholder="my-bucket"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t("imageHosting_pathPrefix")}</label>
            <input
              type="text"
              value={ih.aliyunOss.pathPrefix}
              onChange={(e) => updateAliyunOss({ pathPrefix: e.target.value })}
              placeholder="images/"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Access Key ID</label>
            <input
              type="text"
              value={ih.aliyunOss.accessKeyId}
              onChange={(e) => updateAliyunOss({ accessKeyId: e.target.value })}
              className={`${inputClass} font-mono`}
            />
          </div>
          {renderSecretInput(
            "imageHostingOssAccessKeySecret",
            "Access Key Secret",
            "",
          )}
          <div>
            <label className={labelClass}>
              {t("imageHosting_customDomainOptional")}
            </label>
            <input
              type="text"
              value={ih.aliyunOss.customDomain}
              onChange={(e) =>
                updateAliyunOss({ customDomain: e.target.value })
              }
              placeholder="https://cdn.example.com"
              className={inputClass}
            />
          </div>
        </div>
      )}

      {ih.provider === "qiniu" && (
        <div className="space-y-4 pt-2 border-t border-gray-200/50 dark:border-white/5">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("imageHosting_providerQiniu")}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Bucket</label>
              <input
                type="text"
                value={ih.qiniu.bucket}
                onChange={(e) => updateQiniu({ bucket: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t("imageHosting_zone")}</label>
              <SettingsSelect
                aria-label={t("imageHosting_zone")}
                value={ih.qiniu.zone}
                options={QINIU_ZONES.map((z) => ({
                  value: z.value,
                  label: `${t(z.labelKey)} (${z.value})`,
                }))}
                onChange={(zone) => updateQiniu({ zone })}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t("imageHosting_domain")}</label>
            <input
              type="text"
              value={ih.qiniu.domain}
              onChange={(e) => updateQiniu({ domain: e.target.value })}
              placeholder="cdn.example.com"
              className={inputClass}
            />
            <p className={descClass}>{t("imageHosting_qiniuDomainDesc")}</p>
          </div>
          <div>
            <label className={labelClass}>{t("imageHosting_pathPrefix")}</label>
            <input
              type="text"
              value={ih.qiniu.pathPrefix}
              onChange={(e) => updateQiniu({ pathPrefix: e.target.value })}
              placeholder="images/"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Access Key</label>
            <input
              type="text"
              value={ih.qiniu.accessKey}
              onChange={(e) => updateQiniu({ accessKey: e.target.value })}
              className={`${inputClass} font-mono`}
            />
          </div>
          {renderSecretInput("imageHostingQiniuSecretKey", "Secret Key", "")}
        </div>
      )}

      {ih.provider === "custom" && (
        <div className="space-y-4 pt-2 border-t border-gray-200/50 dark:border-white/5">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("imageHosting_providerCustom")}
          </h4>
          <div>
            <label className={labelClass}>{t("imageHosting_uploadUrl")}</label>
            <input
              type="text"
              value={ih.custom.uploadUrl}
              onChange={(e) => updateCustom({ uploadUrl: e.target.value })}
              placeholder="https://api.example.com/upload"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t("imageHosting_method")}</label>
              <SettingsSelect
                aria-label={t("imageHosting_method")}
                value={ih.custom.method}
                options={[
                  { value: "POST", label: "POST" },
                  { value: "PUT", label: "PUT" },
                ]}
                onChange={(method) =>
                  updateCustom({ method: method as "POST" | "PUT" })
                }
              />
            </div>
            <div>
              <label className={labelClass}>
                {t("imageHosting_fileFieldName")}
              </label>
              <input
                type="text"
                value={ih.custom.fileFieldName}
                onChange={(e) =>
                  updateCustom({ fileFieldName: e.target.value })
                }
                placeholder="file"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>
              {t("imageHosting_headersJson")}
            </label>
            <textarea
              value={ih.custom.headers}
              onChange={(e) => updateCustom({ headers: e.target.value })}
              placeholder='{"Authorization": "Bearer xxx"}'
              rows={3}
              className={`${inputClass} font-mono resize-none`}
            />
          </div>
          <div>
            <label className={labelClass}>
              {t("imageHosting_responseUrlJsonPath")}
            </label>
            <input
              type="text"
              value={ih.custom.responseUrlJsonPath}
              onChange={(e) =>
                updateCustom({ responseUrlJsonPath: e.target.value })
              }
              placeholder="data.url"
              className={inputClass}
            />
            <p className={descClass}>
              {t("imageHosting_responseUrlJsonPathDesc")}
            </p>
          </div>
        </div>
      )}

      {/* Test Connection */}
      {ih.provider !== "none" && (
        <div className="pt-2 border-t border-gray-200/50 dark:border-white/5">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testStatus === "testing"}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-all active:scale-95 ${
              testStatus === "success"
                ? "bg-green-500 text-white"
                : testStatus === "error"
                  ? "bg-red-500 text-white"
                  : "bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/20"
            }`}
          >
            {testStatus === "testing" && (
              <svg
                className="w-4 h-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83" />
              </svg>
            )}
            {testStatus === "success" && (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {testStatus === "error" && (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            {testStatus === "testing"
              ? t("imageHosting_testing")
              : testStatus === "success"
                ? t("imageHosting_testSuccess")
                : testStatus === "error"
                  ? t("imageHosting_testFailed")
                  : t("imageHosting_testConnection")}
          </button>
          {testStatus === "error" && testError && (
            <p className="mt-2 text-xs text-red-500 break-all">{testError}</p>
          )}
        </div>
      )}
    </div>
  );
};
