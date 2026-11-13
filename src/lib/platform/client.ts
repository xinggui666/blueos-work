import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import type { Project } from "@/lib/blueos/model";
import { useStudio, useStudioHydrated } from "@/lib/blueos/store";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { OFFICIAL_ACCESS } from "./policy";
import { type ClientKind } from "@/lib/contract/surface";
import { platform } from "./functions";
import { projectToDoc, toNative } from "@/lib/protocol/editor";
import { uid } from "@/lib/blueos/model";

export function call<T>(action: string, payload?: unknown, client: ClientKind = "web"): Promise<T> {
  return platform({ data: { action, payload: payload ?? {}, client } }) as Promise<T>;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

type Cloud = { ready: boolean; status: "idle" | "saving" | "saved" | "error"; detail: string };
let cloud: Cloud = { ready: false, status: "idle", detail: "" };
const listeners = new Set<() => void>();

function setCloud(next: Cloud) {
  cloud = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCloud() {
  return useSyncExternalStore(subscribe, () => cloud, () => cloud);
}

let paletteCache: Record<string, string> | null = null;
const paletteListeners = new Set<() => void>();

function setPalette(next: Record<string, string>) {
  paletteCache = next;
  paletteListeners.forEach((listener) => listener());
}

export function useComponentLock() {
  const palette = useSyncExternalStore(
    (listener) => {
      paletteListeners.add(listener);
      return () => paletteListeners.delete(listener);
    },
    () => paletteCache,
    () => null,
  );
  return (type: string) => {
    if (!palette) return OFFICIAL_ACCESS[type] === "public_free" ? null : "正在核对权益";
    if (!(type in palette)) return "这个组件未上架";
    return palette[type] || null;
  };
}

/** 本机最后一次与云端确认一致的内容（按工程），用于判断离线修改和冲突。 */
const SYNC_KEY = "blueos-sync-state-v2";
type SyncMark = { revision: number; key: string };
function readMarks(): Record<string, SyncMark> {
  try {
    return JSON.parse(localStorage.getItem(SYNC_KEY) || "{}") as Record<string, SyncMark>;
  } catch {
    return {};
  }
}
function writeMark(id: string, mark: SyncMark | null) {
  const marks = readMarks();
  if (mark) marks[id] = mark;
  else delete marks[id];
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(marks));
  } catch {
    // 存储满时不影响编辑
  }
}

/** 只看内容：忽略保存时间、本地快照和修订号。 */
export function contentKey(project: Project): string {
  try {
    const doc = projectToDoc(project);
    return JSON.stringify({ ...doc, project: { ...doc.project, createdAt: 0, updatedAt: 0, revision: 0 } });
  } catch {
    const { updatedAt: _u, revisions: _r, ...rest } = project;
    return JSON.stringify(rest);
  }
}

function revisionOf(project?: Project): number {
  return project?.protocolExtras?.revision ?? 0;
}

function conflictCopy(local: Project): Project {
  return { ...structuredClone(local), id: uid("j"), name: `${local.name.slice(0, 30)}（本机冲突副本）`, updatedAt: Date.now(), revisions: [], protocolExtras: local.protocolExtras ? { ...local.protocolExtras, revision: 0 } : undefined };
}

/**
 * 启动时合并本地与云端（规格 4.3：冲突保留双方，不直接覆盖较新数据）。
 * - 本地没改过（内容等于上次同步）→ 用云端。
 * - 本地改过、云端没变 → 用本地（随后上传）。
 * - 两边都改过 → 云端为主版本，本地另存为“冲突副本”。
 */
function merge(local: Project, remote: Project | undefined, mark: SyncMark | undefined): Project[] {
  if (!remote) return [local];
  const revisions = [...local.revisions, ...remote.revisions.filter((r) => !local.revisions.some((x) => x.id === r.id))].slice(0, 30);
  const localDirty = !mark || mark.key !== contentKey(local);
  const remoteMoved = !mark || revisionOf(remote) > mark.revision;
  if (!localDirty) return [{ ...remote, revisions }];
  if (contentKey(local) === contentKey(remote)) return [{ ...remote, revisions }];
  if (!remoteMoved) return [{ ...local, revisions, protocolExtras: local.protocolExtras ? { ...local.protocolExtras, revision: revisionOf(remote) } : local.protocolExtras }];
  // 两边内容不同且云端已前进（或旧版本地数据没有同步记录）：云端为主版本，本机另存副本，避免丢数据。
  return [{ ...remote, revisions }, conflictCopy(local)];
}

type SyncResult = { ok: true; revision: number; changed: boolean } | { ok: false; conflict: true; serverRevision: number; serverProject: Project; message: string };

