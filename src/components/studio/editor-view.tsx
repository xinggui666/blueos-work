import { prepareDelivery } from "@/lib/platform/delivery";
import { Link } from "@tanstack/react-router";
import { Bug, ChevronLeft, Download, Eye, EyeOff, Layers, Lock, LockOpen, Redo2, Shapes, SlidersHorizontal, Trash2, Undo2, Package, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { NodeGlyph } from "@/components/studio/face";
import { call, errorText, useCloud, useComponentLock } from "@/lib/platform/client";
import {
  CATALOG,
  DESIGN,
  freeSpot,
  asColor,
  catalogOf,
  snapshotOf,
  type CompType,
  type Field,
  type Project,
  type SceneNode,
} from "@/lib/blueos/model";
import { useStudio, useStudioHydrated } from "@/lib/blueos/store";
import { ComponentLogic, LogicProvider, LogicWorkspace, useIssues, useProjectDoc, type Focus } from "@/components/studio/logic-editor";
import { BuildPanel } from "@/components/studio/build-panel";
import { saveBase64 } from "@/lib/platform/save-file";
import { DebugPanel, previewNode, useGestures, usePreview, type Preview } from "@/components/studio/preview-debug";
import type { EditorProject } from "@/lib/protocol/editor";
import { inspectBproj, type ImportPreview } from "@/lib/protocol/bproj";
import { issueTarget, labelForPath, type IssueTarget } from "@/lib/protocol/logic-tools";
import type { ProjectDoc } from "@/lib/protocol/schema";

type Mode = "library" | "layers" | "props" | "logic" | "pack" | "debug";

const MODES: { id: Mode; label: string; icon: typeof Shapes }[] = [
  { id: "library", label: "组件", icon: Shapes },
  { id: "layers", label: "图层", icon: Layers },
  { id: "props", label: "属性", icon: SlidersHorizontal },
  { id: "logic", label: "逻辑", icon: Workflow },
  { id: "pack", label: "交付", icon: Package },
  { id: "debug", label: "调试", icon: Bug },
];

export function EditorView({ projectId }: { projectId: string }) {
  const cloud = useCloud();
  const hydrated = useStudioHydrated();
  const project = useStudio((state) => state.projects.find((item) => item.id === projectId));
  if (!hydrated || !cloud.ready) return <main className="grid h-dvh place-items-center text-sm text-muted">{cloud.detail || "正在打开工程…"}</main>;
  if (!project) {
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
  return <Workspace project={project as EditorProject} cloudDetail={cloud.detail} />;
}

function Workspace({ project, cloudDetail }: { project: EditorProject; cloudDetail: string }) {
  const projectId = project.id;
  const undo = useStudio((state) => state.undo);
  const redo = useStudio((state) => state.redo);
  const past = useStudio((state) => state.past[projectId]?.length ?? 0);
  const future = useStudio((state) => state.future[projectId]?.length ?? 0);
  const [pageId, setPageId] = useState<string>(project.pages[0].id);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("props");
  const [sheet, setSheet] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [focus, setFocus] = useState<Focus>({ tab: "events" });
  const preview = usePreview();
  const doc = useProjectDoc(project);
  const previewOn = Boolean(preview.runtime);
  const rt = preview.runtime;
  const shownPageId = rt ? rt.state.pageId : pageId;
  const page = project.pages.find((item) => item.id === shownPageId) ?? project.pages.find((item) => item.id === pageId) ?? project.pages[0];

  useEffect(() => {
    if (!project.pages.some((item) => item.id === pageId)) setPageId(project.pages[0].id);
  }, [project.pages, pageId]);

  // 定位后滚动到对应的事件/动作/变量卡片。
  useEffect(() => {
    const id = focus.actionId ?? focus.id;
    if (!id) return;
    const timer = window.setTimeout(() => document.getElementById(`logic-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
    return () => window.clearTimeout(timer);
  }, [focus]);

  const locate = useCallback(
    (target: IssueTarget) => {
      const openLogic = (next: Focus) => {
        setFocus(next);
        setMode("logic");
        setSheet(true);
      };
      switch (target.kind) {
        case "event":
          return openLogic({ tab: "events", id: target.id, actionId: target.actionId });
        case "function":
          return openLogic({ tab: "functions", id: target.id, actionId: target.actionId });
        case "variable":
          return openLogic({ tab: "variables", id: target.id });
        case "timer":
          return openLogic({ tab: "timers", id: target.id });
        case "binding": {
          const owner = project.pages.find((item) => item.nodes.some((node) => node.id === target.componentId));
          if (owner && !rt) setPageId(owner.id);
          setSelected([target.componentId]);
          return openLogic({ tab: "bindings", id: target.id });
        }
        case "component":
          if (!rt) setPageId(target.pageId);
          setSelected([target.id]);
          setMode("props");
          setSheet(true);
          return;
        case "page":
          if (!rt) setPageId(target.id);
          return;
        default:
          setMode("pack");
      }
    },
    [project.pages, rt],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (previewOn) return;
        if (event.shiftKey) redo(projectId);
        else undo(projectId);
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        if (!previewOn) redo(projectId);
      } else if (meta && event.key.toLowerCase() === "d" && !previewOn && selected.length) {
        event.preventDefault();
        const ids = useStudio.getState().duplicateNodes(projectId, page.id, selected);
        if (ids.length) setSelected(ids);
      } else if (!previewOn && (event.key === "Delete" || event.key === "Backspace") && selected.length) {
        event.preventDefault();
        useStudio.getState().removeNodes(projectId, page.id, selected);
        setSelected([]);
      } else if (event.key === "Escape") setSelected([]);
      else if (!previewOn && selected.length && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
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

  function openMode(next: Mode) {
    setMode(next);
    setSheet(true);
  }

  function togglePreview() {
    if (rt) {
      preview.stop();
      if (mode === "debug") setMode("props");
      return;
    }
    setSelected([]);
    preview.start(doc);
    setMode("debug");
  }

  const modes = MODES.filter((item) => item.id !== "debug" || previewOn);
  const sideModes: Mode[] = previewOn ? ["debug", "logic", "pack"] : ["props", "logic", "pack"];
  const sideMode: Mode = sideModes.includes(mode) ? mode : sideModes[0];
  const panel = (which: Mode) =>
    which === "debug" ? (
      <DebugPanel preview={preview} doc={doc} locate={locate} />
    ) : which === "library" ? (
      <Library project={project} pageId={page.id} onAdded={(ids) => { setSelected(ids); setSheet(false); }} />
    ) : which === "layers" ? (
      <LayerList project={project} page={page} selected={selected} onSelect={setSelected} />
    ) : (
      <Side project={project} doc={doc} pageId={page.id} selected={selected} mode={which as "props" | "logic" | "pack"} advanced={advanced} onSelect={setSelected} onFocus={(next) => { setFocus(next); setMode("logic"); setSheet(true); }} locate={locate} />
    );

  return (
    <LogicProvider project={project} advanced={advanced} pageId={page.id} selectedComponentId={selected[selected.length - 1]} focus={focus} setFocus={setFocus} locate={locate}>
    <div className="relative flex h-full min-h-0 flex-col bg-bg">
      <header className="glass border-b border-line">
        <div className="flex items-center gap-2 px-2 py-2">
          <Link to="/" aria-label="返回" className="grid size-11 place-items-center rounded-xl border border-line bg-surface">
            <ChevronLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{project.name}</p>
            <p className="truncate text-xs text-muted">
              {previewOn ? "模拟预览，不是真机" : cloudDetail || "云端"} · {project.pages.length} 页
            </p>
          </div>
          <button type="button" className={`min-h-11 rounded-xl border px-3 text-sm ${advanced ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface"}`} onClick={() => setAdvanced((value) => !value)}>
            {advanced ? "高级" : "简易"}
          </button>
          <button type="button" className={`min-h-11 rounded-xl border px-3 text-sm ${previewOn ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface"}`} onClick={togglePreview}>
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
              onClick={() => {
                if (rt) {
                  rt.openPage(item.id);
                  preview.bump();
                } else setPageId(item.id);
              }}
            >
              {item.name}
              {item.id === project.startPageId ? " · 启动" : ""}
            </button>
          ))}
          {!previewOn ? (
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
          ) : null}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[272px_minmax(0,1fr)_340px]">
        <aside className="hidden min-h-0 flex-col border-r border-line lg:flex">
          <Library project={project} pageId={page.id} onAdded={setSelected} />
          <LayerList project={project} page={page} selected={selected} onSelect={setSelected} />
        </aside>
        <Stage project={project} pageId={page.id} selected={selected} preview={preview} onSelect={setSelected} />
        <aside className="hidden min-h-0 flex-col border-l border-line lg:flex">
          <div className="flex border-b border-line">
            {sideModes.map((item) => (
              <button key={item} type="button" className={`min-h-11 flex-1 text-sm ${sideMode === item ? "text-accent" : "text-muted"}`} onClick={() => setMode(item)}>
                {MODES.find((entry) => entry.id === item)?.label}
              </button>
            ))}
          </div>
          <div className="studio-scroll min-h-0 flex-1 overflow-y-auto">{panel(sideMode)}</div>
        </aside>
      </div>
      <nav className="glass grid border-t border-line lg:hidden" style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }}>
        {modes.map((item) => {
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
        <div role="region" aria-label={`${MODES.find((item) => item.id === mode)?.label ?? ""}面板`} data-testid="mobile-sheet" className="glass absolute inset-x-0 bottom-14 z-20 flex max-h-[62%] flex-col rounded-t-2xl border border-line lg:hidden">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-sm font-semibold">{MODES.find((item) => item.id === mode)?.label}</p>
            <button type="button" className="min-h-11 px-2 text-sm text-muted" onClick={() => setSheet(false)}>
              收起
            </button>
          </div>
          <div className="studio-scroll min-h-0 flex-1 overflow-y-auto">{panel(mode)}</div>
        </div>
      ) : null}
    </div>
    </LogicProvider>
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
                  // 找一个不和现有组件重叠的位置，避免新组件叠在一起。
                  const nodes = project.pages.find((page) => page.id === pageId)?.nodes ?? [];
                  const spot = freeSpot(nodes, item.w, item.h, { round: project.device === "watch-round" });
                  const id = useStudio.getState().addNode(project.id, pageId, item.type, spot.x, spot.y);
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
                <span className="mr-1 font-mono text-xs text-muted">{page.nodes.length - nodes.indexOf(node)}</span>
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
  preview: live,
  onSelect,
}: {
  project: Project;
  pageId: string;
  selected: string[];
  preview: Preview;
  onSelect: (ids: string[]) => void;
}) {
  const preview = Boolean(live.runtime);
  const gestures = useGestures(live.interact);
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
      gestures.onDown(node.id, event.clientX, event.clientY);
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
    return live.runtime ? previewNode(live.runtime, node) : node;
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
                  onPointerUp={(event) => {
                    if (!preview) return;
                    event.stopPropagation();
                    gestures.onUp(node.id, event.clientX, event.clientY, () => {
                      if (node.type === "switch") live.interact(node.id, "change", !node.props.checked);
                    });
                  }}
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
                      if (live.runtime) {
                        live.runtime.openPage(item.pageId);
                        live.bump();
                      }
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            {live.toast ? (
              <div className="absolute bottom-20 left-8 right-8 rounded-full bg-fg px-3 py-2 text-center text-sm text-surface">{live.toast}</div>
            ) : null}
            {guides.x ? <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent" style={{ left: DESIGN / 2 }} /> : null}
            {guides.y ? <div className="pointer-events-none absolute left-0 right-0 h-px bg-accent" style={{ top: DESIGN / 2 }} /> : null}
          </div>
          {page.nodes
            .filter((node) => !preview && selected.includes(node.id) && !node.hidden)
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
  doc,
  pageId,
  selected,
  mode,
  advanced,
  onSelect,
  onFocus,
  locate,
}: {
  project: EditorProject;
  doc: ProjectDoc;
  pageId: string;
  selected: string[];
  mode: "props" | "logic" | "pack";
  advanced: boolean;
  onSelect: (ids: string[]) => void;
  onFocus: (focus: Focus) => void;
  locate: (target: IssueTarget) => void;
}) {
  const page = project.pages.find((item) => item.id === pageId)!;
  const node = page.nodes.find((item) => item.id === selected[selected.length - 1]);
  if (mode === "logic") return <LogicWorkspace />;
  if (mode === "pack") return <PackPanel project={project} doc={doc} locate={locate} />;
  return (
    <div className="p-3">
      {selected.length > 0 ? <AlignBar project={project} pageId={page.id} selected={selected} onSelect={onSelect} /> : null}
      {node ? (
        <Inspector project={project} pageId={page.id} node={node} onSelect={onSelect} onFocus={onFocus} />
      ) : (
        <p className="text-sm leading-6 text-muted">选中页面上的组件后，在这里改文字、颜色、点击动作和数据绑定。普通编辑不显示源码。</p>
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

function AlignBar({ project, pageId, selected, onSelect }: { project: Project; pageId: string; selected: string[]; onSelect: (ids: string[]) => void }) {
  const align = (how: Parameters<ReturnType<typeof useStudio.getState>["alignNodes"]>[3]) => useStudio.getState().alignNodes(project.id, pageId, selected, how);
  const many = selected.length > 1;
  const buttons: [Parameters<typeof align>[0], string][] = [
    ["left", "左对齐"],
    ["hcenter", "水平居中"],
    ["right", "右对齐"],
    ["top", "顶对齐"],
    ["vcenter", "垂直居中"],
    ["bottom", "底对齐"],
  ];
  return (
    <div className="mb-3 rounded-md border border-line p-2">
      <p className="text-xs text-muted">{many ? `已选 ${selected.length} 个，按选区对齐（Shift+点击多选）` : "对齐到画布（Shift+点击多选）"}</p>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {buttons.map(([how, label]) => (
          <button key={how} type="button" className="min-h-9 rounded-md border border-line text-xs" onClick={() => align(how)}>
            {label}
          </button>
        ))}
        {many ? (
          <>
            <button type="button" disabled={selected.length < 3} className="min-h-9 rounded-md border border-line text-xs disabled:opacity-40" onClick={() => align("hspace")}>
              水平等距
            </button>
            <button type="button" disabled={selected.length < 3} className="min-h-9 rounded-md border border-line text-xs disabled:opacity-40" onClick={() => align("vspace")}>
              垂直等距
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="min-h-9 rounded-md border border-line text-xs"
          onClick={() => {
            const ids = useStudio.getState().duplicateNodes(project.id, pageId, selected);
            if (ids.length) onSelect(ids);
          }}
        >
          复制组件
        </button>
      </div>
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
      <p className="mt-4 text-xs leading-5 text-muted">{advanced ? "变量、事件、函数和计时器在「逻辑」里管理。" : "简易模式只显示外观和常用动作。条件、函数和计时器在高级模式里。"}长按、滑动等手势还没经过 BlueOS 真机验证。</p>
    </div>
  );
}

function PagesBlock({ project }: { project: Project }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-sm font-medium">页面</p>
      <p className="mt-1 text-xs text-muted">页面名会成为 RPK 的页面目录，只能用英文字母和数字。</p>
      <div className="mt-2 grid gap-3">
        {project.pages.map((page, index) => (
          <PageName key={page.id} project={project} pageId={page.id} name={page.name} index={index} />
        ))}
      </div>
    </div>
  );
}

function PageName({ project, pageId, name, index }: { project: Project; pageId: string; name: string; index: number }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState("");
  const extras = (project as EditorProject).protocolExtras;
  const title = extras?.pageTitles[pageId] ?? "";
  const [titleText, setTitleText] = useState(title);
  useEffect(() => setValue(name), [name]);
  useEffect(() => setTitleText(title), [title]);
  const studio = useStudio.getState;
  return (
    <div className="rounded-md border border-line p-2">
      <div className="flex gap-2">
        <input
          aria-label="页面名"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            const message = studio().renamePage(project.id, pageId, value);
            setError(message || "");
            if (message) setValue(name);
          }}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-3 font-mono text-sm"
        />
        <button type="button" className={`min-h-11 shrink-0 rounded-md border px-2 text-xs ${project.startPageId === pageId ? "border-accent text-accent" : "border-line text-muted"}`} onClick={() => studio().setStartPage(project.id, pageId)}>
          启动
        </button>
      </div>
      {extras ? (
        <input
          aria-label="页面标题"
          value={titleText}
          placeholder="页面标题（可选，可中文）"
          onChange={(event) => setTitleText(event.target.value)}
          onBlur={() => titleText !== title && studio().setPageTitle(project.id, pageId, titleText)}
          className="mt-2 min-h-11 w-full rounded-md border border-line bg-bg px-3 text-sm"
        />
      ) : null}
      <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
        <button type="button" disabled={index === 0} className="min-h-9 rounded-md border border-line disabled:opacity-40" onClick={() => studio().movePage(project.id, pageId, -1)}>
          前移
        </button>
        <button type="button" disabled={index === project.pages.length - 1} className="min-h-9 rounded-md border border-line disabled:opacity-40" onClick={() => studio().movePage(project.id, pageId, 1)}>
          后移
        </button>
        <button type="button" className="min-h-9 rounded-md border border-line" onClick={() => studio().duplicatePage(project.id, pageId)}>
          复制
        </button>
        <button type="button" disabled={project.pages.length <= 1} className="min-h-9 rounded-md border border-line text-warn disabled:opacity-40" onClick={() => studio().removePage(project.id, pageId)}>
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

function Inspector({
  project,
  pageId,
  node,
  onSelect,
  onFocus,
}: {
  project: Project;
  pageId: string;
  node: SceneNode;
  onSelect: (ids: string[]) => void;
  onFocus: (focus: Focus) => void;
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
      <button type="button" className="mt-3 min-h-11 w-full rounded-md border border-line text-sm" onClick={() => useStudio.getState().patchNode(project.id, pageId, node.id, { props: { ...(catalogOf(node.type)?.defaults ?? {}) } })}>
        恢复默认外观
      </button>
      <ComponentLogic componentId={node.id} openInLogic={onFocus} />
      <p className="mt-3 text-xs text-muted">图层 {page.nodes.findIndex((entry) => entry.id === node.id) + 1} / {page.nodes.length}</p>
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

function PackPanel({ project, doc, locate }: { project: Project; doc: ProjectDoc; locate: (target: IssueTarget) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [report, setReport] = useState<ImportPreview | null>(null);
  const issues = useIssues(doc);
  const problems = issues.filter((issue) => issue.level === "error");
  const warns = issues.filter((issue) => issue.level === "warn");
  return (
    <div className="p-3">
      <p className="text-sm font-semibold">检查</p>
      <p className="mt-1 text-xs text-muted">
        协议 v{doc.schemaVersion} · {doc.pages.length} 页 · {doc.pages.reduce((n, p) => n + p.components.length, 0)} 个组件 · {doc.events.length} 个事件 · {doc.variables.length} 个变量 · {doc.functions.length} 个函数 · {doc.bindings.length} 个绑定
      </p>
      {problems.length === 0 ? <p className="mt-2 text-sm text-muted">没有错误{warns.length ? `，${warns.length} 个提醒` : ""}。这不是真机验收。</p> : null}
      <ul className="mt-2 grid gap-1">
        {problems.slice(0, 20).map((issue, index) => (
          <li key={index}>
            <button type="button" className="min-h-9 w-full text-left text-xs text-warn" onClick={() => locate(issueTarget(doc, issue.path))}>
              {labelForPath(doc, issue.path)}：{issue.message}
            </button>
          </li>
        ))}
      </ul>
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
          void prepareDelivery(project, call)
            .then((fixed) => call<{ ok: boolean; fileName: string; zipBase64: string; reused?: boolean }>("exportBundle", { projectId: project.id, ...fixed }))
            .then(async (file) => {
              const saved = await saveBase64(file.fileName, file.zipBase64);
              if (!saved) setNote(file.reused ? "已取消保存（内容未变，未重复扣分）" : "已取消保存，本次已计入下载额度，内容不变时再次下载不重复扣分");
              else setNote(file.reused ? "工程包已下载（内容未变，未重复扣分）" : "工程包已下载");
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
      <label className="mt-3 block text-sm text-muted">
        校验 .bproj 文件（只检查，不导入）
        <input
          type="file"
          accept=".bproj,application/zip"
          className="mt-1 block w-full text-xs"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setReport(null);
            void file
              .arrayBuffer()
              .then((buffer) => inspectBproj(new Uint8Array(buffer)))
              .then(setReport)
              .catch((reason) => setError(errorText(reason)));
          }}
        />
      </label>
      {report ? <BprojReport report={report} /> : null}
      <BuildPanel project={project} />
      <div className="mt-6 border-t border-line pt-4">
        <p className="text-sm font-semibold">修订</p>
        <p className="mt-1 text-xs leading-5 text-muted">保存后的修订不会被后面的编辑改掉。恢复只是复制回画布。</p>
        <RevisionList project={project} />
      </div>
    </div>
  );
}

function BprojReport({ report }: { report: ImportPreview }) {
  const errors = report.issues.filter((issue) => issue.level === "error");
  return (
    <div className={`mt-2 rounded-md border p-2 text-xs leading-5 ${report.ok ? "border-line" : "border-warn"}`}>
      <p className={report.ok ? "text-fg" : "text-warn"}>{report.ok ? "校验通过：文件完整，可以导入。" : "校验未通过，不能导入。"}</p>
      {report.doc ? (
        <p className="text-muted">
          {report.doc.project.name} · 协议 v{report.doc.schemaVersion} · {report.doc.pages.length} 页 · {report.doc.events.length} 个事件
        </p>
      ) : null}
      <p className="text-muted">完整性：{report.integrity === "verified" ? "每个文件的 SHA-256 都已核对" : report.integrity === "legacy" ? "旧版工程包，没有文件校验值" : "校验失败"}</p>
      {report.from !== 2 && report.from !== "invalid" ? <p className="text-muted">来源版本 {String(report.from)}，导入时会自动迁移{report.steps.length ? `（${report.steps.join(" → ")}）` : ""}。</p> : null}
      {report.contentSha256 ? <p className="break-all font-mono text-muted">内容 SHA-256 {report.contentSha256}</p> : null}
      {errors.slice(0, 8).map((issue, index) => (
        <p key={index} className="text-warn">
          {issue.path}：{issue.message}
        </p>
      ))}
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
