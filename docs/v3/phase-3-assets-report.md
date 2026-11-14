# BlueOS工坊 V3阶段3：PNG资源实际字节闭环开发报告（第一有界批）

> America/Los_Angeles（PST），2026-11-14。**这是 PNG 子集候选批，不是 V3 阶段3全部完成，也不是 Android/手表最终验收通过。** 应用依赖 audit=0 不代表官方外置工具链 audit=0；新发现的工具链高危/严重问题仍未关闭，不进行自动合并或生产发布。

## 1. 本轮目标

对应 V3 §7.4、P1-02，先将过去“有资源清单但没有资源字节”的断点补为真实链路：上传 PNG → 账号私有资源 → 工程引用 → bproj包含字节 → 另一账号确认导入 → 固定修订源工程 → bwrap隔离下的官方工具链 → 在VRU索引中定位并校验原始资源SHA-256。组件固定版本 P1-01 另批完成，不用附加元数据冒充实现映射，不引入用户任意JS。

首次检查工作区干净，保留已有 PR9/PR10 及其提交。本批没有改历史交付、历史审计、签名密钥或外部部署。源代码之外的备份、SDK、签名材料均未装入代码包。

## 2. 当前仓库提交 SHA

- 基线：`e19154dcec1ec6f1436a84433f92611e8aa3286e`（Android阶段2报告提交）。
- 分支：`v3/phase-3-binary-assets`。
- 首个实现提交：`e114980`。随后自检发现历史缓存格式升级会多扣一次积分，已增加红绿回归并修复，**以本报告最终来源清单中的代码提交为准，不能只交付首个提交**。
- 最终代码提交：`ca9eb6c402252e7c0ae33598662d2be2f952aac8`。报告/证据提交另列在交付 `交付索引.json`，报告不会假装能提前包含自身提交SHA。
- PR9、PR10本轮只读查询CI均绿色，链接及真实 head/base/check 结果见 `evidence-assets/pr9-readonly.json`、`pr10-readonly.json`。本执行器没有推送/创建/合并PR；需要父代理在既有授权范围内发布本分支。PR10仍需在PR9合并后按正常流程改base并核对差异，不能强推改历史。

## 3. 修改文件清单

核心分组如下，完整精确清单随 `code-files.txt` 保存：

|文件|实际职责|
|---|---|
|`migrations/0010_project_binary_assets.sql`|新资源表、归属、大小/MIME约束、禁止UPDATE的触发器|
|`src/lib/protocol/assets.ts`|PNG头/CRC/尺寸预算、限定格式、本地引用、浏览器有界解压检查|
|`src/lib/platform/assets.server.ts`|严格Base64、SHA、实际PNG解压行校验、账号读取、去重、事务配额|
|`src/lib/protocol/bproj.ts`、`zip.ts`|字节清单、打包/解包、摘要、未来版本/畸形清单/重复路径/解压预算|
|`projects.server.ts`、`logic.server.ts`、`builds.server.ts`|保存归属、原子导入、已付导出权益继承、固定源快照|
|`src/lib/generator/native.ts`、`host-template.ts`|复制原始资源、冻结资源清单、阻止动态网络图片地址流入native image|
|`worker/build-worker.mjs`、`rpk.mjs`、`rpk.d.mts`|源ZIP哈希、源资源核验、官方VRU索引/原始字节核验、ZIP大小/CRC|
|`asset-picker.tsx`、`asset-image.tsx`、`face.tsx`、`editor-view.tsx`、`home-view.tsx`|真实上传/选择/显示/确认导入；账号epoch检查；文件读取前大小限制|
|`src/components/platform/admin*`|新增“工程资源”只读清单，不提供代下载、改写、删除|
|`request-limits.ts`、API route、`functions.ts`、contract/policy|二进制动作预算、API流式限长、共享动作、维护模式只读权限|
|`deploy/nginx.conf.example`|示例16m代理上限与禁止直接公网暴露upstream提醒；不是实际部署|
|`assets.test.ts`、`request-limits.test.ts`、`worker/resource.test.mjs`、`scripts/e2e/v3-assets.mjs`|红绿、安全、数据库并发、浏览器和真实隔离编译用例|

