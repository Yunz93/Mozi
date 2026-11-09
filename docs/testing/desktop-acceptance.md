# 跨平台桌面验收

## 实施方案

在 GitHub 托管的 Windows、macOS 虚拟机上启动实际桌面程序，复用同一套文件系统、交互和多窗口用例。Linux 使用 Xvfb 桌面作为回归基线。常规门禁覆盖当前发布架构 macOS ARM64、Windows x64，以及 Linux x64 回归。Intel macOS 是可选的手动兼容性检查，工作流输入 `include_intel=true` 时启用。不在 Linux 容器中模拟 macOS 或 Windows 的系统 WebView。

| Runner                        | 程序与驱动                                                           | 覆盖范围                                                                         |
| ----------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `windows-2025`                | 无测试 feature 的 NSIS 安装程序；另构建独立标识的 `desktop-e2e` 程序 | 普通包安装／响应窗口／测试端口关闭，测试构建的真实 WebView2、Rust 后端和完整交互 |
| `macos-15` / `macos-15-intel` | 独立标识的优化测试 `.app`，显式启用 `desktop-e2e`                    | ARM64 / Intel 的实际 WKWebView、Rust 后端、完整交互                              |
| 同上 macOS runner             | 再构建无测试 feature 的普通 `.app`                                   | 原应用标识、原生窗口启动、测试端口关闭                                           |
| `ubuntu-24.04`                | 优化测试程序、WebKitGTK、Xvfb / Openbox / D-Bus                      | 同协议的 Linux 回归                                                              |

嵌入式驱动使用固定版本 `tauri-plugin-wdio-webdriver = 1.5.1`。Node 客户端直接发送 W3C WebDriver 请求；不加载 IPC 模拟层，文件读写、监听、权限和索引都运行真实实现。Windows 选择并记录实际 WebView2 运行时，两种构建使用同一份前端资源。轮询回退用例观察真实回调中的订阅信息，并通过原有权限接口筛选有效的窗口令牌；不替换命令或响应。

实测 Windows Server 2025 runner 上的普通程序可以渲染和响应，但原生 EdgeDriver 的自动启动与附加连接均无法建立调试连接。因此 Windows 与 macOS 都以隔离测试构建完成交互验收，普通程序另过安装／原生窗口／测试驱动排除检查。避免通过降级 WebView2 来绕过验收差异。

Windows 打包工具通过 GitHub Release API 下载，按官方资产摘要校验 SHA-256，并缓存匹配 Tauri CLI 2.11 的 NSIS 3.11 与配套 DLL。遇到临时打包下载失败时，只重试 `tauri bundle`，复用已编译程序。

实施顺序：先验证驱动连接，再执行 33 项功能用例和性能采样，最后检查普通发布配置的程序。修复失败后，要求三个常规平台和 Linux 已安装升级任务通过再合并。各平台独立排队，可选 Intel 检查只在手动启用时加入。

## 验收内容

原有 25 项用例覆盖初始快照、外部修改与任务索引、原子替换、Unicode 和仅大小写重命名、目录移动删除、回收站与隐藏文件／符号链接策略、自身保存、同路径目录重建、2／5 窗口共享监听、跨窗口令牌所有权、无知识库窗口时的后台任务、单文件授权边界、根目录消失恢复、未保存内容保护、监听丢失后的轮询快照，以及万文件目录的滚动、展开、定位、字体和窗口缩放、短笔记搜索、真实延迟加载的语法高亮。后台任务用例保留一个独立文件窗口维持应用存活；不代表托盘零窗口模式已验收。

新增 8 项覆盖：专注模式与光标、待办 `@` 日期选择、后台刷新保持选区和焦点、紧凑日历角标、正常关闭保存、保存失败取消后重试、全屏关闭保存，以及多窗口退出保存。关闭窗口使用标准 WebDriver `DELETE /window`，经过真实 `CloseRequested`，不再直接调用强制关闭命令。多窗口退出从主窗口接收退出事件开始，不能代替原生菜单／Dock／Cmd+Q 验收。驱动键盘事件也是合成事件，不能代替真实输入法。

用例清单由 `scripts/desktop/case-manifest.json` 管理；缺项、重名或失败都会阻止完整验收通过。配置在导航卸载时写入临时 profile，避免旧页面的异步持久化覆盖测试配置。

性能采样分为：

- `smoke`：100 篇笔记、单窗口，分别运行 `poll` / `native`，用于常规 PR。
- `full`：100 / 1,000 / 10,000 篇笔记 × 1 / 2 / 5 窗口 × `poll` / `native`，共 18 组，每天上海时间 02:30 运行，也可手动执行。

每组记录恢复耗时、首次完整索引落盘时间、各窗口文件树 DOM 行数、进程内存，以及三次真实外部写入到全部编辑器显示的耗时。耗时包含驱动轮询、顺序切换窗口与后台工作，三次样本只报告中位数和最大值，不推断 P95。内存为 RSS／Windows working set；共享页可能重复计算。macOS 归属包含应用进程树和新出现的 WebKit XPC 进程，复用的 XPC 进程可能遗漏。这些数值不能直接与 Linux PSS 比较，也不支持 CPU、能耗改善结论。

