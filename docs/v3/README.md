# V3持续开发

- 基线`09b057de0bf290fb961ba61b8f06c58d491827cc`；开始时main干净；工作分支`v3/phase-1-p0-safety`。
- 最新V3完整1510行已读取，SHA-256 `dbb2745a9687217175de23b184cb092d4f6ffbc4ff2aac0fdb3150a68c8f4192`；保留原栈和现有数据。
- [需求追踪](requirements.md)、[V3§14.5开发报告](phase-1-report.md)、[测试证据](evidence/README.md)。
- 阶段0已建立基线；阶段1有受测修复，但不是全量终验完成。Android最终APK、BlueOS手表、Docker、生产仍未验证。
- 原始V2.1 MD来源已核对，与`/workspace/bw-spec/spec.md`哈希一致。旧审计“未找到二进制原件”的文字不代表V2.1 Markdown原文缺失。
- 未做外部部署，不上传签名秘密。旧无归属草稿字节保留，不自动认领到任意账号，受控恢复UI后续补齐。
- 本轮box出现意外运行时重启/检查点恢复，`/tmp`原始日志、临时数据库、node_modules和未持久化交付副本消失；详见报告，恢复后的测试单独记录。
