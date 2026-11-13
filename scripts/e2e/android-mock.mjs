/**
 * 在桌面 Chromium 里模拟 Android 原生桥（window.BlueOSNative），用来测试 APK 内置界面（android/app/src/main/assets/www）。
 * 页面地址和 APK 里一致：https://appassets.androidplatform.net/www/index.html，由 Playwright 路由从 assets 目录直接供给。
 * 网络请求由 Node 端转发到真实服务器（和原生一样带 Bearer 令牌、client=android）。
 * 这里只替代 Java 层；Java 层本身由 JVM 单元测试和模拟器测试覆盖。
 */
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/** 用 node:http 发请求：和 Android 的 HttpURLConnection 一样不带浏览器的 sec-fetch / Origin 头。 */
function rawRequest(method, url, body, headers) {
  return new Promise((done, fail) => {
    const target = new URL(url);
    const req = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => done({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8"), token: res.headers["set-auth-token"] ?? null }));
    });
    req.on("error", fail);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export const APP_URL = "https://appassets.androidplatform.net/www/index.html";
const WWW = resolve(import.meta.dirname, "../../android/app/src/main/assets/www");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

export async function installMockNative(context, { apiBase, versionCode = 10, versionName = "1.0.0" }) {
  const state = { online: true, token: "", base: "", user: null, email: "", saved: [] };

  await context.route("https://appassets.androidplatform.net/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/www/") || path.includes("..")) return route.fulfill({ status: 404, body: "" });
    try {
      const body = await readFile(join(WWW, path.slice(5) || "index.html"));
      await route.fulfill({ status: 200, body, contentType: MIME[extname(path)] ?? "application/octet-stream" });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });

  async function http(method, url, json, bearer) {
    if (!state.online) return { status: 0, body: "网络不可用或连不上服务器（模拟离线）", token: null };
    const headers = { accept: "application/json" };
    if (json !== undefined) headers["content-type"] = "application/json; charset=utf-8";
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    try {
      const res = await rawRequest(method, url, json, headers);
      return { status: res.status, body: res.text, token: res.token };
    } catch (error) {
      return { status: 0, body: `网络不可用或连不上服务器（${error.message}）`, token: null };
    }
  }

  await context.exposeBinding("__bwHost", async (_source, op, args) => {
    if (op === "call") {
      const [action, payloadJson] = args;
      if (!state.token) return [401, '{"error":"Unauthorized"}'];
      const body = JSON.stringify({ action, payload: JSON.parse(payloadJson || "{}"), client: "android" });
      const r = await http("POST", `${state.base}/api/v1/platform`, body, state.token);
      return [r.status, r.body];
    }
    if (op === "signIn") {
      const [rawBase, email, password, register, name] = args;
      const base = rawBase.trim().replace(/\/+$/, "");
      if (!/^https?:\/\//.test(base)) return [400, JSON.stringify({ message: "服务器地址必须以 https:// 开头" })];
      if (register) {
        const r = await http("POST", `${base}/api/auth/sign-up/email`, JSON.stringify({ email, password, name }));
        if (r.status !== 200) return [r.status, r.body];
      }
      const r = await http("POST", `${base}/api/auth/sign-in/email`, JSON.stringify({ email, password }));
      if (r.status !== 200 || !r.token) return [r.status, r.body];
      const me = await http("GET", `${base}/api/auth/get-session`, undefined, r.token);
      const user = JSON.parse(me.body).user;
      Object.assign(state, { base, token: r.token, user: { id: user.id, name: user.name, email: user.email }, email: user.email });
      return [200, "{}"];
    }
    if (op === "signOut") {
      state.token = "";
      state.user = null;
      return [200, ""];
    }
    if (op === "saveFile") {
      const [fileName, mime, base64] = args;
      state.saved.push({ fileName, mime, bytes: Buffer.from(base64, "base64") });
      return [200, ""];
    }
    if (op === "__state") return { signedIn: Boolean(state.token && state.user), base: state.base, user: state.user, online: state.online };
    return [400, "unknown op"];
  });

  // 同步方法（session/online/appInfo）需要同步返回：Node 状态在每次页面加载前注入，变化时推送。
  await context.addInitScript(
    ({ versionCode, versionName }) => {
      const s = () => window.__bwMockState || { signedIn: false, base: "", user: null, expired: false, online: true };
      const resolveLater = (id, p) => p.then(([status, body]) => window.__bwNative?.resolve(id, status, body));
      window.BlueOSNative = {
        call: (id, action, payload) => resolveLater(id, window.__bwHost("call", [action, payload])),
        signIn: (id, base, email, password, register, name) =>
          resolveLater(
            id,
            window.__bwHost("signIn", [base, email, password, register, name]).then(async (r) => {
              if (r[0] === 200) {
                window.__bwMockState = await window.__bwHost("__state", []);
                sessionStorage.setItem("__bwMockState", JSON.stringify(window.__bwMockState));
              }
              return r;
            }),
          ),
        signOut: () => {
          window.__bwMockState = { ...s(), signedIn: false, user: null };
          sessionStorage.setItem("__bwMockState", JSON.stringify(window.__bwMockState));
          void window.__bwHost("signOut", []);
        },
        session: () => JSON.stringify({ signedIn: s().signedIn, base: s().base, user: s().user, expired: false }),
        online: () => s().online,
        appInfo: () => JSON.stringify({ versionName, versionCode, debug: true, packageName: "icu.liuhua.workshop.debug", sdk: 34, device: "playwright" }),
        saveFile: (id, name, mime, b64) => resolveLater(id, window.__bwHost("saveFile", [name, mime, b64])),
        installUpdate: (id) => window.__bwNative?.resolve(id, 400, "模拟环境不安装"),
        openExternal: () => {},
      };
    },
    { versionCode, versionName },
  );

  const snapshot = () => ({ signedIn: Boolean(state.token && state.user), base: state.base, user: state.user, online: state.online });
  // 页面每次加载前把原生状态写进去（模拟同步读取）。
  await context.addInitScript(() => {
    try {
      const raw = sessionStorage.getItem("__bwMockState");
      if (raw) window.__bwMockState = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  });

  return {
    state,
    snapshot,
    /** 把最新原生状态写入页面（下一次加载也生效）。 */
    async sync(page) {
      const snap = snapshot();
      await page.evaluate((value) => {
        window.__bwMockState = value;
        sessionStorage.setItem("__bwMockState", JSON.stringify(value));
      }, snap);
    },
    async setOnline(page, online) {
      state.online = online;
      await this.sync(page);
      await page.evaluate((value) => window.__bwNative?.emit("network", JSON.stringify({ online: value })), online);
    },
  };
}
