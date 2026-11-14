# Android 客户端（第十六章）

## 架构决策与 PoC

从 0.1.0 Java 说明壳替换为 **Java 原生宿主 + APK 内置 React 工坊**，不是加载远程网页。PoC 用同一编辑器/协议/解释器构建静态页面，在 Chromium 手机触屏视口操作，验证组件添加、编辑、预览、本机持久化、断网重连冲突合并、文件导入和导出。决定保留这条混合路线：共享约 4,000 行画布/逻辑编辑器和同一个运行时，不再维护第二套语义不完整的 Java 编辑器；原生负责网络、Bearer 令牌、SAF 文件和更新安装。Flutter/Kotlin 原生需要重写协议解释器与复杂逻辑表单，维护成本更高；没有声称做过这两条路线的性能测试。

内置 UI 是完整工坊：工程、多页面、画布、组件库、图层、属性、撤销/重做、逻辑事件/变量/绑定/函数/计时器/检查、预览调试、商城、权益卡密、订单、任务、.bproj、RPK 和版本更新。手机底部页签/抽屉；平板使用共享编辑器双侧栏。触控通过共享 pointer events 实现，真机手势性能仍须验收。

- `android-web/`：启动、Hash 路由、登录、网络状态、设置/更新、原生桥、账号缓存隔离、三个 Android 替代模块。
- `vite.android.config.ts`：将共享 `src/components/studio`、商城/权益/任务、协议编成 APK 的 `assets/www`。不依赖在线字体、TanStack 服务端函数或 Better Auth 浏览器会话。
- `android/app/src/main/java/.../MainActivity.java`：只从 APK 提供 `https://appassets.androidplatform.net/www/`，不是 file://。外链交系统浏览器，禁止 WebView file/content 通用访问，CSP 禁止远程脚本、frame、网络连接；JS 通过受限原生方法调 API。
- `NativeBridge.java`、`Http.java`：原生登录/注册和 `client=android` 平台请求。令牌只在应用私有 SharedPreferences，备份禁用，不返回 JS；不记录密码和令牌。系统已 root 或设备被攻陷不在此保护范围。
- `Session.java`：离线可读取已登录身份；401 回登录页，本机数据保留；退出清令牌并尽力撤销服务端会话。
- `AssetRoutes.java`、`UrlRules.java`、`Hashes.java`、`Js.java`：路径/HTTPS/校验/回调转义。

### 离线与权限

编辑器/解释器/资源代码都随 APK 交付。缓存使用 WebView DOM storage（Zustand localStorage），已缓存的工程可离线打开、编辑和预览；持续编辑自动落盘，网络恢复重挂 CloudSync，按修订合并，双方都修改时保留“本机冲突副本”。账号切换先把上一账号缓存归档，再读新账号缓存，不能把上一人的工程同步进新账号。设置显示当前缓存数量/体积，不提供危险的一键清空。

组件授权来自服务器，离线不新增授权；工程包导出、RPK/源工程任务/下载、积分、订单、兑换均要真实在线 API。第一次离线启动仍可编辑缓存的公开免费组件，付费组件未核对时锁定。不缓存用户密码，也不在本地生成付费 RPK 绕过积分。

### 文件与版本更新

- `.bproj` 导入：SAF `ACTION_OPEN_DOCUMENT` → File chooser → 共享完整性/迁移预览 → 用户确认后导入新工程，不覆盖已有工程。
- 导出/RPK/源工程：先过服务器权限、积分和任务检查，base64 给原生 `ACTION_CREATE_DOCUMENT` 保存。取消不会创建文件；服务器已发出的工程包可能已计额度，内容未变再次下载不重复计分（页面明确说明）。无存储广泛访问权限。
- 更新：stable/beta、versionCode/minVersionCode、普通提示/强制更新，无真实 URL+SHA 时不可下载。原生下载后校验 SHA-256、包名、新版本号，最后交 PackageInstaller 让用户确认；证书匹配由 Android 安装器强制检查。Release 禁 http；Debug 才允许本机 http。没有自动安装/静默更新。

## 构建与签名

