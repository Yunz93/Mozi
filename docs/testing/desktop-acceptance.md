# 跨平台桌面验收

## 实施方案

在 GitHub 托管的 Windows、macOS 虚拟机上启动实际桌面程序，复用同一套文件系统、交互和多窗口用例。Linux 使用 Xvfb 桌面作为回归基线。此环境缺少 KVM；不在 Linux 容器中模拟 macOS 或 Windows 的系统 WebView。

| Runner                        | 程序与驱动                                                           | 覆盖范围                                                                         |
| ----------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `windows-2025`                | 无测试 feature 的 NSIS 安装程序；另构建独立标识的 `desktop-e2e` 程序 | 普通包安装／响应窗口／测试端口关闭，测试构建的真实 WebView2、Rust 后端和完整交互 |
| `macos-15` / `macos-15-intel` | 独立标识的优化测试 `.app`，显式启用 `desktop-e2e`                    | ARM64 / Intel 的实际 WKWebView、Rust 后端、完整交互                              |
| 同上 macOS runner             | 再构建无测试 feature 的普通 `.app`                                   | 原应用标识、原生窗口启动、测试端口关闭                                           |
| `ubuntu-24.04`                | 优化测试程序、WebKitGTK、Xvfb / Openbox / D-Bus                      | 同协议的 Linux 回归                                                              |

嵌入式驱动使用固定版本 `tauri-plugin-wdio-webdriver = 1.5.1`。Node 客户端直接发送 W3C WebDriver 请求；不加载 IPC 模拟层，文件读写、监听、权限和索引都运行真实实现。Windows 选择并记录实际 WebView2 运行时，两种构建使用同一份前端资源。轮询回退用例观察真实回调中的订阅信息，并通过原有权限接口筛选有效的窗口令牌；不替换命令或响应。

实测 Windows Server 2025 runner 上的普通程序可以渲染和响应，但原生 EdgeDriver 的自动启动与附加连接均无法建立调试连接。因此 Windows 与 macOS 都以隔离测试构建完成交互验收，普通程序另过安装／原生窗口／测试驱动排除检查。避免通过降级 WebView2 来绕过验收差异。

实施顺序：先验证驱动连接，再执行 25 项用例和性能采样，最后检查普通发布配置的程序。修复失败后，要求四个平台的任务通过再合并。

## 验收内容

25 项用例覆盖初始快照、外部修改与任务索引、原子替换、Unicode 和仅大小写重命名、目录移动删除、回收站与隐藏文件／符号链接策略、自身保存、同路径目录重建、2／5 窗口共享监听、跨窗口令牌所有权、无知识库窗口时的后台任务、单文件授权边界、根目录消失恢复、未保存内容保护、监听丢失后的轮询快照，以及万文件目录的滚动、展开、定位、字体和窗口缩放、短笔记搜索、真实延迟加载的语法高亮。后台任务用例保留一个独立文件窗口维持应用存活；不代表托盘零窗口模式已验收。

性能采样分为：

- `smoke`：100 篇笔记、单窗口，分别运行 `poll` / `native`，用于常规 PR。
- `full`：100 / 1,000 / 10,000 篇笔记 × 1 / 2 / 5 窗口 × `poll` / `native`，共 18 组，通过手动工作流执行。

每组记录恢复耗时、首次完整索引落盘时间、各窗口文件树 DOM 行数、进程内存，以及三次真实外部写入到全部编辑器显示的耗时。耗时包含驱动轮询、顺序切换窗口与后台工作，三次样本只报告中位数和最大值，不推断 P95。内存为 RSS／Windows working set；共享页可能重复计算。macOS 归属包含应用进程树和新出现的 WebKit XPC 进程，复用的 XPC 进程可能遗漏。这些数值不能直接与 Linux PSS 比较，也不支持 CPU、能耗改善结论。

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

`MOZI_DESKTOP_PERFORMANCE=full` 扩大性能矩阵。`MOZI_DESKTOP_SUITE=bootstrap` 仅诊断驱动连接，不算完成验收。完整结果必须包含 25 项功能用例与 bootstrap，并以 `status: passed` 结束。

结果中的源码 SHA、工作区是否修改、程序 SHA256、系统架构、UA、驱动能力和测试范围用于追溯。同一工作流包含测试构建和普通发布配置构建，不能把测试包上的完整交互结果描述为已签名发布包的完整验收。Windows 另记录构建工具对 Cargo manifest 的改写，保留构建来源差异。

## 隔离与发布边界

- `desktop-e2e` 是可选 Rust feature，默认依赖图和发布工作流均不启用。检查脚本验证这一点；普通 Windows 和 macOS 程序再验证测试端口关闭。
- 测试程序使用独立应用标识。重置前必须匹配本工具创建的所有权标记；遇到既有未标记目录或符号链接立即拒绝。普通应用标识的重置只允许临时 GitHub Actions runner。
- Linux 使用临时 XDG 目录；不改写 HOME，不修改代理、证书或账号配置。Windows 安装位置位于 runner 临时目录。
- 只使用合成笔记与禁用模型下载的临时配置；不上传用户资料、数据库、凭据或完整进程参数。`.perf/` 是忽略目录，证据通过 CI artifact 提供。

虚拟机结果之外仍需在正式发布流程验证签名、公证、Gatekeeper、更新器，以及在真实设备验证高 DPI、多显示器、输入法、休眠恢复、托盘／通知和 GPU／能耗。Windows Server runner 的结果不能替代 Windows 10／11 真机验收。
