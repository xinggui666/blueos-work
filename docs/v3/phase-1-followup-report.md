# BlueOS 工坊 V3.0 阶段1续批开发报告

报告时间：2026-11-14 04:42 PST（America/Los_Angeles）。**本批是已本地测试的安全/业务修复候选，不是V3完成、APK启动成功或生产可上线声明。** 新报告补充而不改写上一批历史记录。原V2.1 MD已核实存在且与 `/workspace/bw-spec/spec.md` 哈希一致；V3原文1510行及需求追踪仍为本轮依据。

## 1. 本轮目标

优先处理真实依赖审计、未来会员一次性额度提前入账、公开Debug签名外置及无归属旧草稿显式恢复；回归身份、schema、编辑器、Native桥替身、首管/Worker安全门禁。沿用既有架构和数据，不外部部署、不上传任何签名材料、不生成替代正式密钥、不重写历史。后续Android白屏调查已开始，但最终APK验收门槛仍开放。

## 2. 当前仓库提交 SHA

- 上一批保存点：`710ee584d8b2be7991bec355ca5a9aad0a4c4911`。
- 本批实现提交：`c7a1155c06b9d67fc316649cd4a314a797d64880`；分支 `v3/phase-1-p0-safety`。`evidence-next/code-commit.txt` 绑定这一实现版本；报告/原始证据另作文档提交，避免SHA自引用。
- 工作前检查过git状态和现存进程，保留所有已有修改。RED服务器运行上一版编译产物，GREEN运行本批源码，两者在所有回归结束后仅停止自有进程树；保留PG与测试数据。
- `gh auth status` 已核实HTTPS登录有效；没有读取认证配置/凭据文件。**本执行器未push、未建PR、未merge，故不存在可交付的真实PR链接。** 外部发布交由父任务根据其可核验的具体用户授权执行，不能把CLI登录成功当发布授权或CI通过。PR建议文本见 `PR-phase1-proposal.md`；也不通过连接器绕过本地工作流。

## 3. 修改文件清单

|模块|文件与职责|
|---|---|
|依赖|`package.json`、`package-lock.json`：明确升级版本、定向override，无强制自动修复|
|认证适配|`src/lib/auth/{client,popup.server,server,preview,providers}.ts`：Better Auth 1.7 social API/回调迁移、不可变subject|
|一次性额度|`migrations/0009_membership_credit_activation.sql`、`logic.server.ts:giveMembership/dispatch/退款`、`worker/build-worker.mjs`、`scripts/activate-membership-credits.mjs`|
|旧草稿恢复|`legacy-recovery.ts`、其4个单测、`legacy-draft-recovery.tsx`、`home-view.tsx`：两次确认、仅无归属、新副本|
|计费文案|`src/components/platform/admin/commerce.tsx`：月度字段明确预留、未自动发放|
|签名|移除当前跟踪的 `android/debug.keystore`；`android/app/build.gradle` 接受仓库外旧Debug文件或AGP标准Debug配置；Release不回退|
|打包策略|`scripts/package-delivery.py`、`test-package-delivery.py`：所有keystore均拒绝，包括历史公开Debug；补入首管/激活运维脚本|
|测试|`dependency-safety.test.mjs`、`e2e/v3-{activation,activation-migration,auth-upgrade,recovery-ui}.mjs`、更新 `android-web.mjs`、新增 `android-boot-failure-probe.mjs`|
|文档与证据|`docs/06`、`09`、`17`，本报告、需求追踪、完整审计/失败与成功原始日志；`.gitignore` 仅增加证据日志允许项|

没有上传keys、改生产数据、移除历史交付或改变正式签名身份。精确文件表由实现提交的 `git show --stat` 审计。

## 4. 已完成的功能

### 4.1 依赖漏洞闭环与认证兼容

原始 `npm audit` 为**12个受影响包条目**，包含传播项，并非12个独立漏洞：critical 1、high 1、moderate 8、low 2。原始JSON完整保留，最终根目录和deploy目录各自审计均为0。

|原受影响安装路径/传播|明确处理|
|---|---|
|`node_modules/better-auth`（critical汇总）及 `@better-auth/{drizzle,kysely}-adapter` low传播|better-auth 1.6.33 → **1.7.23**，锁文件同步|
|`node_modules/zod`（high）|4.6.5 → **4.6.6**|
|`node_modules/seroval`（moderate，服务端序列化依赖）|锁定解析至 **1.8.1**|
|`node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch`（moderate）及eslint/parser/utils/type-utils传播|typescript-eslint明确升 **8.72.2**；仅estree子树override minimatch **11.0.1**，不全局覆盖、不接受audit建议的无关降级|