export function CloudSync() {
  const { user } = useCurrentUserState();
  const hydrated = useStudioHydrated();
  useEffect(() => {
    if (!user || !hydrated) return;
    let stop = false;
    let timer = 0;
    let unsubscribe = () => {};
    const sent = new Map<string, string>();
    const known = new Set<string>();
    let applying = false;

    async function push(project: Project) {
      const key = JSON.stringify(project);
      if (sent.get(project.id) === key) return;
      setCloud({ ready: true, status: "saving", detail: "正在保存到云端" });
      const result = await call<SyncResult>("syncProject", { project });
      sent.set(project.id, key);
      known.add(project.id);
      if (!result.ok) {
        // 云端有其他设备的新版本：云端版本替换当前工程，本机内容另存为副本，两份都保留。
        const copy = conflictCopy(project);
        applying = true;
        const server = { ...result.serverProject, revisions: project.revisions };
        useStudio.getState().setHydrated(useStudio.getState().projects.flatMap((p) => (p.id === project.id ? [server, copy] : [p])));
        applying = false;
        writeMark(project.id, { revision: result.serverRevision, key: contentKey(server) });
        setCloud({ ready: true, status: "error", detail: `${result.message}：本机内容已另存为“${copy.name}”` });
        void flush();
        return;
      }
      // 本地工程总是原生协议模式（旧数据在 toNative 时转换），修订号记在 protocolExtras。
      const base = toNative(project) as Project;
      const extras = base.protocolExtras;
      if (extras && extras.revision !== result.revision) {
        const updated = { ...base, protocolExtras: { ...extras, revision: result.revision } };
        applying = true;
        useStudio.getState().setHydrated(useStudio.getState().projects.map((p) => (p.id === project.id && contentKey(p) === contentKey(project) ? updated : p)));
        applying = false;
        sent.set(project.id, JSON.stringify(updated));
        writeMark(project.id, { revision: result.revision, key: contentKey(updated) });
      } else writeMark(project.id, { revision: result.revision, key: contentKey(project) });
      setCloud({ ready: true, status: "saved", detail: "已保存到云端" });
    }

    async function flush() {
      if (applying || stop) return;
      const projects = useStudio.getState().projects;
      const ids = new Set(projects.map((project) => project.id));
      try {
        for (const id of known) {
          if (!ids.has(id)) {
            known.delete(id);
            sent.delete(id);
            await call("deleteProject", { id });
            writeMark(id, null);
          }
        }
        for (const project of projects) await push(project);
      } catch (error) {
        setCloud({ ready: true, status: "error", detail: errorText(error) });
      }
    }

    void (async () => {
      try {
        setCloud({ ready: false, status: "saving", detail: "正在同步云端工程" });
        const [remote, profile] = await Promise.all([
          call<Project[]>("listProjects"),
          call<{ palette: Record<string, string> }>("me"),
        ]);
        if (stop) return;
        setPalette(profile.palette);
        applying = true;
        const map = new Map(remote.map((project) => [project.id, project]));
        const marks = readMarks();
        const extra: Project[] = [];
        for (const project of useStudio.getState().projects) {
          const [main, ...copies] = merge(project, map.get(project.id), marks[project.id]);
          map.set(project.id, main);
          extra.push(...copies);
        }
        for (const project of remote) {
          const local = useStudio.getState().projects.find((p) => p.id === project.id);
          if (!local || contentKey(local) === contentKey(project)) writeMark(project.id, { revision: revisionOf(project), key: contentKey(map.get(project.id) ?? project) });
        }
        const projects = [...map.values(), ...extra].sort((a, b) => b.updatedAt - a.updatedAt);
        useStudio.getState().setHydrated(projects);
        applying = false;
        if (stop) return;
        unsubscribe = useStudio.subscribe((state, previous) => {
          if (applying || state.projects === previous.projects) return;
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void flush(), 700);
        });
        for (const project of projects) {
          await push(useStudio.getState().projects.find((p) => p.id === project.id) ?? project);
          if (stop) return;
        }
        setCloud({ ready: true, status: "saved", detail: "已保存到云端" });
      } catch (error) {
        setCloud({ ready: true, status: "error", detail: errorText(error) });
      }
    })();

    return () => {
      stop = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [hydrated, user?.id]);
  return null;
}

export function useMe<T>() {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    call<T>("me")
      .then((value) => {
        if (!live) return;
        setData(value);
        const palette = (value as { palette?: Record<string, string> }).palette;
        if (palette) setPalette(palette);
      })
      .catch((reason) => {
        if (live) setError(errorText(reason));
      });
    return () => {
      live = false;
    };
  }, [nonce]);
  return { data, error, reload: () => setNonce((value) => value + 1) };
}
