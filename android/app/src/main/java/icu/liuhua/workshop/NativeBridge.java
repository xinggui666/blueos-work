package icu.liuhua.workshop;

import android.os.Build;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 暴露给内置页面的 window.BlueOSNative。
 * 只有内置页面（https://appassets.androidplatform.net/www/）会被加载，其他地址都交给系统浏览器打开。
 */
public final class NativeBridge {
    private final MainActivity activity;
    private final Session session;
    private final SessionGuard sessionGuard = new SessionGuard();
    private final AtomicBoolean updateInFlight = new AtomicBoolean(false);
    private final ExecutorService pool = Executors.newFixedThreadPool(3);

    NativeBridge(MainActivity activity) {
        this.activity = activity;
        this.session = new Session(activity);
    }

    private boolean allowHttp() {
        return BuildConfig.DEBUG;
    }

    @JavascriptInterface
    public void call(String id, String action, String payloadJson) {
        if (!UrlRules.validAction(action)) {
            activity.resolve(id, 400, "{\"error\":\"无效请求\"}");
            return;
        }
        // Capture the pair atomically: switching servers must never send A's token to B's base.
        String[] identity = sessionGuard.read(() -> new String[]{session.token(), session.base()});
        final String token = identity[0], base = identity[1];
        if (token.isEmpty() || base.isEmpty()) {
            activity.resolve(id, 401, "{\"error\":\"Unauthorized\"}");
            return;
        }
        pool.execute(() -> {
            Http.Result result = Http.request("POST", base + "/api/v1/platform", Js.platformBody(action, payloadJson), token);
            activity.resolve(id, result.status, result.body);
        });
    }

    @JavascriptInterface
    public void signIn(String id, String rawBase, String email, String password, boolean register, String name) {
        final long generation = sessionGuard.begin();
        pool.execute(() -> {
            String base;
            try {
                base = UrlRules.normalizeBase(rawBase, allowHttp());
            } catch (IllegalArgumentException error) {
                activity.resolve(id, 400, json("message", error.getMessage()));
                return;
            }
            try {
                if (register) {
                    JSONObject body = new JSONObject();
                    body.put("email", email);
                    body.put("password", password);
                    body.put("name", name == null || name.isEmpty() ? email : name);
                    Http.Result created = Http.request("POST", base + "/api/auth/sign-up/email", body.toString(), null);
                    if (created.status != 200) {
                        activity.resolve(id, created.status, created.body);
                        return;
                    }
                }
                JSONObject body = new JSONObject();
                body.put("email", email);
                body.put("password", password);
                Http.Result signed = Http.request("POST", base + "/api/auth/sign-in/email", body.toString(), null);
                if (signed.status != 200 || signed.token == null || signed.token.isEmpty()) {
                    activity.resolve(id, signed.status == 200 ? 500 : signed.status, signed.status == 200 ? json("message", "服务器没有返回登录令牌") : signed.body);
                    return;
                }
                Http.Result me = Http.request("GET", base + "/api/auth/get-session", null, signed.token);
                JSONObject user = me.status == 200 ? new JSONObject(me.body).optJSONObject("user") : null;
                if (user == null) {
                    activity.resolve(id, me.status == 0 ? 0 : 500, json("message", "读取账号信息失败"));
                    return;
                }
                if (!sessionGuard.commit(generation, () -> session.save(base, signed.token, user.optString("id"), user.optString("name"), user.optString("email", email)))) {
                    activity.resolve(id, 409, json("message", "登录已被后续操作取消，未替换会话")); return;
                }
                activity.resolve(id, 200, "{}");
            } catch (Exception error) {
                activity.resolve(id, 500, json("message", String.valueOf(error.getMessage())));
            }
        });
    }

    @JavascriptInterface
    public void signOut() {
        String[] identity = sessionGuard.clear(() -> {
            String[] old = new String[]{session.token(), session.base()}; session.signOut(); return old;
        });
        final String token = identity[0], base = identity[1];
        if (!token.isEmpty() && !base.isEmpty()) {
            // 尽力通知服务器注销；离线时只清本机令牌。
            pool.execute(() -> Http.request("POST", base + "/api/auth/sign-out", "{}", token));
        }
    }

    @JavascriptInterface
    public String session() {
        return sessionGuard.read(session::toJson);
    }

    @JavascriptInterface
    public boolean online() {
        return activity.isOnline();
    }

    @JavascriptInterface
    public String appInfo() {
        JSONObject info = new JSONObject();
        try {
            info.put("bridgeVersion", 2);
            info.put("versionName", BuildConfig.VERSION_NAME);
            info.put("versionCode", BuildConfig.VERSION_CODE);
            info.put("debug", BuildConfig.DEBUG);
            info.put("packageName", activity.getPackageName());
            info.put("sdk", Build.VERSION.SDK_INT);
            info.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            try {
                if (Build.VERSION.SDK_INT >= 26) {
                    android.content.pm.PackageInfo webView = android.webkit.WebView.getCurrentWebViewPackage();
                    if (webView != null) info.put("webViewVersion", webView.versionName);
                }
            } catch (Exception unavailable) { /* Optional diagnostics must not break required metadata. */ }
        } catch (Exception ignored) {
        }
        return info.toString();
    }

    @JavascriptInterface
    public void saveFile(String id, String fileName, String mime, String base64) {
        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            activity.resolve(id, 400, "文件内容不是合法的 base64");
            return;
        }
        String safeName = fileName == null ? "file.bin" : fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
        activity.runOnUiThread(() -> activity.createDocument(id, safeName, mime == null || mime.isEmpty() ? "application/octet-stream" : mime, bytes));
    }

    @JavascriptInterface
    public void installUpdate(String id, String url, String sha256) {
        if (!updateInFlight.compareAndSet(false, true)) {
            activity.resolve(id, 409, "已有更新正在处理，请等待结果后再试"); return;
        }
        pool.execute(() -> { try { new UpdateInstaller(activity, allowHttp()).install(id, url, sha256); }
            finally { updateInFlight.set(false); } });
    }

    @JavascriptInterface
    public void openExternal(String url) {
        if (url != null && (url.startsWith("https://") || url.startsWith("http://"))) activity.runOnUiThread(() -> activity.openExternal(url));
    }

    @JavascriptInterface
    public void reloadBundledApp() { activity.reloadBundledApp(); }

    void cancelPendingLogin() { sessionGuard.invalidate(); }

    void close() {
        sessionGuard.close();
        pool.shutdownNow();
    }

    static String json(String key, String value) {
        JSONObject out = new JSONObject();
        try {
            out.put(key, value);
        } catch (Exception ignored) {
        }
        return out.toString();
    }
}
