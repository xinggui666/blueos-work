# BlueOS 工坊 V3.0 开发报告

日期：2026-11-14 PST（America/Los_Angeles）。范围：阶段0基线与阶段1首批P0修复候选。**不是V3正式完成，不是Android/手表终验通过。**

## 1. 本轮目标

依据最新V3全文，先修P0-01..05、08，保持现有Node/PostgreSQL/React/Zustand/混合Android/Worker栈；不删除数据、不触碰生产、不上传签名材料。阶段0已核对干净main、需求、审计与既有134单测基线。阶段1提供实际代码、加法迁移、HTTP/数据库/浏览器/Worker测试，不用计划代替实现。

V3原文1510行，SHA-256 `dbb2745a9687217175de23b184cb092d4f6ffbc4ff2aac0fdb3150a68c8f4192`。完整逐项工作队列见[requirements.md](requirements.md)。原始V2.1 MD已确认与`/workspace/bw-spec/spec.md`哈希一致；旧审计有关二进制原件的文字不应被解读为MD来源缺失。

## 2. 当前仓库提交 SHA

- 开始基线：`09b057de0bf290fb961ba61b8f06c58d491827cc`，main干净。
- 工作分支：`v3/phase-1-p0-safety`。
- 实现提交：`58dd16e2fca5e3a5cd06d9d18ef9bff945edb24e`（本地；应用修复为`0140b230b88c9aaa06186b18884b27912eba4435`，后续提交仅补旧浏览器测试的hydration等待条件）；同值记录在`evidence/code-commit.txt`。该提交绑定实现，不以文档提交反向自引用。
- 证据/报告可单独文档提交；不能把未来提交当作已受测内容。PR、外部推送/合并状态以最终交接说明为准，不伪造链接。本轮没有push/PR/merge；npm audit仍有critical/high未处置，不能称所有检查通过。

## 3. 修改文件清单

|模块|文件/符号|责任|
|---|---|---|
|工作空间|`src/lib/platform/workspace.ts`、`workspace.test.ts`|origin+userId持久化键、epoch失效、删除标记|
|编辑器状态|`src/lib/blueos/store.ts:setStudioIdentity`|在显示前切换身份，清空旧内存/撤销栈，只装载匹配缓存|
|云同步|`src/lib/platform/client.ts:CloudSync/call/useMe`|陈旧响应丢弃、expectedUserId、请求循环存活检查、串行flush、重连/删除恢复、资料隔离|
|交付门禁|`delivery.ts`、`delivery.server.ts`、`delivery.test.ts`|同步回执检查、固定revision及可选内容摘要|
|交付入口|`src/components/studio/{editor-view,build-panel}.tsx`|两处bproj/RPK交付先经过门禁|
|服务业务|`logic.server.ts`、`builds.server.ts`、`errors.ts`|权益快照、退款撤销、首管、版本、428/409交付验证|
|迁移|`migrations/0008_v3_entitlement_safety.sql`|撤销列、有效权益视图、快照补齐/不可变触发器|
|安全初始化|`scripts/bootstrap-admin.mjs`、`.env.example`、`docs/06-如何运行.md`|明确选定账号的运维CLI，禁首个陌生注册自动超管|
|Android混合层|`android-web/{app,main,storage}.tsx/ts`|使用共享身份空间，不再启动旧user-only迁移；同版本强更保护和退出更新门禁恢复入口|
|Worker|`worker/build-worker.mjs`|共享会员区间/快照并发限制，独立15秒心跳|
|回归脚本|`scripts/api-smoke.mjs`、`scripts/e2e/build-rpk.mjs`|显式提交revision，兼容新交付协议|
|新增测试|`scripts/e2e/v3-{p0-api,workspace,migration,heartbeat}.mjs`|真实HTTP、PG、Playwright、70秒实际Worker故障夹具|
|追溯|`docs/v3/`|完整需求队列、报告、测试记录，不包含秘密|

精确差异以实现提交`git show --stat`为准；未修改依赖版本、未重写体系。

## 4. 已完成的功能

### 4.1 身份隔离与离线删除

持久键为`bw-workspace-v3:<encode(origin)>:<encode(userId)>:<原键>`，Web用当前origin，Android取Native session base的origin。相同用户ID在不同服务地址仍分开；注销或切换时先停写、清旧projects/past/future再装新缓存。`call`自动附expectedUserId，结果返回后确认epoch仍有效；CloudSync每段await后再次检查作用域。服务端在ensureActor和业务写入前拒绝A身份标记+B会话请求。

