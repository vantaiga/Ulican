// ═══════════════════════════════════════════════════════════════
// src/settlement.js — ALL SYSTEMS (alucard, aegis, ulican, vulcan, xalican)
// The router. Detects NAME_SECRET_KEY from env.
// Each network = its own adapter file (30-50 LoC).
// modempay.js is the first adapter. Add more = add file + env var.
// ═══════════════════════════════════════════════════════════════
import { fileURLToPath } from 'url'
import path              from 'path'
import { createRequire } from 'module'

const __dir     = path.dirname(fileURLToPath(import.meta.url))
const cleanKey  = s => String(s||'').trim().replace(/['"]/g,'')

// ── BRIDGE REGISTRY — built from env vars at boot ─────────────────────────────
// Pattern: NAME_SECRET_KEY → bridge name = 'name' (lowercase)
// Adapter file: ./adapters/name.js (or ./name.js if no adapters folder)
const BRIDGES = {}

function loadBridges() {
  for (const [k, v] of Object.entries(process.env)) {
    const m = k.match(/^([A-Z][A-Z0-9]+)_SECRET_KEY$/)
    if (!m || !v) continue
    const name = m[1].toLowerCase()
    BRIDGES[name] = cleanKey(v)
  }
  if (Object.keys(BRIDGES).length > 0) {
    console.log(`[SETTLEMENT] Bridges detected: ${Object.keys(BRIDGES).join(', ')}`)
  } else {
    console.log('[SETTLEMENT] No bridges configured — add NAME_SECRET_KEY to Railway Variables')
  }
}
loadBridges()

// ── ADAPTER LOADER — finds adapter file for each bridge ───────────────────────
// Search order: ./src/adapters/{name}.js → ./{name}.js → built-in
const adapterCache = {}

async function loadAdapter(name) {
  if (adapterCache[name]) return adapterCache[name]
  const candidates = [
    path.join(__dir, 'adapters', `${name}.js`),
    path.join(__dir, `${name}.js`),
  ]
  for (const p of candidates) {
    try {
      const adapter = await import(p)
      adapterCache[name] = adapter
      return adapter
    } catch {}
  }
  // Generic fallback: basic REST POST to {NAME}_BASE_URL
  const baseUrl = process.env[`${name.toUpperCase()}_BASE_URL`]
  if (baseUrl) {
    const generic = {
      send: async (key, params) => {
        const r = await fetch(`${baseUrl}/transfers`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...params, description:'(system) Operator: Bun Omar SECKA' }),
          signal: AbortSignal.timeout(60000),
        })
        const d = await r.json()
        if (!r.ok) throw new Error(d.message || `Transfer failed: ${r.status}`)
        return d
      },
      calcFee: (amount) => ({ fee: amount * 0.015, net: amount * 0.985 }),
    }
    adapterCache[name] = generic
    return generic
  }
  throw new Error(`No adapter found for bridge '${name}'. Create src/adapters/${name}.js or set ${name.toUpperCase()}_BASE_URL env var.`)
}

// ── PUBLIC API ─────────────────────────────────────────────────────────────────
export async function send(bridge, params) {
  const name = (bridge||'modempay').toLowerCase()
  const key  = BRIDGES[name]
  if (!key) throw new Error(`Bridge '${name}' not configured. Add ${name.toUpperCase()}_SECRET_KEY to Railway Variables.`)
  const adapter = await loadAdapter(name)
  return adapter.send(key, params)
}

export function calcFee(bridge, amount, network='wave') {
  const name = (bridge||'modempay').toLowerCase()
  // Adapter may have its own fee table; fall back to generic
  const FEES = { wave:.015, afrimoney:.015, qmoney:.015, bank:.0125, international:.0125, crypto:.01 }
  const rate = FEES[network] || 0.015
  return { amount, fee:+(amount*rate).toFixed(2), net:+(amount*(1-rate)).toFixed(2), rate:`${(rate*100).toFixed(2)}%` }
}

export function getBridges() { return Object.keys(BRIDGES) }

export function getBridgeMode(bridge) {
  const key = BRIDGES[(bridge||'modempay').toLowerCase()] || ''
  if (!key) return 'UNCONFIGURED'
  return key.startsWith('sk_live_') || key.startsWith('live_') ? 'LIVE' : 'TEST'
}
