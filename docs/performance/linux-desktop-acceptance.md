# Linux desktop acceptance: 2026-11-08

## Scope

The release build was packaged as a Debian `.deb`, extracted and executed in a
Debian 13.7 container in the development environment. The application used GTK
3.24.49, WebKitGTK 2.54.0, an Xvfb X11 display, Openbox and a session D-Bus. It was
controlled through tauri-driver 2.1.0 / WebKitWebDriver. The application reported
the `wry` browser and `linux` platform. Release assets, Rust IPC, native filesystem
events and the actual React/editor UI were exercised together.

The outer host is Debian 13.6, x86_64, Linux 6.18.57. The build used Rust stable
1.99.1, Node 22.23.4 and the ordinary optimized release profile. Signing was
skipped for this local package. Test vaults contained synthetic Markdown only;
profiles, notes and screenshots were isolated from user data. No Chromium
filesystem substitute or JavaScript filesystem mock was used.

## Completed behavior checks

Sixteen grouped checks passed after the fixes below:

| Check                                                      | Observed result                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Startup snapshot, note restoration and initial task scope  | Note restored; hidden/trash tasks excluded; one watcher and three references                         |
| Repeated external edits                                    | Current editor and task index updated                                                                |
| Atomic file replacement                                    | Replacement content appeared in the editor and task index                                            |
| Unicode create, rename, case-only rename and deletion      | File tree and task index followed each operation                                                     |
| Nested directory move and deletion                         | Old paths disappeared and task paths followed the directory                                          |
| Trash movement/restore, hidden files and external symlinks | Visibility and task exclusions remained consistent                                                   |
| Own save                                                   | Content reached disk without a false external-change conflict                                        |
| Directory removed/recreated at the same path               | New descendants replaced the old cached children                                                     |
| Two and five actual application windows                    | One watcher, with five and eleven references respectively                                            |
| Window ownership                                           | Another window could neither read nor release an owned subscription                                  |
| Background task reference                                  | After every vault window closed, a separate standalone-file window confirmed background task updates |
| Exact-file permission                                      | A single-file grant could not subscribe to its parent directory                                      |
| Root loss, recreation and window reload                    | Polling recovered the tree and tasks; reload reattached observation                                  |
| External edit while the buffer was dirty                   | Local text and external disk content were both preserved                                             |
| File deletion while the buffer was dirty                   | Local text remained; the deleted file was not recreated                                              |
| Backend loss during a structural change                    | The first polling snapshot restored the missing new file                                             |

The backend-loss check released actual window-owned subscriptions through IPC,
then created a file before the journal heartbeat. This deliberately exercises
failure recovery without fabricating filesystem responses. A background task
subscription remained active. The unfixed build left the new file absent from
the tree after 18 seconds even though the task index had already seen it; the
fixed build displayed it.

## Fixes found by desktop testing

The first `.deb` could be extracted and run, but `dpkg-deb --field` rejected its
control file: the Chinese product name had become an invalid Debian package
identifier. A Linux platform overlay now uses `Mozi` / `mozi` for packaging and
the executable, with a localized Chinese desktop launcher. The launcher forwards
selected files through `%F`. Linux targets Debian packages; updater artifacts
are disabled for this target because Tauri's Linux updater requires AppImage.
The Debian package is installed or updated through normal package-management
tools. No Linux release publication was added.

CI now builds the release `.deb` on Ubuntu 24.04, asks dpkg to parse its actual
metadata, validates the desktop entry and executable/file association, and runs
the application Rust tests on Linux. Merely extracting a package does not prove
that it is installable.

An index read could update the shared text-format cache before the document
watcher processed an external edit. The watcher then mistook the updated cache
for an acknowledged document version and left old text visible. Watchers now
keep their own observed content and track successful writes separately. A read
from another consumer does not acknowledge an edit; a read that predates a
concurrent save is still discarded. The same reader is used by native and
polling adapters.

When native replay failed, the polling adapter previously read its initial tree
only to establish a comparison signature. That silently absorbed structural
changes during the handoff. Native fallback now emits a strict initial snapshot
with an index-rescan request. If the root is initially unavailable, this request
remains pending until a later scan succeeds. Partial failed reads do not replace
the tree.

Five additional unit regressions cover an index winning the read race in either
mode, another read completing during a watch read, and fallback with an available
or initially unavailable root. The complete frontend suite passed 2,370 tests;
typecheck, targeted lint and production build passed.

## Reproduction and evidence

A Linux build requires the Tauri GTK/WebKit development packages. This session
used `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`,
`build-essential`, `pkg-config` and `patchelf`. Desktop automation additionally
used `webkit2gtk-driver`, `xvfb`, `xauth`, `openbox`, `dbus-x11` and CJK fonts.
Package validation additionally requires `desktop-file-utils`.

```sh
npm ci
npm run build
npm run tauri -- build --bundles deb --no-sign --config '{"build":{"beforeBuildCommand":""}}'
node scripts/check-linux-package.mjs
cargo install tauri-driver --locked
# Start the driver in an isolated desktop/session, then create a W3C WebDriver
# session whose tauri:options.application points to the packaged executable.
dbus-run-session -- xvfb-run -a tauri-driver
```

The local acceptance artifact includes JSON case results, before/after failure
evidence, screenshots, the package hash, environment details and the test harness.
Generated profiles and raw per-session artifacts are not committed to the public
repository. When collecting actual-window measurements, compare both modes with
100/1,000/10,000 notes and 1/2/5 windows. Short samples include automation overhead
and provide smoke evidence rather than latency, memory or power budgets.

## Remaining gates

This virtual desktop does not establish physical desktop acceptance on every
Linux distribution. Real suspend/resume, a slow/unavailable network share,
system notification delivery, tray behavior after the last application window
closes, hardware rendering and energy use remain to be exercised in a desktop
session. The background check above kept a standalone-file window for observation;
it does not claim zero-window tray notification coverage. macOS and Windows
packaged UI checks remain pending. Native mode therefore remains opt-in.