版本 `1.0.0` / code `10`，包名 `icu.liuhua.workshop`；Debug 后缀 `.debug`，minSdk 24、target/compile 34。需 Android System WebView 支持现代 JS、Web Crypto、DecompressionStream（推荐当前稳定 WebView；随系统旧 WebView 的最低兼容性仍待设备验证）。

1. 安装 JDK 17、Gradle 8.9、Android SDK API 34/build-tools 34.0.0。Android Studio 打开 `android/`。
2. 根目录 `npm ci && npm run build:android-web` 生成内置页面。`assets/www` 不跟踪；缺失时 Gradle 拒绝打包，避免空壳 APK。
3. 按 `docs/09-签名与打包.md` 在仓库外配置 keystore 和密码，设置 `BLUEOS_KEYSTORE_PROPERTIES`。不得上传到 GitHub Secrets，不得提交正式 key/password。
4. `ANDROID_HOME=... JAVA_HOME=... GRADLE_BIN=... scripts/build-android.sh`（脚本会 npm ci）；或生成页面后 `cd android && gradle testDebugUnitTest assembleDebug assembleRelease`。
5. 产物 `android/app/build/outputs/apk/release/app-release.apk`；没传正式签名时明确是 `app-release-unsigned.apk`，绝不回退 Debug key。`apksigner verify --print-certs` 和 `sha256sum` 验证。

安装：传输 Release APK 到手机，系统允许该来源后安装。首次输入 **自己的 HTTPS 服务地址**、邮箱/密码；可注册。服务需部署完整迁移和真实认证，不要使用 dev-user 模式。模拟器 Debug 可填 `http://10.0.2.2:<服务端口>`。正式包明确拒绝 http，不能为了测试放宽 Release 安全策略。

升级保留同包名/签名和 WebView 缓存；卸载/系统清应用数据会删除本机缓存，先联网同步并导出重要工程。退出登录不删除本机工程。

## 测试方法与证据范围

- `npm test`：协议/解释器/平台等回归，账号缓存隔离 2 测试，Worker fail-closed 4 测试。
- `npm run typecheck && npm run lint`。
- `npm run build:android-web`，`gradle testDebugUnitTest assembleDebug assembleRelease`；JVM 5 测试（URL、资源路径、SHA-256、回调 JSON 转义）。
- `API_BASE=http://127.0.0.1:<端口> E2E_SHOTS=/tmp/shots npm run e2e:android-web`：真实 API + APK 内置资源，**Java bridge 由测试替身模拟**。17 步覆盖登录/云端文档、手机组件/图层/变量/预览、锁定组件、离线编辑重连、禁止离线构建、保留冲突、积分不足拒绝/补分后 .bproj 导出导入、商城/兑换/任务、普通/强制更新、401、账号隔离、360/412/800/横屏布局。需允许注册的全新测试库，第一个账号创建管理员测试卡密/版本。这些测试卡密/版本只在隔离测试库，非产品种子。
- **该测试不是 Android 模拟器测试，也不是手机真机测试**。APK 模拟器实际安装/启动/登录结论及系统阻碍另见 `docs/15-Android测试报告.md`，不把浏览器替身的结果冒充原生层通过。

## 已知限制

- 真机画布性能、复杂手势、不同 WebView/Android 版本、完整系统文件选择/更新安装路径需要实际设备验收。原生更新 SHA 规则有 JVM 测试，完整新 APK 更新安装未实测。
- 本机缓存容量受 WebView localStorage 配额限制，极大工程可能不足；没有把存储失败伪装成云端保存成功。生产要结合项目配额和备份。
- 商城/权益离线显示错误，不拿过期会员或积分当作最新结果；工程本地预览不受网络影响。
- Android 不内置管理后台，管理入口说明去网页；这不是 ch.16 必须的 Android 功能。
- BlueOS 手表安装/运行未测试，不能据此宣称可运营终验全部通过。

## V3阶段2续批（候选）

已提供独立启动恢复、保留数据重载、桥错误码/超时、会话世代、更新签名与唯一临时文件；已构建1.0.1/code11原证书候选。真实APK运行仍未验，详见 `docs/v3/phase-2-android-recovery-report.md`。不得把历史5项JVM/17项Mock记录当新版APK设备成功。