## 4. 已完成的功能

### 4.1 可操作入口与权限

1. 在线登录，在工程里添加/选择 image，属性面板的“图片资源（PNG）”可上传或选择本工程已有PNG。不是只显示文件名的占位框：本轮 Chromium 验证了 `img.naturalWidth` 和真实替换上传。
2. 上传结果生成资源ID、SHA-256、`assets/<完整摘要>.png`路径和字节数；工程引用为`/assets/<摘要>.png`。不采用用户提供的磁盘路径或URL，不下载远程资源。
3. 同账号同SHA复用，不重复占空间；不同账号分别持有、分别计配额。读取使用登录身份，不接受客户端指定owner。B尚未导入之前读取A资源为404。
4. 普通账号资源原始字节配额20MiB；当前会员授权快照中有效整数`storageMb`决定会员配额。不是读取可变套餐即时放大权益。事务锁`profiles`行，避免并发不同资源超额。
5. 单张≤2MiB、像素总数≤1048576、宽高各≤4096，仅支持8位非交错PNG；不支持SVG/APNG、JPEG/WebP、字体、音频或URL。工程资源总字节≤6MiB、协议声明≤64个；ZIP限制与额外清单条目相容。配额按原始字节，不是数据库物理占用。
6. 管理后台“工程资源”使用`jobs.read`权限查看最近100条的账号ID、摘要、大小、MIME、时间。无权限返回403；管理员也没有本批新增的任意代用户取字节入口。

### 4.2 bproj、原生工程和RPK

- bproj清单包含每份PNG的长度和摘要，ZIP包含实际PNG；丢失、篡改、重复/穿越路径、未声明脚本、清单格式/版本错误会明确失败。旧版没有资源的bproj仍能导入；旧版只有资源元数据没有原图的包不能凭空修复，需要重新上传原图，原文件不被修改。
- 有资源的首页导入先给出明确确认，在线服务端原子写入资源与新工程；配额/工程数量失败全部回滚，不留下部分资源。不是先自动归属旧草稿，也不覆盖原工程。
- 原生生成器`native-2.1.0-assets1`复制真实资源到`src/assets/...`，并生成`blueos-assets.json`。任务源ZIP、资源哈希已固定；后续工程修订/上传不会改写已入队源快照。
- Worker读取并复核`source_sha256`和源资源后才调用toolkit。本批实际用bwrap编译debug RPK，通过官方VRU文件索引逐份比较大小和SHA，而不是在压缩包里搜索一段字符串就声称成功。未知VRU布局在资源检查时失败关闭。
- 初始image路径必须已声明，本机内置图标除外；运行时setProp/绑定产生的网络/任意路径也会被native宿主清空。Web预览只向本服务的鉴权动作取已声明摘要，不直接fetch输入URL。

### 4.3 缓存和计费边界

新bproj二进制格式使用版本化缓存，避免返回旧“清单有资源、ZIP没字节”的包。但格式升级不能变成再次收费：同账号、同工程、同内容的历史成功`bproj2:`导出在事务内继承已付权益；另存完整新版产物并写`export.format-upgrade`审计，旧产物保留，余额不变。并发重复新下载仍只占一个幂等任务。历史任务下载链接不被回写成新文件，重新导出才能获得升级版。

资源仅有在线读取和当前界面内存状态，**不承诺重启后离线显示原图**。未实现资源删除/GC，删除工程不会自动回收历史资源；这避免旧修订失效，但误传、未引用资源仍占空间。会员到期/退款降额不会自动删除已有文件；超额时阻止继续新增。

## 5. 修复的问题