`performance-baseline.json` 保存工作流 [42532502117](https://github.com/Yunz93/Mozi/actions/runs/42532502117) 在 `fdd1bd7` 上的三平台实测值。每个平台按架构、监听模式、笔记数和窗口数逐项比较；耗时上限为基线 × 2 + 1,000ms，内存上限为基线 × 1.5 + 128MiB，用于拦截明显回退。缺失测量、无效值、指标类型变化也会失败。可选 Intel 暂无实测基线，只采样，不声称已有性能门禁。更新基线应保留完整成功运行及源码来源，不能只为消除失败而抬高数值。

## Linux 已安装升级

`linux-upgrade` 仅允许 GitHub 托管 Linux runner 的普通用户运行。它构建并安装独立的 `mozi-ci-upgrade` 99.0.1，再通过设置页下载和安装 99.0.2：

- 损坏下载内容时，真实 Tauri 验签拒绝，且没有调用任何提权工具。
- 拒绝 `pkexec`、`zenity`、`kdialog`、`sudo` 四条授权路径时，旧包和进程保留，文档仍可编辑和保存。
- 重试成功时执行真实 `dpkg`，验证两窗口未保存内容落盘、已安装版本变化、新进程重启及文档恢复。

授权代理只加入测试应用的子进程 PATH。允许安装时，先复制到 root 专属目录，校验副本摘要与独立包元数据，再调用绝对路径 `sudo dpkg`。不覆盖正式墨知包。更新源只绑定 `127.0.0.1`，使用临时密钥与独立配置；私钥、安装包和 profile 不进入工件。实际系统授权弹窗仍按真机清单验收。

## 运行与证据

工作流：`.github/workflows/desktop-acceptance.yml`。每个平台上传独立的 `desktop-<runner>` artifact，包含 `results.json`、截图和应用日志；Windows 另含安装／运行时元数据与 `windows-stock.json`，macOS 另含 `macos-stock.json`。

```sh
# 不需要图形桌面的保护测试
node --test scripts/desktop/safety.test.mjs
node scripts/desktop/check-boundary.mjs

# Linux：安装工作流中列出的 GTK/WebKit/Xvfb 依赖后
npm ci
npm run tauri -- build --features desktop-e2e --no-bundle --no-sign \
  --config src-tauri/tauri.desktop-e2e.conf.json
MOZI_DESKTOP_BINARY=src-tauri/target/release/mozi-desktop-e2e \
  sh scripts/desktop/run-linux.sh

# macOS：测试构建的独立标识不覆盖正式应用
npm run tauri -- build --features desktop-e2e --bundles app --no-sign \
  --config src-tauri/tauri.desktop-e2e.conf.json
MOZI_DESKTOP_BINARY='src-tauri/target/release/bundle/macos/Mozi Desktop E2E.app/Contents/MacOS/mozi-desktop-e2e' \
  node scripts/desktop/run.mjs
```

`MOZI_DESKTOP_PERFORMANCE=full` 扩大性能矩阵。`MOZI_DESKTOP_SUITE=bootstrap` 仅诊断驱动连接，不算完成验收。完整结果必须包含 33 项功能用例与 bootstrap，共 34 项，并以 `status: passed` 结束。性能比较另生成 `performance-comparison.json`；Linux 升级证据位于 `linux-installed-upgrade` 工件。

## 合并门禁

`CI gates` 汇总前端、macOS／Windows 应用 Rust、Linux 包／应用 Rust、三平台监听 crate 测试；`Desktop gates` 汇总平台矩阵与 Linux 已安装升级。文档变更可由显式范围判断跳过重任务，汇总检查仍报告。未知范围或差异获取失败时执行完整桌面测试。

main 的远端必需检查应在这份工作流合入并实际报告这两个检查后启用，使用精确名称 `CI gates`、`Desktop gates`，并要求分支保持最新。仅写入 workflow 不等于 GitHub 已强制执行；维护者需验证远端保护规则。常规前端覆盖率显式包含全部 `src/**/*.ts(x)`，保留 lines/statements/functions/branches 原门槛 60/60/55/50，并上传摘要。

待启用的配置在 [required-checks.json](../../.github/required-checks.json)，绑定现有 GitHub Actions App（15368），对管理员同样生效，要求 PR，但不额外要求他人审批。合入后先确认 main 上两个汇总检查成功，再读取现有 protection／rulesets；存在其他规则时应合并配置，不能覆盖。当前没有其他保护规则时执行：

```sh
gh api --method PUT repos/Yunz93/Mozi/branches/main/protection \
  --input .github/required-checks.json
gh api repos/Yunz93/Mozi/branches/main/protection
gh api repos/Yunz93/Mozi/rules/branches/main
```

结果中的源码 SHA、工作区是否修改、程序 SHA256、系统架构、UA、驱动能力和测试范围用于追溯。同一工作流包含测试构建和普通发布配置构建，不能把测试包上的完整交互结果描述为已签名发布包的完整验收。Windows 另记录构建工具对 Cargo manifest 的改写，保留构建来源差异。

## 隔离与发布边界

- `desktop-e2e` 是可选 Rust feature，默认依赖图和发布工作流均不启用。检查脚本验证这一点；普通 Windows 和 macOS 程序再验证测试端口关闭。
- 测试程序使用独立应用标识。重置前必须匹配本工具创建的所有权标记；遇到既有未标记目录或符号链接立即拒绝。普通应用标识的重置只允许临时 GitHub Actions runner。
- Linux 使用临时 XDG 目录；不改写 HOME，不修改代理、证书或账号配置。Windows 安装位置位于 runner 临时目录。
- 只使用合成笔记与禁用模型下载的临时配置；不上传用户资料、数据库、凭据或完整进程参数。`.perf/` 是忽略目录，证据通过 CI artifact 提供。

虚拟机结果之外仍需按[真机发布清单](./physical-release-checklist.md)验证系统通知、全屏空间、真实输入法、多显示器、休眠和原生退出。Windows Server runner 的结果不能替代 Windows 10／11 真机验收。
