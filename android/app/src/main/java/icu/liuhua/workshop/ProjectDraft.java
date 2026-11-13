package icu.liuhua.workshop;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Random;

public final class ProjectDraft {
    private ProjectDraft() {}

    public static JSONObject create() throws Exception {
        String pageId = id("p");
        JSONObject node = new JSONObject();
        node.put("id", id("n"));
        node.put("type", "text");
        node.put("name", "标题");
        node.put("x", 80);
        node.put("y", 80);
        node.put("w", 220);
        node.put("h", 64);
        node.put("locked", false);
        node.put("hidden", false);
        JSONObject props = new JSONObject();
        props.put("text", "你好");
        props.put("color", "#1C1916");
        props.put("fontSize", 32);
        node.put("props", props);
        node.put("actions", new JSONArray());
        JSONObject page = new JSONObject();
        page.put("id", pageId);
        page.put("name", "Home");
        page.put("background", "#F5F5F7");
        page.put("nodes", new JSONArray().put(node));
        JSONObject project = new JSONObject();
        project.put("id", id("j"));
        project.put("name", "安卓工程");
        project.put("appName", "安卓工程");
        project.put("packageName", "com.example.app");
        project.put("device", "watch-round");
        project.put("designWidth", 466);
        project.put("updatedAt", System.currentTimeMillis());
        project.put("startPageId", pageId);
        project.put("nav", new JSONObject().put("kind", "none").put("items", new JSONArray()));
        project.put("variables", new JSONArray());
        project.put("functions", new JSONArray());
        project.put("timeBindings", new JSONArray());
        project.put("templateId", "blank");
        project.put("pages", new JSONArray().put(page));
        project.put("revisions", new JSONArray());
        return project;
    }

    public static String id(String prefix) {
        String alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
        Random random = new Random();
        StringBuilder builder = new StringBuilder(prefix);
        for (int i = 0; i < 8; i++) builder.append(alphabet.charAt(random.nextInt(alphabet.length())));
        return builder.toString();
    }
}
