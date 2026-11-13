package icu.liuhua.workshop;

import java.util.Locale;

/** 把 https://appassets.androidplatform.net/www/... 映射到 APK 里的 assets/www/...。 */
public final class AssetRoutes {
    public static final String HOST = "appassets.androidplatform.net";
    public static final String START_URL = "https://" + HOST + "/www/index.html";

    private AssetRoutes() {}

    /** 返回 assets 里的相对路径；不是内置页面或路径不安全时返回 null。 */
    public static String assetPath(String scheme, String host, String path) {
        if (!"https".equals(scheme) || !HOST.equals(host) || path == null) return null;
        if (!path.startsWith("/www/")) return null;
        if (path.contains("..") || path.contains("\\") || path.contains("//")) return null;
        String rel = path.substring(1);
        if (rel.endsWith("/")) rel = rel + "index.html";
        return rel;
    }

    public static boolean isAppUrl(String scheme, String host) {
        return "https".equals(scheme) && HOST.equals(host);
    }

    public static String mime(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }
}
