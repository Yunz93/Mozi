$ErrorActionPreference = 'Stop'

# Install the release-configuration NSIS package in this ephemeral runner.
$installer = @(Get-ChildItem 'src-tauri/target/release/bundle/nsis/*-setup.exe')
if ($installer.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
$installation = Join-Path $env:RUNNER_TEMP 'mozi-desktop-installed'
$result = Start-Process -FilePath $installer[0].FullName -ArgumentList @('/S', "/D=$installation") -Wait -PassThru
if ($result.ExitCode -notin @(0, 3010)) { throw "Installer failed: $($result.ExitCode)" }
$application = @(Get-ChildItem $installation -Filter '*.exe' | Where-Object { $_.Name -notmatch 'uninstall|unins|卸载' })
if ($application.Count -ne 1) { throw 'Expected exactly one installed application binary' }

# Select an installed runtime and explicitly use that same runtime in the app,
# so the driver cannot accidentally target Edge browser's unrelated version.
$locations = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application'),
    (Join-Path $env:ProgramFiles 'Microsoft/EdgeWebView/Application'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application')
)
$runtimes = @(foreach ($location in $locations) {
    if (Test-Path $location) {
        Get-ChildItem $location -Directory | Where-Object {
            $_.Name -match '^\d+\.\d+\.\d+\.\d+$' -and (Test-Path (Join-Path $_.FullName 'msedgewebview2.exe'))
        }
    }
})
$runtime = $runtimes | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $runtime) { throw 'WebView2 runtime was not installed' }
$tools = Join-Path $env:RUNNER_TEMP 'mozi-webdriver'
New-Item $tools -ItemType Directory -Force | Out-Null
$archive = Join-Path $tools 'edgedriver.zip'
Invoke-WebRequest "https://msedgedriver.microsoft.com/$($runtime.Name)/edgedriver_win64.zip" -OutFile $archive
Expand-Archive $archive -DestinationPath $tools -Force
$driver = Join-Path $tools 'msedgedriver.exe'
& $driver --version

@(
    "MOZI_DESKTOP_BINARY=$($application[0].FullName)",
    'MOZI_DESKTOP_DRIVER=official',
    "MOZI_EDGE_DRIVER=$driver",
    "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=$($runtime.FullName)"
) | Add-Content -Path $env:GITHUB_ENV -Encoding utf8

# Only package/runtime metadata, never profile data, is uploaded.
New-Item '.perf/desktop' -ItemType Directory -Force | Out-Null
@{ installerExitCode = $result.ExitCode; installer = $installer[0].Name;
   application = $application[0].Name; webview2 = $runtime.Name;
   installerSha256 = (Get-FileHash $installer[0].FullName -Algorithm SHA256).Hash;
   applicationSha256 = (Get-FileHash $application[0].FullName -Algorithm SHA256).Hash
} | ConvertTo-Json | Set-Content '.perf/desktop/windows-install.json' -Encoding utf8
