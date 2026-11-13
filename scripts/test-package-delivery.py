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
        for name in ['.env', '.env.production', 'keys/release.jks', 'x/private.pem', 'android/keystore.properties', 'android/release.keystore', 'node_modules/a.js', 'backups/db.dump', 'secrets/anything', '.git/config']:
            with self.subTest(name=name): self.assertFalse(delivery.allowed(name))
    def test_templates_and_public_debug_certificate_allowed(self):
        for name in ['.env.example', 'android/debug.keystore', 'android-web/app.tsx', 'worker/sandbox.mjs', '.output/server/index.mjs']:
            with self.subTest(name=name): self.assertTrue(delivery.allowed(name))
    def test_archive_audit_rejects_secret_and_android_in_server(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'x.zip'
            with zipfile.ZipFile(p,'w') as z: z.writestr('blueos-work/keys/private.pem','test fixture')
            with self.assertRaises(RuntimeError): delivery.audit_zip(p)
            with zipfile.ZipFile(p,'w') as z: z.writestr('blueos-work/android/app/build.gradle','test fixture')
            with self.assertRaises(RuntimeError): delivery.audit_zip(p, server_source=True)
            delivery.audit_zip(p)

if __name__ == '__main__': unittest.main()
