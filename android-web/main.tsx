import "@/styles.css";
import { hasNative, loadSession, saveFile } from "./bridge";
import { swapUserStorage } from "./storage";

/**
 * 启动顺序很重要：先按当前登录用户切换本机缓存，再加载编辑器状态（zustand persist 在模块加载时读 localStorage）。
 * 所以 app 模块用动态 import，保证切换发生在前面。
 */
function boot() {
  const root = document.getElementById("root")!;
  if (!hasNative()) {
    root.innerHTML = '<p style="padding:24px;font:14px sans-serif">这个页面只能在 BlueOS 工坊 Android 客户端里运行。</p>';
    return;
  }
  const session = loadSession();
  if (session.signedIn && session.user) swapUserStorage(localStorage, session.user.id);
  (globalThis as { __bwSaveFile?: typeof saveFile }).__bwSaveFile = (name, mime, base64) => saveFile(name, mime, base64);
  void import("./app").then(({ mount }) => mount(root));
}

boot();
