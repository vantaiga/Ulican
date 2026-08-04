// dashboard.js — ULICAN (Model 1) + VULCAN (Model 2)
// 100% HOT. Zero fake data.
// Same PIN fix. /ping requires no auth.
// Broadcasts pre-deployment data from second 1:
//   uptime, memory, chains, propeller, flash — all real from boot
// Post-deployment adds: revenue, executions, treasury
import { createRequire }    from 'module'
import { createServer }     from 'http'
import { existsSync }       from 'fs'
import { fileURLToPath }    from 'url'
import path                 from 'path'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const _req  = createRequire(import.meta.url)
const express             = _req(path.join(__dir,'../node_modules/express'))
const { WebSocketServer } = _req(path.join(__dir,'../node_modules/ws'))

// Config — works for both Ulican and Vulcan since both export same names
import { CHAINS, TOTAL_FLASH, getProp, EXECUTOR, TREASURY, SYSTEM } from './config.js'

// DB — both systems have same db.js exports
let _getExecs, _exportSnapshot, _recTransfer, _queueSize
try {
  const db  = await import('./db.js')
  const ovl = await import('./overlay.js').catch(() => ({ queueSize: ()=>0 }))
  _getExecs        = db.getExecs       || db.getExecutions || (() => [])
  _exportSnapshot  = db.exportSnapshot || (() => ({}))
  _recTransfer     = db.recTransfer    || db.recordTransfer || (()=>{})
  _queueSize       = ovl.queueSize     || ovl.getQueueSize  || (() => 0)
} catch {}

// ── PIN ──────────────────────────────────────────────────────────────────────
const cleanPin = s => String(s || '').replace(/[^0-9a-zA-Z]/g, '')
const PIN      = cleanPin(process.env.DASHBOARD_PASSKEY || '3530588')
const PORT     = parseInt(process.env.PORT || '3000')

// ── REFS ─────────────────────────────────────────────────────────────────────
let SAB_REF      = null
let CHAINS_REF   = []
const WS_CLIENTS = new Set()
let   rejections = 0

const hot = () => SAB_REF ? new Float64Array(SAB_REF) : null

// ── STATE — 100% HOT reads, system-agnostic ──────────────────────────────────
function fullState() {
  const H = hot()
  if (!H) return { type:'state', ts:Date.now(), booting:true }

  const propeller = H[0]
  const P         = getProp ? getProp(propeller) : { r: 1e7, flash: TOTAL_FLASH }
  const target    = P.r
  const flashTotal= H[2] + H[3]
  const memMB     = process.memoryUsage().heapUsed / 1024 / 1024 | 0

  const chains = CHAINS_REF.map((c, i) => ({
    name:   c.name,
    id:     c.id,
    active: H[40 + i] > 0,
    gas:    H[20 + i] > 0 ? H[20 + i].toFixed(1) : '0',
  }))

  // Fields differ slightly between Model 1 (Ulican) and Model 2 (Vulcan)
  // Both are present — dashboard HTML uses what it needs
  return {
    type:         'state',
    ts:           Date.now(),
    system:       SYSTEM,
    // ── Propeller / Revenue
    propeller,
    target,
    dailyRevenue: H[1],
    revPct:       target > 0 ? Math.min(H[1]/target*100, 100) : 0,
    // ── Flash
    flashBase:    H[2],
    flashReserve: H[3],
    flashTotal,
    // ── Signals
    crashSignal:  H[4],
    // ── Treasury
    treasury:     H[5],
    // ── Ops (HOT[6]=execCount in both, HOT[7]=uptime in both)
    executions:   H[6] | 0,
    uptime:       H[7] | 0,
    // ── Model 2 specific (Vulcan — zeros for Ulican, harmless)
    throughputCycles: H[8] | 0,
    deployed:         H[9] > 0,
    polReceived:      H[10],
    totalThroughput:  H[60] || 0,
    extractionEarned: H[61] || 0,
    // ── Chains
    chainCount:   CHAINS_REF.length,
    activeWS:     chains.filter(c => c.active).length,
    chains,
    // ── System
    memMB,
    memCap:       80,
    executor:     EXECUTOR,
    treasuryAddr: TREASURY,
    wsClients:    WS_CLIENTS.size,
    queueSize:    (() => { try { return _queueSize() } catch { return 0 } })(),
  }
}

// ── BROADCAST ────────────────────────────────────────────────────────────────
function broadcast(data) {
  const p = JSON.stringify(data)
  for (const ws of WS_CLIENTS) {
    if (ws.readyState === 1) try { ws.send(p) } catch { WS_CLIENTS.delete(ws) }
  }
}

// ── EXPRESS ──────────────────────────────────────────────────────────────────
const app = express()
const srv  = createServer(app)
const wss  = new WebSocketServer({ server: srv, perMessageDeflate: false })

app.use(express.json({ limit: '512kb' }))
app.use(express.static(path.join(__dir, '../dashboard')))