现有nf3定向override保留。estree实际只调用 `minimatch(path, pattern, {dot:true})`；兼容测试及完整lint/type/unit通过。完整当前依赖来源见 `dependency-paths-after.json`，各旧包节点见 `audit-before.json`。

认证1.7迁移是安全升级所需，不是无关重写：浏览器 `.signIn.oauth2` 改 `.signIn.social`，服务端 `signInWithOAuth2` 改 `signInSocial`。genericOAuth仍保留；broker UserInfo必须有稳定 `sub`，不以可变邮箱/显示名替代。**回调由 `/api/auth/oauth2/callback/<provider>` 改为 `/api/auth/callback/<provider>`**。本地测试仅验证授权发起、S256、新路径与伪造state拒绝，没有完成真实broker跳转/回调；生产上线前必须核对provider登记与历史accountId/sub一致性，防新旧身份分裂。没有替用户修改平台登记。

可达性说明：本配置没有Magic Link、OAuthProxy、DeviceAuthorization插件，故相关公告不能直接解释成项目已被证实可利用；genericOAuth存在，不能因此忽略整个认证包。seroval处于服务端依赖链，但未证明项目有可控恶意输入到公告sink。minimatch属于开发lint路径，不是已确认公网接口ReDoS。全部仍升级到审计安全版本。**audit=0只代表当前锁文件与当时公告数据库无已知命中，不是安全认证。**

参考：官方1.7升级指南 `https://better-auth.com/docs/guides/1-7-upgrade-guide`；安全公告 `https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm`。公告全文/受影响范围以审计JSON关联为准，不把一个公告覆盖所有传播项。

### 4.2 会员一次性额度按时间生效

新增DB状态 `pending/applied/revoked` 和共用函数 `activate_membership_credits(userId或null)`：

1. 新授予先锁用户profile，按未撤销段尾排队，保存不可变snapshot并标pending。
2. `starts_at <= 数据库now()` 才可激活；活跃会员仍按 `[starts_at, ends_at)` 与 `revoked_at IS NULL` 判断。首段用DB时钟，避免JS与事务时间细微差异。
3. 额度仅为snapshot中的generation、export、**build + bonusBuild**。**monthlyBuild/dailyBuild不参与一次性发放，周期刷新仍未实现。** 后改套餐不影响待发/已发快照。
4. 行锁+同一事务保证并发幂等；每种额度有 `activation:<membershipId>:<kind>` 唯一流水ID。余额、grant流水和applied状态要么全成功，要么全回滚。
5. API在业务/扣费前懒激活；Worker每轮与运维CLI调用同一函数。函数每次最多500段；调度器并未自动安装。用户完全离线且没有Worker/调度器时不会神奇后台精确到账。
6. 一次性余额本轮明确采用**不随会员结束清零**：停机后补发已到起点且未撤销的段，即便段已经结束。会员身份不会因此恢复。
7. 退款将未激活段标revoked；退款/激活并发只能产生撤销先行或先发后按原流水扣回，不能退款后再补发。余额不足仍沿用既有差额记录，未实现自动追债。退款不会自动前移后续段起点，可能有会员空档；时间轴产品规则仍须另行完善。
8. 0009之前已提前发过的未来段保守标applied：**不自动重发、不静默追回**，需要运营对账；不能说历史提前入账已被本迁移追溯清零。

### 4.3 旧草稿受控恢复

用户在已加载工作空间的首页点“恢复旧版草稿”：第一次确认本人归属后才读旧原文；规范化并按 `ProjectDocSchema` 校验后，第二次列出名称/数量/当前账号与服务器，明确说明新副本会被云同步上传。取消任一步均不导入。

- 仅处理没有 `bw-owner` 归属标记的原 `blueos-studio-v1`，不是自动迁移所有历史缓存。
- 有owner立即拒绝，**先于读取草稿内容**；不能作为B账号认领A草稿入口，即便当前ID与旧标记恰好相同也不据此推断origin归属。
- 最多100工程、原字符串最多1000万字符；不是严格“10MB文件”承诺。全部校验成功后才批量提交；原数据不修改、不删除。
- 新project ID、revision 0、无旧revision链，名字加恢复标识；提交前再次检查workspace epoch。重复恢复明确产生新副本而非自动去重。
- 规范化后schema通过不等于所有未知旧字段/二进制资源均完全无损。旧user-only已归属缓存不走此入口，仍需原身份及人工备份流程。

### 4.4 Debug签名与打包