|问题/证据|修复与结果|
|---|---|
|`red-native-copy.log`：声明资源却没有字节仍生成成功|现在缺字节失败，真实字节写入源ZIP；相应单元回归通过|
|`red-cloud-image-policy.log`：原有保存允许远程图片字符串作为语义错误落库|资源边界在保存/交付前强制校验；普通逻辑草稿的其他可修复语义问题仍按旧设计处理|
|`red-legacy-entitlement.log`：格式缓存升级造成余额从4变3|新增同内容历史付费权益继承，保留旧文件并审计；红绿回归验证余额仍4|
|旧ZIP重复路径、浏览器解压无实际预算|拒绝重复条目，边界/CRC检查，浏览器/服务端都限制实际解压输出；伪报长度的压缩炸弹失败|
|原JSON请求额度无法运送2MiB图片/含资源bproj|uploadAsset允许3MiB封装；import/preview允许12MiB；普通API动作仍1,000,000字节。API route有界流式读，server function保留动作校验，代理模板上限16m|
|任意image.src可能让native自行取网络地址|静态声明+固定资源白名单+运行时宿主二次限制；未增加任意用户代码执行|

测试开发中还发现并修正了测试夹具Origin缺失、Buffer与Uint8Array比较、浏览器Cookie建立、`--once` Worker退出后被当在线等夹具问题，未把它们伪装成客户端产品缺陷。

## 6. 数据库迁移

迁移：`0010_project_binary_assets.sql`，在全新一次性PostgreSQL库上从0001顺序执行成功，重复迁移命令返回up to date。

表`project_binary_assets`以`(user_id,sha256)`为主键，关联用户，存`bytes/mime/data_base64/created_at`。只有服务端验证成功后插入；UPDATE触发器拒绝改写，内容变化必须是新摘要。Base64为跨数据库驱动稳定的二进制承载，并非加密；当前数据空间估算不含其约1/3编码开销。

保存检查owner资源；导入资源和工程在同一事务；API配额并发用同一账号锁串行检查。不做历史数据破坏性清洗，不补造缺失原图，不更改既有会员/订单快照。

**回滚策略（操作方案，不冒称已做生产演练）：**先暂停写入/导出/构建、停止旧新Worker并备份数据库；回滚应用时保留0010表、原始字节、任务和审计，不drop、不改摘要、不重放扣费。旧程序忽略新表，但旧导出器可能重新产生缺资源的包，因此不能在旧程序上重新开放导出/构建冒充兼容。确认前向恢复后才恢复开关。没有外部冷部署、Nginx/Docker或异地备份恢复的新通过声明。

## 7. API 变化

均为现有平台动作名，不虚构REST路径。鉴权、封禁、账号epoch及维护模式沿用已有入口，客户端不能传owner越权。

|动作|输入/行为|权限和失败|
|---|---|---|
|`uploadAsset`|`mime=image/png`、规范`fileBase64`，可选期望sha256；返回asset/usage|当前账号；不支持格式/损坏400，配额不足413|
|`getAsset`|`sha256`，返回规范asset及fileBase64|仅owner；不存在/他人资源404|
|`assetUsage`|返回bytes/count/limitBytes|当前账号，维护模式允许读|
|`adminProjectAssets`|可选userId筛选，最近100条元数据|`jobs.read`；不返回文件字节|
|`saveProjectDoc`/`syncProject`|补充资源归属/本地引用检查|缺失、他人、网络/任意路径拒绝，不静默取远程文件|
|`previewImport`/`importBundle`|含原始PNG的包，正式导入原子化|结构/摘要/配额检查；不会覆盖已有工程|
|`exportBundle`|保持expectedRevision/expectedContentSha256门禁；完整字节；历史权益升级返回upgraded|同内容成功缓存不重复扣分，历史格式升级不额外扣分|
|`requestBuild`|固定资源字节进入source_zip/source_sha256|后续修订不改变任务；旧expectedRevision为409|

反向代理16m是新二进制流程的部署要求，尚未实际应用到生产。API route流式预算的证明不能替代所有server function、代理、限流、超时及客户端响应预算的系统性安全验收。

## 8. 测试命令与真实结果

环境详见`evidence-assets/environment.json`：本机Linux、Node24.22.1、PostgreSQL17.5，Vite4020与实际编译Nitro Node4021；全为一次性本地账号/库，不是外部生产。正式APK/手表没有加入本批测试。原始日志保留失败与通过，最终通过以后缀production日志和来源清单为准。

