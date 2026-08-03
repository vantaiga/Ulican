// ═══════════════════════════════════════════════════════════════
// ulican/src/dashboard.js — ULICAN + VULCAN SHARED PATTERN
// No PIN. No auth. Immediate state. Heartbeat. _started guard.
// ═══════════════════════════════════════════════════════════════
import express             from 'express'
import { createServer }    from 'http'
import { WebSocketServer } from 'ws'
import { existsSync }      from 'fs'
import { fileURLToPath }   from 'url'
import { join, dirname }   from 'path'

import { getDB, getExecs, exportSnapshot } from './db.js'
import { CHAINS, TOTAL_FLASH, getProp, EXECUTOR, TREASURY, SYSTEM } from './config.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const PORT  = parseInt(process.env.PORT || '3000')

const app    = express()
const server = createServer(app)
const wss    = new WebSocketServer({ server })

app.use(express.json({ limit: '1mb' }))
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  next()
})
app.options('*', (_, res) => res.sendStatus(200))

let SAB_REF    = null
let CHAINS_REF = []

let _lastGoodState = null
let _stateBuilds   = 0

function buildState() {
  _stateBuilds++
  try {
    if (!SAB_REF) return { type:'state', ts:Date.now(), booting:true, system:SYSTEM, uptime:0, memMB:0, chainCount:CHAINS.length, activeWS:0, chains:[] }

    const HOT   = new Float64Array(SAB_REF)
    const lvl   = Math.max(1, Math.min(10, Math.round(HOT[0])))
    const P     = getProp(lvl)
    const flash = HOT[2] + HOT[3]
    const activeWS = CHAINS_REF.filter((_, i) => HOT[40 + i] > 0).length

    // Vulcan-specific fields (harmless if not used by Ulican)
    const isVulcan  = SYSTEM === 'VULCAN'
    const deployed  = HOT[9] > 0
    const polRcv    = HOT[10]
    const cycles    = HOT[8] | 0
    const thruput   = HOT[60]

    let recentExecs = []
    try { recentExecs = getExecs(30) } catch {}

    const state = {
      type: 'state', ts: Date.now(), system: SYSTEM,
      // propeller
      propeller:    HOT[0],
      target:       P.r,
      dailyRevenue: HOT[1],
      revPct:       P.r > 0 ? Math.min(HOT[1] / P.r * 100, 100) : 0,
      // flash
      flashBase:    HOT[2],
      flashReserve: HOT[3],
      flashTotal:   flash,
      // ops
      treasury:     HOT[5],
      executions:   HOT[6] | 0,
      uptime:       HOT[7] | 0,
      crashSignal:  HOT[4],
      // chains
      chainCount:   CHAINS_REF.length,
      activeWS,
      chains: CHAINS_REF.map((c, i) => ({
        name:   c.name,
        id:     c.id,
        active: HOT[40 + i] > 0,
        gas:    HOT[20 + i] > 0 ? HOT[20 + i].toFixed(1) : '—',
      })),
      // system
      memMB:    process.memoryUsage().heapUsed / 1024 / 1024 | 0,
      memCap:   80,
      // vulcan-specific
      deployed,
      polReceived:       polRcv,
      throughputCycles:  cycles,
      totalThroughput:   thruput,
      extractionEarned:  HOT[61],
      marketDependency:  isVulcan ? 'ZERO' : 'MEV pools',
      model:             isVulcan ? 2 : 1,
      // identity
      executor:      EXECUTOR,
      treasury_addr: TREASURY,
      // meta
      stateBuilds:  _stateBuilds,
      wsClients:    _clients.size,
      recentExecs,
    }

    _lastGoodState = state
    return state
  } catch (e) {
    if (_lastGoodState) return _lastGoodState
    return { type:'state', ts:Date.now(), system:SYSTEM, error:e.message?.slice(0,100), uptime:0, memMB:0, chainCount:0, activeWS:0, chains:[] }
  }
}

const _clients         = new Set()
let   _lastTickPayload = null
let   _tickCount       = 0

wss.on('connection', ws => {
  _clients.add(ws)
  ws.isAlive = true
  ws.on('pong',  () => { ws.isAlive = true })
  ws.on('close', () => _clients.delete(ws))
  ws.on('error', () => _clients.delete(ws))

  // Immediate state on connect
  const payload = _lastTickPayload || JSON.stringify({ type:'state', ...buildState() })
  try { ws.send(payload) } catch {}

  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw.toString())
      if (m.type === 'propeller' && typeof m.level === 'number') {
        const HOT = new Float64Array(SAB_REF)
        HOT[0] = Math.max(1, Math.min(10, m.level))
        broadcast({ type:'propeller', level:HOT[0], target:getProp(Math.round(HOT[0])).r })
      }
    } catch {}
  })
})