历史Debug为公开调试文件，不称为正式密钥泄露事件。原字节已保存在仓库外 `/workspace/blueos-local-signing/legacy-public-debug.keystore`；本提交移除当前跟踪文件，保留Git历史与旧交付。今后打包策略不再特许它，且拒绝大小写变体及常见签名容器后缀。

默认AGP使用仓库外标准Debug文件；要升级旧Debug必须显式设置 `BLUEOS_DEBUG_KEYSTORE_FILE` 到已保留的旧文件，否则默认新调试证书不能保证覆盖旧签名。显式路径缺失/位于仓库内则配置阶段失败，不能默默换签名。当前环境未执行Gradle，故此分支仅代码核查，不能写“Debug构建通过”。Release配置没换key，没使用Debug回退。

## 5. 修复的问题

|缺陷/发现|先复现/失败|修正后的证据|
|---|---|---|
|monthlyBuild误作一次性积分，未来段立即双倍入账|旧编译逻辑RED 0通过/2预期失败；build实际15而正确6，第二段提前增加余额|真实PG+HTTP最终9/9|
|升级auth后的旧API不兼容|初次typecheck明确2错误，日志保留|API迁移后typecheck及真实本地HTTP6/6|
|懒激活插在错误入口|首轮新用例7通过/2失败，未删除失败日志|挪到dispatch；最终9/9，两次成功回归|
|历史公开Debug仍被打包器白名单允许|新增负例在旧策略失败（保留red日志）|取消白名单；Python3/3通过|
|无归属旧草稿无法显式恢复|之前仅保留字节且没有认领入口|单测4项及真实浏览器6/6：取消、确认、新副本实际云上传、owner隐私、坏JSON|
|Android启动失败后无提示|新增缺失动态app chunk注入：空root+未捕获import rejection稳定复现|**只完成诊断，尚未修复，不算验收通过**|

最后一项是本轮新发现的真实客户端异常恢复缺陷，不据此断言历史最终APK白屏/ANR的根因就是缺失chunk。模拟器问题和客户端问题都未排除。

## 6. 数据库迁移

**0009为加法迁移，运行程序前必须部署；0008快照不可变与撤销逻辑继续保留。**

- 新列：`memberships.credits_state` 默认applied并加check，`credits_applied_at`；新pending条件索引；新PL/pgSQL函数。新代码显式插pending，旧行不猜测是否曾发放。
- `scripts/migrate.mjs` 对每个文件使用事务和迁移记录。非空0008测试库真实升级，逐项核对旧membership、订单snapshot、全部quota余额与ledger原值；重复运行无重复迁移，3项通过。
- 上线顺序：安全备份/记录应用版本 → 暂停API与Worker写入 → 迁移0009 → 同时换API/Worker → 启动受控调度 → 对账抽样 → 恢复写入。仅maintenance不足以阻止管理员写，不能把它当全库停写。
- 查询历史待对账候选可用 `select count(*) from memberships where credits_state='applied' and credits_applied_at is null and starts_at>now();`。这只找候选，不证明每行应追回多少，不能自动扣余额。
- 损坏pending snapshot使所在激活事务回滚。Worker记录政策错误码继续原构建调度，不放松沙箱；全局500段批次可能被坏行阻塞，需要告警/修复，未提供跳过坏行的自动运维面板。其他无坏数据用户按用户作用域的API激活不必受全局批次影响。
- **回滚策略：优先前滚修复；紧急停写保留0009列、函数、状态和流水。** 旧应用重新引入未来额度提前发放，不能把回滚旧二进制当业务正确的无条件退路。禁止在有新业务写入后直接删列/清状态/还原旧全库快照而丢失订单流水。仅无新写入演练库可直接回到备份；生产恢复需要另行审批、时点恢复和差异对账，本轮未执行。
- 实测数据库为Linux上PostgreSQL17.5的隔离本机库，不是生产库；PGlite兼容、生产规模扫描/锁争用/调度积压未实测。

## 7. API 变化

- 没有新增虚构REST资源；业务仍通过 `/api/v1/platform` 的既有action分发。
- `dispatch` 在身份/expectedUserId检查后，业务操作前调用共享激活函数；`giveMembership` 调整写入状态；退款action同时撤销pending。
- 原 `expectedRevision` 交付门禁、409/428、immutable snapshots与首管防护保留，最终P0 API回归验证。
- 认证库端点变化：sign-in social与上述新callback路径；实际broker回调及生产历史身份必须额外验收。
- 新运维命令 `node scripts/activate-membership-credits.mjs` 只从环境取DB连接，无HTTP公网激活管理接口，不自动装cron。部署包生成脚本已补入此命令及 `bootstrap-admin.mjs`。
- 不把monthly字段保留在API里说成周期业务已生效；后台文案已明确未启用。

