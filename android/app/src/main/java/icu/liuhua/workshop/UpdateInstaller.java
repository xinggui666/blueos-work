package icu.liuhua.workshop;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 版本更新：下载 → 校验 SHA-256 → 核对包名和版本号 → 交给系统 PackageInstaller。
 * 任何一步不通过都删除下载文件，不安装。
 */
final class UpdateInstaller {
    static final String ACTION_STATUS = "icu.liuhua.workshop.INSTALL_STATUS";
    private final MainActivity activity;
    private final boolean allowHttp;

    UpdateInstaller(MainActivity activity, boolean allowHttp) {
        this.activity = activity;
        this.allowHttp = allowHttp;
    }

    void install(String id, String url, String expected) {
        if (!UrlRules.downloadAllowed(url, allowHttp)) {
            activity.resolve(id, 400, "安装包地址必须是 https");
            return;
        }
        if (!Hashes.isSha256(expected)) {
            activity.resolve(id, 400, "版本信息缺少 SHA-256，不能安装");
            return;
        }
        File file = new File(activity.getCacheDir(), "update.apk");
        try {
            download(url, file);
            String actual;
            try (InputStream in = new FileInputStream(file)) {
                actual = Hashes.sha256(in);
            }
            if (!Hashes.same(actual, expected)) {
                file.delete();
                activity.resolve(id, 400, "安装包 SHA-256 不一致，已删除，没有安装（期望 " + expected + "，实际 " + actual + "）");
                return;
            }
            PackageManager pm = activity.getPackageManager();
            PackageInfo info = pm.getPackageArchiveInfo(file.getPath(), 0);
            if (info == null || !activity.getPackageName().equals(info.packageName)) {
                file.delete();
                activity.resolve(id, 400, "安装包不是本应用，已删除");
                return;
            }
            long newCode = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            if (newCode <= BuildConfig.VERSION_CODE) {
                file.delete();
                activity.resolve(id, 400, "安装包版本不比当前新，已删除");
                return;
            }
            if (Build.VERSION.SDK_INT >= 26 && !pm.canRequestPackageInstalls()) {
                activity.runOnUiThread(() -> activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))));
                activity.resolve(id, 409, "请在系统设置里允许本应用安装更新，然后回来再点一次（安装包已下载并校验通过）");
                return;
            }
            commit(file);
            activity.resolve(id, 200, "SHA-256 校验通过，已交给系统安装，请按系统提示完成");
        } catch (Exception error) {
            file.delete();
            activity.resolve(id, 0, "下载更新失败：" + error.getMessage());
        }
    }

    private void download(String url, File file) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(true);
        int code = connection.getResponseCode();
        if (code != 200) throw new IllegalStateException("HTTP " + code);
        String finalUrl = connection.getURL().toString();
        if (!UrlRules.downloadAllowed(finalUrl, allowHttp)) throw new IllegalStateException("跳转到了不安全的地址");
        try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            long total = 0;
            while ((read = in.read(buffer)) > 0) {
                total += read;
                if (total > 300L * 1024 * 1024) throw new IllegalStateException("安装包过大");
                out.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
    }

    private void commit(File file) throws Exception {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(activity.getPackageName());
        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(file); OutputStream out = session.openWrite("update.apk", 0, file.length())) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
                session.fsync(out);
            }
            Intent intent = new Intent(ACTION_STATUS).setPackage(activity.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pending = PendingIntent.getBroadcast(activity, sessionId, intent, flags);
            session.commit(pending.getIntentSender());
        }
        file.delete();
    }
}
