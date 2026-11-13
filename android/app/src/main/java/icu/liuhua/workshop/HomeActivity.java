package icu.liuhua.workshop;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

public class HomeActivity extends Activity {
    private LinearLayout list;
    private TextView status;
    private JSONArray projects = new JSONArray();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 32, 32, 32);
        LinearLayout bar = new LinearLayout(this);
        bar.addView(action("刷新", () -> load(true)));
        bar.addView(action("新建", this::create));
        bar.addView(action("商城", () -> openList("market")));
        bar.addView(action("权益", () -> openList("me")));
        bar.addView(action("任务", () -> openList("listJobs")));
        bar.addView(action("退出", () -> {
            new Session(this).clearToken();
            startActivity(new Intent(this, LoginActivity.class));
            finish();
        }));
        status = new TextView(this);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(list);
        root.addView(bar);
        root.addView(status);
        root.addView(scroll);
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        load(true);
    }

    private void load(boolean network) {
        status.setText(network ? "正在读取工程…" : "显示本地缓存");
        new Thread(() -> {
            Session session = new Session(this);
            String cached = readCache();
            if (network && !session.token().isEmpty()) {
                try {
                    Api.Result result = Api.platform(session.baseUrl(), session.token(), "listProjects", new JSONObject());
                    if (result.code < 400) {
                        writeCache(result.body);
                        cached = result.body;
                    } else {
                        show(errorOf(result.body));
                    }
                } catch (Exception error) {
                    show("网络不可用，显示上次缓存");
                }
            }
            JSONArray rows = new JSONArray();
            try {
                if (cached.startsWith("[")) rows = new JSONArray(cached);
            } catch (Exception ignored) {
            }
            JSONArray ready = rows;
            runOnUiThread(() -> render(ready));
        }).start();
    }

    private void render(JSONArray rows) {
        projects = rows;
        list.removeAllViews();
        status.setText(rows.length() == 0 ? "没有工程" : "工程 " + rows.length() + " 个");
        for (int i = 0; i < rows.length(); i++) {
            JSONObject project = rows.optJSONObject(i);
            if (project == null) continue;
            Button open = new Button(this);
            open.setText(project.optString("name", "未命名"));
            open.setMinHeight(dp(48));
            open.setOnClickListener(v -> EditorActivity.open(this, project.toString()));
            list.addView(open);
        }
    }

    private void create() {
        status.setText("正在新建…");
        new Thread(() -> {
            try {
                Session session = new Session(this);
                JSONObject project = ProjectDraft.create();
                JSONObject payload = new JSONObject();
                payload.put("project", project);
                Api.Result result = Api.platform(session.baseUrl(), session.token(), "syncProject", payload);
                if (result.code >= 400) {
                    show(errorOf(result.body));
                    return;
                }
                runOnUiThread(() -> EditorActivity.open(this, project.toString()));
            } catch (Exception error) {
                show(error.getMessage() == null ? "新建失败" : error.getMessage());
            }
        }).start();
    }

    private void openList(String action) {
        Intent intent = new Intent(this, InfoActivity.class);
        intent.putExtra("action", action);
        startActivity(intent);
    }

    private Button action(String label, Runnable runnable) {
        Button button = new Button(this);
        button.setText(label);
        button.setMinHeight(dp(48));
        button.setOnClickListener(v -> runnable.run());
        return button;
    }

    private void show(String text) {
        runOnUiThread(() -> status.setText(text));
    }

    private String errorOf(String body) {
        try {
            return new JSONObject(body).optString("error", body);
        } catch (Exception error) {
            return body;
        }
    }

    private File cache() {
        return new File(getFilesDir(), "projects.json");
    }

    private String readCache() {
        try {
            if (!cache().exists()) return "[]";
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            try (FileInputStream in = new FileInputStream(cache())) {
                byte[] chunk = new byte[4096];
                int count;
                while ((count = in.read(chunk)) >= 0) buffer.write(chunk, 0, count);
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception error) {
            return "[]";
        }
    }

    private void writeCache(String body) {
        try (FileOutputStream out = new FileOutputStream(cache())) {
            out.write(body.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
