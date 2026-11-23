import type { Plan } from '../engine/types'
import { parsePlans, type ParsedPlans } from '../engine/validate'

/**
 * Plans shared as a link: the plan is compressed and put after `#share=` in the URL.
 * The part after `#` is never sent to the server; everything stays in the browsers of the
 * people who open the link.
 */

const PREFIX = '#share=v1.'

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export const canShare = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

/** A link that opens this app with the plan in it. */
export async function shareUrl(plan: Plan, base = `${location.origin}${location.pathname}`): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(plan))
  return `${base}${PREFIX}${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`
}

/** Whether the URL fragment carries a shared plan. */
export const hasSharedPlan = (hash = location.hash) => hash.startsWith('#share=')

/** The plan in a shared link's fragment. */
export async function readSharedPlan(hash = location.hash): Promise<ParsedPlans> {
  if (!hash.startsWith(PREFIX)) return { ok: false, error: 'このリンクの形式には対応していません。アプリを最新にして開き直してください。' }
  try {
    const bytes = await pipe(fromBase64Url(hash.slice(PREFIX.length)), new DecompressionStream('deflate-raw'))
    return parsePlans(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return { ok: false, error: 'リンクが途中で切れているか、壊れています。送ってくれた人に、もう一度リンクを作ってもらってください。' }
  }
}

/** Removes the shared plan from the address bar (so that reloading does not ask again). */
export function clearSharedPlanFromUrl() {
  history.replaceState(null, '', `${location.pathname}${location.search}`)
}
