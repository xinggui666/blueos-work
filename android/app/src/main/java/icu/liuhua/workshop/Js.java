package icu.liuhua.workshop;

import org.json.JSONObject;

/** 生成回调页面脚本的 JS 片段（所有字符串都经过 JSON 转义）。 */
public final class Js {
    private Js() {}

    public static String resolve(String id, int status, String body) {
        return "window.__bwNative&&window.__bwNative.resolve(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(body == null ? "" : body) + ")";
    }

    public static String emit(String name, String json) {
        return "window.__bwNative&&window.__bwNative.emit(" + JSONObject.quote(name) + "," + JSONObject.quote(json == null ? "null" : json) + ")";
    }

    /** 平台接口请求体；payload 是页面 JSON.stringify 的结果，这里再解析一次，非法时退回空对象。 */
    public static String platformBody(String action, String payloadJson) {
        JSONObject body = new JSONObject();
        try {
            body.put("action", action);
            Object payload;
            try {
                payload = new JSONObject(payloadJson == null || payloadJson.isEmpty() ? "{}" : payloadJson);
            } catch (Exception notObject) {
                payload = new JSONObject();
            }
            body.put("payload", payload);
            body.put("client", "android");
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
        return body.toString();
    }
}
