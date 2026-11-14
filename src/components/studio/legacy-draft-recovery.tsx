import { useState } from "react";
import { useStudio } from "@/lib/blueos/store";
import { recoverUnownedLegacy } from "@/lib/platform/legacy-recovery";
export function LegacyDraftRecovery() {
  const [message, setMessage] = useState("");
  return (
    <section className="mt-4 rounded-md border border-line p-3 text-sm" aria-label="旧草稿恢复">
      <button
        type="button"
        className="rounded-md border border-line px-3 py-2"
        onClick={() => {
          try {
            const count = recoverUnownedLegacy(
              localStorage,
              (m) => window.confirm(m),
              (projects) =>
                useStudio.setState({ projects: [...projects, ...useStudio.getState().projects] }),
            );
            setMessage(
              count
                ? `已恢复 ${count} 个新副本；旧缓存仍然保留。`
                : "已取消，或没有可恢复的无归属旧草稿。",
            );
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "恢复失败，旧缓存未删除");
          }
        }}
      >
        恢复旧版草稿
      </button>
      <p className="mt-2 text-muted">
        不会自动认领任何旧数据。需两次确认本人归属及当前账号/服务器后才导入；带原账号标记的数据不会被读取。
      </p>
      {message ? (
        <p role="status" className="mt-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
