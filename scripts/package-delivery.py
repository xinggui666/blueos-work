#!/usr/bin/env python3
"""Package tracked source + built Nitro server + signed APK, never secrets/dependencies.
Run after tests/builds on the intended git commit: python3 scripts/package-delivery.py /workspace/deliverables
Android source intentionally includes shared src/ and Node setup so it is independently buildable.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime
from zoneinfo import ZoneInfo
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def allowed(name):
    p = PurePosixPath(name)
    if any(part in {'.git', 'node_modules', 'backups', 'secrets', '.gradle'} for part in p.parts):
        return False
    if p.name.startswith('.env') and p.name != '.env.example':
        return False
    if p.name.lower() == 'keystore.properties' or p.suffix.lower() in {'.jks', '.pem', '.dump', '.keystore', '.p12', '.pfx', '.key'}:
        return False
    return True

def audit_zip(path, server_source=False):
    with zipfile.ZipFile(path) as z:
        bad = [n for n in z.namelist() if not allowed('/'.join(PurePosixPath(n).parts[1:]))]
        if bad:
            raise RuntimeError(f'{path}: forbidden paths: {bad}')
        if server_source and any(n.startswith('blueos-work/android/') for n in z.namelist()):
            raise RuntimeError('server source contains android/')
        corrupt = z.testzip()
        if corrupt:
            raise RuntimeError(f'corrupt entry: {corrupt}')

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for data in iter(lambda: f.read(1024 * 1024), b''):
            h.update(data)
    return h.hexdigest()

def write_sources(out):
    data = subprocess.check_output(['git', 'archive', '--format=zip', 'HEAD'], cwd=ROOT)
    with zipfile.ZipFile(io.BytesIO(data)) as src:
        for kind in ['server', 'android']:
            target = out / f'blueos-work-{kind}-source.zip'
            with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as dest:
                for info in src.infolist():
                    if info.is_dir():
                        continue
                    if not allowed(info.filename):
                        raise RuntimeError(f'forbidden tracked path: {info.filename}')
                    if kind == 'server' and info.filename.startswith('android/'):
                        continue
                    entry = zipfile.ZipInfo('blueos-work/' + info.filename, info.date_time)
                    entry.external_attr = info.external_attr
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    dest.writestr(entry, src.read(info))
            audit_zip(target, server_source=kind == 'server')

def write_deploy(out):
    if not (ROOT / '.output/server/index.mjs').is_file():
        raise RuntimeError('build Nitro node-server first')
    target = out / 'blueos-work-server-deploy.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        def add(path, name):
            if not allowed(name):
                return
            z.write(path, 'blueos-work-server-deploy/' + name)
        for directory in ['.output', 'migrations', 'worker', 'docs']:
            for p in sorted((ROOT / directory).rglob('*')):
                if p.is_file():
                    add(p, str(p.relative_to(ROOT)))
        for name in ['migrate.mjs', 'migration-plan.mjs', 'backup-db.sh', 'restore-db.sh', 'build-rpk.sh', 'healthcheck.sh', 'bootstrap-admin.mjs', 'activate-membership-credits.mjs']:
            add(ROOT / 'scripts' / name, 'scripts/' + name)
        for name in ['package.json', 'package-lock.json']:
            add(ROOT / 'deploy' / name, name)
        add(ROOT / '.env.example', '.env.example')
        add(ROOT / 'docs/17-最终交付与部署.md', 'README-部署.md')
        add(ROOT / 'deploy/nginx.conf.example', 'deploy/nginx.conf.example')
    audit_zip(target)

def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else '/workspace/deliverables').resolve()
    out.mkdir(parents=True, exist_ok=True)
    apk = ROOT / 'android/app/build/outputs/apk/release/app-release.apk'
    if not apk.exists():
        raise RuntimeError('missing signed release APK; unsigned files are never substituted')
    sdk = Path(os.environ.get('ANDROID_HOME', '/nonexistent'))
    signer = shutil.which('apksigner')
    if not signer:
        candidates = sorted(sdk.glob('build-tools/*/apksigner'))
        signer = str(candidates[-1]) if candidates else None
    if not signer:
        raise RuntimeError('apksigner required for release verification')
    subprocess.run([signer, 'verify', str(apk)], check=True)
    samples = Path(os.environ.get('RPK_SAMPLE_DIR', str(out / 'rpk-sample'))).resolve()
    subprocess.run(['node', str(ROOT / 'scripts/verify-samples.mjs'), str(samples)], check=True)
    sample_dest = out / 'rpk-sample'
    sample_dest.mkdir(exist_ok=True)
    for p in samples.glob('*.rpk'):
        if p.resolve() != (sample_dest / p.name).resolve():
            shutil.copy2(p, sample_dest / p.name)
    write_sources(out)
    write_deploy(out)
    for kind in ['release', 'debug']:
        p = ROOT / f'android/app/build/outputs/apk/{kind}/app-{kind}.apk'
        if p.exists():
            shutil.copy2(p, out / f'blueos-workshop-1.0.0-{kind}.apk')
    for doc in ['15-Android测试报告.md', '16-多端与第十九章验收.md', '17-最终交付与部署.md']:
        shutil.copy2(ROOT / 'docs' / doc, out / doc)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    (out / 'DELIVERY.json').write_text(json.dumps({
        'revision': revision, 'androidVersion': '1.0.0', 'androidVersionCode': 10,
        'builtAt': datetime.now(ZoneInfo('America/Los_Angeles')).isoformat(),
        'status': 'release-candidate; Android native runtime, BlueOS watch and production deployment gates OPEN',
        'excluded': ['node_modules', 'signing keys/passwords', '.env', 'backups'],
    }, indent=2, ensure_ascii=False) + '\n')
    (out / 'README-交付说明.md').write_text(f'''# BlueOS 工坊候选交付

源码修订 `{revision}`。这是已构建/测试的候选交付，不是已在生产和目标手表验收通过的声明。

- server-source.zip：完整服务端/网页源码，不含 android/。
- android-source.zip：完整 Android Studio 宿主 + android-web + 共享 src/、Node 构建配置等跟踪源码；需 npm ci + npm run build:android-web 再 Gradle 构建。
- server-deploy.zip：Nitro node-server 产物、迁移、锁定 pg 安装清单、Worker、脚本和文档；先 npm ci --omit=dev，按 README-部署.md 配置。无 node_modules。
- blueos-workshop-1.0.0-release.apk：正式签名；证书 SHA-256 0f885077fb73915c0256b283d90eac28d2e0a08e27d374ba1ae956f615620482。Debug 为 .debug 包名且仅它允许 http。
- rpk-sample/：官方工具链编译的真实示例 RPK；未真机验证。
- DELIVERY.json / SHA256SUMS.txt：精确修订/版本与全部交付文件哈希。`sha256sum -c SHA256SUMS.txt`。
- 若目录保留旧 0.1.0 APK，它们仅为历史壳，不是本次最终客户端。

## 更新记录
- Stage 5 / PR #6：完整内置 Android 工坊、原生集成、离线与权限；Worker fail closed，不可用沙箱拒绝启动。134 单测 + JVM 5 + Android UI/桥替身17 + 真实隔离 RPK9。最终 APK 安装/启动/登录未完成验收。
- Stage 6 / PR #7：API30、网页同步4、逻辑8、网页构建6、admin API13/UI4；跨双 UI4、过期边界3。Android 原生、手表全项仍未完成。
- Stage 7：可复现打包、部署包冷启动/备份恢复演练、监控/升级回滚手册和最终缺口清单。生产 HTTPS/域名/外部主机未部署；Docker 未实测。

密钥在仓库外 /workspace/secrets/blueos-work/，不在包内；需单独安全备份。先读同目录三个验收/部署报告。最终成品上线仍受这些明确未完成门槛约束。
''')
    files = sorted(p for p in out.rglob('*') if p.is_file() and p.name != 'SHA256SUMS.txt')
    for p in files:
        if not allowed(str(p.relative_to(out))):
            raise RuntimeError(f'forbidden deliverable: {p}')
    (out / 'SHA256SUMS.txt').write_text(''.join(f'{digest(p)}  {p.relative_to(out)}\n' for p in files))
    print(f'Packaged revision {revision} in {out}; no Android/watch/production acceptance implied')

if __name__ == '__main__':
    main()
