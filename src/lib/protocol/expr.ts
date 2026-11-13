/**
 * 受控表达式语言（规格 8.6）。
 * - 手写词法/语法分析，不使用 eval / new Function。
 * - 支持：数字、字符串、布尔、null、变量名、+ - * / %、比较、&& || !、?:、括号、白名单函数调用。
 * - 复杂度限制：源码长度、节点数、嵌套深度；求值有步数预算。
 */

export type ValueType =
  "string" | "int" | "float" | "bool" | "array" | "object" | "datetime" | "any" | "null";
export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

export type Expr =
  | { t: "lit"; v: Value }
  | { t: "var"; name: string }
  | { t: "un"; op: "!" | "-"; a: Expr }
  | { t: "bin"; op: string; a: Expr; b: Expr }
  | { t: "cond"; c: Expr; a: Expr; b: Expr }
  | { t: "call"; fn: string; args: Expr[] }
  | { t: "member"; obj: Expr; key: Expr };

export const EXPR_LIMITS = {
  maxLength: 500,
  maxNodes: 200,
  maxDepth: 24,
  maxSteps: 5000,
  maxString: 2000,
  maxArray: 500,
};

export class ExprError extends Error {
  readonly pos: number;
  constructor(message: string, pos = -1) {
    super(message);
    this.name = "ExprError";
    this.pos = pos;
  }
}

type Tok = { k: "num" | "str" | "id" | "op" | "eof"; v: string; pos: number };

const OPS = [
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "(",
  ")",
  ",",
  "?",
  ":",
  "[",
  "]",
  ".",
];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ k: "num", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new ExprError("字符串没有结束引号", i);
      out.push({ k: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$\u4e00-\u9fa5]/.test(ch)) {
      const m = /^[A-Za-z_$\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*/.exec(src.slice(i))!;
      out.push({ k: "id", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`无法识别的字符 "${ch}"`, i);
    out.push({ k: "op", v: op, pos: i });
    i += op.length;
  }
  out.push({ k: "eof", v: "", pos: src.length });
  return out;
}

const PREC: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

export function parseExpr(src: string): Expr {
  if (typeof src !== "string") throw new ExprError("表达式必须是文本");
  if (src.length > EXPR_LIMITS.maxLength)
    throw new ExprError(`表达式超过 ${EXPR_LIMITS.maxLength} 个字符`);
  if (!src.trim()) throw new ExprError("表达式为空");
  const toks = lex(src);
  let p = 0;
  let nodes = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];
  const expect = (v: string) => {
    const t = take();
    if (t.v !== v || t.k === "str") throw new ExprError(`这里需要 "${v}"`, t.pos);
  };
  const node = <T extends Expr>(e: T, depth: number): T => {
    if (++nodes > EXPR_LIMITS.maxNodes) throw new ExprError("表达式过于复杂");
    if (depth > EXPR_LIMITS.maxDepth) throw new ExprError("表达式嵌套过深");
    return e;
  };
  function primary(d: number): Expr {
    const t = take();
    if (t.k === "num") return node({ t: "lit", v: Number(t.v) }, d);
    if (t.k === "str") return node({ t: "lit", v: t.v }, d);
    if (t.k === "id") {
      if (t.v === "true" || t.v === "false") return node({ t: "lit", v: t.v === "true" }, d);
      if (t.v === "null") return node({ t: "lit", v: null }, d);
      if (peek().v === "(" && peek().k === "op") {
        take();
        const args: Expr[] = [];
        if (!(peek().k === "op" && peek().v === ")")) {
          for (;;) {
            args.push(ternary(d + 1));
            if (peek().k === "op" && peek().v === ",") take();
            else break;
          }
        }
        expect(")");
        return node({ t: "call", fn: t.v, args }, d);
      }
      return node({ t: "var", name: t.v.replace(/^\$/, "") }, d);
    }
    if (t.k === "op" && t.v === "(") {
      const e = ternary(d + 1);
      expect(")");
      return e;
    }
    if (t.k === "op" && t.v === "[") {
      const items: Expr[] = [];
      if (!(peek().k === "op" && peek().v === "]")) {
        for (;;) {
          items.push(ternary(d + 1));
          if (peek().k === "op" && peek().v === ",") take();
          else break;
        }
      }
      expect("]");
      return node({ t: "call", fn: "list", args: items }, d);
    }
    throw new ExprError(t.k === "eof" ? "表达式不完整" : `这里不能出现 "${t.v}"`, t.pos);
  }
  function postfix(d: number): Expr {
    let e = primary(d);
    for (;;) {
      const t = peek();
      if (t.k === "op" && t.v === "[") {
        take();
        const key = ternary(d + 1);
        expect("]");
        e = node({ t: "member", obj: e, key }, d);
      } else if (t.k === "op" && t.v === ".") {
        take();
        const id = take();
        if (id.k !== "id") throw new ExprError("点号后需要字段名", id.pos);
        e = node({ t: "member", obj: e, key: { t: "lit", v: id.v } }, d);
      } else return e;
    }
  }
  function unary(d: number): Expr {
    const t = peek();
    if (t.k === "op" && (t.v === "!" || t.v === "-")) {
      take();
      return node({ t: "un", op: t.v as "!" | "-", a: unary(d + 1) }, d);
    }
    return postfix(d);
  }
  function binary(minPrec: number, d: number): Expr {
    let left = unary(d);
    for (;;) {
      const t = peek();
      const prec = t.k === "op" ? PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      take();
      const right = binary(prec + 1, d + 1);
      left = node({ t: "bin", op: t.v, a: left, b: right }, d);
    }
  }
  function ternary(d: number): Expr {
    const c = binary(1, d);
    if (peek().k === "op" && peek().v === "?") {
      take();
      const a = ternary(d + 1);
      expect(":");
      const b = ternary(d + 1);
      return node({ t: "cond", c, a, b }, d);
    }
    return c;
  }
  const e = ternary(0);
  if (peek().k !== "eof") throw new ExprError(`多余的内容 "${peek().v}"`, peek().pos);
  return e;
}