## 8. 测试命令与真实结果

环境：Linux x64、Node24、本地PostgreSQL17.5；HTTP GREEN为 `http://localhost:4019`，RED为 `http://localhost:4018`。浏览器为Playwright Chromium；Android项用Mock Java桥。不是设备、不是WebView实跑。敏感/临时测试登录参数不列值。报告统一PST，原始日志保留工具原时区文本，Z后缀是UTC，不能当PST。

真实命令均在仓库根目录；API/DB测试使用明确隔离的本机 `blueos_v3_*` 测试库，**绝不能对生产运行**。下表省略连接值，按需通过 `DATABASE_URL`、`API_BASE`、测试专用 `E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD` 环境注入。

|实际命令|结果|证据 `docs/v3/evidence-next/`|
|---|---|---|
|`npm run typecheck`|通过|`final-typecheck.log`|
|`npm test`|**141/141**，含schema/editor/身份门禁与Worker fail-closed|`final-unit.log`|
|`node --test scripts/dependency-safety.test.mjs`|**3/3**|`final-dependency-test.log`|
|`npm run lint`|**0 errors，15 warnings**；主要既有Fast Refresh及mock未使用参数，未隐瞒|`final-lint.log`|
|`npm audit --json`|critical/high/moderate/low全部0|`final-audit.json`、before/after JSON|
|`npm audit --prefix deploy --json`|全部0（deploy锁文件另验）|`deploy-audit.json`|
|`NITRO_PRESET=node-server node scripts/with-app-env.mjs npx --no-install vite build`|生产Node bundle构建成功；不是生产部署成功|`final-node-build.log`|
|`node scripts/e2e/v3-auth-upgrade.mjs`|**6/6**真实HTTP；真实外部broker未登录|`auth-upgrade.log`|
|`node scripts/e2e/v3-p0-api.mjs`|新库首轮17/17；最终现存管理员库复跑**16/16**，不重复执行一次性CLI初始化用例|`p0-api.log`、`p0-api-final.log`|
|`node scripts/e2e/v3-activation.mjs`|旧代码RED2项都失败；修正后最终**9/9**，含10并发激活、退款竞态、冻结snapshot、精确边界、坏数据回滚|`activation-red.log`、首次green失败日志、`activation-final-green.log`|
|`node scripts/e2e/v3-activation-migration.mjs`|**3/3** 非空0008升级与重复迁移|`activation-populated-migration.log`|
|`node scripts/e2e/v3-recovery-ui.mjs`|**6/6** 实际网页点击/原生确认框/实际本机API上传|`recovery-ui.log`|
|`node scripts/e2e/v3-workspace.mjs`|**7/7** A→B、离线/重启、origin隔离与陈旧请求|`workspace-browser.log`|
|`node scripts/api-smoke.mjs`|**30/30**真实HTTP回归|`legacy-api.log`|
|`node scripts/e2e/web-logic.mjs`|**8/8** 浏览器逻辑|`web-logic.log`|
|`npm run build:android-web`|混合客户端资源构建成功|`android-web-build.log`|
|`node scripts/e2e/android-web.mjs`|**17/17** Chromium+Mock桥+真实API，含同版本/更新失败返回与缓存/冲突；**不是APK验收**|`android-bridge-browser.log`|
|`node scripts/e2e/v3-heartbeat.mjs`|**3/3** 真实70秒沙箱编译故障夹具；心跳未过期、受理不误判、失败额度只释放一次|`heartbeat.log`|
|`python3 scripts/test-package-delivery.py`|**3/3** 含公开Debug/容器扩展名/ZIP路径拒绝；**非完整最终打包实测**|`packaging-debug-red.log`、`packaging-debug-green.log`|
|`node scripts/e2e/android-boot-failure-probe.mjs`|**诊断成功复现仍存在的白屏恢复缺陷；不是通过产品用例**|`android-boot-failure-probe.log`|

不同组有重叠，不把所有数字相加伪称独立覆盖率。红灯、初次失败、修正后绿灯均保留，不只展示最终成功。新Gradle/JVM、APK安装启动/登录/SAF/更新、真机手表、Docker、外部生产、真实broker与周期权益均未执行。

## 9. APK/RPK/工程包产物及 SHA-256

