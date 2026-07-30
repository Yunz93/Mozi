/**
 * Keep in sync with `src-tauri/tauri.conf.json` → `bundle.createUpdaterArtifacts`.
 * While false, in-app update checks must no-op so clients do not poll a missing
 * `latest.json` and surface false failures.
 */
export const UPDATER_ARTIFACTS_ENABLED = true;

export function areUpdaterArtifactsEnabled(): boolean {
  return UPDATER_ARTIFACTS_ENABLED;
}
