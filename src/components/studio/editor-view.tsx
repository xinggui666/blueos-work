import { Link } from "@tanstack/react-router";
import { ChevronLeft, Download, Eye, EyeOff, Layers, Lock, LockOpen, Redo2, Shapes, SlidersHorizontal, Trash2, Undo2, Package } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { NodeGlyph } from "@/components/studio/face";
import { call, errorText, useCloud, useComponentLock } from "@/lib/platform/client";
import {
  CATALOG,
  DESIGN,
  asColor,
  catalogOf,
  formatClock,
  initialPreview,
  makeAction,
  projectToDsl,
  runActions,
  shownText,
  snapshotOf,
  validateDsl,
  type AppAction,
  type CompType,
  type Field,
  type Project,
  type SceneNode,
} from "@/lib/blueos/model";
import { useStudio, useStudioHydrated } from "@/lib/blueos/store";

type Mode = "library" | "layers" | "props" | "logic" | "pack";

const MODES: { id: Mode; label: string; icon: typeof Shapes }[] = [
  { id: "library", label: "组件", icon: Shapes },
  { id: "layers", label: "图层", icon: Layers },
  { id: "props", label: "属性", icon: SlidersHorizontal },
  { id: "logic", label: "逻辑", icon: Eye },
  { id: "pack", label: "交付", icon: Package },
];