同步flush串行化、重连重新合并，离线删除先落本机标记；启动先完成远端删除再合并，避免单客户端删后重启复活。删除失败保留标记等待重试。此处不是通用服务端跨客户端删除墓碑协议；另一个设备并发保存/删除的所有竞态未宣称解决。

旧无归属`blueos-studio-v1`和旧user-only缓存保留原字节，但**不自动认领**。这避免B看见A，却意味着旧未上云草稿不会自动出现在新空间。受控导出/认领迁移UI仍待做，运营上线前必须提供备份/恢复指引，不能当作旧数据已无损迁移完成。损坏JSON进入错误状态，保留原始字节，不静默用空工程覆盖。

### 4.2 固定交付版本

两处UI调用`prepareDelivery`，仅接受`syncProject`的`ok:true`和正整数revision；冲突或坏回执直接报错，禁止继续计费导出/构建。服务端`exportBundle/requestBuild`检查用户拥有的实际已加载文档快照与expectedRevision，校验发生在扣费、任务创建和不可用任务记录前。后续构建用该已加载文档，不因云端后来更新而改构建输入。可选expectedContentSha256不一致也拒绝。

不能据此宣称全编辑UI在后台已并发替换内容时都完成用户意图确认；本轮证明是回执门禁与固定服务端快照。真实负向UI点击409用例应补齐。

### 4.3 会员、订单和退款

有效区间统一为`starts_at <= now() AND now() < ends_at AND revoked_at IS NULL`。视图选择当前段，而不是把未来续费段提前当会员。发放在事务内锁定profiles同一用户，续接所有未撤销未来段尾，避免并发续费重叠。工程上限、构建并发、优先级来自会员快照，不读后续可编辑的plan实时值。订单确认从订单已下单snapshot重建授予；计划后改不改变已下单权益。订单/会员快照有DB不可变触发器。

退款显式revoked_at，未来段即使有保留的starts_at也永不转为有效；仍按原始发放流水撤销余额，余额不足按既有规则记录差额。本批没有实现每日/月度额度自动刷新、时区/结转闭环，不把snapshot里保存字段当作这些业务已生效。**现有giveMembership仍在购买/发放时立即授予generation/export额度，build额度将build_quota+monthly_build+bonus_build一次性相加，即使会员段排在未来；本批时间门禁修复针对会员身份/组件/工程上限/并发/优先级，不声称把所有配额延迟到未来段起点。monthly_build目前不是每月自动发放。是否需延后一次性额度及周期规则需在P1-03闭环并明确运营文案。**

### 4.4 首管、更新、Worker

首个公共注册不再自动超管；单独指定邮箱也不能提升（当前邮箱未验证，防抢同名邮箱）。推荐网络受限初始化：先建立指定账号，由运维CLI明确user ID+邮箱，事务与咨询锁唯一初始化并记录审计，拒绝不匹配、已封禁、其他超管已存在。可选运行时bootstrap必须同时固定BOOTSTRAP_ADMIN_USER_ID和BOOTSTRAP_ADMIN_EMAIL；不影响已合法存在的管理员角色。

服务端仅当latest>current且最低版本不高于latest时返回force；后台拒绝不一致最低/最新版本。Android更新遮罩也要求确有更新，并提供明确返回现有工坊的恢复入口（它是客户端可退出门禁，不是不可绕过的服务器安全封锁）。原生APK SHA/签名/下载/取消仍需阶段2真实验证。

Worker保留启动前沙箱探测/失败拒绝，不提供自动none回退；并发调度读共享有效权益视图；编译等待期间独立15秒心跳防60秒“离线”误判。沙箱namespace缺失的生产部署应修宿主权限/容器配置，不得关闭隔离来“跑通”。

## 5. 修复的问题

