package icu.liuhua.workshop;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class Api {
    public static final class Result {
        public final int code;
        public final String body;
        public final String token;

        Result(int code, String body, String token) {
            this.code = code;
            this.body = body;
            this.token = token;
        }
    }

    private Api() {}

    public static Result post(String url, String json, String bearer) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        if (bearer != null && !bearer.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + bearer);
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        try (OutputStream out = connection.getOutputStream()) {
            out.write(bytes);
        }
        int code = connection.getResponseCode();
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String body = read(stream);
        String token = connection.getHeaderField("set-auth-token");
        connection.disconnect();
        return new Result(code, body, token);
    }

    public static Result platform(String base, String token, String action, JSONObject payload) throws Exception {
        JSONObject body = new JSONObject();
        body.put("action", action);
        body.put("payload", payload == null ? new JSONObject() : payload);
        body.put("client", "android");
        return post(Session.trimSlash(base) + "/api/v1/platform", body.toString(), token);
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) builder.append(line);
        reader.close();
        return builder.toString();
    }
}
