/** Explicit recovery only: never claim an old owner-tagged cache for another login. */
import { normalizeProject, uid, type Project } from "../blueos/model.ts";
import { toNative, projectToDoc } from "../protocol/editor.ts";
import { ProjectDocSchema } from "../protocol/schema.ts";
import { workspace, isCurrent, type KV } from "./workspace.ts";
export function recoverUnownedLegacy(
  store: KV,
  confirm: (message: string) => boolean,
  commit: (projects: Project[]) => void,
): number {
  const scope = workspace();
  if (!scope) throw new Error("请先登录并等待当前工作空间加载");
  if (store.getItem("bw-owner"))
    throw new Error(
      "旧缓存带有账号归属标记，不可作为无归属草稿认领。未读取或改动其内容，请核对原账号及服务器。",
    );
  if (
    !confirm(
      `旧缓存没有可验证的账号或服务器归属。仅在确认草稿属于你本人时继续。当前服务器：${scope.origin}；当前用户ID：${scope.userId}。是否检查本人旧草稿？`,
    )
  )
    return 0;
  const raw = store.getItem("blueos-studio-v1");
  if (!raw) return 0;
  if (raw.length > 10_000_000) throw new Error("旧缓存过大，请先备份后分批恢复；原数据未改动");
  const parsed = JSON.parse(raw) as { state?: { projects?: unknown[] } };
  if (!Array.isArray(parsed.state?.projects) || parsed.state.projects.length > 100)
    throw new Error("旧缓存格式或数量异常，原数据已保留");
  const projects = parsed.state.projects.map((input) => {
    if (!input || typeof input !== "object" || !Array.isArray((input as Project).pages))
      throw new Error("旧工程结构损坏，原数据已保留");
    const project = toNative(normalizeProject(structuredClone(input) as Project)) as Project;
    ProjectDocSchema.parse(projectToDoc(project));
    return {
      ...project,
      id: uid("j"),
      name: `${project.name.slice(0, 30)}（旧草稿恢复）`,
      updatedAt: Date.now(),
      revisions: [],
      protocolExtras: project.protocolExtras
        ? { ...project.protocolExtras, revision: 0 }
        : undefined,
    };
  });
  if (!projects.length) return 0;
  if (
    !confirm(
      `已检查 ${projects.length} 个旧草稿：\n${projects
        .slice(0, 10)
        .map((p) => p.name)
        .join(
          "\n",
        )}\n将作为新副本加入当前账号，并由云同步上传到 ${scope.origin}。不会覆盖现有工程或删除旧缓存；重复恢复会再建副本。确认这些都是你本人的草稿并导入？`,
    )
  )
    return 0;
  if (!isCurrent(scope)) throw new Error("账号或服务器已切换，恢复已停止，原数据未改动");
  commit(projects);
  return projects.length;
}