app.get('/', (_, res) => {
  // SYSTEM name drives which HTML to serve
  const name = (SYSTEM || 'ulican').toLowerCase()
  const p    = path.join(__dir, `../dashboard/${name}.html`)
  existsSync(p) ? res.sendFile(p) : res.status(404).send(`${name}.html not found in /dashboard/`)
})

// ── NO-AUTH DIAGNOSTICS ──────────────────────────────────────────────────────
app.get('/ping', (_, res) => {
  const H = hot()
  res.json({
    ok:         true,
    ts:         Date.now(),
    system:     SYSTEM,
    wsClients:  WS_CLIENTS.size,
    wsRejected: rejections,
    pinLength:  PIN.length,
    uptime:     H ? H[7]|0 : 0,
    propeller:  H ? H[0]   : 0,
    rev:        H ? H[1]   : 0,
    flash:      H ? (H[2]+H[3]) : 0,
    chains:     CHAINS_REF.length,
    activeWS:   H ? CHAINS_REF.filter((_,i)=>H[40+i]>0).length : 0,
    memMB:      process.memoryUsage().heapUsed/1024/1024|0,
  })
})

// ── AUTH ──────────────────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const raw = req.headers['x-pin'] || req.query.pin || req.body?.pin || ''
  if (cleanPin(raw) !== PIN) return res.status(401).json({ error: 'Invalid PIN' })
  next()
}

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/state', auth, (_, res) => res.json(fullState()))

app.get('/api/executions', auth, (req, res) => {
  try { res.json(_getExecs(parseInt(req.query.limit) || 50)) } catch { res.json([]) }
})

app.post('/api/propeller', auth, (req, res) => {
  const { level } = req.body
  if (typeof level !== 'number' || level < 1 || level > 10)
    return res.status(400).json({ error: 'Level 1-10' })
  const H = hot(); if (!H) return res.status(503).json({ error: 'not ready' })
  H[0] = level
  const P = getProp(level)
  broadcast({ type: 'propeller', level, target: P.r })
  res.json({ ok: true, level, target: P.r })
})

app.post('/api/transfer', auth, async (req, res) => {
  const { bridge = 'modempay', ...params } = req.body
  try {
    const { send } = await import('./settlement.js')
    const result   = await send(bridge, params)
    try { _recTransfer({ type:params.type||'', amount:params.amount||0, bridge, recipient:params.phone||params.accountNumber||params.address||'', status:'submitted', reference:result.reference||'' }) } catch {}
    broadcast({ type:'transfer', amount:params.amount, status:'submitted' })
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/halt', auth, (_, res) => {
  const H = hot()
  if (H) H[0] = 0
  broadcast({ type: 'halt' })
  res.json({ ok: true })
})

app.post('/api/snapshot', auth, (_, res) => {
  try { res.json({ ok: true, ..._exportSnapshot() }) } catch (e) { res.status(500).json({ error: e.message }) }
})
app.get('/api/snapshot/download', auth, (_, res) => {
  const p = ['/data/snapshot.json', './data/snapshot.json'].find(existsSync)
  if (!p) return res.status(404).json({ error: 'POST /api/snapshot first' })
  res.download(p, 'snapshot.json')
})

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  let incoming = ''
  try { incoming = cleanPin(new URL(req.url || '/', 'http://x').searchParams.get('pin') || '') } catch {}

  if (incoming !== PIN) {
    rejections++
    console.warn(`[DASHBOARD] WS REJECTED #${rejections} | got:'${incoming}' want:'${PIN}' | check DASHBOARD_PASSKEY in Railway Variables`)
    ws.close(4001, 'Unauthorized')
    return
  }

  WS_CLIENTS.add(ws)
  // Send full state immediately on connect
  ws.send(JSON.stringify(fullState()))

  ws.on('close', () => WS_CLIENTS.delete(ws))
  ws.on('error', () => WS_CLIENTS.delete(ws))
  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw.toString())
      if (m.type === 'propeller' && typeof m.level === 'number') {
        const H = hot()
        if (H) { H[0] = Math.max(1,Math.min(10,m.level)); broadcast({ type:'propeller', level:H[0], target:getProp(Math.round(H[0])).r }) }
      }
    } catch {}
  })

  console.log(`[DASHBOARD] ${SYSTEM} WS CONNECTED | clients:${WS_CLIENTS.size} | uptime:${hot()?hot()[7]|0:0}s`)
})

// 500ms broadcast loop
setInterval(() => { if (WS_CLIENTS.size > 0) broadcast(fullState()) }, 500)

export function startDashboard(SAB, chains) {
  SAB_REF    = SAB
  CHAINS_REF = chains || []
  srv.listen(PORT, () => {
    console.log(`[DASHBOARD] ${SYSTEM} :${PORT} | PIN:${PIN}`)
    console.log(`[DASHBOARD] Test with no auth: GET /ping`)
  })
}
