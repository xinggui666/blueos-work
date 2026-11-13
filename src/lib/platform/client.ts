import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import type { Project } from "@/lib/blueos/model";
import { useStudio, useStudioHydrated } from "@/lib/blueos/store";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { OFFICIAL_ACCESS } from "./policy";
import { type ClientKind } from "@/lib/contract/surface";
import { platform } from "./functions";

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

function merge(local: Project, remote?: Project): Project {
  if (!remote) return local;
  const localRev = new Map(local.revisions.map((revision) => [revision.id, revision]));
  const remoteRev = new Map(remote.revisions.map((revision) => [revision.id, revision]));
  const revisions = local.updatedAt >= remote.updatedAt
    ? [...local.revisions, ...remote.revisions.filter((revision) => !localRev.has(revision.id))].slice(0, 30)
    : [...remote.revisions, ...local.revisions.filter((revision) => !remoteRev.has(revision.id))].slice(0, 30);
  const newer = local.updatedAt >= remote.updatedAt ? local : remote;
  return { ...newer, revisions };
}

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
      await call("syncProject", { project });
      sent.set(project.id, key);
      known.add(project.id);
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
        for (const project of useStudio.getState().projects) map.set(project.id, merge(project, map.get(project.id)));
        const projects = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        useStudio.getState().setHydrated(projects);
        applying = false;
        if (stop) return;
        unsubscribe = useStudio.subscribe((state, previous) => {
          if (applying || state.projects === previous.projects) return;
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void flush(), 700);
        });
        for (const project of projects) {
          const key = JSON.stringify(project);
          await call("syncProject", { project });
          if (stop) return;
          sent.set(project.id, key);
          known.add(project.id);
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