- 本批重新构建Node server bundle和Android-web资源，并版本化交付源码、报告、跟踪及证据；`DELIVERY.json` 和 `SHA256SUMS.txt` 记录精确源码/实现提交与各文件哈希，旧交付目录不覆盖。
- **没有生成新的Release APK或RPK，不把旧APK或旧编译记录贴成修复版。** 恢复后JDK/SDK/Gradle工具链不存在；仓库外正式签名属性文件仅确认存在，未读取/输出值，也未证明引用的正式key仍可用或证书连续性。因此不得替换/重建正式key来“凑一个APK”。
- 旧 `blueos-workshop-1.0.0-release.apk` 仅静态核查，SHA-256 `08d8ce6a6839a62cf55ab5d1c413ba785ed7d8f377bbd41958b2d85667f703b5`。ZIP中4个web资源、2个可静态识别的入口/module引用没有缺失；这不证明运行中资源拦截/MIME/WebView兼容。详见 `old-apk-static-assets.json`。
- 既往9项真实官方工具链RPK编译记录不是本批重新编译，更不等于手表成功。完整打包器依然要求真实新签名APK和可验证RPK才可生成原“全量最终交付”；本批没有绕过它、调用它来伪造齐套交付。
- Debug旧文件仅仓库外保留用于签名连续性，不放入新ZIP。源码不含真实凭据、.env、数据库、node_modules及任何keystore。源码中的本机专用测试fixture字符串不是生产凭据，不复制进本报告。

## 10. 未完成事项

1. **P0-06 Android最终APK仍未通过安装、冷启动、登录、编辑、文件、进程恢复与更新验收**；P0-07手表真机仍未验。
2. Android启动已发现空静态root、dynamic import无catch、Java缺少renderer/error/console诊断，且 `restoreState` 返回空时没有加载回退；除缺失chunk浏览器复现外，其他为代码观察，未证明对应原ANR。
3. `vite.android.config.ts` target chrome87不自动补齐 `structuredClone` 等运行时API；共享编辑器确实调用该API。最低可用WebView能力还需明确/检测/兼容，不能用minSdk24就声称全部旧WebView可用。历史APK运行原因尚未定位。
4. 周期daily/monthly、时区、结转、退款后的后续段前移、坏快照监控/队列修复、历史未来提前授予对账未闭环。
5. 真实冲突409从用户UI点击阻断的完整复验、Android原生跨账号/切origin/杀进程，仍不能由共享代码推定全端通过。
6. 本批新部署包冷启动/备份恢复、Docker/生产/真实broker、PGlite、生产级锁争用与大于500段积压测试未执行；原阶段记录不能顶替新版本实测。
7. 组件版本/资源二进制与商城执行闭环、全站计费文案、生产限流/备份/许可/平台登记等V3队列未整体完成。

## 11. 风险与阻塞

- 当前npm critical/high已清零，移除了上轮依赖审计阻塞；**不等于全部P0门槛关闭，也没有远程CI结果可宣称。**
- OAuth升级必须审核真实身份映射与新callback平台登记，属于切换前验证门槛；没有替用户操作外部provider。
- 无真实Android设备/WebView日志，恢复环境缺少构建工具；不重试已知会导致宿主故障的KVM。客户端自身恢复/观测不足确已存在，不能简单归咎模拟器。
- 用户要求保留原正式Release密钥。若原key丢失则更新发布阻塞；当前仅知道属性文件存在，不把它解释为私钥已验证可用。所有签名材料继续仓库外。
- 一次性额度语义已明确并受测，但不清零/补发过期未撤销段是本轮选定策略；生产前须向运营明确。旧未来已入账余额不能静默改动。
- Worker故障夹具并非真实RPK工具链成功；沙箱不可用仍直接拒绝，未允许none/unsandboxed退路。Docker宿主namespace/权限仍需实际部署验证。
- CLI正常不代表发布授权；本执行器停在外部写入前，父任务应基于其掌握的明确授权完成一次push/建PR并等待真实checks，不能伪造链接或先合并再补测试。

## 12. 下一项自动推进任务

1. 阶段2先对启动链加静态可见状态、受控错误/重试、导入失败与渲染错误观测，并为缺失chunk/坏session/恢复失败做红绿测试；不得自动清数据“解决”白屏。浏览器复现只定位一条风险路径，不替代设备根因。
2. 恢复JDK17/SDK34/Gradle8.9，先本地JVM、资源路径/桥接测试，再用原正式签名配置做连续性验证；缺key则停在Release发布门槛，不换key。
3. 在不启用危险KVM的条件下评估安全软件渲染/用户提供设备；获取真实安装/冷启动/WebView/logcat证据后再结论。没有条件则明确未验，不循环浪费时间重启ANR。
4. 依V3顺序继续P0设备/手表门槛、P1资源与组件版本、周期权益、商城与部署；按逻辑批次报告和独立PR，不承诺本次已经全部完成。
