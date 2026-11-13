import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DownloadBar } from "@/components/platform/downloads";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    const result = mode === "up"
      ? await authClient.signUp.email({ email, password, name: name || "工坊用户", callbackURL: "/" })
      : await authClient.signIn.email({ email, password, callbackURL: "/" });
    setBusy(false);
    if (result.error) {
      setError(result.error.message || "登录失败");
      return;
    }
    void navigate({ to: "/" });
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md place-items-center px-4 py-8 pb-40">
      <div className="w-full">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg border border-line bg-surface">
            <span className="size-6 rounded-full border-2 border-accent" />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">BlueOS 工坊</p>
            <p className="text-sm text-muted">登录后才能保存应用、兑换权益和使用后台</p>
          </div>
        </div>
        {authEnabled ? (
          <form
            className="panel mt-6 w-full rounded-2xl border border-line p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              {(["up", "in"] as const).map((item) => (
                <button key={item} type="button" className={`min-h-11 rounded-md border text-sm ${mode === item ? "border-accent bg-accent text-accent-fg" : "border-line"}`} onClick={() => setMode(item)}>
                  {item === "up" ? "注册" : "登录"}
                </button>
              ))}
            </div>
            {mode === "up" ? (
              <label className="mt-4 block text-sm text-muted">
                名字
                <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg" />
              </label>
            ) : null}
            <label className="mt-3 block text-sm text-muted">
              邮箱
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg" />
            </label>
            <label className="mt-3 block text-sm text-muted">
              密码
              <input type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg" />
            </label>
            {error ? <p className="mt-3 text-sm text-warn">{error}</p> : null}
            <button type="submit" disabled={busy} className="mt-4 min-h-11 w-full rounded-md bg-accent text-sm font-semibold text-accent-fg disabled:opacity-60">
              {busy ? "请稍等…" : mode === "up" ? "创建账号" : "进入工坊"}
            </button>
            <div className="mt-4 grid gap-2">
              {GROK_PROVIDERS.map((provider) => (
                <button key={provider.providerId} type="button" className="min-h-11 rounded-md border border-line text-sm" onClick={() => signIn(provider.providerId, { callbackURL: "/" })}>
                  用 {provider.label} 继续
                </button>
              ))}
            </div>
          </form>
        ) : (
          <p className="mt-6 text-sm text-muted">登录还没打开。</p>
        )}
      </div>
      <div className="fixed inset-x-0 bottom-0">
        <DownloadBar />
      </div>
    </main>
  );
}
