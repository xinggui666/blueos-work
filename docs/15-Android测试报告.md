# Stage 5 Android 测试报告

## 本轮可重复验证

- `npm test` **134/134**（包括账号切换缓存隔离 2、Worker 沙箱 4）。
- `npm run typecheck` 通过；`npm run lint` 0 errors（现存 hooks/fast-refresh 等 warnings 16）。
- `npm run build:android-web` 通过；APK 内含约 630 KB JS + 23 KB CSS 的完整编辑器/协议解释器，非远程加载页面。
- `NITRO_PRESET=node-server node scripts/with-app-env.mjs npx vite build` 通过；`node scripts/gen-watch-runtime.mjs --check` 通过。
- `gradle testDebugUnitTest assembleDebug assembleRelease` 通过。JVM **5/5**，Release 正式签名校验通过，证书 SHA-256 `0f885077fb73915c0256b283d90eac28d2e0a08e27d374ba1ae956f615620482`（与先前 release 相同）。正式密钥/密码未进入源码/压缩包/GitHub Secrets。
- Android 内置 UI + 真实 PostgreSQL API（Java 原生桥由 Playwright 替身模拟）：**17/17**；范围见 docs/14，截图 `screenshots/android/{login,editor,conflict}.png` 为浏览器触屏视口，不是 Android 模拟器截图。
- 实际官方工具链 + **bwrap 强制隔离** RPK 端到端：**9/9**，包括成功确认扣分、超时退回、取消、幂等和文件权限。
- Worker fail closed：`none`/未知模式拒绝；探测缺失/权限错误/超时/网络泄露拒绝；用独立子进程证明缺失 bwrap 时在数据库连接/心跳/领取任务前非零退出。真实 bwrap 构建仍可用，无裸跑分支。

一次 RPK 回归最初误复用了 Android E2E 已有管理员的数据库，返回 403（脚本要求空库的第一个账号自动成为管理员），没有当作通过。改成独立全新测试库后 9/9 通过；没有为测试放松产品权限。

## 模拟器尝试：不能宣称通过安装/启动/登录全链路

在 box 安装官方 Android Emulator 与 Android 34 google_apis x86_64 系统镜像，Pixel 6 AVD。环境有 /dev/kvm，但实际启用 KVM 在宿主内核触发 `kernel BUG at arch/x86/kvm/x86.c:689` / `kvm_spurious_fault`，无法启动。之后仅以软件 TCG（`-accel off`）运行，约 14 分钟后 `sys.boot_completed=1`，WebView 113.0.5672.136。

实测：

- **较早的本阶段 Release 构建** `adb install -r` 返回 `Success`；Debug 安装也返回 `Success`。
- `am start` 已发出，观察到进程/MainActivity 和 WebView 创建，**但没有验证登录页成功呈现**。模拟器反复出现 **Process system isn't responding / System UI isn't responding**，system_server watchdog、白屏、ADB 服务不稳定。截图 `screenshots/android/emulator-system-anr.png` 是这次真实模拟器系统 ANR，不是应用成功运行截图。
- 已尝试降低屏幕分辨率、关闭动画、等待启动；不能得出稳定启动/登录、画布、SAF 或更新安装通过的结论。
- 最终签名 APK 又包含后续 UI 更新门禁修正，因此**最终打包文件本身的安装/启动/登录仍标记待验证**，不把前一构建的 install Success 移用为最终 APK 全链路通过。

结论：此 box 可编译/签名/做浏览器 UI 与真实 API 测试，但当前模拟器环境不足以完成可信 Android 运行验收。需要可用 KVM 的 Linux 主机或 Android 实机完成以下项目。

## 待设备验收（不勾选通过）

- [ ] 最终 Release APK 安装/启动/HTTPS 注册登录。
- [ ] 真正 Android WebView 的拖动/缩放/输入法/返回键/横竖屏与复杂画布性能。
- [ ] 系统 SAF 导入 .bproj、导出工程/RPK 与用户取消保存。
- [ ] 飞行模式重启应用后编辑、恢复网络同步与双端冲突。
- [ ] SHA-256 不符拒绝安装；合法新版本 APK 下载/安装确认/签名不符拒绝。
- [ ] Android 7–14+ 多版本 WebView 兼容性、存储配额满时行为。
- [ ] BlueOS 真表安装和独立运行（另属 Stage 6）。

以上限制不影响已经跑过的构建/签名和 API/协议测试，但不能把 Stage 5 代码交付称为真机验收全部完成。