/* ---------------- 白名单函数 ---------------- */

type Fn = {
  args: [number, number];
  ret: ValueType | ((args: ValueType[]) => ValueType);
  run: (a: Value[], env: EvalEnv) => Value;
  desc: string;
};

const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, "0");
const WEEK = "日一二三四五六";

export function formatTime(ts: number, pattern: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  return pattern.replace(/YYYY|MM|DD|HH|hh|mm|ss|A|W/g, (tok) => {
    switch (tok) {
      case "YYYY":
        return String(d.getFullYear());
      case "MM":
        return pad(d.getMonth() + 1);
      case "DD":
        return pad(d.getDate());
      case "HH":
        return pad(h);
      case "hh":
        return pad(h % 12 === 0 ? 12 : h % 12);
      case "mm":
        return pad(d.getMinutes());
      case "ss":
        return pad(d.getSeconds());
      case "A":
        return h < 12 ? "上午" : "下午";
      case "W":
        return WEEK[d.getDay()];
      default:
        return tok;
    }
  });
}

export function formatDuration(ms: number, pattern = "mm:ss"): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return pattern.replace(/HH|mm|ss/g, (tok) =>
    tok === "HH"
      ? pad(h)
      : tok === "mm"
        ? pad(pattern.includes("HH") ? m : Math.floor(total / 60))
        : pad(s),
  );
}

const num = (v: Value): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  throw new ExprError(`"${toText(v)}" 不是数字`);
};

export function toText(v: Value): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number")
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
}

export function truthy(v: Value): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return true;
  return Boolean(v) && v !== "false" && v !== "0";
}

const date = (v: Value) => new Date(num(v));

