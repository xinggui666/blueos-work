import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  makeFromTemplate,
  makeNode,
  makePage,
  normalizeProject,
  restoreSnapshot,
  snapshotOf,
  uid,
  MAX_PAGES,
    type CompType,
  type DeviceShape,
  type NavKind,
  type Project,
  type PropMap,
  type SceneNode,
  type TemplateId,
} from "./model";
import { toNative, logicOf, type LogicDoc, type EditorProject } from "../protocol/editor";
import { activateWorkspace, rememberDeletion, scopedStorage, workspace, type Workspace } from "../platform/workspace";
import { PROTOCOL_LIMITS } from "../protocol/schema";

/** 工程统一以原生协议模式保存在本地（旧数据打开时转换一次）。 */
function native(project: Project): Project {
  return toNative(normalizeProject(project) as EditorProject) as Project;
}

/** 复制组件时给挂在它身上的事件/绑定生成新编号。 */
function cloneId(prefix: string) {
  return uid(prefix);
}

type Past = Record<string, string[]>;

type Studio = {
  projects: Project[];
  hydrated: boolean;
  past: Past;
  future: Past;
  setHydrated: (projects: Project[]) => void;
  createProject: (input: { name: string; appName: string; packageName: string; device: DeviceShape; template?: TemplateId }) => string;
  importProject: (input: unknown) => string;
  duplicateProject: (id: string) => string | null;
  removeProject: (id: string) => void;
  updateMeta: (id: string, patch: Partial<Pick<Project, "name" | "appName" | "packageName" | "device">>) => void;
  updateProject: (id: string, recipe: (project: Project) => Project) => void;
  addPage: (id: string) => string | null;
  renamePage: (id: string, pageId: string, name: string) => string | null;
  removePage: (id: string, pageId: string) => void;
  setStartPage: (id: string, pageId: string) => void;
  setNavKind: (id: string, kind: NavKind) => void;
  toggleNavPage: (id: string, pageId: string) => void;
  /** 逻辑编辑（变量、事件、函数、计时器、绑定），可撤销。live=true 时不记撤销（连续输入）。 */
  updateLogic: (id: string, recipe: (logic: LogicDoc) => LogicDoc, live?: boolean) => void;
  duplicatePage: (id: string, pageId: string) => string | null;
  movePage: (id: string, pageId: string, dir: -1 | 1) => void;
  setPageTitle: (id: string, pageId: string, title: string) => void;
  duplicateNodes: (id: string, pageId: string, nodeIds: string[]) => string[];
  alignNodes: (id: string, pageId: string, nodeIds: string[], how: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hspace" | "vspace") => void;
  setPageBackground: (id: string, pageId: string, color: string) => void;
  paintPage: (id: string, pageId: string, color: string) => void;
  addNode: (id: string, pageId: string, type: CompType, x: number, y: number) => string | null;
  setNodes: (id: string, pageId: string, nodes: SceneNode[]) => void;
  commitPast: (id: string, before: string) => void;
  patchNode: (id: string, pageId: string, nodeId: string, patch: Partial<SceneNode> & { props?: PropMap }) => void;
  touchNode: (id: string, pageId: string, nodeId: string, patch: Partial<SceneNode> & { props?: PropMap }) => void;
  removeNodes: (id: string, pageId: string, nodeIds: string[]) => void;
  moveLayer: (id: string, pageId: string, nodeId: string, dir: -1 | 1) => void;
  replaceFromSnapshot: (id: string, snapshot: string) => void;
  undo: (id: string) => void;
  redo: (id: string) => void;
  saveRevision: (id: string, note: string) => void;
  restoreRevision: (id: string, revisionId: string) => void;
};

function applyNode(projects: Project[], id: string, pageId: string, nodeId: string, patch: Partial<SceneNode> & { props?: PropMap }) {
  return withProject(projects, id, (project) => ({
    ...project,
    updatedAt: Date.now(),
    pages: project.pages.map((page) =>
      page.id === pageId
        ? {
            ...page,
            nodes: page.nodes.map((node) =>
              node.id === nodeId ? { ...node, ...patch, props: patch.props ? { ...node.props, ...patch.props } : node.props } : node,
            ),
          }
        : page,
    ),
  }));
}

function withProject(projects: Project[], id: string, fn: (project: Project) => Project): Project[] {
  return projects.map((project) => (project.id === id ? fn(project) : project));
}

function remember(past: Past, future: Past, id: string, before: string): { past: Past; future: Past } {
  const stack = past[id] ?? [];
  return {
    past: { ...past, [id]: [...stack.slice(-39), before] },
    future: { ...future, [id]: [] },
  };
}

export const useStudio = create<Studio>()(
  persist(
    (set, get) => ({
      projects: [],
      hydrated: false,
      past: {},
      future: {},
      setHydrated: (projects) => set({ projects: projects.map((project) => native(project)), hydrated: true }),
      createProject: (input) => {
        const project = makeFromTemplate(input.template || "blank", input);
        project.name = input.name.trim() || project.name;
        project.appName = input.appName.trim() || project.appName;
        project.packageName = input.packageName.trim() || project.packageName;
        project.device = input.device;
        const created = native(project);
        set({ projects: [created, ...get().projects] });
        return created.id;
      },
      importProject: (input) => {
        const project = native((input ?? {}) as Project);
        // 导入总是新建工程，不覆盖已有工程（规格 4.3）。
        // 总是分配新编号：别人的工程包里的编号在云端可能属于其他账号。
        project.id = uid("j");
        if (project.protocolExtras) project.protocolExtras = { ...project.protocolExtras, revision: 0 };
        project.updatedAt = Date.now();
        set({ projects: [project, ...get().projects] });
        return project.id;
      },
      duplicateProject: (id) => {
        const found = get().projects.find((project) => project.id === id);
        if (!found) return null;
        const copy: Project = {
          ...structuredClone(found),
          id: uid("j"),
          name: `${found.name} 副本`,
          updatedAt: Date.now(),
          revisions: [],
        };
        set({ projects: [copy, ...get().projects] });
        return copy.id;
      },
      removeProject: (id) => {
        rememberDeletion(localStorage, id); // Persist before removing the draft; survives offline/restart.
        set({ projects: get().projects.filter((project) => project.id !== id) });
      },
      updateMeta: (id, patch) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const next: Project = normalizeProject({
          ...current,
          ...patch,
          name: patch.name?.trim() || current.name,
          appName: patch.appName?.trim() || current.appName,
          packageName: patch.packageName?.trim() || current.packageName,
        });
        if (snapshotOf(next) === snapshotOf(current)) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, () => ({ ...next, updatedAt: Date.now() })),
        });
      },
      updateProject: (id, recipe) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const next = normalizeProject({ ...recipe(current), id: current.id, updatedAt: Date.now() });
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({ ...history, projects: withProject(get().projects, id, () => next) });
      },
      addPage: (id) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current || current.pages.length >= MAX_PAGES) return null;
        const used = new Set(current.pages.map((page) => page.name));
        let name = "Page";
        let index = 2;
        while (used.has(name)) {
          name = `Page${index}`;
          index += 1;
        }
        const page = makePage(name);
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            pages: [...project.pages, page],
          })),
        });
        return page.id;
      },
      renamePage: (id, pageId, name) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return "找不到工程";
        const next = name.trim();
        if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(next)) return "页面名需以字母开头";
        if (current.pages.some((page) => page.id !== pageId && page.name === next)) return "页面名重复";
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            pages: project.pages.map((page) => (page.id === pageId ? { ...page, name: next } : page)),
          })),
        });
        return null;
      },
      removePage: (id, pageId) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current || current.pages.length <= 1) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => {
            const pages = project.pages.filter((page) => page.id !== pageId);
            return {
              ...project,
              updatedAt: Date.now(),
              pages,
              startPageId: project.startPageId === pageId ? pages[0].id : project.startPageId,
              nav: { ...project.nav, items: project.nav.items.filter((item) => item.pageId !== pageId) },
            };
          }),
        });
      },
      setStartPage: (id, pageId) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({ ...project, startPageId: pageId, updatedAt: Date.now() })),
        });
      },
      setNavKind: (id, kind) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            nav: { ...project.nav, kind },
          })),
        });
      },
      toggleNavPage: (id, pageId) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const page = current.pages.find((item) => item.id === pageId);
        if (!page) return;
        const has = current.nav.items.some((item) => item.pageId === pageId);
        const items = has
          ? current.nav.items.filter((item) => item.pageId !== pageId)
          : [...current.nav.items, { id: uid("b"), label: page.name.slice(0, 8), pageId }].slice(0, 4);
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            nav: { ...project.nav, items },
          })),
        });
      },
      updateLogic: (id, recipe, live) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const base = native(current) as EditorProject;
        const next = recipe(structuredClone(logicOf(base)));
        const extras = { ...base.protocolExtras!, ...next };
        const updated = { ...base, protocolExtras: extras, updatedAt: Date.now() } as Project;
        const history = live ? {} : remember(get().past, get().future, id, snapshotOf(current));
        set({ ...history, projects: withProject(get().projects, id, () => updated) });
      },
      duplicatePage: (id, pageId) => {
        const current = get().projects.find((project) => project.id === id) as EditorProject | undefined;
        const page = current?.pages.find((item) => item.id === pageId);
        if (!current || !page || current.pages.length >= MAX_PAGES) return null;
        const used = new Set(current.pages.map((item) => item.name));
        let name = `${page.name}Copy`.slice(0, 20);
        let index = 2;
        while (used.has(name)) name = `${page.name}Copy${index++}`.slice(0, 24);
        const idMap = new Map<string, string>();
        const copy = {
          ...structuredClone(page),
          id: uid("p"),
          name,
          nodes: page.nodes.map((node) => {
            const nid = uid("n");
            idMap.set(node.id, nid);
            return { ...structuredClone(node), id: nid };
          }),
        };
        idMap.set(page.id, copy.id);
        const x = current.protocolExtras;
        const extras = x
          ? {
              ...x,
              bindings: [
                ...x.bindings,
                ...x.bindings
                  .filter((b) => idMap.has(b.componentId))
                  .map((b) => ({ ...structuredClone(b), id: cloneId("b"), componentId: idMap.get(b.componentId)! })),
              ].slice(0, PROTOCOL_LIMITS.bindings),
              events: [
                ...x.events,
                ...x.events
                  .filter((e) =>
                    e.trigger.kind === "component" ? idMap.has(e.trigger.componentId) : e.trigger.kind === "page" ? e.trigger.pageId === page.id : false,
                  )
                  .map((e) => {
                    // 动作里引用本页组件的，改成指向副本里的对应组件。
                    const json = JSON.stringify(e).replace(/"(componentId|pageId)":"([^"]+)"/g, (all, key, value) =>
                      idMap.has(value) && !(key === "pageId" && e.trigger.kind !== "page" && value === page.id) ? `"${key}":"${idMap.get(value)}"` : all,
                    );
                    const clone = JSON.parse(json) as typeof e;
                    return { ...clone, id: cloneId("e"), actions: reId(clone.actions) };
                  }),
              ].slice(0, PROTOCOL_LIMITS.events),
            }
          : x;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            ...(extras ? { protocolExtras: extras } : {}),
            updatedAt: Date.now(),
            pages: [...project.pages.slice(0, project.pages.indexOf(project.pages.find((item) => item.id === pageId)!) + 1), copy, ...project.pages.slice(project.pages.findIndex((item) => item.id === pageId) + 1)],
          })),
        });
        return copy.id;
      },
      movePage: (id, pageId, dir) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const index = current.pages.findIndex((page) => page.id === pageId);
        const next = index + dir;
        if (index < 0 || next < 0 || next >= current.pages.length) return;
        const pages = current.pages.slice();
        const [item] = pages.splice(index, 1);
        pages.splice(next, 0, item);
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({ ...history, projects: withProject(get().projects, id, (project) => ({ ...project, pages, updatedAt: Date.now() })) });
      },
      setPageTitle: (id, pageId, title) => {
        const current = get().projects.find((project) => project.id === id) as EditorProject | undefined;
        if (!current?.protocolExtras) return;
        const pageTitles = { ...current.protocolExtras.pageTitles };
        if (title.trim()) pageTitles[pageId] = title.trim().slice(0, 40);
        else delete pageTitles[pageId];
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            protocolExtras: { ...current.protocolExtras!, pageTitles },
          })),
        });
      },
      duplicateNodes: (id, pageId, nodeIds) => {
        const current = get().projects.find((project) => project.id === id) as EditorProject | undefined;
        const page = current?.pages.find((item) => item.id === pageId);
        if (!current || !page) return [];
        const chosen = page.nodes.filter((node) => nodeIds.includes(node.id));
        if (!chosen.length || page.nodes.length + chosen.length > PROTOCOL_LIMITS.componentsPerPage) return [];
        const idMap = new Map<string, string>();
        const copies = chosen.map((node) => {
          const nid = uid("n");
          idMap.set(node.id, nid);
          return { ...structuredClone(node), id: nid, name: `${node.name}副本`.slice(0, 24), x: node.x + 16, y: node.y + 16 };
        });
        const x = current.protocolExtras;
        const extras = x
          ? {
              ...x,
              bindings: [
                ...x.bindings,
                ...x.bindings
                  .filter((b) => idMap.has(b.componentId))
                  .map((b) => ({ ...structuredClone(b), id: cloneId("b"), componentId: idMap.get(b.componentId)! })),
              ].slice(0, PROTOCOL_LIMITS.bindings),
              events: [
                ...x.events,
                ...x.events
                  .filter((e) => e.trigger.kind === "component" && idMap.has(e.trigger.componentId))
                  .map((e) => ({
                    ...structuredClone(e),
                    id: cloneId("e"),
                    trigger: { ...e.trigger, componentId: idMap.get((e.trigger as { componentId: string }).componentId)! } as typeof e.trigger,
                    actions: reId(structuredClone(e.actions)),
                  })),
              ].slice(0, PROTOCOL_LIMITS.events),
            }
          : x;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            ...(extras ? { protocolExtras: extras } : {}),
            updatedAt: Date.now(),
            pages: project.pages.map((item) => (item.id === pageId ? { ...item, nodes: [...item.nodes, ...copies] } : item)),
          })),
        });
        return copies.map((node) => node.id);
      },
      alignNodes: (id, pageId, nodeIds, how) => {
        const current = get().projects.find((project) => project.id === id);
        const page = current?.pages.find((item) => item.id === pageId);
        if (!current || !page) return;
        const chosen = page.nodes.filter((node) => nodeIds.includes(node.id) && !node.locked);
        if (!chosen.length) return;
        const single = chosen.length === 1;
        // 单个组件对齐到画布；多个组件对齐到选区。
        const left = single ? 0 : Math.min(...chosen.map((n) => n.x));
        const top = single ? 0 : Math.min(...chosen.map((n) => n.y));
        const right = single ? 466 : Math.max(...chosen.map((n) => n.x + n.w));
        const bottom = single ? 466 : Math.max(...chosen.map((n) => n.y + n.h));
        const pos = new Map<string, { x: number; y: number }>();
        if (how === "hspace" || how === "vspace") {
          if (chosen.length < 3) return;
          const horiz = how === "hspace";
          const sorted = chosen.slice().sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
          const total = sorted.reduce((sum, n) => sum + (horiz ? n.w : n.h), 0);
          const span = horiz ? right - left : bottom - top;
          const gap = (span - total) / (sorted.length - 1);
          let cursor = horiz ? left : top;
          for (const n of sorted) {
            pos.set(n.id, horiz ? { x: Math.round(cursor), y: n.y } : { x: n.x, y: Math.round(cursor) });
            cursor += (horiz ? n.w : n.h) + gap;
          }
        } else {
          for (const n of chosen) {
            const x = how === "left" ? left : how === "right" ? right - n.w : how === "hcenter" ? (left + right) / 2 - n.w / 2 : n.x;
            const y = how === "top" ? top : how === "bottom" ? bottom - n.h : how === "vcenter" ? (top + bottom) / 2 - n.h / 2 : n.y;
            pos.set(n.id, { x: Math.round(x), y: Math.round(y) });
          }
        }
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            pages: project.pages.map((item) =>
              item.id === pageId ? { ...item, nodes: item.nodes.map((node) => (pos.has(node.id) ? { ...node, ...pos.get(node.id)! } : node)) } : item,
            ),
          })),
        });
      },
      setPageBackground: (id, pageId, color) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            pages: project.pages.map((page) => (page.id === pageId ? { ...page, background: color } : page)),
          })),
        });
      },
      paintPage: (id, pageId, color) => {
        set({
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            pages: project.pages.map((page) => (page.id === pageId ? { ...page, background: color } : page)),
          })),
        });
      },
      addNode: (id, pageId, type, x, y) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return null;
        const node = makeNode(type, x, y);
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            pages: project.pages.map((page) => (page.id === pageId ? { ...page, nodes: [...page.nodes, node] } : page)),
          })),
        });
        return node.id;
      },
      setNodes: (id, pageId, nodes) => {
        set({
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            pages: project.pages.map((page) => (page.id === pageId ? { ...page, nodes } : page)),
          })),
        });
      },
      commitPast: (id, before) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current || snapshotOf(current) === before) return;
        set(remember(get().past, get().future, id, before));
      },
      patchNode: (id, pageId, nodeId, patch) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: applyNode(get().projects, id, pageId, nodeId, patch),
        });
      },
      touchNode: (id, pageId, nodeId, patch) => {
        set({ projects: applyNode(get().projects, id, pageId, nodeId, patch) });
      },
      removeNodes: (id, pageId, nodeIds) => {
        const drop = new Set(nodeIds);
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            pages: project.pages.map((page) =>
              page.id === pageId ? { ...page, nodes: page.nodes.filter((node) => !drop.has(node.id)) } : page,
            ),
          })),
        });
      },
      moveLayer: (id, pageId, nodeId, dir) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            pages: project.pages.map((page) => {
              if (page.id !== pageId) return page;
              const index = page.nodes.findIndex((node) => node.id === nodeId);
              const next = index + dir;
              if (index < 0 || next < 0 || next >= page.nodes.length) return page;
              const nodes = page.nodes.slice();
              const [item] = nodes.splice(index, 1);
              nodes.splice(next, 0, item);
              return { ...page, nodes };
            }),
          })),
        });
      },
      replaceFromSnapshot: (id, snapshot) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => native(restoreSnapshot(project, snapshot))),
        });
      },
      undo: (id) => {
        const stack = get().past[id] ?? [];
        if (!stack.length) return;
        const before = stack[stack.length - 1];
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        set({
          past: { ...get().past, [id]: stack.slice(0, -1) },
          future: { ...get().future, [id]: [...(get().future[id] ?? []), snapshotOf(current)] },
          projects: withProject(get().projects, id, (project) => native(restoreSnapshot(project, before))),
        });
      },
      redo: (id) => {
        const stack = get().future[id] ?? [];
        if (!stack.length) return;
        const next = stack[stack.length - 1];
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        set({
          future: { ...get().future, [id]: stack.slice(0, -1) },
          past: { ...get().past, [id]: [...(get().past[id] ?? []), snapshotOf(current)] },
          projects: withProject(get().projects, id, (project) => native(restoreSnapshot(project, next))),
        });
      },
      saveRevision: (id, note) => {
        set({
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            revisions: [
              { id: uid("r"), at: Date.now(), note: note.trim() || "手动修订", snapshot: snapshotOf(project) },
              ...project.revisions,
            ].slice(0, 30),
          })),
        });
      },
      restoreRevision: (id, revisionId) => {
        const current = get().projects.find((project) => project.id === id);
        const revision = current?.revisions.find((item) => item.id === revisionId);
        if (!current || !revision) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => native(restoreSnapshot(project, revision.snapshot))),
        });
      },
    }),
    {
      name: "blueos-studio-v1",
      partialize: (state) => ({ projects: state.projects }),
      skipHydration: true,
      storage: createJSONStorage(() => scopedStorage(localStorage)),
    },
  ),
);

