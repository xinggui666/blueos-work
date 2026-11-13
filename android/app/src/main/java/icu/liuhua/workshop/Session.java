package icu.liuhua.workshop;

import android.content.Context;
import android.content.SharedPreferences;

public final class Session {
    private final SharedPreferences prefs;

    public Session(Context context) {
        prefs = context.getSharedPreferences("workshop", Context.MODE_PRIVATE);
    }

    public String baseUrl() {
        return prefs.getString("base", "");
    }

    public String token() {
        return prefs.getString("token", "");
    }

    public void save(String base, String token) {
        prefs.edit().putString("base", trimSlash(base)).putString("token", token).apply();
    }

    public void clearToken() {
        prefs.edit().remove("token").apply();
    }

    public static String trimSlash(String value) {
        String next = value == null ? "" : value.trim();
        while (next.endsWith("/")) next = next.substring(0, next.length() - 1);
        return next;
    }
}
