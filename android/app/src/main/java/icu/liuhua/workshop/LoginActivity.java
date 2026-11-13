package icu.liuhua.workshop;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

public class LoginActivity extends Activity {
    private EditText base;
    private EditText email;
    private EditText password;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Session session = new Session(this);
        LinearLayout root = form();
        base = field("服务器地址，例如 https://example.com");
        base.setText(session.baseUrl());
        email = field("邮箱");
        password = field("密码");
        password.setInputType(129);
        status = new TextView(this);
        Button login = button("登录");
        Button signup = button("注册");
        root.addView(base);
        root.addView(email);
        root.addView(password);
        root.addView(login);
        root.addView(signup);
        root.addView(status);
        setContentView(root);
        if (!session.token().isEmpty()) openHome();
        login.setOnClickListener(v -> auth(false));
        signup.setOnClickListener(v -> auth(true));
    }

    private void auth(boolean register) {
        String origin = Session.trimSlash(base.getText().toString());
        String mail = email.getText().toString().trim();
        String pass = password.getText().toString();
        if (origin.isEmpty() || mail.isEmpty() || pass.isEmpty()) {
            status.setText("请填写服务器、邮箱和密码");
            return;
        }
        status.setText(register ? "正在注册…" : "正在登录…");
        new Thread(() -> {
            try {
                if (register) {
                    JSONObject body = new JSONObject();
                    body.put("email", mail);
                    body.put("password", pass);
                    body.put("name", mail);
                    Api.Result created = Api.post(origin + "/api/auth/sign-up/email", body.toString(), null);
                    if (created.code >= 400) {
                        show(errorOf(created.body));
                        return;
                    }
                }
                JSONObject body = new JSONObject();
                body.put("email", mail);
                body.put("password", pass);
                Api.Result signed = Api.post(origin + "/api/auth/sign-in/email", body.toString(), null);
                if (signed.token == null || signed.token.isEmpty()) {
                    show(signed.code + " " + errorOf(signed.body));
                    return;
                }
                new Session(this).save(origin, signed.token);
                runOnUiThread(this::openHome);
            } catch (Exception error) {
                show(error.getMessage() == null ? "网络失败" : error.getMessage());
            }
        }).start();
    }

    private void openHome() {
        startActivity(new Intent(this, HomeActivity.class));
        finish();
    }

    private void show(String text) {
        runOnUiThread(() -> status.setText(text));
    }

    private String errorOf(String body) {
        try {
            JSONObject json = new JSONObject(body);
            if (json.has("message")) return json.getString("message");
            if (json.has("error")) return json.getString("error");
        } catch (Exception ignored) {
        }
        return body == null || body.isEmpty() ? "登录失败" : body;
    }

    private LinearLayout form() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 48, 48, 48);
        return root;
    }

    private EditText field(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setMinHeight(dp(48));
        return input;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setMinHeight(dp(48));
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
