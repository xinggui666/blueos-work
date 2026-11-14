# BlueOS 工坊 V3 阶段2：Android启动恢复与更新安全开发报告

时间：2026-11-14 05:14 PST（America/Los_Angeles）。**已产出原密钥签名1.0.1候选APK；没有安装/启动/登录成功证据，不是阶段2终验完成。** 本报告补充上轮记录，不覆盖旧交付。

## 1. 本轮目标

修复已复现的动态app chunk加载失败后空白；提供独立启动提示、错误/重试/数据保留、版本化桥错误；检查原生更新与身份竞态。恢复原构建栈，先验证原Release证书连续性再编译。禁止危险KVM、替换Release key、上传签名材料或外部部署。V3追踪继续保留未验门槛。

## 2. 当前仓库提交 SHA

- 基线：PR9 `https://github.com/xinggui666/blueos-work/pull/9` 的 `d9b5b5d9dd108b26e1513751bc82391d4a509d40`。
- 分支：`v3/phase-2-android-recovery`；Android实现 `ed81b37bce48ea412e9f52c2105992e0fbc08e13`。
- 独立CI修复提交：`5b861b94741c61b06e83cfd4260d30f39a9129a4`，直接接在d9之后，**父任务可单独将PR9分支快进到此提交**；不必把Android补丁混入PR9。
- 只检查过两次PR9状态：开始pending，后查server test失败、两个debug成功。失败发生2026-11-14约04:46 PST；当前没有任何后续远程绿灯证据。
- 本执行器没有push/建PR/merge。CLI读取正常；外部写入留父任务依据其已核验授权执行，不能把本地修复当远程CI通过。PR9红灯时禁止合并。

## 3. 修改文件清单

|模块|文件/代码依据|
|---|---|
|独立启动层|`android-web/index.html`、`public/boot.js`、`main.tsx`、`vite.android.config.ts`：静态恢复面板、ES5 watchdog、动态import门禁|
|React异常|`android-web/app.tsx:BootBoundary/RouteFailure/BootReady`：route/effect/render错误，sticky fatal状态不被ready覆盖|
|桥RPC|`android-web/bridge.ts:request/readSession/platformCall/NativeError`：会话校验、超时/异常清理、页epoch、版本化错误|
|原生生命周期|`MainActivity.java`：恢复state失败回退、只清资源cache重载、主文档/renderer失败对话框、空WebView回调保护|
|原生身份|`NativeBridge.java`、`SessionGuard.java`及6个JVM用例：token/base原子快照、登录世代、注销/关闭/重载失效|
|更新|`UpdateInstaller.java`、`SigningPolicy.java`及5个JVM用例：唯一临时文件、相同签名集合、finally清理/断连、防同一bridge重入|
|版本与打包|`android/app/build.gradle`：1.0.1/code11；`package-delivery.py`：实际aapt版本及固定原证书门禁；Python5项测试|
|CI|`server-ci.yml`、`run-ci-api-smoke.mjs`、`api-smoke.mjs`、`ci-fixture-safety.test.mjs`：显式运维初始化、隔离本机库、拒绝错误目标|
|回归|`v3-android-boot.mjs`、`v3-native-auth-http.mjs`；旧boot probe改为运行新回归，旧红灯记录保留|

没有修改服务端会员/扣费规则、迁移或第三方OAuth登记，没有生成新Release身份。报告、证据与需求表另作后续文档提交。

## 4. 已完成的功能

### 启动失败不再只剩空白

HTML先呈现可读状态与保留数据重载链接；独立classic `boot.js` 不依赖React或module入口。entry 404/抛错、动态app chunk失败、15秒等待、坏session、React route/effect异常都有稳定 `BW_BOOT_V1_*` 码，显示信息不含原始异常、服务URL参数、工程内容或令牌。即便watchdog与entry一起缺失，静态提示和普通重载链接仍存在。

fatal错误保持可见，避免React父effect的ready把子组件错误盖掉；TIMEOUT不是取消，后续资源真正加载成功仍可进入。structuredClone能力缺失时在导入编辑器前明确阻止并提示升级WebView，不以minSdk24假定旧引擎能运行；这也不是全WebView兼容认证。

