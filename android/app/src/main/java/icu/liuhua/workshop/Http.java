package icu.liuhua.workshop;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** 简单 HTTP 客户端。网络错误返回 status 0，不抛异常。 */
public final class Http {
    public static final class Result {
        public final int status;
        public final String body;
        public final String token;

        Result(int status, String body, String token) {
            this.status = status;
            this.body = body;
            this.token = token;
        }
    }

    private Http() {}

    public static Result request(String method, String url, String json, String bearer) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "BlueOSWorkshop-Android/" + BuildConfig.VERSION_NAME);
            if (bearer != null && !bearer.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + bearer);
            if (json != null) {
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int code = connection.getResponseCode();
            InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            return new Result(code, read(stream), connection.getHeaderField("set-auth-token"));
        } catch (IOException error) {
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            if (message.contains("CLEARTEXT")) message = "正式版不允许 http 明文连接，请使用 https 服务器地址";
            else message = "网络不可用或连不上服务器（" + message + "）";
            return new Result(0, message, null);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static String read(InputStream stream) throws IOException {
        if (stream == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = stream.read(buffer)) > 0) out.write(buffer, 0, read);
        stream.close();
        return out.toString("UTF-8");
    }
}
