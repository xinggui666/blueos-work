package icu.liuhua.workshop;

import java.net.URI;
import java.util.Locale;

/** 服务器地址规则：正式包只允许 https，调试包可以用 http 连本机/局域网服务器。 */
public final class UrlRules {
    private UrlRules() {}

    public static String normalizeBase(String raw, boolean allowHttp) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("请填写服务器地址");
        if (!value.contains("://")) value = "https://" + value;
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        URI uri;
        try {
            uri = new URI(value);
        } catch (Exception error) {
            throw new IllegalArgumentException("服务器地址格式不对");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (uri.getHost() == null || uri.getHost().isEmpty()) throw new IllegalArgumentException("服务器地址缺少域名");
        if (uri.getQuery() != null || uri.getFragment() != null || uri.getUserInfo() != null) {
            throw new IllegalArgumentException("服务器地址不能带参数或账号");
        }
        if (scheme.equals("https")) return value;
        if (scheme.equals("http")) {
            if (allowHttp) return value;
            throw new IllegalArgumentException("正式版只允许 https 服务器地址");
        }
        throw new IllegalArgumentException("服务器地址必须以 https:// 开头");
    }

    /** 更新包下载地址：正式包只接受 https。 */
    public static boolean downloadAllowed(String url, boolean allowHttp) {
        if (url == null) return false;
        String lower = url.trim().toLowerCase(Locale.ROOT);
        return lower.startsWith("https://") || (allowHttp && lower.startsWith("http://"));
    }

    public static boolean validAction(String action) {
        return action != null && action.matches("[a-zA-Z]{2,40}");
    }
}
