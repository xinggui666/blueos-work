package icu.liuhua.workshop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.json.JSONObject;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

public class RulesTest {
    @Test
    public void baseUrlNormalizesAndEnforcesHttps() {
        assertEquals("https://work.example.com", UrlRules.normalizeBase(" work.example.com/ ", false));
        assertEquals("https://a.b/sub", UrlRules.normalizeBase("https://a.b/sub//", false));
        assertEquals("http://10.0.2.2:3980", UrlRules.normalizeBase("http://10.0.2.2:3980", true));
        expectBad("http://10.0.2.2:3980", false);
        expectBad("", false);
        expectBad("ftp://a.b", true);
        expectBad("https://a.b/?x=1", false);
        expectBad("https://user:pw@a.b", false);
    }

    private static void expectBad(String raw, boolean allowHttp) {
        try {
            UrlRules.normalizeBase(raw, allowHttp);
            fail("应拒绝 " + raw);
        } catch (IllegalArgumentException expected) {
            assertFalse(expected.getMessage().isEmpty());
        }
    }

    @Test
    public void downloadsAndActions() {
        assertTrue(UrlRules.downloadAllowed("https://x/y.apk", false));
        assertFalse(UrlRules.downloadAllowed("http://x/y.apk", false));
        assertTrue(UrlRules.downloadAllowed("http://x/y.apk", true));
        assertFalse(UrlRules.downloadAllowed("file:///sdcard/y.apk", true));
        assertTrue(UrlRules.validAction("syncProject"));
        assertFalse(UrlRules.validAction("../x"));
        assertFalse(UrlRules.validAction("a"));
    }

    @Test
    public void assetRoutesOnlyServeBundledPages() {
        assertEquals("www/index.html", AssetRoutes.assetPath("https", AssetRoutes.HOST, "/www/index.html"));
        assertEquals("www/assets/app.js", AssetRoutes.assetPath("https", AssetRoutes.HOST, "/www/assets/app.js"));
        assertEquals("www/index.html", AssetRoutes.assetPath("https", AssetRoutes.HOST, "/www/"));
        assertNull(AssetRoutes.assetPath("https", AssetRoutes.HOST, "/www/../secret"));
        assertNull(AssetRoutes.assetPath("https", AssetRoutes.HOST, "/other/x"));
        assertNull(AssetRoutes.assetPath("http", AssetRoutes.HOST, "/www/index.html"));
        assertNull(AssetRoutes.assetPath("https", "evil.example", "/www/index.html"));
        assertEquals("text/javascript", AssetRoutes.mime("www/a.js"));
        assertEquals("text/css", AssetRoutes.mime("www/a.CSS"));
        assertEquals("application/octet-stream", AssetRoutes.mime("www/a.bin"));
    }

    @Test
    public void sha256() throws Exception {
        String abc = Hashes.sha256(new ByteArrayInputStream("abc".getBytes(StandardCharsets.UTF_8)));
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", abc);
        assertTrue(Hashes.same(abc, " " + abc.toUpperCase() + " "));
        assertFalse(Hashes.same(abc, abc.substring(1) + "0"));
        assertTrue(Hashes.isSha256(abc));
        assertFalse(Hashes.isSha256("xyz"));
    }

    @Test
    public void jsCallbacksAreEscaped() throws Exception {
        String script = Js.resolve("r1", 200, "a\"b</script>\n\u2028");
        assertTrue(script.startsWith("window.__bwNative&&window.__bwNative.resolve(\"r1\",200,"));
        assertFalse(script.contains("\n"));
        assertFalse(script.contains("</script>"));
        JSONObject body = new JSONObject(Js.platformBody("me", "{\"a\":1}"));
        assertEquals("me", body.getString("action"));
        assertEquals("android", body.getString("client"));
        assertEquals(1, body.getJSONObject("payload").getInt("a"));
        assertEquals(0, new JSONObject(Js.platformBody("me", "not json")).getJSONObject("payload").length());
    }
}