const _heartbeat = setInterval(() => {
  for (const ws of _clients) {
    if (!ws.isAlive) { ws.terminate(); _clients.delete(ws); continue }
    ws.isAlive = false
    try { ws.ping() } catch { ws.terminate(); _clients.delete(ws) }
  }
}, 15000)

const _ticker = setInterval(() => {
  if (!_clients.size) return
  try {
    _tickCount++
    const s = buildState()
    _lastTickPayload = JSON.stringify({ type:'state', tick:_tickCount, ...s })
    for (const ws of _clients) {
      try { if (ws.readyState === 1) ws.send(_lastTickPayload) }
      catch { ws.terminate(); _clients.delete(ws) }
    }
  } catch {}
}, 2000)

function broadcast(d) {
  if (!_clients.size) return
  const p = JSON.stringify(d)
  for (const ws of _clients) {
    try { if (ws.readyState === 1) ws.send(p) } catch {}
  }
}

const DASH_DIR = join(__dir, '../dashboard')

app.get('/', (_, res) => {
  const name = SYSTEM === 'VULCAN' ? 'vulcan.html' : 'ulican.html'
  const f    = join(DASH_DIR, name)
  existsSync(f) ? res.sendFile(f) : res.status(404).send(`${name} missing from /dashboard/`)
})
app.use(express.static(DASH_DIR))

app.get('/api/state',  (_, res) => { try { res.json(buildState()) } catch (e) { res.status(500).json({ error:e.message }) } })
app.get('/api/health', (_, res) => res.json({ ok:true, system:SYSTEM, uptime:SAB_REF?new Float64Array(SAB_REF)[7]|0:0, clients:_clients.size }))
app.get('/ping',       (_, res) => res.json({ ok:true, system:SYSTEM, ts:Date.now() }))

app.get('/api/executions', (req, res) => {
  try { res.json(getExecs(parseInt(req.query.limit) || 50)) } catch { res.json([]) }
})

app.post('/api/propeller', (req, res) => {
  if (!SAB_REF) return res.status(503).json({ error:'not ready' })
  const { level } = req.body
  if (typeof level !== 'number' || level < 1 || level > 10) return res.status(400).json({ error:'Level 1-10' })
  const HOT = new Float64Array(SAB_REF)
  HOT[0] = level
  broadcast({ type:'propeller', level, target:getProp(Math.round(level)).r })
  res.json({ ok:true, level, target:getProp(Math.round(level)).r })
})

app.post('/api/halt', (_, res) => {
  if (!SAB_REF) return res.status(503).json({ error:'not ready' })
  new Float64Array(SAB_REF)[0] = 0
  broadcast({ type:'halt' })
  res.json({ ok:true })
})

app.post('/api/transfer', async (req, res) => {
  try {
    const { send } = await import('./settlement.js')
    res.json(await send(req.body.bridge || 'modempay', req.body))
  } catch (e) { res.status(500).json({ error:e.message }) }
})

app.post('/api/snapshot', (_, res) => {
  try { res.json({ ok:true, ...exportSnapshot() }) } catch (e) { res.status(500).json({ error:e.message }) }
})
app.get('/api/snapshot/download', (_, res) => {
  const p = ['/data/snapshot.json', './data/snapshot.json'].find(existsSync)
  if (!p) return res.status(404).json({ error:'POST /api/snapshot first' })
  res.download(p, 'snapshot.json')
})

let _started = false

export function startDashboard(SAB, chains) {
  SAB_REF    = SAB
  CHAINS_REF = chains || []
  if (_started) return
  _started = true

  const tryBind = (port) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`[DASHBOARD] ${SYSTEM} :${port} | no auth | immediate state | 2s tick`)
    })
    server.on('error', e => {
      if (e.code === 'EADDRINUSE') {
        server.removeAllListeners('error')
        setTimeout(() => tryBind(port + 1), 500)
      } else {
        console.error('[DASHBOARD]', e.message)
      }
    })
  }
  tryBind(PORT)
}

process.on('exit', () => { clearInterval(_heartbeat); clearInterval(_ticker) })
