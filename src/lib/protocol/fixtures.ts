/** 测试和文档示例共用的协议工程。 */
import type { ProjectDoc } from "./schema.ts";
import { computeDependencies } from "./validate.ts";

/** 一个计数器工程：按钮点击 count+1，文本绑定 count，count 达到 3 弹提示。 */
export function counterDoc(): ProjectDoc {
  const doc: ProjectDoc = {
    format: "blueos-workshop-project",
    schemaVersion: 2,
    project: {
      id: "jcounter",
      name: "计数器",
      appName: "计数",
      packageName: "com.example.counter",
      createdAt: 1,
      updatedAt: 1,
      revision: 0,
    },
    manifest: {
      device: "watch-round",
      designWidth: 466,
      canvas: { width: 466, height: 466 },
      versionName: "1.0",
      versionCode: 1,
      sdk: { toolkit: "t", verified: false },
    },
    startPageId: "pHome",
    navigation: { kind: "none", items: [] },
    pages: [
      {
        id: "pHome",
        name: "Home",
        background: "#000000",
        components: [
          {
            id: "cBtn",
            type: "button",
            version: "1.0.0",
            name: "加一",
            layout: { x: 100, y: 300, w: 200, h: 80 },
            locked: false,
            hidden: false,
            props: { value: "加一" },
          },
          {
            id: "cText",
            type: "text",
            version: "1.0.0",
            name: "显示",
            layout: { x: 100, y: 100, w: 260, h: 60 },
            locked: false,
            hidden: false,
            props: { text: "0" },
          },
          {
            id: "cTip",
            type: "text",
            version: "1.0.0",
            name: "提示",
            layout: { x: 100, y: 200, w: 260, h: 60 },
            locked: false,
            hidden: true,
            props: { text: "够了" },
          },
        ],
      },
      { id: "pTwo", name: "Two", background: "#111111", components: [] },
    ],
    variables: [
      { id: "vCount", key: "count", type: "int", default: 0, scope: "global", persist: false },
    ],
    events: [
      {
        id: "eClick",
        enabled: true,
        trigger: { kind: "component", componentId: "cBtn", event: "click" },
        actions: [{ id: "aInc", kind: "setVar", variableId: "vCount", value: "count + 1" }],
      },
      {
        id: "eThree",
        enabled: true,
        trigger: { kind: "variable", variableId: "vCount", event: "equals", value: "3" },
        actions: [
          { id: "aShow", kind: "show", componentId: "cTip" },
          { id: "aToast", kind: "toast", text: '"到 " + str(count) + " 了"' },
        ],
      },
    ],
    functions: [],
    timers: [],
    bindings: [
      {
        id: "bText",
        componentId: "cText",
        prop: "text",
        source: { kind: "expr", expr: '"次数 " + str(count)' },
      },
    ],
    assets: [],
    dependencies: [],
  };
  doc.dependencies = computeDependencies(doc);
  return doc;
}
