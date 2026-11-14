/**
 * Android 客户端内置界面的构建配置（`npm run build:android-web`）。
 *
 * 复用网页工坊的编辑器、逻辑编辑器、预览解释器、商城、权益和任务组件，打成纯静态页面放进 APK
 * （android/app/src/main/assets/www），离线也能打开。三个模块在这里换成 Android 版：
 *   - src/lib/platform/functions.ts   → 原生桥发 HTTP（令牌只在原生侧）
 *   - src/lib/auth/use-current-user.ts → 原生保存的会话
 *   - src/lib/auth/gates.tsx           → 不引入 Better Auth 浏览器客户端
 */
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = import.meta.dirname;
const SWAPS: Record<string, string> = {
  [resolve(root, "src/lib/platform/functions.ts")]: resolve(root, "android-web/shims/functions.ts"),
  [resolve(root, "src/lib/auth/use-current-user.ts")]: resolve(root, "android-web/shims/use-current-user.ts"),
  [resolve(root, "src/lib/auth/gates.tsx")]: resolve(root, "android-web/shims/gates.tsx"),
};

function swapModules(): Plugin {
  return {
    name: "bw-android-swap",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(resolve(root, "android-web/shims"))) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && SWAPS[resolved.id]) return SWAPS[resolved.id];
      return null;
    },
  };
}

/** 安装包不连外网字体：去掉样式里的 Google Fonts 引用，用系统字体。 */
function noRemoteFonts(): Plugin {
  return {
    name: "bw-android-no-remote-fonts",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("src/styles.css")) return null;
      // 界面根目录是 android-web/，要让 Tailwind 同时扫描共享的 src/ 组件。
      return code
        .replace(/@import url\("https:\/\/fonts\.googleapis\.com[^)]*\);?/g, "")
        .replace('@import "tailwindcss";', `@import "tailwindcss";\n@source "${resolve(root, "src")}";\n@source "${resolve(root, "android-web")}";`);
    },
  };
}

export default defineConfig({
  root: resolve(root, "android-web"),
  base: "./",
  publicDir: "public",
  resolve: { alias: { "@": resolve(root, "src") } },
  define: {
    "import.meta.env.VITE_AUTH_ENABLED": JSON.stringify("true"),
  },
  plugins: [swapModules(), noRemoteFonts(), tailwindcss(), viteReact()],
  build: {
    outDir: resolve(root, "android/app/src/main/assets/www"),
    emptyOutDir: true,
    target: "chrome87",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
