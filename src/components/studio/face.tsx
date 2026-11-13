import { DESIGN, type DeviceShape, type SceneNode, type ScenePage } from "@/lib/blueos/model";

export function WatchFace({ page, device, size }: { page: ScenePage; device: DeviceShape; size: number }) {
  const scale = size / DESIGN;
  return (
    <div
      className="relative shrink-0 overflow-hidden border border-line"
      style={{
        width: size,
        height: size,
        borderRadius: device === "watch-round" ? 999 : size * 0.18,
        background: page.background,
      }}
    >
      <div style={{ width: DESIGN, height: DESIGN, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative" }}>
        {page.nodes
          .filter((node) => !node.hidden)
          .map((node) => (
            <div key={node.id} style={{ position: "absolute", left: node.x, top: node.y, width: node.w, height: node.h }}>
              <NodeGlyph node={node} />
            </div>
          ))}
      </div>
    </div>
  );
}

export function NodeGlyph({ node, guide = false }: { node: SceneNode; guide?: boolean }) {
  const props = node.props;
  if (node.type === "text" || node.type === "number" || node.type === "time") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          color: String(props.color),
          fontSize: Number(props.fontSize),
          fontWeight: props.fontWeight === "bold" ? 700 : 400,
          textAlign: props.textAlign === "center" || props.textAlign === "right" ? (props.textAlign as "center" | "right") : "left",
          lineHeight: 1.15,
          overflow: "hidden",
        }}
      >
        {String(props.text ?? "")}
      </div>
    );
  }
  if (node.type === "button") {
    return (
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{
          width: "100%",
          height: "100%",
          background: String(props.background),
          color: String(props.color),
          borderRadius: Number(props.radius) || 0,
          fontSize: Number(props.fontSize),
          fontWeight: 600,
        }}
      >
        {String(props.value ?? "")}
      </div>
    );
  }
  if (node.type === "image") {
    const src = String(props.src || "image");
    const name = src.split("/").pop() || "image";
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-2 px-1 text-center text-xs text-muted">{name}</div>
    );
  }
  if (node.type === "progress") {
    const percent = Math.max(0, Math.min(100, Number(props.percent) || 0));
    if (props.progressType === "arc") {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: `conic-gradient(${String(props.color)} ${percent * 3.6}deg, ${String(props.layerColor)} 0)`,
          }}
        />
      );
    }
    return (
      <div className="h-full w-full overflow-hidden" style={{ background: String(props.layerColor), borderRadius: 999 }}>
        <div style={{ width: `${percent}%`, height: "100%", background: String(props.color) }} />
      </div>
    );
  }
  if (node.type === "switch") {
    return (
      <div className="relative h-full w-full" style={{ borderRadius: 999, background: String(props.track) }}>
        <div
          style={{
            position: "absolute",
            top: "14%",
            bottom: "14%",
            width: "44%",
            left: props.checked ? "48%" : "8%",
            borderRadius: 999,
            background: String(props.thumb),
          }}
        />
      </div>
    );
  }
  if (node.type === "circle" || node.type === "rect" || node.type === "column" || node.type === "row") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: String(props.background),
          borderRadius: node.type === "circle" ? "50%" : Number(props.radius) || 0,
        }}
      />
    );
  }
  if (node.type === "divider") {
    return <div style={{ width: "100%", height: "100%", background: String(props.color) }} />;
  }
  if (guide && node.type === "spacer") return <div className="h-full w-full border border-dashed border-line" />;
  if (guide && node.type === "hotspot") {
    return <div className="flex h-full w-full items-center justify-center border border-dashed border-accent text-xs text-accent">点击</div>;
  }
  return null;
}