|问题|复现/验证|限制|
|---|---|---|
|A/B本地草稿串用及旧异步上传|真实浏览器A离线→B会话→重开A；真实API expectedUserId拒绝|origin用同浏览器两个人工server origin验证键，不是两台真实服务/Android切换实测|
|冲突后仍交付旧/错误工程|单测/浏览器门禁夹具；真实HTTP旧revision409且余额/任务未变|浏览器门禁是可控冲突回执，不冒称真实UI409点击|
|同版本force死锁|真实API current等于/高于latest均不force，低于才force|最终APK更新路径未验|
|未来会员/退款|真实PG+API及精确时刻边界、并发续费/确认|非生产，周期发放另案|
|改plan反向改旧权益|真实下单后改plan再确认、改plan后读有效限制、直接改snapshot被DB拒绝|历史缺失字段只能迁移时冻结近似值|
|首管抢注|首陌生人普通、未验证指定邮箱也普通、CLI选定和并发唯一|运行时双固定配置的专门新进程竞态仍可补测|
|长编译Worker误离线|真实Worker/PG/bwrap运行70秒故障编译器夹具，65秒时心跳新鲜且任务running|夹具不是BlueOS编译器，不冒称这条测试产出RPK|

旧代码红灯子集记录为2通过/13失败；它与最终17项不完全相同，含新视图缺失、依赖性级联，**不能说独立重现13个根缺陷**。该早期原始日志在运行时重启后丢失，只保留已观察结果说明；恢复后测试日志单列归档。

## 6. 数据库迁移

`0008`是加法迁移：增加revoked_at，补缺snapshot字段，建有效权益视图，建两类快照不可变触发器。不删除业务行，历史已知字段优先保留。旧snapshot缺失字段无法推回当年plan状态；只能按迁移时plan补齐一次，须在部署前核对受影响会员/订单并留业务确认记录。不是对历史权益准确性的虚假保证。

部署顺序：

1. 限制写入，停止旧Web/API与Worker，备份数据库及必要文件；密钥独立安全备份。
2. 在还原的预生产库运行`DATABASE_URL=<安全注入> npm run db:migrate`，检查保留旧字段/行数以及已退款历史段；本轮不提供真实连接串。
3. 迁移成功后一起发布支持显式revision的新Web/API/Worker；不能新Worker配老schema。
4. 按上节operator步骤初始化指定首管，核对合法已有角色，启动Web与bwrap Worker，跑本报告回归。
5. 验证后恢复写入；实际生产地址/权限/设备未提供，不进行外部部署。

回滚策略：优先前滚修复；**禁止只撤销revoked_at或触发器、把老代码直接挂回新写入库**，会重新引入退款和快照错误。若需完整旧版本恢复，先停写/保存新增交易，使用经批准的整库备份和对应旧应用恢复，核对RPO及人工补偿后才能开放。没有执行生产恢复或破坏性down迁移；回滚演练待部署阶段。

## 7. API 变化

这些是现有平台分发接口的action，不是新造REST路径。

|action/字段|新行为|兼容注意|
|---|---|---|
|所有action可带`expectedUserId`|与已鉴权用户不一致409，先于资料/业务写入|共享call自动附加；可选字段并不替代认证/资源所有权|
|`exportBundle/requestBuild.expectedRevision`|必须为已确认正整数；缺少428，不符409|旧客户端调用需同步升级，不能再省略默认为最新|
|`expectedContentSha256`|如提供则要求和已加载快照一致|当前sync回执未始终给摘要，revision仍是必需门禁|
|`checkAppUpdate`|同/更高版本不force，无自锁|不是APK安装成功的证据|
|`adminSaveRelease`|最低版本>最新版本等非法配置400|后台仍需正确URL、签名、SHA和真实包核验|
|订单确认/退款|保持action名，授予按订单快照、撤销按原grant|不重新定义在线支付或自动退款到账能力|

## 8. 测试命令与真实结果

早期观察：基线`npm test`134/134；修复后137/137；真实API17/17；原API smoke30/30；浏览器工作空间7/7；原Web逻辑8/8；数据库升级/区间3项；真实官方工具链9/9；70秒Worker夹具3项；Android-Web与Node服务端bundle成功。

**证据异常必须披露：**本轮box发生意外运行时重启/检查点恢复，所有原`/tmp/blueos-v3-*`、临时PG、运行进程、node_modules，以及刚生成但未保存至检查点的报告/交付副本消失；部分工作区回到之前状态。原因未确定。不能把先前观察冒称为当前可下载原始证据。已保留代码并用锁文件重新安装、创建独立PG复验；恢复后已经重新通过：单测137/137、类型检查、lint 0错误15警告、HTTP安全17/17、旧API30/30、工作空间浏览器7/7、旧逻辑浏览器8/8、带数据0007→0008迁移及精确时刻3项、70秒Worker夹具3/3、auth模式一致、Android-Web和Node bundle。实际日志/失败均见`evidence/README.md`及清单。没有从真实凭据文件取密码来恢复旧库。

