# Updater Release Notes

This repository uses the Tauri updater plugin on Windows and Linux, and the same signed updater artifacts for native macOS updates.

## Release channels

- Default to beta validation unless the user explicitly requests a stable release. Use `vX.Y.Z-beta.N` for the next planned stable version, increasing `N` from 1 after checking remote tags. Never reuse or move a published tag.
- Only an explicit stable-release request authorizes `vX.Y.Z`. The workflow validates the tag and marks beta as `prerelease: true` and stable as `prerelease: false`. GitHub excludes prereleases from Latest; beta builds keep their own signed assets and `latest.json` under their tags.
- Manual macOS asset recovery defaults to the beta channel. Recovering a stable tag requires selecting stable explicitly; the channel must match the existing tag.
- The installer script downloads stable releases only; its optional `RELEASE_TAG` accepts stable tags only. In-app updates default to `releases/latest/download/latest.json`.
- **Receive beta updates** is off by default. When enabled, manual and automatic checks select the highest newer semantic version among published stable and beta releases with updater manifests. Drafts and releases whose prerelease flag disagrees with their tag are excluded. The selected tag's signed updater artifacts use the existing download, save, signature verification, installation, and relaunch flow. Disabling the option clears previous check results and checks stable releases only; it never downgrades an installed beta.

## Beta discovery index

Beta-enabled clients read `https://raw.githubusercontent.com/Yunz93/Mozi/updater-index/releases.json`. User devices no longer query the GitHub Releases REST API, whose anonymous quota is shared by the originating IP. The index has `schemaVersion: 1` and a `releases` array with `tag_name`, `draft`, `prerelease`, and `assets` (containing `latest.json`). Clients construct manifest URLs from validated tags rather than accepting arbitrary URLs from the index. The existing signature verification and installation paths remain in use.

The native process caches an index for 60 seconds and errors for 5 seconds, merging concurrent manual, startup and multiwindow requests. Version comparisons happen after reading the cache, so results are not tied to a particular installed version. A missing index, unsupported schema, malformed JSON or HTTP failure is reported as a failed check, never as “up to date.” Stable-only checks continue using `releases/latest/download/latest.json`.

After `verify-published-assets` succeeds, `publish-update-index` uses the Actions token to paginate Releases and add the verified tag to the dedicated `updater-index` branch. Historical candidates must already be in the verified index; an unrelated Release still being built cannot enter it. Rebuilding also removes deleted, draft, incomplete or channel-mismatched entries. Git reference updates are fast-forward only; concurrent publishers re-read and merge the current index after a conflict. This avoids both overwriting a newer version during an older release repair and losing a verified tag through cancellation of a queued concurrency job.

### Initialization and recovery

The first complete tagged release using this workflow creates the index branch. Until then, Beta-enabled clients report that the index has not been published; use the release page for manual downloads. This source change alone does not create the remote branch. No existing version tags or stable release manifests are moved or overwritten.

To seed an older stable/Beta tag, or recover a failed index publication, first run the same complete published-asset, metadata, SHA-256 and updater-signature checks used by `verify-published-assets` for that exact tag. Then run the publisher in an explicitly authorized environment, with repository write access:

```bash
export GITHUB_REPOSITORY=Yunz93/Mozi
export RELEASE_TAG=v2.3.6-beta.1
node scripts/publish-update-index.mjs --output /tmp/mozi-release-index.json
node scripts/publish-update-index.mjs --publish
```

`GH_TOKEN` must already contain the authorized token; never put it in a command argument or commit it. Without `--publish`, the script only reads GitHub and optionally writes the local output. Seed each verified historical tag individually. The existing macOS-only repair dispatch does not satisfy the complete verification gate and does not automatically publish the index.

After initialization, confirm that the raw index returns HTTP 200, its first entry is the highest eligible semantic version, the previous stable update URL is unchanged, and both manual and startup checks with **Receive beta updates** enabled find the expected version.

