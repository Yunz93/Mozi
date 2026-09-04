import type { BuiltinEmbeddingDownloadConsent } from "../../types";

export type BuiltinEmbeddingDownloadAction = "prompt" | "allow" | "skip";

export function shouldPromptBuiltinEmbeddingDownload(input: {
  consent: BuiltinEmbeddingDownloadConsent;
  privacyMode: boolean;
  modelCached: boolean;
}): boolean {
  return resolveBuiltinEmbeddingDownloadAction(input) === "prompt";
}

export function resolveBuiltinEmbeddingDownloadAction(input: {
  consent: BuiltinEmbeddingDownloadConsent;
  privacyMode: boolean;
  modelCached: boolean;
}): BuiltinEmbeddingDownloadAction {
  if (input.modelCached) return "allow";
  if (input.privacyMode) return "skip";
  if (input.consent === "granted") return "allow";
  if (input.consent === "denied") return "skip";
  return "prompt";
}

type ConsentPromptHandler = () => Promise<boolean>;

let promptHandler: ConsentPromptHandler | null = null;
let inflightPrompt: Promise<boolean> | null = null;

/** 由 AppDialogs 注册，用现有 ConfirmDialog 询问用户。 */
export function registerBuiltinEmbeddingConsentPrompt(
  handler: ConsentPromptHandler | null,
): void {
  promptHandler = handler;
}

export async function requestBuiltinEmbeddingDownloadConsent(): Promise<boolean> {
  if (inflightPrompt) return inflightPrompt;
  if (!promptHandler) return false;

  inflightPrompt = promptHandler()
    .then((granted) => granted)
    .finally(() => {
      inflightPrompt = null;
    });
  return inflightPrompt;
}

let hasNotifiedSkip = false;

export function consumeBuiltinEmbeddingSkipNotice(): boolean {
  if (hasNotifiedSkip) return false;
  hasNotifiedSkip = true;
  return true;
}

export function resetBuiltinEmbeddingSkipNoticeForTests(): void {
  hasNotifiedSkip = false;
}
