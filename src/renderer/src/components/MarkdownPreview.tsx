import { useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { monaco } from '@/lib/monaco'
import { useStore } from '@/store'

const slug = (text: string): string =>
  text.toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')

marked.setOptions({ gfm: true, breaks: false })
// GitHub-style heading ids, so in-page links (#installation) work
marked.use({
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`
    }
  }
})

/** Resolve a relative link against the folder of the markdown file. */
function resolvePath(from: string, href: string): string {
  const sep = from.includes('\\') && !from.includes('/') ? '\\' : '/'
  const parts = from.split(/[\\/]/).slice(0, -1)
  for (const seg of decodeURIComponent(href).split(/[\\/]/)) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join(sep)
}

/** Rendered markdown. Scripts and inline handlers are stripped; links open outside the app. */
export function MarkdownPreview({ source, filePath, serverId }: { source: string; filePath: string; serverId?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false }) as string), [source])

  // syntax-highlight fenced code blocks with Monaco's tokenizer
  useEffect(() => {
    const blocks = ref.current?.querySelectorAll<HTMLElement>('pre > code[class*="language-"]') ?? []
    let alive = true
    for (const code of blocks) {
      const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9)
      if (!lang) continue
      monaco.editor.colorize(code.textContent ?? '', lang, {}).then((colored) => {
        if (alive) code.innerHTML = DOMPurify.sanitize(colored)
      }, () => {})
    }
    // local images (relative to the file) come through main as data: URLs
    if (!serverId)
      for (const img of ref.current?.querySelectorAll<HTMLImageElement>('img') ?? []) {
        const src = img.getAttribute('src') ?? ''
        if (!src || /^[a-z][\w+.-]*:/i.test(src) || src.startsWith('//')) continue
        const path = src.startsWith('/') ? src : resolvePath(filePath, src.split(/[?#]/)[0])
        window.orbit.fsImage?.(path).then((url) => {
          if (alive && url) img.src = url
        }, () => {})
      }
    return () => {
      alive = false
    }
  }, [html, filePath, serverId])

  const onClick = (e: React.MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1))
      ref.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth' })
    } else if (/^(https?|mailto):/i.test(href)) {
      window.orbit.openExternal(href)
    } else if (href && !/^[a-z][\w+.-]*:/i.test(href)) {
      useStore.getState().openFile(resolvePath(filePath, href.split('#')[0]), serverId)
    }
  }

  return <div ref={ref} className="md-preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
