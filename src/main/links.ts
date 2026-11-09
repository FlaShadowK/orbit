const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Only web/mail links may leave the app; file:, javascript:, custom schemes etc. are refused. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}
