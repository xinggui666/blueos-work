/**
 * 手表端页面胶水代码（写入生成工程的 src/common/host.js）。
 * 负责：创建并保存运行时（放在 app.ux 暴露的 ctx 对象里，所有页面共用）、持久化变量、
 * 把运行时状态渲染成页面数据、页面跳转/返回、计时、手势识别（双击和滑动由触摸事件推算）。
 * 占位符 __X__ 由 native.ts 替换。
 */
export const HOST_TEMPLATE = `import { Runtime, VISIBLE_PROP, toText, truthy } from './engine.js'
import doc from './project.js'
import router from '@blueos.app.appmanager.router'
__IMPORTS__
var PAGE_URI = __PAGE_URI__
var PERSIST = __PERSIST__
var TICK_MS = __TICK_MS__

function ctxOf(vm) {
  var def = vm.$app.$def
  if (!def.ctx) def.ctx = {}
  var ctx = def.ctx
  if (!ctx.timers) {
    ctx.rt = null
    ctx.depth = 0
    ctx.navigating = false
    ctx.hidden = false
    ctx.timers = {}
    ctx.touch = {}
    ctx.lastClick = null
  }
  return ctx
}

function loadVars() {
  var out = {}
__LOAD_VARS__
  return out
}

function saveVar(id, value) {
__SAVE_VAR__
}

function showToast(text) {
__TOAST__
}

export function runtimeOf(vm) {
  var ctx = ctxOf(vm)
  if (!ctx.rt) {
    ctx.rt = new Runtime(doc, { initialVars: loadVars(), onVarChange: saveVar })
    ctx.rt.start()
  }
  return ctx.rt
}

function pageOf(pageId) {
  for (var i = 0; i < doc.pages.length; i++) if (doc.pages[i].id === pageId) return doc.pages[i]
  return null
}

export function render(rt, pageId) {
  var out = {}
  var page = pageOf(pageId)
  if (!page) return out
  for (var i = 0; i < page.components.length; i++) {
    var id = page.components[i].id
    var props = rt.resolvedProps(id)
    var view = { visible: true }
    for (var key in props) {
      var v = props[key]
      if (key === VISIBLE_PROP) view.visible = truthy(v)
      else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') view[key] = v
      else view[key] = toText(v)
    }
    out[id] = view
  }
  return out
}

function stopTick(ctx, pageId) {
  if (ctx.timers[pageId]) {
    clearInterval(ctx.timers[pageId])
    ctx.timers[pageId] = null
  }
}

function startTick(vm, ctx, pageId) {
  stopTick(ctx, pageId)
  ctx.timers[pageId] = setInterval(function () {
    ctx.rt.tick()
    flush(vm, pageId)
  }, TICK_MS)
}

export function flush(vm, pageId) {
  var ctx = ctxOf(vm)
  var rt = ctx.rt
  if (!rt) return
  if (rt.state.toast) {
    showToast(rt.state.toast)
    rt.state.toast = ''
  }
  if (rt.state.pageId !== pageId) {
    if (ctx.navigating) return
    ctx.navigating = true
    stopTick(ctx, pageId)
    if (rt.state.stack.length < ctx.depth) router.back()
    else router.push({ uri: PAGE_URI[rt.state.pageId] })
    return
  }
  vm.p = render(rt, pageId)
}

export function pageShow(vm, pageId) {
  var rt = runtimeOf(vm)
  var ctx = ctxOf(vm)
  ctx.navigating = false
  if (rt.state.pageId !== pageId) rt.externalBack(pageId)
  ctx.depth = rt.state.stack.length
  rt.tick()
  flush(vm, pageId)
  if (!ctx.navigating) startTick(vm, ctx, pageId)
}

export function pageHide(vm, pageId) {
  stopTick(ctxOf(vm), pageId)
}

function point(evt) {
  if (!evt) return null
  var list = evt.touches && evt.touches.length ? evt.touches : evt.changedTouches
  if (!list || !list.length) return null
  return { x: list[0].clientX, y: list[0].clientY }
}

export function gesture(vm, pageId, id, kind, evt) {
  var ctx = ctxOf(vm)
  var rt = runtimeOf(vm)
  if (ctx.navigating) return
  var now = Date.now()
  var t = ctx.touch
  if (kind === 'click') {
    rt.interact(id, 'click')
    var prev = ctx.lastClick
    if (prev && prev.id === id && now - prev.t < 350) {
      rt.interact(id, 'doubleClick')
      ctx.lastClick = null
    } else ctx.lastClick = { id: id, t: now }
  } else if (kind === 'longpress') {
    rt.interact(id, 'longPress')
  } else if (kind === 'change') {
    rt.interact(id, 'change', !!(evt && evt.checked))
  } else if (kind === 'touchstart') {
    var p0 = point(evt)
    ctx.touch = { id: id, x: p0 ? p0.x : 0, y: p0 ? p0.y : 0, ex: null, ey: null, moved: false, last: 0 }
    rt.interact(id, 'touchStart')
  } else if (kind === 'touchmove') {
    if (t.id !== id) return
    var p1 = point(evt)
    if (p1) {
      t.ex = p1.x
      t.ey = p1.y
    }
    if (!t.moved && t.ex !== null && Math.max(Math.abs(t.ex - t.x), Math.abs(t.ey - t.y)) > 30) {
      t.moved = true
      rt.interact(id, 'swipeStart')
    }
    if (t.moved && now - t.last > 100) {
      t.last = now
      rt.interact(id, 'swiping')
    }
  } else if (kind === 'touchend') {
    rt.interact(id, 'touchEnd')
    if (t.id === id && t.ex !== null) {
      var dx = t.ex - t.x
      var dy = t.ey - t.y
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) {
        if (!t.moved) rt.interact(id, 'swipeStart')
        rt.interact(id, Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'swipeLeft' : 'swipeRight') : dy < 0 ? 'swipeUp' : 'swipeDown')
      }
    }
    ctx.touch = {}
  }
  flush(vm, pageId)
}

export function openPage(vm, pageId, target) {
  runtimeOf(vm).openPage(target)
  flush(vm, pageId)
}
`;
