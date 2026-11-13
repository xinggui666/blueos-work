package icu.liuhua.workshop;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 唯一的界面：WebView 载入 APK 内置的工坊界面（assets/www，离线可用），
 * 网络、登录令牌、文件读写、版本更新都由原生处理（见 NativeBridge）。
 */
public class MainActivity extends Activity {
    private static final int REQ_CREATE = 41;
    private static final int REQ_OPEN = 42;

    private WebView web;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private ValueCallback<Uri[]> pendingChooser;
    private String pendingSaveId;
    private byte[] pendingSaveBytes;

    private final BroadcastReceiver installStatus = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                Toast.makeText(context, "安装没有完成：" + (message == null ? status : message), Toast.LENGTH_LONG).show();
            }
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setTextZoom(100);
        web.addJavascriptInterface(new NativeBridge(this), "BlueOSNative");
        web.setWebViewClient(new AppClient());
        web.setWebChromeClient(new Chrome());
        setContentView(web);
        IntentFilter filter = new IntentFilter(UpdateInstaller.ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(installStatus, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(installStatus, filter);
        watchNetwork();
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(AssetRoutes.START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        emit("network", "{\"online\":" + isOnline() + "}");
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(installStatus);
        } catch (Exception ignored) {
        }
        if (networkCallback != null) connectivity.unregisterNetworkCallback(networkCallback);
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    boolean isOnline() {
        Network network = connectivity.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void watchNetwork() {
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                emit("network", "{\"online\":true}");
            }

            @Override
            public void onLost(Network network) {
                emit("network", "{\"online\":" + isOnline() + "}");
            }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
    }

    void resolve(String id, int status, String body) {
        runOnUiThread(() -> web.evaluateJavascript(Js.resolve(id, status, body), null));
    }

    void emit(String name, String json) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript(Js.emit(name, json), null);
        });
    }

    void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception error) {
            Toast.makeText(this, "没有可以打开链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    /** 系统“保存到…”（SAF）。 */
    void createDocument(String id, String fileName, String mime, byte[] bytes) {
        if (pendingSaveId != null) resolve(pendingSaveId, 499, "已取消");
        pendingSaveId = id;
        pendingSaveBytes = bytes;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, fileName);
        try {
            startActivityForResult(intent, REQ_CREATE);
        } catch (Exception error) {
            pendingSaveId = null;
            pendingSaveBytes = null;
            resolve(id, 500, "这台设备没有文件保存界面");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CREATE) {
            String id = pendingSaveId;
            byte[] bytes = pendingSaveBytes;
            pendingSaveId = null;
            pendingSaveBytes = null;
            if (id == null) return;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (uri == null) {
                resolve(id, 499, "已取消");
                return;
            }
            try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new IllegalStateException("无法写入");
                out.write(bytes);
                resolve(id, 200, "");
            } catch (Exception error) {
                resolve(id, 500, "保存失败：" + error.getMessage());
            }
        } else if (requestCode == REQ_OPEN) {
            ValueCallback<Uri[]> callback = pendingChooser;
            pendingChooser = null;
            if (callback == null) return;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            callback.onReceiveValue(uri == null ? null : new Uri[] {uri});
        }
    }

    private final class AppClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String path = AssetRoutes.assetPath(url.getScheme(), url.getHost(), url.getPath());
            if (path == null) {
                if (AssetRoutes.isAppUrl(url.getScheme(), url.getHost())) return notFound();
                return null;
            }
            try {
                InputStream in = getAssets().open(path);
                WebResourceResponse response = new WebResourceResponse(AssetRoutes.mime(path), "utf-8", in);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", path.endsWith("index.html") ? "no-cache" : "max-age=31536000, immutable");
                headers.put("X-Content-Type-Options", "nosniff");
                response.setResponseHeaders(headers);
                return response;
            } catch (Exception missing) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            WebResourceResponse response = new WebResourceResponse("text/plain", "utf-8", new java.io.ByteArrayInputStream(new byte[0]));
            response.setStatusCodeAndReasonPhrase(404, "Not Found");
            return response;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (AssetRoutes.isAppUrl(url.getScheme(), url.getHost())) return false;
            // 内置页面以外的地址一律交给系统浏览器，WebView 里只跑本应用自己的页面。
            openExternal(url.toString());
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingChooser != null) pendingChooser.onReceiveValue(null);
            pendingChooser = callback;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            try {
                startActivityForResult(intent, REQ_OPEN);
                return true;
            } catch (Exception error) {
                pendingChooser = null;
                return false;
            }
        }
    }
}