|实际命令|结果/边界|
|---|---|
|`npm test`|163/163，含资源、请求预算、ZIP/PNG炸弹、VRU损坏/缺失、worker fail-closed及原有auth/schema/editor逻辑测试|
|`npm run typecheck`|通过|
|`npm run lint`|0错误，19个原有警告；不是无警告|
|`npm audit --json`（应用根目录）|0；依赖锁未盲目force升级|
|`node scripts/migrate.mjs`|隔离库0001..0010成功；重复执行up to date|
|`npm run build:server`|真实生产Node构建通过，随后以`.output/server/index.mjs`启动测试|
|`node --experimental-strip-types scripts/e2e/v3-assets.mjs`（4020）|12组通过：真实HTTP/DB、Chromium、真实bwrap编译；开发中新增历史权益回归前的Vite证据，不当成最终最新全部用例|
|同脚本，`API_BASE=http://localhost:4021`、已配置本地`DATABASE_URL`/toolkit和证据目录|最终13组通过；含>1MB真实图片/包、owner隔离、MIME/摘要/PNG炸弹、并发配额、两种导入回滚、历史已付升级、浏览器真实图片/上传、后续修订不改变源快照、真实bwrap/RPK、重复下载不扣分|
|`API_BASE=http://localhost:4021 node scripts/e2e/v3-native-auth-http.mjs`|6组真实无Origin native形状HTTP通过；不是Java HttpURLConnection或APK运行|
|`BUILD_SANDBOX=none ... node worker/build-worker.mjs --once`|实际非0退出，DB确认没有注册/心跳；没有裸执行fallback|
|`BUILD_SANDBOX=auto`真实Worker|隔离探测返回bwrap，并真实执行本批PNG工程；debug，不是release/手表运行|
|已上传官方SDK恢复的`bot build`与`verifyRpk`|直接可信夹具编译、随后真实隔离流水线编译均成功；VRU索引与PNG SHA吻合|
|外置toolkit目录`npm audit --json`|35个受影响包：12严重、7高、8中、8低；未修复，详见风险节|

截图：`production-editor-resource.png`；冻结任务修订、后续修订和源SHA：`production-snapshot-provenance.json`；实际Worker状态/资源检查：`production-build-result.json`。测试没有使用KVM。Nginx配置示例没有本轮实际Nginx语法或代理运行验证。

## 9. APK/RPK/工程包产物及 SHA-256

本批只更新经过实际验证的源码/报告/测试证据、含PNG源ZIP和debug RPK。详细文件字节数及SHA-256由交付目录`SHA256SUMS`和`交付索引.json`给出，代码提交与产物分开标注。

- 官方RPK资源实际位于`<包名>.vru`的索引中，并非假定ZIP根下有assets。固定源快照里有`blueos-assets.json`和原始PNG，产物检查逐份比对。
- `source ZIP`不是bproj，也不是平台完整源码；平台源码单独打包。RPK不是APK。用户bproj需要保留全部资源字节才能恢复。
- 本批没有新签名APK，未触碰原Release私钥，未生成替换密钥。Android版本仍为前批1.0.1/code11；下一APK批必须提升版本、核验证书再构建，不能把自行同版本重打包当作新正式更新。前批1.0.1 APK保持原件；**本批新增资源UI尚未形成经过安装运行验证的新APK交付**。
- 调试RPK来自官方工具链的debug流程，不是正式上架签名验收。CERT存在检查不是独立的完整密码学签名链验证，不能据此许诺商店/手表一定接受。
- 不分发官方SDK/toolkit包或其node_modules，不夹带数据库凭据、会话、联系人、签名配置或私钥。

## 10. 未完成事项