### 明确确认的非破坏重试

先提示未保存界面状态可能丢失、原生文件/安装操作可能仍进行。取消不导航。新版bridge重载只调用 `WebView.clearCache(true)` 与新文档加载，**不清DOM storage、SharedPreferences、账号、历史草稿或应用数据**；同时失效未完成登录，避免后来回写。旧bridge回退同origin整页重载并加查询版本，不宣称旧bridge也能清原生资源cache。boot.js/index.html不做immutable缓存；hashed资源仍长期缓存。

A/B持久缓存、旧原文字节在浏览器注入故障/重试中逐项保持；不是Android真实磁盘杀进程恢复证明。只保证代码不主动删除已保存数据，不能保证未落盘状态或系统损坏/清数据情况下零丢失。

### 版本化桥与原生身份保护

桥能力版本 `bridgeVersion=2`；错误封装 `protocolVersion=1`，如 `BW_BRIDGE_V1_CALL/RESPONSE/TIMEOUT/SESSION/AUTH/FILE/UPDATE`，不是混淆两个版本。RPC异常/超时删除等待项；回调有新页面epoch，旧文档或已超时回调不能误配新请求。超时不伪称取消原生后台操作，需先核对状态。

会话损坏不静默变成匿名缓存写入，停止导入编辑器且不清原数据。原生SessionGuard统一保护token/base读取与会话写入；旧登录结果、注销后结果、Activity关闭/重载后结果不能替换新会话。真实Java线程验证10000轮配对读写、100轮注销/提交竞态；NativeBridge接线已编译，但不是SharedPreferences/Activity真机端到端。

### 更新安全与恢复

每次下载独立临时文件，避免共用update.apk覆盖/删错；失败/拒绝/安装提交后finally清理，非200/异常也断开连接。SHA/包名/新版本检查之外，新增与已安装应用**相同签名集合**检查，失败拒绝；不支持自动接受证书轮换。单个bridge实例防并发重复更新；不是跨进程安装状态恢复/断点续传实现。未知来源授权返回后需重新下载校验，文案与清理策略一致。

主文档加载失败与renderer退出有原生保数据重试对话框；renderer已死则销毁并在显式重试时重建Activity，不向空/销毁WebView发回调。restoreState失败/非内置URL回退内置入口。上述Java路径编译通过，未在Android故障注入执行；JavaScript watchdog也不能解决UI线程完全卡死的ANR。

## 5. 修复的问题

|问题|证据/修正|未被证明的部分|
|---|---|---|
|缺失动态chunk→空root|上一批红灯；当前故障注入、取消、修复资源后重试全绿|不是历史APK ANR同一根因证明|
|ready吞掉子组件致命错误|sticky fatal +实际React effect/route故障测试|真实WebView崩溃未注入|
|坏session被默认为退出|严格session校验，进入SESSION恢复而非写匿名数据|私有存储真正损坏/系统恢复未验|
|旧RPC回调误配新页或永久等待|页epoch、超时、异常清理，源桥测试|Java真实慢网/SAF/PackageInstaller未验|
|原生跨服务器token/base撕裂与旧登录回写|生产共用SessionGuard及JVM并发验证|不是Android系统存储原子性认证|
|更新文件共用、证书不预检、异常未断连|唯一temp、签名policy、finally；JVM签名集合5项|完整下载/安装Android路径未验|
|PR9远程CI 19通过/11失败|旧API smoke假设首注册自动超管；显式CLI初始化后新库30/30|远程CI未重新运行/通过，不能合并|
|新APK仍会被旧打包器标1.0.0|实际aapt版本、原证书硬门禁、Python5项|全量含新RPK部署打包未运行|

CI不能通过恢复产品自动提权来“修复”；新公共测试账号先被证实无角色，之后才调用运维CLI。CI目标限制独立localhost blueos_ci库、显式opt-in；4项负例在网络请求前拒绝。

