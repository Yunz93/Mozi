See the assets to download this version and install.

### {{VERSION}}

Release notes for this tag are tracked in the repository history and pull requests merged since the previous release.

> Windows in-app updates: this build ships with `createUpdaterArtifacts: true`, so clients can receive `latest.json` and signed updater packages from the GitHub Release.

### macOS 安装说明

**推荐：一键安装**

```bash
curl -fsSL https://raw.githubusercontent.com/Yunz93/Mozi/main/scripts/install-macos.sh | bash
```

脚本会自动下载对应架构的 `.dmg`、移除隔离标记并安装到「应用程序」。

已配置 Apple 开发者证书与公证凭据的 Release 也可直接拖入 Applications 打开。若仍提示无法验证开发者，请执行：

```
xattr -cr /Applications/墨知.app
```

> 若应用仍在 Downloads 文件夹，请改用：
>
> ```
> xattr -cr ~/Downloads/墨知.app
> ```

### Windows 安装说明

下载 `.exe` 安装程序，双击运行即可。如果 Windows SmartScreen 拦截，点击"更多信息" → "仍要运行"。
