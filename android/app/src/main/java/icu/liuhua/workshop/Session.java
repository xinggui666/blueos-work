package icu.liuhua.workshop;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/** 登录会话：只存在应用私有存储里（allowBackup=false），页面脚本拿不到令牌。 */
public final class Session {
    private final SharedPreferences prefs;

    public Session(Context context) {
        prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE);
    }

    public String base() {
        return prefs.getString("base", "");
    }

    public String token() {
        return prefs.getString("token", "");
    }

    public boolean signedIn() {
        return !token().isEmpty() && !prefs.getString("userId", "").isEmpty();
    }

    public void save(String base, String token, String userId, String name, String email) {
        prefs.edit().putString("base", base).putString("token", token).putString("userId", userId).putString("name", name).putString("email", email).apply();
    }

    public void signOut() {
        // 保留服务器地址和邮箱，方便下次登录；令牌清掉。
        prefs.edit().remove("token").remove("userId").apply();
    }

    public String toJson() {
        JSONObject out = new JSONObject();
        try {
            out.put("signedIn", signedIn());
            out.put("base", base());
            out.put("expired", false);
            String email = prefs.getString("email", "");
            if (signedIn()) {
                JSONObject user = new JSONObject();
                user.put("id", prefs.getString("userId", ""));
                user.put("name", prefs.getString("name", ""));
                user.put("email", email);
                out.put("user", user);
            } else if (!email.isEmpty()) {
                JSONObject user = new JSONObject();
                user.put("id", "");
                user.put("name", "");
                user.put("email", email);
                out.put("user", user);
                out.put("signedIn", false);
            } else {
                out.put("user", JSONObject.NULL);
            }
        } catch (Exception ignored) {
        }
        return out.toString();
    }
}
