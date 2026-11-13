package icu.liuhua.workshop;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

public class EditorActivity extends Activity {
    private JSONObject project;
    private int pageIndex;
    private int selected = -1;
    private FaceView face;
    private EditText name;
    private TextView status;

    public static void open(Context context, String json) {
        Intent intent = new Intent(context, EditorActivity.class);
        intent.putExtra("project", json);
        context.startActivity(intent);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            project = new JSONObject(getIntent().getStringExtra("project"));
        } catch (Exception error) {
            finish();
            return;
        }
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        LinearLayout bar = new LinearLayout(this);
        bar.addView(button("加文字", () -> add("text", "文字")));
        bar.addView(button("加按钮", () -> add("button", "按钮")));
        bar.addView(button("保存", this::save));
        bar.addView(button("工程包", this::exportBundle));
        bar.addView(button("RPK", this::requestBuild));
        name = new EditText(this);
        name.setHint("选中组件的名称");
        status = new TextView(this);
        face = new FaceView(this);
        face.setListener(new FaceView.Listener() {
            @Override
            public void onPick(int index) {
                selected = index;
                JSONObject node = node();
                name.setText(node == null ? "" : node.optString("name"));
            }

            @Override
            public void onMove(int index, int x, int y) {
                JSONObject node = nodes().optJSONObject(index);
                if (node == null) return;
                try {
                    node.put("x", x);
                    node.put("y", y);
                    project.put("updatedAt", System.currentTimeMillis());
                } catch (Exception ignored) {
                }
                draw();
            }
        });
        name.setOnFocusChangeListener((view, focused) -> {
            if (!focused) rename();
        });
        root.addView(bar);
        root.addView(name);
        root.addView(status);
        root.addView(face, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        draw();
    }

    private void draw() {
        face.setNodes(nodes(), selected);
    }

    private JSONArray nodes() {
        JSONObject page = project.optJSONArray("pages") == null ? null : project.optJSONArray("pages").optJSONObject(pageIndex);
        if (page == null) return new JSONArray();
        JSONArray nodes = page.optJSONArray("nodes");
        return nodes == null ? new JSONArray() : nodes;
    }

    private JSONObject node() {
        return nodes().optJSONObject(selected);
    }

    private void rename() {
        JSONObject node = node();
        if (node == null) return;
        try {
            node.put("name", name.getText().toString());
            draw();
        } catch (Exception ignored) {
        }
    }

    private void add(String type, String label) {
        try {
            JSONObject node = new JSONObject();
            node.put("id", ProjectDraft.id("n"));
            node.put("type", type);
            node.put("name", label);
            node.put("x", 40 + nodes().length() * 12);
            node.put("y", 160);
            node.put("w", type.equals("button") ? 180 : 220);
            node.put("h", 64);
            node.put("locked", false);
            node.put("hidden", false);
            JSONObject props = new JSONObject();
            if (type.equals("button")) props.put("value", label);
            else props.put("text", label);
            node.put("props", props);
            node.put("actions", new JSONArray());
            nodes().put(node);
            selected = nodes().length() - 1;
            draw();
        } catch (Exception error) {
            status.setText("添加失败");
        }
    }

    private void save() {
        rename();
        status.setText("正在保存…");
        new Thread(() -> {
            try {
                Session session = new Session(this);
                JSONObject payload = new JSONObject();
                payload.put("project", project);
                Api.Result result = Api.platform(session.baseUrl(), session.token(), "syncProject", payload);
                show(result.code >= 400 ? errorOf(result.body) : "已保存到云端");
            } catch (Exception error) {
                show(error.getMessage() == null ? "保存失败，本地修改还在这个页面里" : error.getMessage());
            }
        }).start();
    }

    private void exportBundle() {
        status.setText("正在准备工程包…");
        call("exportBundle", payload -> payload.put("project", project), result -> {
            try {
                JSONObject json = new JSONObject(result.body);
                show(json.optString("fileName", "工程包") + " " + json.optString("sha256", ""));
            } catch (Exception error) {
                show(result.body);
            }
        });
    }

    private void requestBuild() {
        status.setText("正在询问 RPK…");
        call("requestBuild", payload -> payload.put("projectId", project.optString("id")), result -> {
            try {
                show(new JSONObject(result.body).optString("message", result.body));
            } catch (Exception error) {
                show(result.body);
            }
        });
    }

    private interface Fill {
        void apply(JSONObject payload) throws Exception;
    }

    private void call(String action, Fill fill, java.util.function.Consumer<Api.Result> done) {
        new Thread(() -> {
            try {
                Session session = new Session(this);
                JSONObject payload = new JSONObject();
                fill.apply(payload);
                Api.Result result = Api.platform(session.baseUrl(), session.token(), action, payload);
                runOnUiThread(() -> {
                    if (result.code >= 400) status.setText(errorOf(result.body));
                    else done.accept(result);
                });
            } catch (Exception error) {
                show(error.getMessage() == null ? "请求失败" : error.getMessage());
            }
        }).start();
    }

    private Button button(String label, Runnable runnable) {
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

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
