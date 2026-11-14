# Android启动恢复证据（非设备验收）

见../phase-2-android-recovery-report.md及code-commit.txt。最终npm148、JVM16、启动恢复Chromium10、Mock Native17、原生形状HTTP6、OAuth发起6、本地CI API30、打包策略5通过；分组重叠，不能累加。Release1.0.1/code11原证书签名、实际APK版本/资源字节核对通过；没有APK安装或运行。

保留初次JSDoc类型错误、harness缺esbuild、ES5尾逗号失败与最终成功。PR9 CI实际19/11失败，本地显式CLI初始化修正后30/30，但远程未复跑；CI日志的fixture secret行已可见脱敏，原文由GitHub run保留，不是宣称原日志逐字节复制。

工具下载在仓库外，JDK/Gradle官方SHA256、SDK官方仓库校验。源码/交付无签名文件。原始工具时间保留原文，报告时间PST；CI原始Z为UTC。HTTP服务测试完仅停自有进程，PG和adb保留。raw .log含ANSI/空白，不重写，只从git空白格式检查排除；不跳过hook。

环境恢复后没有重试KVM或启动任何模拟器；adb无设备；未做watch/Docker/生产/真实OAuth回调。
