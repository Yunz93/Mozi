param([int]$ApplicationPid, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DesktopWindowProbe {
    public delegate bool WindowCallback(IntPtr window, IntPtr state);
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback, IntPtr state);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
}
'@
Add-Type -AssemblyName System.Drawing
$windows = [System.Collections.Generic.List[object]]::new()
[DesktopWindowProbe]::EnumWindows({ param($window, $state)
    [uint32]$owner = 0
    [void][DesktopWindowProbe]::GetWindowThreadProcessId($window, [ref]$owner)
    if ($owner -eq $ApplicationPid -and [DesktopWindowProbe]::IsWindowVisible($window)) {
        $rectangle = [DesktopWindowProbe+Rect]::new()
        [void][DesktopWindowProbe]::GetWindowRect($window, [ref]$rectangle)
        $windows.Add(@{ left = $rectangle.Left; top = $rectangle.Top; width = $rectangle.Right - $rectangle.Left; height = $rectangle.Bottom - $rectangle.Top })
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
$application = Get-Process -Id $ApplicationPid -ErrorAction SilentlyContinue
@{ processId = $ApplicationPid; processAlive = [bool]$application; responding = $application.Responding; windows = @($windows.ToArray()) } |
    ConvertTo-Json -Depth 5 | Set-Content (Join-Path $OutputDirectory 'windows-native.json') -Encoding utf8
$rectangle = $windows | Where-Object { $_.width -gt 100 -and $_.height -gt 100 } | Select-Object -First 1
if ($rectangle) {
    $bitmap = [System.Drawing.Bitmap]::new($rectangle.width, $rectangle.height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rectangle.left, $rectangle.top, 0, 0, $bitmap.Size)
        $bitmap.Save((Join-Path $OutputDirectory 'windows-native.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
