import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  makeFromTemplate,
  makeNode,
  makePage,
  makeSample,
  normalizeProject,
  snapshotOf,
  uid,
  MAX_PAGES,
  type AppVariable,
  type CompType,
  type DeviceShape,
  type NavKind,
  type Project,
  type PropMap,
  type SceneNode,
  type TemplateId,
} from "./model";

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
  addVariable: (id: string) => void;
  patchVariable: (id: string, variableId: string, patch: Partial<AppVariable>) => void;
  removeVariable: (id: string, variableId: string) => void;
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
      setHydrated: (projects) => set({ projects: projects.map((project) => normalizeProject(project)), hydrated: true }),
      createProject: (input) => {
        const project = makeFromTemplate(input.template || "blank", input);
        project.name = input.name.trim() || project.name;
        project.appName = input.appName.trim() || project.appName;
        project.packageName = input.packageName.trim() || project.packageName;
        project.device = input.device;
        set({ projects: [project, ...get().projects] });
        return project.id;
      },
      importProject: (input) => {
        const project = normalizeProject((input ?? {}) as Partial<Project>);
        if (get().projects.some((item) => item.id === project.id)) project.id = uid("j");
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
      removeProject: (id) => set({ projects: get().projects.filter((project) => project.id !== id) }),
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
      addVariable: (id) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current || current.variables.length >= 24) return;
        const used = new Set(current.variables.map((item) => item.key));
        let key = "value";
        let index = 2;
        while (used.has(key)) {
          key = `value${index}`;
          index += 1;
        }
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            variables: [...project.variables, { id: uid("v"), key, kind: "string", value: "", scope: "app", pageId: "" }],
          })),
        });
      },
      patchVariable: (id, variableId, patch) => {
        set({
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            variables: project.variables.map((item) => (item.id === variableId ? { ...item, ...patch } : item)),
          })),
        });
      },
      removeVariable: (id, variableId) => {
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => ({
            ...project,
            updatedAt: Date.now(),
            variables: project.variables.filter((item) => item.id !== variableId),
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
        const data = JSON.parse(snapshot) as Partial<Project>;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => normalizeProject({ ...project, ...data, id: project.id, revisions: project.revisions, updatedAt: Date.now() })),
        });
      },
      undo: (id) => {
        const stack = get().past[id] ?? [];
        if (!stack.length) return;
        const before = stack[stack.length - 1];
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const data = JSON.parse(before) as Partial<Project>;
        set({
          past: { ...get().past, [id]: stack.slice(0, -1) },
          future: { ...get().future, [id]: [...(get().future[id] ?? []), snapshotOf(current)] },
          projects: withProject(get().projects, id, (project) => normalizeProject({ ...project, ...data, id: project.id, revisions: project.revisions, updatedAt: Date.now() })),
        });
      },
      redo: (id) => {
        const stack = get().future[id] ?? [];
        if (!stack.length) return;
        const next = stack[stack.length - 1];
        const current = get().projects.find((project) => project.id === id);
        if (!current) return;
        const data = JSON.parse(next) as Partial<Project>;
        set({
          future: { ...get().future, [id]: stack.slice(0, -1) },
          past: { ...get().past, [id]: [...(get().past[id] ?? []), snapshotOf(current)] },
          projects: withProject(get().projects, id, (project) => normalizeProject({ ...project, ...data, id: project.id, revisions: project.revisions, updatedAt: Date.now() })),
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
        const data = JSON.parse(revision.snapshot) as Partial<Project>;
        const history = remember(get().past, get().future, id, snapshotOf(current));
        set({
          ...history,
          projects: withProject(get().projects, id, (project) => normalizeProject({ ...project, ...data, id: project.id, revisions: project.revisions, updatedAt: Date.now() })),
        });
      },
    }),
    {
      name: "blueos-studio-v1",
      partialize: (state) => ({ projects: state.projects }),
      onRehydrateStorage: () => (state) => {
        const projects = state?.projects?.length ? state.projects : [makeSample()];
        queueMicrotask(() => {
          useStudio.getState().setHydrated(projects);
        });
      },
    },
  ),
);

export function useStudioHydrated() {
  const hydrated = useStudio((state) => state.hydrated);
  useEffect(() => {
    const finish = () => {
      if (useStudio.getState().hydrated) return;
      const projects = useStudio.getState().projects;
      useStudio.getState().setHydrated(projects.length ? projects : [makeSample()]);
    };
    if (useStudio.persist.hasHydrated()) finish();
    return useStudio.persist.onFinishHydration(finish);
  }, []);
  return hydrated;
}