1. P1-01：组件descriptor/preview/native实现版本不可变映射、依赖图、撤回/SDK不兼容的固定修订验证，尚未完成。
2. P1-02仍是PNG子集：JPEG/WebP、字体/音频未实现；调色板/复杂PNG之外完整图像格式矩阵、设备端显示还需补验。不把“支持拒绝”的格式算作已支持。
3. 资源重启离线缓存、跨账号/服务器的持久化二进制库、孤儿资源显式回收、历史引用保护删除UI、数据库物理空间配额仍缺。
4. Android1.0.1最终启动/登录/编辑/SAF/更新仍没有APK运行通过证据；旧白屏/ANR根因未关闭，不能归咎模拟器后便算完成。Java `Http.read`未设置总响应上限，Base64经WebView大消息的内存/IPC预算仍需实际修复和设备测试。
5. 手表型号/固件、安装、页面、事件、时间、电量/生命周期全未新增验收；Docker/Nginx实际代理、外部生产、灾备、OAuth真实broker没有新增通过。
6. 周期权益、归档、全站限流/CSRF/审计、安全发布条件和商业工具链许可仍遵循追踪表开放项。

## 11. 风险与阻塞

### 11.1 新发现：外置官方工具链audit并非0

`toolkit-audit.json`为实际完整结果，`toolkit-dependency-paths.json`记录安装链路，`toolkit-sink-files.txt`记录触点文件。35是受影响包/元漏洞计数，不是35个不同攻击事件。

|包/真实触点|风险评估与未做的事|
|---|---|
|`image-size`；`@blueos-toolkit/dsl-mvm/lib/loaders/resource-loader.js`、packager resource-plugin|库存在ICNS/JXL/HEIF循环DoS告警。服务端仅接收经头/CRC/像素预算验证的PNG，减少恶意格式可达性，但没有对SDK全部分支完成覆盖证明，不能写“绝对不可达”|
|`jsrsasign`；packager `lib/signature/algorithm/index.js`|签名路径实际使用X509、旧`subjectPublicKeyRSA`及KEYUTIL，不能因在外置目录就忽略。新版本API兼容/签名产物需独立验证；未盲目覆盖到不兼容大版本|
|`ejs`、`request`、`form-data`、`adb-driver`等及SDK debugger/server/analyzer依赖|存在模板注入、SSRF、multipart/命令注入告警；本Worker只调用build，固定模板、无任意JS、bwrap断网/净化环境，未启动预览/adb服务。但这只是当前路径/缓解，不是整个SDK无风险证明|

工具链版本仍是已上传SDK中的`1.9.45-beta.44`，部分源码混淆、部分audit无自动fixAvailable。下一批必须按实际依赖链、兼容候选和编译/签名结果逐项修复或取得可复核不可达/替代方案，不使用`npm audit fix --force`。在未处理完严重/高危门禁前，不将本批合并/发布为生产安全版本。

### 11.2 其他必须明确的边界

- 没有模拟器/真机运行证据；浏览器图片显示和真实RPK编译都不能代替APK/手表运行。
- 服务器存储了Base64原始资源，未加密；需依赖数据库访问、备份/加密、运维隔离。配额不是物理磁盘/备份配额；账号注册/资源上传还要限流/滥用治理。
- 双重本地引用检查限制了图片网络入口，但没有把整个项目的SSRF/CSRF/数据通道安全宣称为已闭环。
- Nginx16m仅示例，不代表代理已部署；上游必须私网/回环，不应绕过代理暴露公网。

## 12. 下一项自动推进任务

1. 先处理本批新发现的外置SDK严重/高危依赖与签名兼容性；固定真实版本/锁文件、逐个候选编译回归，不掩盖audit或只写不可达推测。
2. 推进P1-01安全声明式组件固定版本映射、不可变内容摘要、preview/native一致解析和SDK/依赖失败关闭；不以执行用户JS绕过缺实现。
3. Android单独推进有界响应/大文件通道与白屏/ANR根因，必要时只用有界软件模拟，不使用KVM；新APK必须保留原Release证书连续性并明确安装验证状态。
4. PNG之后按独立测试批增加其他资源格式、离线字节库与保护历史引用的显式清理。每批分别报告；不得将小模块通过当成全部V3完成。