/** 复制的动作树重新编号，避免两个事件里出现相同的动作 ID。 */
function reId<T extends { id: string }>(list: T[]): T[] {
  return list.map((action) => {
    const copy = { ...action, id: cloneId("a") } as T & { then?: T[]; else?: T[]; body?: T[] };
    if (copy.then) copy.then = reId(copy.then);
    if (copy.else) copy.else = reId(copy.else);
    if (copy.body) copy.body = reId(copy.body);
    return copy;
  });
}

/** Switch before paint. No unowned legacy cache is silently assigned to a login. */
export function setStudioIdentity(origin: string, userId: string | null): Workspace | null {
  const previous = workspace();
  if (previous?.origin === new URL(origin).origin && previous.userId === userId && useStudio.getState().hydrated) return previous;
  activateWorkspace(origin, null);
  useStudio.setState({ projects: [], past: {}, future: {}, hydrated: false });
  const scope = activateWorkspace(origin, userId);
  // Stop writes while clearing all transient history from the previous account.
  const storage = scopedStorage(localStorage);
  let projects: Project[] = [];
  if (scope) {
    const raw = storage.getItem("blueos-studio-v1");
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { projects?: Project[] } };
      if (!Array.isArray(parsed.state?.projects)) throw new Error("本机工程缓存损坏，原始数据已保留，请先恢复备份");
      projects = parsed.state.projects.map(native);
    }
  }
  useStudio.setState({ projects, past: {}, future: {}, hydrated: !!scope });
  return scope;
}

export function useStudioHydrated() {
  return useStudio((state) => state.hydrated);
}