|类别|实际命令（只限隔离测试）|早期结果及边界|
|---|---|---|
|单测|`npm test`|137/137，包含原Worker fail-closed负测；非Android设备|
|类型/风格|`npm run typecheck`；`npm run lint`|类型通过，lint最后0错误15警告；不是零警告|
|HTTP/DB|`API_BASE=<本机测试端口> DATABASE_URL=<blueos_v3_测试库> node scripts/e2e/v3-p0-api.mjs`|17/17；并发订单/续费/快照/退款/版本/交付|
|旧API回归|`API_BASE=<测试服务> node scripts/api-smoke.mjs`（按脚本fixture变量配置）|30/30|
|浏览器|`E2E_BASE=<稳定测试Vite> node scripts/e2e/v3-workspace.mjs`|7/7；必须先完成源码修改并重启测试dev服务器，避免HMR重复模块|
|浏览器旧逻辑|`E2E_BASE=<测试服务> node scripts/e2e/web-logic.mjs`|8/8；曾并行首跑登录等待20秒超时，串行重跑通过，原始失败原因未完全确诊|
|DB升级/时刻|`DATABASE_URL=<已有旧schema隔离库> node scripts/e2e/v3-migration.mjs`|3项通过，旧字段/行数保留、重复迁移、精确边界；不能用空库代替带数据升级|
|Worker长任务|`API_BASE=<测试服务> DATABASE_URL=<测试库> node scripts/e2e/v3-heartbeat.mjs`|3/3；70秒故障编译器，实际PG+bwrap|
|真实RPK|`BLUEOS_TOOLKIT_DIR=/workspace/bw-toolkit/installed ... node scripts/e2e/build-rpk.mjs`|9/9；真正release RPK，非ZIP改后缀；省略号表示安全注入测试/签名配置而不是可直接复制的完整命令|
|Android-Web|`npm run build:android-web`|成功；只是WebView内嵌资源，不是Gradle/APK/设备验证|
|Node bundle|`NITRO_PRESET=node-server node scripts/with-app-env.mjs npx --no-install vite build`|成功；故意不用自动迁移的build脚本影响未知库|
|认证模式|`VITE_AUTH_ENABLED=true npm run check:auth -- --dev-url <测试dev地址>`|曾误用默认8080无法观测；恢复后明确4016端口通过（sign-in on），两者区分|
|Android模拟器/真机|未执行本批实包验收|既有白屏/ANR未解决，不归咎模拟器本身；不重试KVM宿主故障|
|BlueOS手表|未执行|没有安装/固件/截图/离线运行证据|
|Docker/生产/异地恢复|未执行|保持阻塞/未验证，不发布生产就绪声明|

恢复后首次浏览器7项功能断言虽通过，但捕获到初始模块尚未下载完成就断网引起的动态import异常，整体仍判失败，日志保留为`recovery-browser-initial-chunk-failure.log`。测试补上初始`networkidle`前置条件后7项与pageerror为空均通过，不忽略异常。缺失Playwright浏览器的首次启动失败也保留，安装对应依赖后重试。

旧API smoke曾与长Worker测试并行，因后者将全局build_enabled打开且有在线Worker，原本假设构建关闭的2项失败（28通过/2失败）；不是记作全通过。等待Worker完整退出后串行复测30/30。该次长测试因Worker又领取了并行smoke任务，耗时约141秒；后续禁止此类共享全局配置夹具并行。旧逻辑测试首次SSR登录表单可见但handler未hydrated，导航到`/login?`等待超时；保留失败日志，明确初始networkidle前提后8/8。未修复所有用户可能遇到的极早点击SSR表单体验，不隐瞒测试预置条件。

浏览器曾因测试期间源文件变化引发Vite的带`t=`/不带query两套store模块并存，出现错误的空状态/恢复断言失败。实际Storage写栈确认模块URL不一致；在干净稳定4014 dev进程、源码不再变化的7项重测通过。测试新增“草稿必须已实际写入localStorage”的断言，避免只验证内存。不把该工具链重载失败说成已经独立定位的生产缺陷，也不隐藏失败。

