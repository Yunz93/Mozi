$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'NSIS cache preparation is limited to ephemeral CI runners' }
$cliVersion = (Get-Content 'node_modules/@tauri-apps/cli/package.json' -Raw | ConvertFrom-Json).version
if ($cliVersion -notmatch '^2\.11\.') { throw 'Review the pinned NSIS recipe when upgrading the Tauri CLI series' }

# Match tauri-cli-v2.11.4's bundler recipe. SHA-256 values are the official
# GitHub release asset digests; Tauri additionally verifies the plugin's SHA-1.
$archiveHash = 'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1'
$pluginHash = '5ba143b5db4a87d32d6e7802e033330aae56cbceabe0d1e3ba41948385ad4709'
$cache = Join-Path $env:LOCALAPPDATA 'tauri/NSIS'
$plugin = Join-Path $cache 'Plugins/x86-unicode/additional/nsis_tauri_utils.dll'
$ready = (Test-Path (Join-Path $cache 'makensis.exe')) -and (Test-Path (Join-Path $cache 'Bin/makensis.exe')) -and (Test-Path $plugin)
if ($ready) { $ready = (Get-FileHash $plugin -Algorithm SHA256).Hash -eq $pluginHash }
if (-not $ready) {
    $download = Join-Path $env:RUNNER_TEMP 'mozi-nsis-download'
    New-Item $download -ItemType Directory -Force | Out-Null
    foreach ($asset in @(
        @{ repository = 'tauri-apps/binary-releases'; tag = 'nsis-3.11'; name = 'nsis-3.11.zip'; hash = $archiveHash },
        @{ repository = 'tauri-apps/nsis-tauri-utils'; tag = 'nsis_tauri_utils-v0.5.3'; name = 'nsis_tauri_utils.dll'; hash = $pluginHash }
    )) {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            & gh release download $asset.tag --repo $asset.repository --pattern $asset.name --dir $download --clobber
            if ($LASTEXITCODE -eq 0) { break }
            if ($attempt -eq 3) { throw "Release API download failed: $($asset.name)" }
            Start-Sleep -Seconds 3
        }
        if ((Get-FileHash (Join-Path $download $asset.name) -Algorithm SHA256).Hash -ne $asset.hash) {
            throw "Release asset checksum mismatch: $($asset.name)"
        }
    }
    $extracted = Join-Path $download 'extracted'
    Expand-Archive (Join-Path $download 'nsis-3.11.zip') -DestinationPath $extracted -Force
    if (Test-Path $cache) { Remove-Item $cache -Recurse -Force }
    New-Item (Split-Path $cache) -ItemType Directory -Force | Out-Null
    Move-Item (Join-Path $extracted 'nsis-3.11') $cache
    New-Item (Split-Path $plugin) -ItemType Directory -Force | Out-Null
    Copy-Item (Join-Path $download 'nsis_tauri_utils.dll') $plugin
}
New-Item '.perf/desktop' -ItemType Directory -Force | Out-Null
@{ nsis = '3.11'; plugin = '0.5.3'; archiveSha256 = $archiveHash; pluginSha256 = $pluginHash; tauriCli = $cliVersion } |
    ConvertTo-Json | Set-Content '.perf/desktop/nsis-tools.json' -Encoding utf8
Write-Output 'Verified NSIS 3.11 and Tauri plugin 0.5.3 are ready in the bundler cache'
