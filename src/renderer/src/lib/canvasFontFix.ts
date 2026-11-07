// Chromium in recent Electron rejects canvas font strings with leading whitespace
// (e.g. " normal 26px Menlo"), falling back to "10px sans-serif". xterm's WebGL
// renderer builds exactly such strings for non-italic text, which made every glyph
// tiny. Trim the value before it reaches the native setter.
for (const proto of [globalThis.CanvasRenderingContext2D?.prototype, globalThis.OffscreenCanvasRenderingContext2D?.prototype]) {
  if (!proto) continue
  const desc = Object.getOwnPropertyDescriptor(proto, 'font')
  if (!desc?.set || !desc.get) continue
  const { get, set } = desc
  Object.defineProperty(proto, 'font', {
    configurable: true,
    enumerable: desc.enumerable,
    get() {
      return get.call(this)
    },
    set(value: string) {
      set.call(this, typeof value === 'string' ? value.trim() : value)
    }
  })
}
export {}