export const FUNCTIONS: Record<string, Fn> = {
  now: { args: [0, 0], ret: "datetime", run: (_a, env) => env.now(), desc: "当前时间戳（毫秒）" },
  year: {
    args: [0, 1],
    ret: "int",
    run: (a, env) => date(a[0] ?? env.now()).getFullYear(),
    desc: "年",
  },
  month: {
    args: [0, 1],
    ret: "int",
    run: (a, env) => date(a[0] ?? env.now()).getMonth() + 1,
    desc: "月",
  },
  day: { args: [0, 1], ret: "int", run: (a, env) => date(a[0] ?? env.now()).getDate(), desc: "日" },
  hour: {
    args: [0, 1],
    ret: "int",
    run: (a, env) => date(a[0] ?? env.now()).getHours(),
    desc: "小时",
  },
  minute: {
    args: [0, 1],
    ret: "int",
    run: (a, env) => date(a[0] ?? env.now()).getMinutes(),
    desc: "分钟",
  },
  second: {
    args: [0, 1],
    ret: "int",
    run: (a, env) => date(a[0] ?? env.now()).getSeconds(),
    desc: "秒",
  },
  weekday: {
    args: [0, 1],
    ret: "int",
    run: (a, env) => date(a[0] ?? env.now()).getDay(),
    desc: "星期（0=周日）",
  },
  formatTime: {
    args: [1, 2],
    ret: "string",
    run: (a) => formatTime(num(a[0]), a[1] === undefined ? "HH:mm" : toText(a[1])),
    desc: "格式化时间",
  },
  formatDuration: {
    args: [1, 2],
    ret: "string",
    run: (a) => formatDuration(num(a[0]), a[1] === undefined ? "mm:ss" : toText(a[1])),
    desc: "格式化时长",
  },
  addMinutes: {
    args: [2, 2],
    ret: "datetime",
    run: (a) => num(a[0]) + num(a[1]) * 60_000,
    desc: "时间加分钟",
  },
  diffSeconds: {
    args: [2, 2],
    ret: "int",
    run: (a) => Math.round((num(a[0]) - num(a[1])) / 1000),
    desc: "两个时间相差秒数",
  },
  str: { args: [1, 1], ret: "string", run: (a) => toText(a[0]), desc: "转文本" },
  int: { args: [1, 1], ret: "int", run: (a) => Math.trunc(num(a[0])), desc: "转整数" },
  float: { args: [1, 1], ret: "float", run: (a) => num(a[0]), desc: "转小数" },
  bool: { args: [1, 1], ret: "bool", run: (a) => truthy(a[0]), desc: "转布尔" },
  round: {
    args: [1, 2],
    ret: (t) => (t.length > 1 ? "float" : "int"),
    run: (a) => {
      const k = 10 ** Math.min(6, Math.max(0, num(a[1] ?? 0)));
      return Math.round(num(a[0]) * k) / k;
    },
    desc: "四舍五入",
  },
  floor: { args: [1, 1], ret: "int", run: (a) => Math.floor(num(a[0])), desc: "向下取整" },
  ceil: { args: [1, 1], ret: "int", run: (a) => Math.ceil(num(a[0])), desc: "向上取整" },
  abs: { args: [1, 1], ret: (t) => t[0], run: (a) => Math.abs(num(a[0])), desc: "绝对值" },
  min: { args: [1, 8], ret: "float", run: (a) => Math.min(...a.map(num)), desc: "最小值" },
  max: { args: [1, 8], ret: "float", run: (a) => Math.max(...a.map(num)), desc: "最大值" },
  clamp: {
    args: [3, 3],
    ret: "float",
    run: (a) => Math.min(num(a[2]), Math.max(num(a[1]), num(a[0]))),
    desc: "限制范围",
  },
  len: {
    args: [1, 1],
    ret: "int",
    run: (a) => (Array.isArray(a[0]) ? a[0].length : toText(a[0]).length),
    desc: "长度",
  },
  upper: { args: [1, 1], ret: "string", run: (a) => toText(a[0]).toUpperCase(), desc: "转大写" },
  lower: { args: [1, 1], ret: "string", run: (a) => toText(a[0]).toLowerCase(), desc: "转小写" },
  concat: { args: [1, 8], ret: "string", run: (a) => a.map(toText).join(""), desc: "拼接文本" },
  substr: {
    args: [2, 3],
    ret: "string",
    run: (a) =>
      toText(a[0]).slice(num(a[1]), a[2] === undefined ? undefined : num(a[1]) + num(a[2])),
    desc: "截取文本",
  },
  padStart: {
    args: [2, 3],
    ret: "string",
    run: (a) =>
      toText(a[0]).padStart(Math.min(64, num(a[1])), a[2] === undefined ? "0" : toText(a[2])),
    desc: "左侧补齐",
  },
  contains: {
    args: [2, 2],
    ret: "bool",
    run: (a) =>
      Array.isArray(a[0]) ? a[0].some((x) => x === a[1]) : toText(a[0]).includes(toText(a[1])),
    desc: "是否包含",
  },
  if: {
    args: [3, 3],
    ret: (t) => (t[1] === t[2] ? t[1] : "any"),
    run: (a) => (truthy(a[0]) ? a[1] : a[2]),
    desc: "条件取值",
  },
  list: { args: [0, 50], ret: "array", run: (a) => a, desc: "列表" },
  push: {
    args: [2, 2],
    ret: "array",
    run: (a) => {
      const l = Array.isArray(a[0]) ? a[0].slice() : [];
      if (l.length >= EXPR_LIMITS.maxArray) throw new ExprError("列表过长");
      l.push(a[1]);
      return l;
    },
    desc: "追加到列表（返回新列表）",
  },
  at: {
    args: [2, 2],
    ret: "any",
    run: (a) => (Array.isArray(a[0]) ? (a[0][num(a[1])] ?? null) : null),
    desc: "取列表元素",
  },
  sum: {
    args: [1, 1],
    ret: "float",
    run: (a) => (Array.isArray(a[0]) ? a[0].reduce<number>((s, x) => s + num(x), 0) : 0),
    desc: "求和",
  },
  join: {
    args: [1, 2],
    ret: "string",
    run: (a) =>
      Array.isArray(a[0])
        ? a[0].map(toText).join(a[1] === undefined ? "," : toText(a[1]))
        : toText(a[0]),
    desc: "列表拼接为文本",
  },
  percent: {
    args: [2, 2],
    ret: "int",
    run: (a) => {
      const d = num(a[1]);
      return d === 0 ? 0 : Math.round(Math.min(100, Math.max(0, (num(a[0]) / d) * 100)));
    },
    desc: "百分比 0-100",
  },
};