新增ES5语法红绿检查发现项目默认formatter会给classic函数调用加尾逗号，破坏ES5解析；已加仅此文件的formatter override及3项强制npm测试，最终148项包含7项新语法/CI安全用例。原生renderer销毁先脱离View树，异常对话框只能保数据重试或退出，避免dismiss后停在死renderer白屏。

## 6. 数据库迁移

本批**无新迁移/生产数据操作**，继续要求0001–0009。真实PG17.5隔离库用于HTTP回归；CI重现另建 `blueos_ci_android_boot`，从空库跑完迁移。CI服务库名同步改为blueos_ci，明确不是借用业务库。

CI wrapper保存临时认证值仅在进程/子进程环境，不放日志或GitHub Secrets；真实签名材料仍仓库外。回滚本批UI/Java须保留用户存储与原签名；若从code11回退旧code10，Android可能拒绝降级，不能建议卸载清数据，需用相同证书发布更高code的回退修复包。0009会员迁移回滚边界仍按上批报告，不能因为本批没加迁移就删列。

## 7. API 变化

- 业务服务API/action无新增；Better Auth继续使用实际可用 `/api/auth/get-session`，没有臆造替代路径。
- 新HTTP6项真实验证无Origin移动请求、cookie session、401/空会话、跨账号409、跨站cookie注销403、仅撤销指定会话。现有OAuth发起回归6项通过；**真实外部OAuth回调仍未验**。
- Native可选增加 `reloadBundledApp()`；appInfo增加能力版本及可用时WebView版本，旧bridge能力缺失可回退。JS页面仍拿不到原生登录令牌。
- native任务异步错误/超时有版本码；同实例更新繁忙返回409；坏session不再被静默忽略。超时不是服务端/安装系统事务回滚承诺。

## 8. 测试命令与真实结果

|命令|实际结果/环境|
|---|---|
|`npm test`|148/148；Node24.22.1，本机源码单测|
|`npm run typecheck`|最终通过；最初classic JS缺JSDoc类型报错，失败日志保留，未用ts-nocheck绕过|
|`npm run lint`|0错误、19警告（Fast Refresh等含新增边界组件），未写成零告警|
|`npm audit --json`|已知公告0；本批未增依赖|
|`npm run build:android-web`|成功，含独立boot.js；Vite关于classic script的提示为有意保持其不依赖module|
|`node scripts/e2e/v3-android-boot.mjs`|10/10，Chromium+mock桥；含缺chunk/entry、坏session、超时后迟到成功、React错误、旧/新能力重试、源桥超时/晚回调|
|`node scripts/e2e/android-web.mjs`|17/17，Chromium手机视口+mock Java桥+本机真实API，不是APK|
|`API_BASE=<本机> node scripts/e2e/v3-native-auth-http.mjs`|6/6，真实Node HTTP/PG，按Java无Origin请求形状；不是Java Http运行|
|`API_BASE=<本机> node scripts/e2e/v3-auth-upgrade.mjs`|6/6真实HTTP，仅OAuth发起/state拒绝|
|`BLUEOS_ALLOW_TEST_BOOTSTRAP=1 … node scripts/run-ci-api-smoke.mjs`|编译Node服务+全新PG库：先证实无角色、CLI指定初始化、API30/30|
|`node --test scripts/ci-fixture-safety.test.mjs`|4/4，错误DB/远程目标/缺opt-in拒绝且未发网络|
|`gradle -p android testDebugUnitTest assembleDebug assembleRelease --no-daemon`|**JVM16/16 + Debug/Release构建成功**；JDK17.0.21+9、SDK34/build-tools34、Gradle8.9；原外置Release和旧公开Debug签名配置|
|`python3 scripts/test-package-delivery.py`|5/5，含实际版本解析、危险版本字符串、所有keystore拒绝|
|`apksigner verify --print-certs …app-release.apk`|通过，公开证书与旧Release一致|
|`aapt dump badging`及ZIP字节核对|两个APK均code11，版本/包名从实际包读取；APK内每个web资源与最终生成文件逐字节一致|
|`adb devices -l`|无已连接设备；本轮没有启动模拟器或使用KVM|