When withdrawing an indexed release (deleting it or making it a draft), immediately rebuild the index with a surviving public tag that has already passed complete verification. Preview with `RELEASE_TAG=<verified-surviving-tag> node scripts/publish-update-index.mjs --output /tmp/mozi-release-index.json`, confirm that the withdrawn tag is absent, then run the same command with `--publish`. The workflow refreshes the index after successful releases; withdrawal alone does not trigger a rebuild. Until the index is refreshed and caches expire, Beta checks can report a manifest download error for the withdrawn tag.

### Local regression verification

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib release_channel::tests
node --test scripts/ci/update-index.test.mjs scripts/ci/release-channel.test.mjs
npm test -- src/services/updaterService.install.test.ts src/components/settings/tabs/UpdatesTab.test.tsx
node scripts/desktop/beta-updater.mjs
```

The last command starts `npm run tauri:dev` with the existing optional desktop driver, a separate application identity and local index/manifest fixtures. It checks missing-index errors, Beta discovery while the old API returns 403, cache sharing between manual and automatic checks, and switching back to the real stable feed. It saves screenshots and results under `.perf/mozi-beta-updater-*` and never installs an update. Fixture URL overrides compile only in debug builds with `desktop-e2e`; production builds always use the fixed repository endpoints.

## Build configuration

`src-tauri/tauri.conf.json` must keep:

```json
"bundle": {
  "createUpdaterArtifacts": true
}
```

With this enabled, tagged Windows builds emit signed updater packages plus `latest.json`. Leaving it `false` publishes installers only — Settings → About will never see new versions.

Current release status: `createUpdaterArtifacts` is `true` (1.0 publish gate). Ensure CI has a working updater signing key (`TAURI_SIGNING_PRIVATE_KEY`, and password only if the key requires one).

## Beta channel

Beta tags use `vX.Y.Z-beta.N` with a positive sequence number. The release channel gate rejects unsupported tags and mismatched manual channels before native builds start. Manual repair dispatch defaults to `beta`; repairing an existing stable tag requires explicitly choosing `stable`.

Beta releases are marked as prereleases. Their installers and signed `latest.json` stay under their own tag. The standard installer and the app's stable update feed continue to use `releases/latest`, so stable users do not receive beta builds automatically. Download beta installers from the corresponding GitHub prerelease page.

All native release builds use the `TAURI` environment. The optional `MOZI_APTABASE_APP_KEY` environment Secret is passed only to native build steps; it is not required by asset verification. Updater signatures must match the public key embedded in the release source for both channels.

## One-time setup

1. Generate a Tauri updater keypair:

```bash
npm run tauri signer generate -- --ci -w /secure/path/markdown-press-updater.key
```

2. Keep the private key outside the repository.
3. Set these GitHub Actions secrets:
   - `TAURI_SIGNING_PRIVATE_KEY`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if your private key uses a password
4. For `TAURI_SIGNING_PRIVATE_KEY`, prefer the exact output generated by `tauri signer generate --ci`.
   - With `--ci`, the private key file content is a single-line base64 string intended for CI secrets.
   - The release workflow also accepts the raw multi-line minisign secret key text and converts it automatically.
   - Do not store the public key (`.pub`) in this secret.
   - Do not store only the second line of the raw secret key. The `untrusted comment:` header line must be present.
5. If the key was generated by Tauri CLI `2.9.3` through `2.10.0` with an empty password, regenerate it with the current CLI before using it in CI.
6. Prefer a **no-password** updater keypair for CI. If `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set to an empty string in the build environment, Tauri 2.x can corrupt key decoding (`Invalid symbol` near offset 346). This workflow only exports the password env when the secret is non-empty.
7. The public key embedded in [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json) must match the private key used in CI. If you rotate the keypair, update the embedded public key too.

## Secret format troubleshooting

