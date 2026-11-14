import "@/styles.css";
import { hasNative, loadSession, saveFile } from "./bridge";

async function boot() {
  try {
    if (!hasNative()) throw new Error("native bridge missing");
    if (typeof structuredClone !== "function") {
      window.__bwBoot?.fail("UNSUPPORTED");
      return;
    }
    loadSession(); // Must validate identity before the persisted editor is imported.
    (globalThis as { __bwSaveFile?: typeof saveFile }).__bwSaveFile = saveFile;
    let app;
    try {
      app = await import("./app");
    } catch {
      window.__bwBoot?.fail("APP_CHUNK");
      return;
    }
    app.mount(document.getElementById("root")!);
  } catch (error) {
    window.__bwBoot?.fail(
      error instanceof Error && "code" in error && error.code === "BW_BRIDGE_V1_SESSION"
        ? "SESSION"
        : "STARTUP",
    );
  }
}
void boot();
