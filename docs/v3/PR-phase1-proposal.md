# 待父任务发布的PR建议（尚未创建）

目标：GitHub `xinggui666/blueos-work`，base `main`，head `v3/phase-1-p0-safety`。

标题：fix(v3): 隔离工作空间、固定交付版本及会员额度安全闭环

正文：

本PR是V3阶段1本地测试候选，包含前批origin+user隔离/陈旧请求拒绝、固定revision交付门禁、首管与Worker fail-closed/心跳，以及续批依赖升级、0009一次性会员额度起点激活/幂等退款、不可变权益快照回归、显式旧草稿恢复与Debug外置。

新增0008/0009加法迁移；部署前备份、停写迁移、同时升级API/Worker；旧未来已提前入账余额不静默追回；月度/每日周期发放未实现。Better Auth 1.7 callback改为/api/auth/callback/<provider>，真实broker注册与历史subject须额外核验。

本地结果：141单测、3依赖兼容、6真实HTTP auth、最终16 P0 API（首次新库17）、9会员激活/退款并发、3非空迁移、7身份隔离浏览器、6恢复UI、30旧API、8网页逻辑、17 Native桥替身、3真实70秒Worker故障夹具、3打包策略均通过；typecheck/Node/Android-web build通过；lint 0错误15警告；根目录及deploy npm audit均0。红灯及修正日志见docs/v3/evidence-next/。

未构建新Release APK/RPK，未做APK运行/手表/Docker/生产/真实broker验收。缺失动态chunk时白屏恢复缺陷已在Chromium复现，尚未修复，不能说已定位历史APK ANR。没有上传签名材料，不使用新的替代Release key。

完整报告：docs/v3/phase-1-followup-report.md。等待真实远程checks与审阅，不将本地绿灯当CI绿灯或V3全量完成。