## 9. APK/RPK/工程包产物及 SHA-256

早期真实工具链样例：`com.example.counter.release.1.0.rpk`，59,824字节；SHA-256 `093fb8f60738d6dd9d8c779c9156ef0f2a06aed401829ead0031a0507ac38dcb`。构建/内容检查/下载摘要一致曾通过，**无手表安装运行证据**。早期从测试DB提取到交付目录的副本和DB在环境恢复后消失，因此该哈希仅描述已观察历史构建，若没有实际文件不得列作本批可下载产物。恢复后如重建则使用新真实哈希记录，不假设签名构建字节可复现。

本批没有新Gradle/APK发布包；旧1.0.0不包含本批全部修复，不重新标为V3。源码快照和报告如生成，见版本化目录`/workspace/deliverables/v3-phase1/`及SHA256SUMS，不能称最终全量成品。签名私钥始终不放仓库/源码包/证据。

## 10. 未完成事项

- P0-06：最终明确SHA APK安装、冷启动、登录、编辑、保存/重启、账号切换、离线、SAF、下载、更新与取消、返回键和内存稳定性。
- P0-07：目标BlueOS手表安装、组件/布局/事件/变量/函数/时间、离线独立运行。
- P0-03：客户端实包恢复路径、原生SHA/签名不匹配拒绝、下载失败和安装取消需要真实验证，当前只能部分关闭。
- P0-01/02补验：旧缓存受控恢复、Android origin切换/进程恢复、真实UI冲突点击、全链路两客户端删除/保存竞争。
- P1：资源及组件固定版本执行闭环、周期权益发放、Native refresh/逐会话吊销、存储配额、Docker、多Worker调度/崩溃、审计限流、商业许可和平台签名安装条件，均不得仅据历史概括关闭。
- 部署、整库恢复回滚演练、外部生产和异地灾备未执行。完整P1/P2及954条原文索引见requirements。

## 11. 风险与阻塞

1. 本批是安全和数据正确性候选，阶段1不能以共享代码/静态构建宣称Android全量完成。
2. 不兼容旧无revision交付调用，需协调前后端一起发布，否则428是预期安全拒绝。
3. 历史缺失快照无法还原原始商品承诺；上线前需业务核对，不可只靠迁移默认值掩盖。
4. 旧草稿不自动认领保护隔离，但有用户误以为数据丢失的风险；提供明确旧数据保留与受控恢复。
5. 强更恢复入口允许继续当前客户端，是可恢复性选择，不适合作为强制安全访问隔离机制。
6. 设备、固件、生产环境和工具链商业许可须真实依据；不编造已获许可/已注册签名平台。不上传签名秘密来换取测试。
7. 意外box恢复导致原始证据缺口，必须重新测试/归档；不能把丢失日志伪造成保留文件。未定位重启根因，也不把所有白屏归咎环境。
8. 重新npm ci观察到依赖审计12项（critical 1、high 1、moderate 8、low 2）：better-auth存在critical依赖公告，zod存在high集合校验内存耗尽公告。见`evidence/recovery-dependency-audit.json`。这不是本配置已可被利用的确认，也绝不能在修复/评估前声称安全通过；另起有界安全升级批次，不能未经回归直接npm audit fix --force。
9. 发现基线已经跟踪`android/debug.keystore`，Gradle注明它是公开调试证书，不是Release私钥。本轮没有读取其内容/重新上传；版本化源码快照明确排除此文件。debugInstall仍硬编码仓库内路径，外置化及构建说明需阶段2整改，不能称所有签名材料已经外置。
10. 本轮没有外部部署。外部PR/合并需要沿用明确授权，由主任务核对执行；不伪造已发布。

## 12. 下一项自动推进任务

先完成本批恢复后的本地回归并固定实现提交/证据，针对依赖审计critical/high公告另起受测安全升级批次、核查本配置可达性（不能宣称已可被利用或可忽略），交由主任务创建同一有界PR（若其持有明确发布授权）。随后推进阶段2：不使用已知致宿主故障KVM的前提下检查最终APK资源/WebView/Bridge与会话错误，复现白屏并收集真实设备日志；无可用设备时继续可以独立完成的P1-01/02组件版本和资源链路，设备验收仍保持阻塞，不暂停所有其他工作，也不说V3已完成。
