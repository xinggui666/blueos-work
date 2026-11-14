# 本轮证据与复现边界

日期2026-11-14 PST；实现提交记录于code-commit.txt。所有测试只对本机一次性blueos_v3_数据库；不是生产、不是设备验证。

## 早期观察但原始文件已丢失

意外box运行时重启/检查点恢复使/tmp日志、临时数据库、进程、node_modules、未固定的交付副本丢失。早期观察值详见主报告§8；不可把本目录没有的文件描述成已归档。重启原因未确定。

## 恢复后实际归档

恢复后的命令输出保存本目录recovery-*文件；测试完成后补充结果及SHA256SUMS。安装日志里的软件包审计结果不代表本项目安全认证。

## 正确复现条件

1. npm ci；依赖版本以package-lock.json为准；Node24。准备隔离PostgreSQL17，不读取生产凭据。
2. 创建blueos_v3_前缀一次性库，安全注入DATABASE_URL后npm run db:migrate；启动单个Vite测试服务，VITE_AUTH_ENABLED=true，测试BetterAuth origin与端口一致，不设置BOOTSTRAP_ADMIN_USER_ID。admin邮箱仅用脚本自带无效域fixture；脚本用运维CLI明确初始化。
3. API脚本设置API_BASE和DATABASE_URL；浏览器脚本设置E2E_BASE。修改源码/格式化结束后重启dev进程再测，避免HMR带query模块与动态import裸路径生成重复store。
4. Worker测试必须bwrap可用且namespace探测通过。没有就应拒绝，不得改none来通过。70秒脚本的编译器是明确故障夹具；不是官方RPK证据。
5. 实际官方RPK需要安装工具链并安全注入签名配置，私钥不进入repo/日志。SDK编译不代表手表运行。
6. 不将客户端浏览器fixture/Native mock、Android-Web bundle称为最终APK运行。

## 恢复后最终结果

- 应用修复0140b23；58dd16e仅补旧逻辑脚本的登录hydration等待条件，应用源码相同；完整SHA见code-commit/environment/results。
- 单测137/137；API安全17/17；旧API串行30/30；工作空间Chromium7/7；逻辑Chromium8/8。
- 带历史数据0007→0008迁移、幂等、时刻边界3组通过（`recovery-populated-upgrade.log`）；`recovery-db-boundaries.log`是在已迁移库重播，不能代替前者/不能重复计算独立场景。
- 70秒实际Worker+PG+bwrap故障编译夹具3/3；因并行smoke产生额外任务总进程约141秒，退出成功；不是RPK编译证据。
- 类型通过；lint 0错误15警告；auth模式一致；Android-Web与Node bundle成功。HTTP验的是Vite，不是生产Node冷启动验收。
- npm audit仍失败：12项公告（critical1/high1/moderate8/low2），better-auth、zod需独立安全处置，不声称当前配置已被利用。
- APK/手表/Docker/生产/异地恢复未测试。早期9项官方RPK结果仅保留观察说明，无当前产物可下载。
- 所有失败日志保留：缺浏览器依赖、初始chunk未加载即断网、旧API全局构建flag并行干扰、SSR登录handler未hydrated。成功复验不抹去失败。
- 新增DB旧fixture准备仅可用于空的一次性库：`V3_MIGRATION_PREPARE_OLD=true DATABASE_URL=<空测试库> node scripts/e2e/v3-migration.mjs`；脚本强制localhost和blueos_v3_前缀并检查空public schema。
- 测试结束已停止本批4016 Vite；55433一次性PG仍保留用于后续诊断，未触碰真实库。

机器可读结果见results.json，文件校验见SHA256SUMS.txt。不能把“多数通过”说成所有检查通过/正式可发布。