/* ---------------- 静态类型检查 ---------------- */

export type TypeEnv = { types: Record<string, ValueType> };

const numeric = (t: ValueType) => t === "int" || t === "float" || t === "datetime" || t === "any";

export function checkExpr(
  src: string,
  env: TypeEnv,
): { ok: true; type: ValueType; ast: Expr; refs: string[] } | { ok: false; error: string } {
  let ast: Expr;
  try {
    ast = parseExpr(src);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const refs = new Set<string>();
  const infer = (e: Expr): ValueType => {
    switch (e.t) {
      case "lit":
        return e.v === null
          ? "null"
          : typeof e.v === "string"
            ? "string"
            : typeof e.v === "boolean"
              ? "bool"
              : Number.isInteger(e.v)
                ? "int"
                : "float";
      case "var": {
        refs.add(e.name);
        const t = Object.prototype.hasOwnProperty.call(env.types, e.name)
          ? env.types[e.name]
          : undefined;
        if (!t) throw new ExprError(`没有变量 "${e.name}"`);
        return t;
      }
      case "un": {
        const t = infer(e.a);
        if (e.op === "-" && !numeric(t)) throw new ExprError("负号只能用于数字");
        return e.op === "!" ? "bool" : t;
      }
      case "bin": {
        const a = infer(e.a);
        const b = infer(e.b);
        if (e.op === "&&" || e.op === "||" || e.op === "==" || e.op === "!=") return "bool";
        if (["<", "<=", ">", ">="].includes(e.op)) {
          if (!(numeric(a) && numeric(b)) && !(a === "string" && b === "string"))
            throw new ExprError(`不能比较 ${a} 和 ${b}`);
          return "bool";
        }
        if (e.op === "+") {
          if (a === "string" || b === "string") return "string";
          if (!numeric(a) || !numeric(b)) throw new ExprError(`不能相加 ${a} 和 ${b}`);
          return a === "float" || b === "float"
            ? "float"
            : a === "any" || b === "any"
              ? "any"
              : a === "datetime" || b === "datetime"
                ? "datetime"
                : "int";
        }
        if (!numeric(a) || !numeric(b)) throw new ExprError(`"${e.op}" 只能用于数字`);
        if (e.op === "/") return "float";
        return a === "float" || b === "float"
          ? "float"
          : a === "any" || b === "any"
            ? "any"
            : "int";
      }
      case "cond": {
        infer(e.c);
        const a = infer(e.a);
        const b = infer(e.b);
        return a === b ? a : "any";
      }
      case "member": {
        const o = infer(e.obj);
        infer(e.key);
        if (!["array", "object", "any"].includes(o)) throw new ExprError("只能从列表或对象取值");
        return "any";
      }
      case "call": {
        const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, e.fn)
          ? FUNCTIONS[e.fn]
          : undefined;
        if (!fn) throw new ExprError(`不支持函数 "${e.fn}"`);
        if (e.args.length < fn.args[0] || e.args.length > fn.args[1])
          throw new ExprError(`${e.fn} 参数个数不对`);
        const ts = e.args.map(infer);
        return typeof fn.ret === "function" ? fn.ret(ts) : fn.ret;
      }
    }
  };
  try {
    const type = infer(ast);
    return { ok: true, type, ast, refs: [...refs] };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/* ---------------- 求值 ---------------- */

export type EvalEnv = {
  get: (name: string) => Value | undefined;
  now: () => number;
  /** 共享步数预算，防止复杂表达式拖垮手表。 */
  budget?: { steps: number };
};

export function evalExpr(e: Expr, env: EvalEnv): Value {
  const budget = env.budget ?? { steps: EXPR_LIMITS.maxSteps };
  const run = (x: Expr): Value => {
    if (--budget.steps < 0) throw new ExprError("计算步数超出限制");
    switch (x.t) {
      case "lit":
        return x.v;
      case "var": {
        const v = env.get(x.name);
        if (v === undefined) throw new ExprError(`没有变量 "${x.name}"`);
        return v;
      }
      case "un": {
        const v = run(x.a);
        return x.op === "!" ? !truthy(v) : -num(v);
      }
      case "bin": {
        if (x.op === "&&") return truthy(run(x.a)) ? truthy(run(x.b)) : false;
        if (x.op === "||") return truthy(run(x.a)) ? true : truthy(run(x.b));
        const a = run(x.a);
        const b = run(x.b);
        switch (x.op) {
          case "==":
            return looseEq(a, b);
          case "!=":
            return !looseEq(a, b);
          case "+": {
            if (typeof a === "string" || typeof b === "string") {
              const s = toText(a) + toText(b);
              if (s.length > EXPR_LIMITS.maxString) throw new ExprError("文本过长");
              return s;
            }
            return num(a) + num(b);
          }
          case "-":
            return num(a) - num(b);
          case "*":
            return num(a) * num(b);
          case "/": {
            const d = num(b);
            if (d === 0) throw new ExprError("除数不能为 0");
            return num(a) / d;
          }
          case "%": {
            const d = num(b);
            if (d === 0) throw new ExprError("除数不能为 0");
            return num(a) % d;
          }
          case "<":
            return typeof a === "string" && typeof b === "string" ? a < b : num(a) < num(b);
          case "<=":
            return typeof a === "string" && typeof b === "string" ? a <= b : num(a) <= num(b);
          case ">":
            return typeof a === "string" && typeof b === "string" ? a > b : num(a) > num(b);
          case ">=":
            return typeof a === "string" && typeof b === "string" ? a >= b : num(a) >= num(b);
        }
        throw new ExprError(`未知运算 ${x.op}`);
      }
      case "cond":
        return truthy(run(x.c)) ? run(x.a) : run(x.b);
      case "member": {
        const o = run(x.obj);
        const k = run(x.key);
        if (Array.isArray(o)) return o[num(k)] ?? null;
        if (o && typeof o === "object") {
          const key = toText(k);
          return Object.prototype.hasOwnProperty.call(o, key)
            ? (o as Record<string, Value>)[key]
            : null;
        }
        return null;
      }
      case "call": {
        const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, x.fn)
          ? FUNCTIONS[x.fn]
          : undefined;
        if (!fn) throw new ExprError(`不支持函数 "${x.fn}"`);
        return fn.run(x.args.map(run), env);
      }
    }
  };
  const out = run(e);
  if (typeof out === "number" && !Number.isFinite(out)) throw new ExprError("计算结果不是有效数字");
  return out;
}

function looseEq(a: Value, b: Value): boolean {
  if (typeof a === "number" || typeof b === "number") {
    try {
      return num(a) === num(b);
    } catch {
      return false;
    }
  }
  if (typeof a === "boolean" || typeof b === "boolean") return truthy(a) === truthy(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 把值转换成变量声明的类型；失败抛 ExprError。 */
export function coerce(v: Value, type: ValueType): Value {
  switch (type) {
    case "string":
      return toText(v);
    case "int":
      return Math.trunc(num(v));
    case "float":
    case "datetime":
      return num(v);
    case "bool":
      return truthy(v);
    case "array":
      if (!Array.isArray(v)) throw new ExprError("需要列表");
      return v;
    case "object":
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new ExprError("需要对象");
      return v;
    default:
      return v;
  }
}

/** 类型能否赋值（用于绑定和赋值检查）。 */
export function assignable(from: ValueType, to: ValueType): boolean {
  if (from === to || to === "any" || from === "any") return true;
  if (to === "string") return true; // 任何值都可以显示成文本
  if (to === "float" && (from === "int" || from === "datetime")) return true;
  if (to === "datetime" && (from === "int" || from === "float")) return true;
  if (to === "int" && from === "datetime") return true;
  if (to === "bool") return from === "int" || from === "float";
  return false;
}

/**
 * 表达式里作为变量使用的标识符（不含函数名、成员名、字符串内容）。
 * 词法错误时返回 null。
 */
export function identifiersOf(src: string): string[] | null {
  let toks: Tok[];
  try {
    toks = lex(src);
  } catch {
    return null;
  }
  const out: string[] = [];
  toks.forEach((t, i) => {
    if (t.k !== "id") return;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (prev?.k === "op" && prev.v === ".") return;
    if (next?.k === "op" && next.v === "(") return;
    if (t.v === "true" || t.v === "false" || t.v === "null") return;
    out.push(t.v);
  });
  return out;
}

/** 把表达式里的变量 from 改名为 to（只改变量位置，字符串和函数名不动）。词法错误时原样返回。 */
export function renameIdentifier(src: string, from: string, to: string): string {
  let toks: Tok[];
  try {
    toks = lex(src);
  } catch {
    return src;
  }
  let out = "";
  let last = 0;
  toks.forEach((t, i) => {
    if (t.k !== "id" || t.v !== from) return;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (prev?.k === "op" && prev.v === ".") return;
    if (next?.k === "op" && next.v === "(") return;
    out += src.slice(last, t.pos) + to;
    last = t.pos + t.v.length;
  });
  return out + src.slice(last);
}
