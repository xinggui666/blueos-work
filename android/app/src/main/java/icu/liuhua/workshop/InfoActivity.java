package icu.liuhua.workshop;

import android.app.Activity;
import android.os.Bundle;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

public class InfoActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView text = new TextView(this);
        text.setPadding(48, 48, 48, 48);
        text.setText("正在读取…");
        ScrollView scroll = new ScrollView(this);
        scroll.addView(text);
        setContentView(scroll);
        String action = getIntent().getStringExtra("action");
        new Thread(() -> {
            try {
                Session session = new Session(this);
                Api.Result result = Api.platform(session.baseUrl(), session.token(), action == null ? "me" : action, new JSONObject());
                String shown = result.code >= 400 ? errorOf(result.body) : pretty(action, result.body);
                runOnUiThread(() -> text.setText(shown));
            } catch (Exception error) {
                runOnUiThread(() -> text.setText(error.getMessage() == null ? "读取失败" : error.getMessage()));
            }
        }).start();
    }

    private String pretty(String action, String body) throws Exception {
        if ("me".equals(action)) {
            JSONObject me = new JSONObject(body);
            JSONObject quota = me.optJSONObject("quota");
            String export = quota == null ? "0" : String.valueOf(quota.optJSONObject("export") == null ? 0 : quota.optJSONObject("export").optInt("balance"));
            String build = quota == null ? "0" : String.valueOf(quota.optJSONObject("build") == null ? 0 : quota.optJSONObject("build").optInt("balance"));
            return me.optString("email") + "\n工程下载积分 " + export + "\nRPK 积分 " + build;
        }
        if ("market".equals(action)) {
            JSONArray rows = new JSONArray(body);
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                builder.append(row.optString("code")).append(" ").append(row.optString("name")).append(" ").append(row.optString("access")).append("\n");
            }
            return builder.length() == 0 ? "商城里没有组件" : builder.toString();
        }
        if ("listJobs".equals(action)) {
            JSONArray rows = new JSONArray(body);
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                builder.append(row.optString("kind")).append(" ").append(row.optString("status")).append(" ").append(row.optString("message")).append("\n");
            }
            return builder.length() == 0 ? "没有任务" : builder.toString();
        }
        return body;
    }

    private String errorOf(String body) {
        try {
            return new JSONObject(body).optString("error", body);
        } catch (Exception error) {
            return body;
        }
    }
}
