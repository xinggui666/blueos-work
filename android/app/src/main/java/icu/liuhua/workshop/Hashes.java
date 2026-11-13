package icu.liuhua.workshop;

import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

public final class Hashes {
    private Hashes() {}

    public static String hex(byte[] digest) {
        StringBuilder out = new StringBuilder(digest.length * 2);
        for (byte b : digest) out.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return out.toString();
    }

    public static String sha256(InputStream in) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = in.read(buffer)) > 0) md.update(buffer, 0, read);
        return hex(md.digest());
    }

    public static boolean isSha256(String value) {
        return value != null && value.trim().toLowerCase(Locale.ROOT).matches("[a-f0-9]{64}");
    }

    /** 常量时间比较，忽略大小写和首尾空白。 */
    public static boolean same(String a, String b) {
        if (a == null || b == null) return false;
        byte[] x = a.trim().toLowerCase(Locale.ROOT).getBytes();
        byte[] y = b.trim().toLowerCase(Locale.ROOT).getBytes();
        return MessageDigest.isEqual(x, y);
    }
}
