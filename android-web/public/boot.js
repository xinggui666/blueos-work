/* Standalone ES5 boot watchdog: must work even if the module entry cannot load/parse. No storage mutation. */
(function () {
  "use strict";
  /** @param {string} id */
  function element(id) {
    var node = document.getElementById(id);
    if (!node) throw new Error("Boot layout unavailable");
    return node;
  }
  var panel = element("bw-boot"),
    ready = false;
  /** @type {string | null} */
  var failureCode = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  var timer;
  /** @type {Record<string,string>} */
  var descriptions = {
    APP_CHUNK:
      "内置编辑器资源未能加载。请保留数据重试；仍失败请报告诊断码并核对安装包和系统 WebView。",
    ENTRY_LOAD: "启动脚本未能加载。请保留数据重新载入，不要清除应用数据。",
    STARTUP: "编辑器启动遇到错误。没有自动清除草稿或会话，请保留数据重试。",
    SESSION: "原生会话数据格式异常。为避免串用账号，已停止加载；未删除任何草稿或登录信息。",
    UNSUPPORTED:
      "系统 WebView 缺少必需能力（structuredClone）。请更新系统 WebView/Chrome；本机草稿没有清除。",
    TIMEOUT: "启动超过等待时间。设备可能仍在加载，请稍候或保留数据重试。",
    RENDER: "编辑器渲染遇到错误，已停止显示。已保存草稿保留，重试前注意尚未保存的状态。",
  };
  /** @param {string} code */
  function fail(code) {
    if (!Object.prototype.hasOwnProperty.call(descriptions, code)) code = "STARTUP";
    clearTimeout(timer);
    failureCode = code;
    ready = false;
    panel.hidden = false;
    panel.setAttribute("role", "alert");
    element("bw-boot-title").textContent = "工坊启动或显示失败";
    element("bw-boot-message").textContent = descriptions[code];
    element("bw-boot-code").textContent = "BW_BOOT_V1_" + code;
    element("root").setAttribute("aria-hidden", "true");
  }
  window.__bwBoot = {
    fail: fail,
    ready: function () {
      if (failureCode && failureCode !== "TIMEOUT") return;
      failureCode = null;
      ready = true;
      clearTimeout(timer);
      panel.hidden = true;
      var root = element("root");
      root.removeAttribute("aria-hidden");
      root.setAttribute("aria-busy", "false");
    },
  };
  try {
    if (window.BlueOSNative) {
      var info = JSON.parse(window.BlueOSNative.appInfo());
      element("bw-boot-env").textContent =
        "APK " +
        String(info.versionName).slice(0, 40) +
        " (" +
        String(info.versionCode).slice(0, 12) +
        ") · Bridge " +
        String(info.bridgeVersion || "legacy") +
        " · Android API " +
        String(info.sdk) +
        " · WebView " +
        String(info.webViewVersion || "未知").slice(0, 60);
    }
  } catch (ignored) {
    element("bw-boot-env").textContent = "版本信息不可读：BW_BRIDGE_V1_INFO";
  }
  window.addEventListener(
    "error",
    function (event) {
      if (ready) return;
      var target = event.target;
      // Styles/images alone must not destroy a usable app. Never display raw errors or private URLs.
      if (target instanceof HTMLScriptElement) fail("ENTRY_LOAD");
      else if (target === window) fail("STARTUP");
    },
    true,
  );
  window.addEventListener("unhandledrejection", function () {
    if (!ready) fail("STARTUP");
  });
  element("bw-boot-retry").addEventListener("click", function (event) {
    event.preventDefault();
    if (
      !window.confirm(
        "将保留本机已保存草稿与登录信息重新加载。尚未保存的界面状态可能丢失，原生文件或安装操作可能仍在进行。确认重试？",
      )
    )
      return;
    try {
      if (window.BlueOSNative && typeof window.BlueOSNative.reloadBundledApp === "function") {
        window.BlueOSNative.reloadBundledApp();
        return;
      }
    } catch (ignored) {
      /* Older/broken bridge: full same-origin document reload below. */
    }
    var next = new URL(window.location.href);
    next.searchParams.set("bw_boot_retry", String(Date.now()));
    window.location.replace(next.href);
  });
  timer = setTimeout(function () {
    if (!ready) fail("TIMEOUT");
  }, 15000);
})();