export function EditorView({ projectId }: { projectId: string }) {
  const cloud = useCloud();
  const hydrated = useStudioHydrated();
  const project = useStudio((state) => state.projects.find((item) => item.id === projectId));
  const undo = useStudio((state) => state.undo);
  const redo = useStudio((state) => state.redo);
  const past = useStudio((state) => state.past[projectId]?.length ?? 0);
  const future = useStudio((state) => state.future[projectId]?.length ?? 0);
  const [pageId, setPageId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("props");
  const [sheet, setSheet] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [stack, setStack] = useState<string[]>([]);
  const [hiddenMap, setHiddenMap] = useState<Record<string, boolean>>({});
  const [textMap, setTextMap] = useState<Record<string, string>>({});
  const [varMap, setVarMap] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");

  const page = project?.pages.find((item) => item.id === (pageId || project.pages[0]?.id)) ?? project?.pages[0];

  useEffect(() => {
    if (project && !pageId) setPageId(project.pages[0]?.id ?? null);
  }, [project, pageId]);

  useEffect(() => {
    if (!previewOn || !project) return;
    const tick = () => {
      const bindings = project.timeBindings || [];
      if (!bindings.length) return;
      setTextMap((current) => {
        const next = { ...current };
        for (const binding of bindings) next[binding.nodeId] = formatClock(binding.format);
        return next;
      });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [previewOn, project]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(projectId);
        else undo(projectId);
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo(projectId);
      } else if (!previewOn && (event.key === "Delete" || event.key === "Backspace") && page && selected.length) {
        event.preventDefault();
        useStudio.getState().removeNodes(projectId, page.id, selected);
        setSelected([]);
      } else if (event.key === "Escape") setSelected([]);
      else if (page && selected.length && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 8 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const before = snapshotOf(useStudio.getState().projects.find((item) => item.id === projectId)!);
        const ids = new Set(selected);
        const nodes = page.nodes.map((node) =>
          ids.has(node.id) && !node.locked ? { ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy) } : node,
        );
        useStudio.getState().setNodes(projectId, page.id, nodes);
        useStudio.getState().commitPast(projectId, before);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, previewOn, projectId, redo, selected, undo]);

  if (!hydrated || !cloud.ready) return <main className="grid h-dvh place-items-center text-sm text-muted">{cloud.detail || "正在打开工程…"}</main>;
  if (!project || !page) {
    return (
      <main className="grid h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-lg font-semibold">找不到这个工程</p>
          <Link to="/" className="mt-3 inline-flex min-h-11 items-center text-accent">
            返回工程列表
          </Link>
        </div>
      </main>
    );
  }

  function openMode(next: Mode) {
    setMode(next);
    setSheet(true);
  }

  function beginPreview() {
    if (!project) return;
    const next = initialPreview(project);
    setPreviewOn(true);
    setPageId(next.pageId);
    setStack([]);
    setHiddenMap({});
    setTextMap({});
    setVarMap(next.vars);
    setToast("");
    setSelected([]);
  }

  function play(actions: AppAction[]) {
    if (!project || !page) return;
    const next = runActions(
      project,
      { pageId: page.id, stack, hidden: hiddenMap, text: textMap, vars: varMap, toast: "" },
      actions,
    );
    setPageId(next.pageId);
    setStack(next.stack);
    setHiddenMap(next.hidden);
    setTextMap(next.text);
    setVarMap(next.vars);
    if (next.toast) {
      setToast(next.toast);
      window.setTimeout(() => setToast(""), 1600);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-bg">
      <header className="glass border-b border-line">
        <div className="flex items-center gap-2 px-2 py-2">
          <Link to="/" aria-label="返回" className="grid size-11 place-items-center rounded-xl border border-line bg-surface">
            <ChevronLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{project.name}</p>
            <p className="truncate text-xs text-muted">
              {previewOn ? "模拟预览，不是真机" : cloud.detail || "云端"} · {project.pages.length} 页
            </p>
          </div>
          <button type="button" className={`min-h-11 rounded-xl border px-3 text-sm ${advanced ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface"}`} onClick={() => setAdvanced((value) => !value)}>
            {advanced ? "高级" : "简易"}
          </button>
          <button type="button" className={`min-h-11 rounded-xl border px-3 text-sm ${previewOn ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface"}`} onClick={() => (previewOn ? setPreviewOn(false) : beginPreview())}>
            {previewOn ? "编辑" : "预览"}
          </button>
          <button type="button" aria-label="撤销" disabled={!past || previewOn} className="grid size-11 place-items-center rounded-xl border border-line bg-surface disabled:opacity-40" onClick={() => undo(projectId)}>
            <Undo2 className="size-4" />
          </button>
          <button type="button" aria-label="重做" disabled={!future || previewOn} className="grid size-11 place-items-center rounded-xl border border-line bg-surface disabled:opacity-40" onClick={() => redo(projectId)}>
            <Redo2 className="size-4" />
          </button>
        </div>
        <div className="studio-scroll flex gap-1 overflow-x-auto px-2 pb-2">
          {project.pages.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`shrink-0 rounded-full border px-3 py-2 text-sm ${item.id === page.id ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface text-muted"}`}
              onClick={() => setPageId(item.id)}
            >
              {item.name}
              {item.id === project.startPageId ? " · 启动" : ""}
            </button>
          ))}
          <button
            type="button"
            className="shrink-0 rounded-full border border-line bg-surface px-3 py-2 text-sm"
            onClick={() => {
              const id = useStudio.getState().addPage(project.id);
              if (id) setPageId(id);
            }}
          >
            加页面
          </button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[272px_minmax(0,1fr)_320px]">
        <aside className="hidden min-h-0 flex-col border-r border-line lg:flex">
          <Library project={project} pageId={page.id} onAdded={setSelected} />
          <LayerList project={project} page={page} selected={selected} onSelect={setSelected} />
        </aside>
        <Stage
          project={project}
          pageId={page.id}
          selected={selected}
          preview={previewOn}
          hiddenMap={hiddenMap}
          textMap={textMap}
          varMap={varMap}
          toast={toast}
          onSelect={setSelected}
          onPlay={play}
          onOpenPage={setPageId}
        />
        <aside className="hidden min-h-0 flex-col border-l border-line lg:flex">
          <div className="flex border-b border-line">
            {(["props", "logic", "pack"] as Mode[]).map((item) => (
              <button key={item} type="button" className={`min-h-11 flex-1 text-sm ${mode === item ? "text-accent" : "text-muted"}`} onClick={() => setMode(item)}>
                {MODES.find((entry) => entry.id === item)?.label}
              </button>
            ))}
          </div>
          <div className="studio-scroll min-h-0 flex-1 overflow-y-auto">
            <Side project={project} pageId={page.id} selected={selected} mode={mode === "library" || mode === "layers" ? "props" : mode} advanced={advanced} onSelect={setSelected} />
          </div>
        </aside>
      </div>
      <nav className="glass grid grid-cols-5 border-t border-line lg:hidden">
        {MODES.map((item) => {
          const Icon = item.icon;
          const active = sheet && mode === item.id;
          return (
            <button key={item.id} type="button" className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs ${active ? "text-accent" : "text-muted"}`} onClick={() => openMode(item.id)}>
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
      {sheet ? (
        <div className="glass absolute inset-x-0 bottom-14 z-20 flex max-h-[62%] flex-col rounded-t-2xl border border-line lg:hidden">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-sm font-semibold">{MODES.find((item) => item.id === mode)?.label}</p>
            <button type="button" className="min-h-11 px-2 text-sm text-muted" onClick={() => setSheet(false)}>
              收起
            </button>
          </div>
          <div className="studio-scroll min-h-0 flex-1 overflow-y-auto">
            {mode === "library" ? <Library project={project} pageId={page.id} onAdded={(ids) => { setSelected(ids); setSheet(false); }} /> : null}
            {mode === "layers" ? <LayerList project={project} page={page} selected={selected} onSelect={setSelected} /> : null}
            {mode === "props" || mode === "logic" || mode === "pack" ? (
              <Side project={project} pageId={page.id} selected={selected} mode={mode} advanced={advanced} onSelect={setSelected} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Library({ project, pageId, onAdded }: { project: Project; pageId: string; onAdded: (ids: string[]) => void }) {
  const locked = useComponentLock();
  const groups = useMemo(() => {
    const map = new Map<string, typeof CATALOG>();
    for (const item of CATALOG) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, []);
  return (
    <div className="studio-scroll min-h-0 flex-1 overflow-y-auto p-3">
      <p className="px-1 text-xs text-muted">点一下就加到当前页面。电脑上也可以拖进去。</p>
      {groups.map(([group, items]) => (
        <section key={group} className="mt-3">
          <h2 className="px-1 text-xs font-medium text-muted">{group}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {items.map((item) => {
              const reason = locked(item.type);
              return (
              <button
                key={item.type}
                type="button"
                draggable={!reason}
                disabled={Boolean(reason)}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", item.type);
                  event.dataTransfer.setData("application/x-blueos", item.type);
                }}
                className="min-h-11 rounded-md border border-line bg-surface-2 px-2 py-2 text-left disabled:opacity-50"
                onClick={() => {
                  if (reason) return;
                  const count = project.pages.find((page) => page.id === pageId)?.nodes.length ?? 0;
                  const id = useStudio.getState().addNode(project.id, pageId, item.type, (DESIGN - item.w) / 2 + (count % 4) * 10, (DESIGN - item.h) / 2 + (count % 4) * 10);
                  if (id) onAdded([id]);
                }}
              >
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block font-mono text-xs text-muted">{reason || item.tag}</span>
              </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function LayerList({
  project,
  page,
  selected,
  onSelect,
}: {
  project: Project;
  page: Project["pages"][number];
  selected: string[];
  onSelect: (ids: string[]) => void;
}) {
  const nodes = [...page.nodes].reverse();
  return (
    <div className="studio-scroll max-h-72 min-h-0 flex-1 overflow-y-auto border-t border-line p-2 lg:max-h-none">
      <p className="px-2 py-1 text-xs text-muted">上面的图层盖住下面的。</p>
      {nodes.length === 0 ? <p className="px-2 py-3 text-sm text-muted">还没有组件。</p> : null}
      <ul>
        {nodes.map((node) => {
          const active = selected.includes(node.id);
          return (
            <li key={node.id} className={`mt-1 flex items-center gap-1 rounded-md px-1 ${active ? "bg-surface-2" : ""}`}>
              <button type="button" className="min-h-11 flex-1 truncate px-2 text-left text-sm" onClick={() => onSelect([node.id])}>
                {node.name}
                <span className="ml-2 font-mono text-xs text-muted">{catalogOf(node.type)?.tag}</span>
              </button>
              <button type="button" aria-label={node.hidden ? "显示" : "隐藏"} className="grid size-11 place-items-center text-muted" onClick={() => useStudio.getState().patchNode(project.id, page.id, node.id, { hidden: !node.hidden })}>
                {node.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              <button type="button" aria-label={node.locked ? "解锁" : "锁定"} className="grid size-11 place-items-center text-muted" onClick={() => useStudio.getState().patchNode(project.id, page.id, node.id, { locked: !node.locked })}>
                {node.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stage({
  project,
  pageId,
  selected,
  preview,
  hiddenMap,
  textMap,
  varMap,
  toast,
  onSelect,
  onPlay,
  onOpenPage,
}: {
  project: Project;
  pageId: string;
  selected: string[];
  preview: boolean;
  hiddenMap: Record<string, boolean>;
  textMap: Record<string, string>;
  varMap: Record<string, string>;
  toast: string;
  onSelect: (ids: string[]) => void;
  onPlay: (actions: AppAction[]) => void;
  onOpenPage: (pageId: string) => void;
}) {
  const page = project.pages.find((item) => item.id === pageId)!;
  const locked = useComponentLock();
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);
  const [guides, setGuides] = useState({ x: false, y: false });
  const gesture = useRef<null | {
    kind: "move" | "resize";
    before: string;
    ids: string[];
    sx: number;
    sy: number;
    origins: SceneNode[];
  }>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = Math.min(rect.width - 36, rect.height - 36) / DESIGN;
      setScale(Math.max(0.42, Math.min(next, 1.05)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function applyMove(clientX: number, clientY: number) {
    const current = gesture.current;
    if (!current) return;
    const dx = (clientX - current.sx) / scale;
    const dy = (clientY - current.sy) / scale;
    let snapX = false;
    let snapY = false;
    const moved = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const origin of current.origins) {
      if (current.kind === "move") {
        let x = origin.x + dx;
        let y = origin.y + dy;
        if (current.ids.length === 1) {
          const cx = x + origin.w / 2;
          const cy = y + origin.h / 2;
          if (Math.abs(cx - DESIGN / 2) < 10) {
            x = DESIGN / 2 - origin.w / 2;
            snapX = true;
          }
          if (Math.abs(cy - DESIGN / 2) < 10) {
            y = DESIGN / 2 - origin.h / 2;
            snapY = true;
          }
        }
        moved.set(origin.id, { x: Math.round(x), y: Math.round(y), w: origin.w, h: origin.h });
      } else {
        moved.set(origin.id, {
          x: origin.x,
          y: origin.y,
          w: Math.max(12, Math.round(origin.w + dx)),
          h: Math.max(origin.h <= 4 ? 2 : 12, Math.round(origin.h + dy)),
        });
      }
    }
    setGuides({ x: snapX, y: snapY });
    const nodes = page.nodes.map((node) => {
      const next = moved.get(node.id);
      return next ? { ...node, ...next } : node;
    });
    useStudio.getState().setNodes(project.id, page.id, nodes);
  }

  function endGesture() {
    const current = gesture.current;
    if (!current) return;
    useStudio.getState().commitPast(project.id, current.before);
    gesture.current = null;
    setGuides({ x: false, y: false });
  }

  function start(event: PointerEvent, node: SceneNode, kind: "move" | "resize") {
    if (preview) {
      event.stopPropagation();
      onPlay((node.actions ?? []).filter((action) => (action.trigger || "click") === "click"));
      return;
    }
    event.stopPropagation();
    if (event.button !== 0) return;
    if (kind === "move" && event.shiftKey) {
      onSelect(selected.includes(node.id) ? selected.filter((id) => id !== node.id) : [...selected, node.id]);
      return;
    }
    const ids = kind === "resize" ? [node.id] : selected.includes(node.id) ? selected : [node.id];
    onSelect(ids);
    const chosen = new Set(ids);
    gesture.current = {
      kind,
      before: snapshotOf(project),
      ids: ids.filter((id) => !page.nodes.find((item) => item.id === id)?.locked),
      sx: event.clientX,
      sy: event.clientY,
      origins: page.nodes.filter((item) => chosen.has(item.id) && !item.locked),
    };
    stageRef.current?.setPointerCapture(event.pointerId);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    if (preview) return;
    const type = (event.dataTransfer.getData("application/x-blueos") || event.dataTransfer.getData("text/plain")) as CompType;
    if (!catalogOf(type) || !stageRef.current || locked(type)) return;
    const rect = stageRef.current.getBoundingClientRect();
    const item = catalogOf(type)!;
    const x = (event.clientX - rect.left) / scale - item.w / 2;
    const y = (event.clientY - rect.top) / scale - item.h / 2;
    const id = useStudio.getState().addNode(project.id, page.id, type, x, y);
    if (id) onSelect([id]);
  }

  const round = project.device === "watch-round";
  const nav = project.nav?.kind && project.nav.kind !== "none" ? project.nav : null;
  function viewOf(node: SceneNode): SceneNode {
    const hidden = preview && hiddenMap[node.id] !== undefined ? hiddenMap[node.id] : node.hidden;
    const props = { ...node.props };
    const override = preview ? textMap[node.id] : undefined;
    if (override !== undefined) {
      if (node.type === "button") props.value = shownText(override, varMap);
      else props.text = shownText(override, varMap);
    } else if (preview && typeof props.text === "string") {
      props.text = shownText(String(props.text), varMap);
    }
    return { ...node, hidden, props };
  }
  return (
    <div ref={wrapRef} className="flex min-h-0 items-center justify-center overflow-hidden bg-bg">
      <div
        ref={stageRef}
        className="relative touch-none"
        style={{ width: DESIGN * scale, height: DESIGN * scale }}
        onPointerMove={(event) => applyMove(event.clientX, event.clientY)}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <div style={{ width: DESIGN, height: DESIGN, transform: `scale(${scale})`, transformOrigin: "top left" }} className="relative">
          <div
            className="relative border border-line"
            style={{ width: DESIGN, height: DESIGN, borderRadius: round ? 999 : 72, overflow: "hidden", background: page.background }}
            onPointerDown={() => onSelect([])}
          >
            {page.nodes
              .map(viewOf)
              .filter((node) => !node.hidden)
              .map((node) => (
                <div
                  key={node.id}
                  style={{ position: "absolute", left: node.x, top: node.y, width: node.w, height: node.h }}
                  onPointerDown={(event) => start(event, node, "move")}
                >
                  <NodeGlyph node={node} guide />
                </div>
              ))}
            {nav ? (
              <div
                className="absolute flex gap-1"
                style={
                  nav.kind === "side"
                    ? { left: 12, top: 16, width: 108, flexDirection: "column" }
                    : nav.kind === "top"
                      ? { left: 12, right: 12, top: 12, height: 52 }
                      : { left: 12, right: 12, bottom: 16, height: 52 }
                }
              >
                {nav.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="min-h-11 flex-1 rounded-2xl border border-line bg-surface text-xs font-medium text-fg"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onOpenPage(item.pageId);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            {toast ? (
              <div className="absolute bottom-20 left-8 right-8 rounded-full bg-fg px-3 py-2 text-center text-sm text-surface">{toast}</div>
            ) : null}
            {guides.x ? <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent" style={{ left: DESIGN / 2 }} /> : null}
            {guides.y ? <div className="pointer-events-none absolute left-0 right-0 h-px bg-accent" style={{ top: DESIGN / 2 }} /> : null}
          </div>
          {page.nodes
            .filter((node) => selected.includes(node.id) && !node.hidden)
            .map((node) => (
              <div key={node.id} className="pointer-events-none absolute border border-accent" style={{ left: node.x, top: node.y, width: node.w, height: node.h }}>
                {!node.locked ? (
                  <button
                    type="button"
                    aria-label="调整大小"
                    className="pointer-events-auto absolute -bottom-4 -right-4 grid size-11 place-items-center"
                    onPointerDown={(event) => start(event, node, "resize")}
                  >
                    <span className="size-3 rounded-sm bg-accent" />
                  </button>
                ) : null}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function Side({
  project,
  pageId,
  selected,
  mode,
  advanced,
  onSelect,
}: {
  project: Project;
  pageId: string;
  selected: string[];
  mode: "props" | "logic" | "pack";
  advanced: boolean;
  onSelect: (ids: string[]) => void;
}) {
  const page = project.pages.find((item) => item.id === pageId)!;
  const node = page.nodes.find((item) => item.id === selected[selected.length - 1]);
  if (mode === "logic") return <LogicPanel project={project} page={page} node={node} advanced={advanced} />;
  if (mode === "pack") return <PackPanel project={project} />;
  return (
    <div className="p-3">
      {node ? (
        <Inspector project={project} pageId={page.id} node={node} onSelect={onSelect} />
      ) : (
        <p className="text-sm leading-6 text-muted">选中页面上的组件后，在这里改文字、颜色和点击动作。普通编辑不显示源码。</p>
      )}
      <details className="mt-4 border-t border-line pt-3" open={!node}>
        <summary className="cursor-pointer text-sm font-medium">工程与页面</summary>
        <div className="pt-3">
          <MetaForm project={project} advanced={advanced} />
          <label className="mt-3 block text-sm text-muted">
            页面背景
            <ColorValue
              value={page.background}
              onLive={(value) => useStudio.getState().paintPage(project.id, page.id, value)}
              onCommit={(before) => useStudio.getState().commitPast(project.id, before)}
              before={() => snapshotOf(useStudio.getState().projects.find((item) => item.id === project.id)!)}
            />
          </label>
        </div>
      </details>
    </div>
  );
}

function MetaForm({ project, advanced }: { project: Project; advanced: boolean }) {
  const [name, setName] = useState(project.name);
  const [appName, setAppName] = useState(project.appName);
  const [packageName, setPackageName] = useState(project.packageName);
  useEffect(() => {
    setName(project.name);
    setAppName(project.appName);
    setPackageName(project.packageName);
  }, [project.name, project.appName, project.packageName]);
  return (
    <div className="grid gap-2">
      <label className="text-sm text-muted">
        工程名
        <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => useStudio.getState().updateMeta(project.id, { name })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg" />
      </label>
      <label className="text-sm text-muted">
        应用名
        <input value={appName} onChange={(event) => setAppName(event.target.value)} onBlur={() => useStudio.getState().updateMeta(project.id, { appName })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg" />
      </label>
      <label className="text-sm text-muted">
        包名
        <input value={packageName} onChange={(event) => setPackageName(event.target.value)} onBlur={() => useStudio.getState().updateMeta(project.id, { packageName })} className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(["watch-round", "watch-square"] as const).map((device) => (
          <button
            key={device}
            type="button"
            className={`min-h-11 rounded-md border text-sm ${project.device === device ? "border-accent text-accent" : "border-line text-muted"}`}
            onClick={() => useStudio.getState().updateMeta(project.id, { device })}
          >
            {device === "watch-round" ? "圆表" : "方表"}
          </button>
        ))}
      </div>
      <PagesBlock project={project} />
      <NavBlock project={project} />
      {advanced ? <VarsBlock project={project} /> : <p className="mt-4 text-xs leading-5 text-muted">简易模式只改外观和常用点击。变量、条件和函数在高级模式里配置。长按、滑动和自定义函数还没经过 BlueOS SDK 验证，不会写进可运行结果。</p>}
    </div>
  );
}

function PagesBlock({ project }: { project: Project }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-sm font-medium">页面</p>
      <div className="mt-2 grid gap-2">
        {project.pages.map((page) => (
          <PageName key={page.id} project={project} pageId={page.id} name={page.name} />
        ))}
      </div>
    </div>
  );
}

function PageName({ project, pageId, name }: { project: Project; pageId: string; name: string }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState("");
  useEffect(() => setValue(name), [name]);
  return (
    <div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            const message = useStudio.getState().renamePage(project.id, pageId, value);
            setError(message || "");
            if (message) setValue(name);
          }}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-3 font-mono text-sm"
        />
        <button type="button" className={`min-h-11 shrink-0 rounded-md border px-2 text-xs ${project.startPageId === pageId ? "border-accent text-accent" : "border-line text-muted"}`} onClick={() => useStudio.getState().setStartPage(project.id, pageId)}>
          启动
        </button>
        <button type="button" className="min-h-11 shrink-0 rounded-md border border-line px-2 text-xs text-warn" onClick={() => useStudio.getState().removePage(project.id, pageId)}>
          删除
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-warn">{error}</p> : null}
    </div>
  );
}

function NavBlock({ project }: { project: Project }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <label className="block text-sm text-muted">
        导航
        <select
          value={project.nav?.kind || "none"}
          onChange={(event) => useStudio.getState().setNavKind(project.id, event.target.value as "none" | "bottom" | "top" | "side")}
          className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg"
        >
          <option value="none">不使用</option>
          <option value="bottom">底部</option>
          <option value="top">顶部</option>
          <option value="side">侧边</option>
        </select>
      </label>
      {project.nav?.kind !== "none" ? (
        <div className="mt-2 grid gap-2">
          {project.pages.map((page) => {
            const on = project.nav.items.some((item) => item.pageId === page.id);
            return (
              <button key={page.id} type="button" className={`min-h-11 rounded-md border text-sm ${on ? "border-accent text-accent" : "border-line text-muted"}`} onClick={() => useStudio.getState().toggleNavPage(project.id, page.id)}>
                {on ? "已放入导航 · " : "放入导航 · "}
                {page.name}
              </button>
            );
          })}
          <p className="text-xs leading-5 text-muted">官方文档没有已核对的导航栏组件，生成时会写成按钮，并调用 router.push。</p>
        </div>
      ) : null}
    </div>
  );
}

function VarsBlock({ project }: { project: Project }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">变量</p>
        <button type="button" className="min-h-11 px-2 text-sm text-accent" onClick={() => useStudio.getState().addVariable(project.id)}>
          添加
        </button>
      </div>
      <div className="mt-2 grid gap-2">
        {(project.variables || []).map((item) => (
          <div key={item.id} className="grid gap-2 rounded-xl border border-line p-2">
            <div className="grid grid-cols-[1fr_88px_auto] gap-2">
              <input value={item.key} onChange={(event) => useStudio.getState().patchVariable(project.id, item.id, { key: event.target.value })} className="min-h-11 rounded-md border border-line bg-bg px-2 font-mono text-sm" />
              <input value={item.value} onChange={(event) => useStudio.getState().patchVariable(project.id, item.id, { value: event.target.value })} className="min-h-11 rounded-md border border-line bg-bg px-2 text-sm" />
              <button type="button" className="min-h-11 rounded-md border border-line px-2 text-xs text-warn" onClick={() => useStudio.getState().removeVariable(project.id, item.id)}>
                删除
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={item.scope || "app"}
                onChange={(event) => useStudio.getState().patchVariable(project.id, item.id, { scope: event.target.value === "page" ? "page" : "app", pageId: event.target.value === "page" ? item.pageId || project.pages[0]?.id || "" : "" })}
                className="min-h-11 rounded-md border border-line bg-bg px-2 text-sm"
              >
                <option value="app">全局变量</option>
                <option value="page">页面变量</option>
              </select>
              {item.scope === "page" ? (
                <select
                  value={item.pageId}
                  onChange={(event) => useStudio.getState().patchVariable(project.id, item.id, { pageId: event.target.value })}
                  className="min-h-11 rounded-md border border-line bg-bg px-2 text-sm"
                >
                  {project.pages.map((page) => (
                    <option key={page.id} value={page.id}>{page.name}</option>
                  ))}
                </select>
              ) : (
                <p className="flex min-h-11 items-center text-xs text-muted">所有页面都能用</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">全局变量写进每个页面。页面变量只写进所选页面。文本里的 $变量名 会绑定这个值。</p>
    </div>
  );
}

function Inspector({
  project,
  pageId,
  node,
  onSelect,
}: {
  project: Project;
  pageId: string;
  node: SceneNode;
  onSelect: (ids: string[]) => void;
}) {
  const item = catalogOf(node.type);
  if (!item) return null;
  const page = project.pages.find((entry) => entry.id === pageId)!;
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{item.label}</p>
          <p className="font-mono text-xs text-muted">{item.tag}</p>
        </div>
        <button
          type="button"
          className="grid size-11 place-items-center rounded-md border border-line text-warn"
          aria-label="删除"
          onClick={() => {
            useStudio.getState().removeNodes(project.id, pageId, [node.id]);
            onSelect([]);
          }}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">{item.blurb}</p>
      <p className="mt-1 text-xs leading-5 text-warn">{item.limit}</p>
      <label className="mt-3 block text-sm text-muted">
        名称
        <input
          value={node.name}
          onChange={(event) => useStudio.getState().touchNode(project.id, pageId, node.id, { name: event.target.value.slice(0, 24) })}
          onFocus={(event) => {
            event.currentTarget.dataset.before = snapshotOf(project);
          }}
          onBlur={(event) => useStudio.getState().commitPast(project.id, event.currentTarget.dataset.before || snapshotOf(project))}
          className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg"
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <NumField label="X" value={node.x} onChange={(value) => useStudio.getState().touchNode(project.id, pageId, node.id, { x: value })} project={project} />
        <NumField label="Y" value={node.y} onChange={(value) => useStudio.getState().touchNode(project.id, pageId, node.id, { y: value })} project={project} />
        <NumField label="宽" value={node.w} onChange={(value) => useStudio.getState().touchNode(project.id, pageId, node.id, { w: Math.max(2, value) })} project={project} />
        <NumField label="高" value={node.h} onChange={(value) => useStudio.getState().touchNode(project.id, pageId, node.id, { h: Math.max(2, value) })} project={project} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" className="min-h-11 rounded-md border border-line text-sm" onClick={() => useStudio.getState().patchNode(project.id, pageId, node.id, { x: Math.round((DESIGN - node.w) / 2) })}>
          水平居中
        </button>
        <button type="button" className="min-h-11 rounded-md border border-line text-sm" onClick={() => useStudio.getState().patchNode(project.id, pageId, node.id, { y: Math.round((DESIGN - node.h) / 2) })}>
          垂直居中
        </button>
        <button type="button" className="min-h-11 rounded-md border border-line text-sm" onClick={() => useStudio.getState().moveLayer(project.id, pageId, node.id, 1)}>
          上移一层
        </button>
        <button type="button" className="min-h-11 rounded-md border border-line text-sm" onClick={() => useStudio.getState().moveLayer(project.id, pageId, node.id, -1)}>
          下移一层
        </button>
      </div>
      <div className="mt-3 grid gap-3">
        {item.fields.map((field) => (
          <FieldEditor key={field.key} field={field} project={project} pageId={pageId} node={node} />
        ))}
      </div>
      <ActionsEditor project={project} pageId={pageId} node={node} />
      <p className="mt-3 text-xs text-muted">图层 {page.nodes.findIndex((entry) => entry.id === node.id) + 1} / {page.nodes.length}</p>
    </div>
  );
}

function ActionsEditor({ project, pageId, node }: { project: Project; pageId: string; node: SceneNode }) {
  const actions = node.actions ?? [];
  function write(next: AppAction[]) {
    useStudio.getState().patchNode(project.id, pageId, node.id, { actions: next });
  }
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-sm font-medium">动作</p>
      <p className="mt-1 text-xs leading-5 text-muted">默认是点击。长按、双击、滑动只在这份工程里保存，预览不会当成手表已支持。</p>
      <div className="mt-2 grid gap-2">
        {actions.map((action, index) => (
          <div key={action.id} className="rounded-md border border-line p-2">
            <div className="flex gap-2">
              <select
                value={action.kind}
                onChange={(event) => {
                  const next = actions.slice();
                  next[index] = { ...action, kind: event.target.value as AppAction["kind"] };
                  write(next);
                }}
                className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-sm"
              >
                <option value="navigate">打开页面</option>
                <option value="back">返回上一页</option>
                <option value="toast">显示提示</option>
                <option value="show">显示组件</option>
                <option value="hide">隐藏组件</option>
                <option value="setText">修改文字</option>
                <option value="setVar">修改变量</option>
                <option value="call">调用函数</option>
              </select>
              <button type="button" className="min-h-11 rounded-md border border-line px-2 text-xs text-warn" onClick={() => write(actions.filter((item) => item.id !== action.id))}>
                删除
              </button>
            </div>
            <select
              value={action.trigger || "click"}
              onChange={(event) => {
                const next = actions.slice();
                next[index] = { ...action, trigger: event.target.value as AppAction["trigger"] };
                write(next);
              }}
              className="mt-2 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm"
            >
              <option value="click">点击时</option>
              <option value="longpress">长按时（手表未验证）</option>
              <option value="double">双击时（手表未验证）</option>
              <option value="swipe">滑动时（手表未验证）</option>
            </select>
            {action.kind === "navigate" ? (
              <select
                value={action.pageName}
                onChange={(event) => {
                  const next = actions.slice();
                  next[index] = { ...action, pageName: event.target.value };
                  write(next);
                }}
                className="mt-2 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm"
              >
                <option value="">选择页面</option>
                {project.pages.map((page) => (
                  <option key={page.id} value={page.name}>{page.name}</option>
                ))}
              </select>
            ) : null}
            {action.kind === "toast" || action.kind === "setText" || action.kind === "setVar" ? (
              <input
                value={action.kind === "setVar" ? action.varValue : action.text}
                placeholder={action.kind === "toast" ? "提示文字" : "新文字"}
                onChange={(event) => {
                  const next = actions.slice();
                  next[index] = action.kind === "setVar" ? { ...action, varValue: event.target.value } : { ...action, text: event.target.value };
                  write(next);
                }}
                className="mt-2 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm"
              />
            ) : null}
            {action.kind === "call" ? (
              <input
                value={action.varKey}
                placeholder="函数名，例如 openHome"
                onChange={(event) => {
                  const next = actions.slice();
                  next[index] = { ...action, varKey: event.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 21) };
                  write(next);
                }}
                className="mt-2 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm"
              />
            ) : null}
            <input
              value={action.whenKey}
              placeholder="可选：变量相等才执行，变量名"
              onChange={(event) => {
                const next = actions.slice();
                next[index] = { ...action, whenKey: event.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 21) };
                write(next);
              }}
              className="mt-2 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm"
            />
            {action.whenKey ? (
              <input
                value={action.whenValue}
                placeholder="要相等的值"
                onChange={(event) => {
                  const next = actions.slice();
                  next[index] = { ...action, whenValue: event.target.value.slice(0, 40) };
                  write(next);
                }}
                className="mt-2 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm"
              />
            ) : null}
            {action.kind === "show" || action.kind === "hide" || action.kind === "setText" ? (
              <select
                value={action.nodeId}
                onChange={(event) => {
                  const next = actions.slice();
                  next[index] = { ...action, nodeId: event.target.value };
                  write(next);
                }}
                className="mt-2 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm"
              >
                <option value="">选择组件</option>
                {project.pages.flatMap((page) => page.nodes).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            ) : null}
            {action.kind === "setVar" ? (
              <select
                value={action.varKey}
                onChange={(event) => {
                  const next = actions.slice();
                  next[index] = { ...action, varKey: event.target.value };
                  write(next);
                }}
                className="mt-2 min-h-11 w-full rounded-md border border-line bg-bg px-2 text-sm"
              >
                <option value="">选择变量</option>
                {(project.variables || []).map((item) => (
                  <option key={item.id} value={item.key}>{item.key}</option>
                ))}
              </select>
            ) : null}
          </div>
        ))}
      </div>
      <button type="button" className="mt-2 min-h-11 w-full rounded-md border border-line text-sm" onClick={() => write([...actions, makeAction("navigate", { pageName: project.pages.find((page) => page.id !== pageId)?.name || "" })])}>
        添加动作
      </button>
      <p className="mt-2 text-xs leading-5 text-muted">预览会执行这些动作。源码里跳转用 router.push，返回用 router.back，提示用 prompt.showToast。</p>
    </div>
  );
}

function FieldEditor({ field, project, pageId, node }: { field: Field; project: Project; pageId: string; node: SceneNode }) {
  const value = node.props[field.key];
  if (field.kind === "bool") {
    return (
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        {field.label}
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => useStudio.getState().patchNode(project.id, pageId, node.id, { props: { [field.key]: event.target.checked } })}
          className="size-5 accent-accent"
        />
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="block text-sm text-muted">
        {field.label}
        <select
          value={String(value)}
          onChange={(event) => useStudio.getState().patchNode(project.id, pageId, node.id, { props: { [field.key]: event.target.value } })}
          className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg"
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.kind === "color") {
    return (
      <label className="block text-sm text-muted">
        {field.label}
        <ColorValue
          value={String(value)}
          onLive={(next) => useStudio.getState().touchNode(project.id, pageId, node.id, { props: { [field.key]: next } })}
          before={() => snapshotOf(useStudio.getState().projects.find((item) => item.id === project.id)!)}
          onCommit={(before) => useStudio.getState().commitPast(project.id, before)}
        />
      </label>
    );
  }
  if (field.kind === "number") {
    return (
      <label className="block text-sm text-muted">
        {field.label}
        <input
          type="number"
          min={field.min}
          max={field.max}
          value={Number(value)}
          onFocus={(event) => {
            event.currentTarget.dataset.before = snapshotOf(project);
          }}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next)) return;
            useStudio.getState().touchNode(project.id, pageId, node.id, { props: { [field.key]: Math.min(field.max, Math.max(field.min, Math.round(next))) } });
          }}
          onBlur={(event) => useStudio.getState().commitPast(project.id, event.currentTarget.dataset.before || snapshotOf(project))}
          className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg"
        />
      </label>
    );
  }
  return (
    <label className="block text-sm text-muted">
      {field.label}
      <input
        value={String(value ?? "")}
        onFocus={(event) => {
          event.currentTarget.dataset.before = snapshotOf(project);
        }}
        onChange={(event) => useStudio.getState().touchNode(project.id, pageId, node.id, { props: { [field.key]: event.target.value } })}
        onBlur={(event) => useStudio.getState().commitPast(project.id, event.currentTarget.dataset.before || snapshotOf(project))}
        className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg"
      />
    </label>
  );
}

function NumField({ label, value, onChange, project }: { label: string; value: number; onChange: (value: number) => void; project: Project }) {
  return (
    <label className="text-sm text-muted">
      {label}
      <input
        type="number"
        value={value}
        onFocus={(event) => {
          event.currentTarget.dataset.before = snapshotOf(project);
        }}
        onChange={(event) => onChange(Math.round(Number(event.target.value) || 0))}
        onBlur={(event) => useStudio.getState().commitPast(project.id, event.currentTarget.dataset.before || snapshotOf(project))}
        className="mt-1 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-fg"
      />
    </label>
  );
}

function ColorValue({
  value,
  onLive,
  onCommit,
  before,
}: {
  value: string;
  onLive: (value: string) => void;
  onCommit: (before: string) => void;
  before: () => string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const safe = asColor(value) || "#000000";
  return (
    <span className="mt-1 flex gap-2">
      <input
        type="color"
        value={safe}
        aria-label="取色"
        onFocus={(event) => {
          event.currentTarget.dataset.before = before();
        }}
        onChange={(event) => onLive(event.target.value.toUpperCase())}
        onBlur={(event) => onCommit(event.currentTarget.dataset.before || before())}
        className="size-11 rounded-md border border-line bg-bg"
      />
      <input
        value={text}
        onFocus={(event) => {
          event.currentTarget.dataset.before = before();
        }}
        onChange={(event) => {
          setText(event.target.value);
          const color = asColor(event.target.value);
          if (color) onLive(color);
        }}
        onBlur={(event) => {
          const color = asColor(text);
          if (color) onLive(color);
          else setText(value);
          onCommit(event.currentTarget.dataset.before || before());
        }}
        className="min-h-11 flex-1 rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg"
      />
    </span>
  );
}

function LogicPanel({ project, page, node, advanced }: { project: Project; page: Project["pages"][number]; node?: SceneNode; advanced: boolean }) {
  const actions = node?.actions ?? [];
  return (
    <div className="p-3">
      <p className="text-sm leading-6 text-muted">这里只看逻辑关系，不显示页面源码。点击动作仍在「属性」里修改。简易和高级共用同一份工程。</p>
      {!node ? <p className="mt-3 text-sm text-muted">先选中一个组件。</p> : null}
      {node ? <p className="mt-3 text-sm font-semibold">{node.name}</p> : null}
      <ol className="mt-2 grid gap-2">
        {actions.length === 0 && node ? <li className="text-sm text-muted">这个组件还没有点击动作。</li> : null}
        {actions.map((action, index) => (
          <li key={action.id} className="rounded-xl border border-line px-3 py-2 text-sm">
            {index + 1}. {(action.trigger && action.trigger !== "click" ? "非点击触发，" : "点击后")}{actionLabel(action)}
          </li>
        ))}
      </ol>
      {advanced && node ? (
        <button
          type="button"
          className="mt-3 min-h-11 w-full rounded-md border border-line text-sm"
          onClick={() => {
            useStudio.getState().updateProject(project.id, (current) => ({
              ...current,
              timeBindings: [
                ...(current.timeBindings || []).filter((item) => item.nodeId !== node.id),
                { id: `t${node.id}`.slice(0, 24), nodeId: node.id, format: "time" as const },
              ],
            }));
          }}
        >
          预览里把当前时间绑到这个组件
        </button>
      ) : null}
      {advanced ? (
        <div className="mt-4 rounded-xl border border-line p-3 text-xs leading-5 text-muted">
          待验证，不会写成手表已支持：长按、滑动、双击、条件、循环和自定义函数。网页预览可以按结构化步骤演示「调用函数」和「变量相等才执行」，这不是真机验收。时间绑定只在预览里每秒刷新。
        </div>
      ) : (
        <p className="mt-4 text-xs leading-5 text-muted">切到高级模式可以查看尚未验证的能力，不会因此改掉现有点击。</p>
      )}
      <p className="mt-3 text-xs text-muted">变量 {project.variables.length} 个 · 页面 {project.pages.length} 个 · 当前页 {page.name}</p>
    </div>
  );
}

function actionLabel(action: AppAction): string {
  if (action.kind === "navigate") return `打开页面 ${action.pageName || "未选"}`;
  if (action.kind === "back") return "返回上一页";
  if (action.kind === "toast") return `提示「${action.text || "未填写"}」`;
  if (action.kind === "show") return `显示 ${action.nodeId || "未选组件"}`;
  if (action.kind === "hide") return `隐藏 ${action.nodeId || "未选组件"}`;
  if (action.kind === "setText") return `把 ${action.nodeId || "组件"} 的文字改成「${action.text}」`;
  if (action.kind === "call") return `调用函数 ${action.varKey || "未命名"}`;
  return `把变量 ${action.varKey || "未选"} 设为「${action.varValue}」`;
}

function PackPanel({ project }: { project: Project }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [buildNote, setBuildNote] = useState("");
  const checked = validateDsl(projectToDsl(project));
  const problems = checked.issues.filter((issue) => issue.level === "error");
  return (
    <div className="p-3">
      <p className="text-sm font-semibold">检查</p>
      {problems.length === 0 ? <p className="mt-2 text-sm text-muted">没有挡住保存的错误。这不是真机验收。</p> : (
        <ul className="mt-2 text-sm text-warn">
          {problems.map((issue, index) => (
            <li key={index}>{issue.path} {issue.message}</li>
          ))}
        </ul>
      )}
      <p className="mt-5 text-sm font-semibold">工程包</p>
      <p className="mt-1 text-sm leading-6 text-muted">下载可再次导入的项目工程包，不包含平台源码，也不是 RPK。同一内容再次下载不重复扣工程下载积分。</p>
      <button
        type="button"
        disabled={busy}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-semibold text-accent-fg disabled:opacity-60"
        onClick={() => {
          setBusy(true);
          setError("");
          // 服务端只打包已保存的内容，所以先保存当前编辑结果再下载。
          void call("syncProject", { project })
            .then(() => call<{ ok: boolean; fileName: string; zipBase64: string; reused?: boolean }>("exportBundle", { projectId: project.id }))
            .then((file) => {
              const bytes = Uint8Array.from(atob(file.zipBase64), (char) => char.charCodeAt(0));
              const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = file.fileName;
              link.click();
              URL.revokeObjectURL(url);
              setNote(file.reused ? "工程包已下载（内容未变，未重复扣分）" : "工程包已下载");
            })
            .catch((reason) => setError(errorText(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <Download className="size-4" />
        {busy ? "正在准备…" : "下载工程包"}
      </button>
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
      {error ? <p className="mt-2 text-sm text-warn">{error}</p> : null}
      <p className="mt-5 text-sm font-semibold">RPK 成品</p>
      <p className="mt-1 text-sm leading-6 text-muted">使用 BlueOS 官方工具链生成 RPK。当前环境尚未完成验证，不会显示打包成功，也不会扣 RPK 积分。</p>
      <button
        type="button"
        className="mt-3 min-h-11 w-full rounded-md border border-line text-sm"
        onClick={() => {
          setBuildNote("");
          void call<{ message: string }>("requestBuild", { projectId: project.id })
            .then((outcome) => setBuildNote(outcome.message))
            .catch((reason) => setBuildNote(errorText(reason)));
        }}
      >
        申请 RPK 打包
      </button>
      {buildNote ? <p className="mt-2 text-sm leading-6 text-muted">{buildNote}</p> : null}
      <div className="mt-6 border-t border-line pt-4">
        <p className="text-sm font-semibold">修订</p>
        <p className="mt-1 text-xs leading-5 text-muted">保存后的修订不会被后面的编辑改掉。恢复只是复制回画布。</p>
        <RevisionList project={project} />
      </div>
    </div>
  );
}

function RevisionList({ project }: { project: Project }) {
  const [note, setNote] = useState("手动修订");
  return (
    <>
      <div className="mt-2 flex gap-2">
        <input value={note} onChange={(event) => setNote(event.target.value)} className="min-h-11 flex-1 rounded-md border border-line bg-bg px-3 text-sm" />
        <button type="button" className="min-h-11 rounded-md border border-line px-3 text-sm" onClick={() => useStudio.getState().saveRevision(project.id, note)}>
          保存
        </button>
      </div>
      <ul className="mt-3">
        {project.revisions.length === 0 ? <li className="text-sm text-muted">还没有修订。</li> : null}
        {project.revisions.map((revision) => (
          <li key={revision.id} className="mt-2 flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate">{revision.note}</span>
              <span className="block text-xs text-muted">{new Date(revision.at).toLocaleString()}</span>
            </span>
            <button type="button" className="min-h-11 shrink-0 rounded-md border border-line px-3" onClick={() => useStudio.getState().restoreRevision(project.id, revision.id)}>
              恢复
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