CI重现用上一批已编译Node产物；本批未改服务端业务源码，**不是本批全新部署包冷启动/生产验收**。各组有重复，不相加伪造独立覆盖率。最初测试harness误引用未安装esbuild，改用已有TypeScript转换源桥，无新增包；失败保留。一次编辑脚本匹配失败后修正并重建/重跑，不把中途产物当最终包。

## 9. APK/RPK/工程包产物及 SHA-256

|新产物|实际元数据|SHA-256|
|---|---|---|
|Release候选|1.0.1/code11，232305字节，包 `icu.liuhua.workshop`|`00dbe4d713ff72fd766c8e546227aefb26524032d4861809662665f2a96e2e16`|
|Debug候选|1.0.1-debug/code11，299391字节，独立.debug包名|`aaca1c785814a64cba935391be63fca44f4c54c30a1c290da2b4d14055aa595e`|

Release公开证书SHA-256：`0f885077fb73915c0256b283d90eac28d2e0a08e27d374ba1ae956f615620482`，与旧1.0.0 APK及现存外置key的signingReport一致；实际签名新包验证通过，**没有替换丢失key的情况**。签名值/密码未输出、未上传。Debug使用上批原字节外置的历史公开调试文件，不放入交付。

源码、报告、证据、两个新APK在新版本目录交付并有SHA清单；旧交付不覆盖。最终DELIVERY.json绑定实现/源码提交、工具来源与开放门槛。**本批没有新编RPK、没有刷新独立部署包，不把旧RPK冒充受本批验证。** 不运行要求全套APK/RPK的旧全量打包器去伪造齐套；仅测试其版本/路径策略。

## 10. 未完成事项

- P0-06仍开放：最终这两个APK未安装/冷启动/登录/编辑/文件/网络/更新运行；源码和JVM不等于Android运行。
- 历史报告明确WebView113，已支持structuredClone，故本次缺能力保护**不能解释之前那次ANR**。历史TCG约14分钟才启动并有system_server/System UI ANR；本次未重跑，不据旧不稳定环境断言客户端无错。之前KVM导致宿主fault，绝不重试。
- 新boot的缺chunk恢复有Chromium红绿证明；原APK白屏/ANR仍缺真实logcat/线程栈/renderer证据，未完成根因定位。
- 原生清cache、renderer销毁/恢复、SAF、下载取消、签名不符安装、未知来源设置返回、杀进程/升级持久化仍需Android设备测试。
- 下载不支持断点续传；跨进程安装session恢复、崩溃遗留cache清理、证书轮换未闭环。单bridge更新busy不等于跨Activity/进程全局幂等。
- 真实OAuth登记/subject历史映射、手表真机、Docker/生产、组件与资源闭环、周期权益、商城/部署仍未验或未完成。

## 11. 风险与阻塞

1. PR9实际远程server CI仍红，不能merge；本地新库30通过只证明修复方案。先由父任务将PR9快进到独立CI提交，再等真实checks。
2. 本分支新Android代码尚无远程CI/PR。本执行器停在外部写入前；父任务可按其可核验授权push新分支/建独立PR，不能伪造现成链接。
3. 已恢复工具链且原正式key可用，消除了上批“工具缺失/签名未验证”阻塞；**设备/ANR门槛没有因此消除**。
4. 没有设备可测，未把TCG/KVM当无条件替代；没有KVM访问或危险宿主重试。若后续安全软件模拟器仍ANR，应记录应用/系统双向证据，不归咎单方。
5. 需要真实更新旧安装包的数据保留演练；不要因覆盖安装失败而建议清数据。旧Debug/Release包身份不同，不能互相覆盖。

## 12. 下一项自动推进任务

先修复PR9远程CI门禁，独立审阅本批Android候选；随后在安全设备/可用非KVM环境收集真实启动与更新证据，仍不得跳过SDK/证书核对。继续V3未阻塞资源二进制闭环/固定组件版本/商城权益任务，按独立逻辑批次测试、报告、PR，不将本批候选称为V3完成。
