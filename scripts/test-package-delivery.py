#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location('delivery', Path(__file__).with_name('package-delivery.py'))
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)

class DeliveryTests(unittest.TestCase):
    def test_secrets_dependencies_backups_forbidden(self):
        for name in ['.env', '.env.production', 'keys/release.jks', 'x/private.pem', 'android/keystore.properties', 'android/release.keystore', 'android/debug.keystore', 'keys/test.KEYSTORE', 'keys/test.p12', 'keys/test.pfx', 'keys/test.key', 'node_modules/a.js', 'backups/db.dump', 'secrets/anything', '.git/config']:
            with self.subTest(name=name): self.assertFalse(delivery.allowed(name))
    def test_templates_and_source_allowed(self):
        for name in ['.env.example', 'android-web/app.tsx', 'worker/sandbox.mjs', '.output/server/index.mjs']:
            with self.subTest(name=name): self.assertTrue(delivery.allowed(name))
    def test_archive_audit_rejects_secret_and_android_in_server(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'x.zip'
            with zipfile.ZipFile(p,'w') as z: z.writestr('blueos-work/keys/private.pem','test fixture')
            with self.assertRaises(RuntimeError): delivery.audit_zip(p)
            with zipfile.ZipFile(p,'w') as z: z.writestr('blueos-work/android/app/build.gradle','test fixture')
            with self.assertRaises(RuntimeError): delivery.audit_zip(p, server_source=True)
            delivery.audit_zip(p)
            with zipfile.ZipFile(p,'w') as z: z.writestr('blueos-work/android/debug.keystore','public debug fixture')
            with self.assertRaises(RuntimeError): delivery.audit_zip(p)

    def test_actual_apk_version_not_old_hardcoded_label(self):
        meta = delivery.parse_apk_badging("package: name='icu.liuhua.workshop' versionCode='11' versionName='1.0.1' platformBuildVersionName='14'")
        self.assertEqual(meta, {'packageName':'icu.liuhua.workshop','versionCode':11,'versionName':'1.0.1'})
    def test_bad_or_path_like_apk_version_rejected(self):
        for text in ['', "package: name='icu.liuhua.workshop' versionCode='11' versionName='../bad'", "package: name='x' versionCode='oops' versionName='1.0'"]:
            with self.subTest(text=text):
                with self.assertRaises(RuntimeError): delivery.parse_apk_badging(text)

if __name__ == '__main__': unittest.main()
