const FILES = [
  { href: "/downloads/blueos-server.zip", title: "服务器端源码", detail: "账号、工程、额度、后台、生成" },
  { href: "/downloads/blueos-client.zip", title: "客户端源码", detail: "当前网页编辑器，接口与桌面和 Android 共用" },
  { href: "/downloads/blueos-docs.zip", title: "开发文档", detail: "架构、接口、完成与未完成" },
  { href: "/downloads/blueos-planner.docx", title: "给策划的说明", detail: "功能、收费规则和不能对外承诺的部分" },
] as const;

export function DownloadBar() {
  return (
    <footer className="border-t border-line bg-white/70 pb-20 lg:pb-0">
      <div className="mx-auto grid w-full max-w-6xl gap-2 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        {FILES.map((file) => (
          <a key={file.href} href={file.href} download className="panel flex min-h-16 flex-col justify-center rounded-xl border border-line px-3 py-2">
            <span className="text-sm font-semibold">{file.title}</span>
            <span className="mt-1 text-xs leading-5 text-muted">{file.detail}</span>
          </a>
        ))}
      </div>
    </footer>
  );
}