- `failed to decode base64 secret key` / `Invalid symbol` usually means either:
  - the key value is raw minisign text instead of CI base64, or
  - the secret was URL-encoded / otherwise polluted (e.g. `%2B`), or
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is present as an empty env var (remove it; only set a real password).
    The prepare script URL-decodes and re-encodes the key, but re-setting a clean `tauri signer generate --ci` secret is still best.
- `Missing comment in secret key` means the decoded private key is incomplete or malformed. This often happens when only the payload line was saved and the leading `untrusted comment:` line was dropped.
- The release workflow validates the secret and re-exports a CI base64 value through `TAURI_SIGNING_PRIVATE_KEY` for the Tauri build step. Do not rename this build env var to `TAURI_SIGNING_PRIVATE_KEY_PATH`.

## Per-release checklist

1. Choose beta by default, or stable only when explicitly requested, and create the corresponding unused tag. Tagged releases sync versions through `npm run release:sync-version`.
2. Let GitHub Actions build the tagged release.
3. After the workflow finishes, confirm the GitHub Release contains:
   - the Windows NSIS installer
   - updater signature assets
   - `latest.json`
   - the macOS `.dmg` (and `.app.tar.gz` updater artifact)
   - the Linux `.deb` and `.deb.sig`, with a `linux-x86_64-deb` entry in `latest.json` matching the installed package type
4. Install the new release on Windows, macOS, and a supported Linux desktop where an older build is already present.
5. For stable releases, open `Settings -> About` and confirm:
   - the app detects the newer version
   - release notes load
   - download and install complete successfully
   - macOS downloads the signed `.app.tar.gz` for the current architecture, verifies it before installation, and atomically replaces the app after all windows have saved
6. For beta releases, confirm the Release is marked as a prerelease and stable install/update endpoints still resolve to the previous stable release. Enable **Receive beta updates** to check and install the beta, or download it manually. With the option off, publishing a beta must not trigger an update. Verify that a higher beta sequence and the final stable version of the same base version are both detected, and that turning the option off does not downgrade the app.

## Automated verification

Tagged releases run `verify-published-assets`: download the eight published assets, verify the stable/beta metadata matches the tag, GitHub SHA-256 digests, exact version/platform inventory, repository-bound URLs and matching signature sidecars. The `verify-updater` Rust example then verifies all three updater packages using the public key embedded in that tag's source. It shares the signature implementation with the macOS installer and never reads a key from the feed or environment. This job has read-only repository access and no signing secrets. Only after it succeeds does the separate `publish-update-index` job update the Beta discovery index. The older macOS-only repair dispatch is outside the complete eight-asset contract.

Desktop acceptance also performs a real installed Linux `.deb` upgrade with a separate package identity, ephemeral signing key and localhost feed. It checks signature corruption, authorization cancellation, saving two dirty windows, `dpkg` replacement and relaunch. Its child-only authorization proxy exercises success and failure without requiring interactive credentials. Real OS prompts and installed-release upgrades remain on the [physical-device checklist](../testing/physical-release-checklist.md).

## Platform behavior

- Windows: in-app update checks and install flow use the Tauri updater plugin and signed NSIS artifacts.
- Linux: the signed `.deb` uses the same check, download progress, document-saving guard, install and relaunch flow as Windows. The Tauri updater verifies the signature and uses `dpkg` with administrator authorization. The desktop needs a working authorization mechanism, normally `pkexec` and a polkit authentication agent. Cancellation or installation failure keeps the app running and releases the document lock. The release job runs after macOS and Windows, uploads the validated `.deb` and signature, and merges only the Linux platform entries into the existing same-version manifest. Users of v2.3.0 must manually install the first version with this capability before they can update in-app.
- macOS: in-app update reads `latest.json`, downloads the architecture-matched signed `.app.tar.gz`, and verifies its signature after download and again before installation. After every window saves successfully, it extracts the bundle, replaces the installed app atomically, and relaunches after the old process exits. Replacement failures restore the old bundle. The README one-line installer remains a separate DMG installation path through `scripts/install-macos.sh`.
