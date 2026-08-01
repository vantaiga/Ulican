// ulican/src/index.js
import { Worker, isMainThread } from 'worker_threads'
import { createServer }         from 'http'
import { fileURLToPath }        from 'url'
import path                     from 'path'
import { CHAINS, TOTAL_FLASH, TOTAL_CYCLES, MEMORY_MB,
         EXECUTOR, TREASURY, SYSTEM, PORT, PIN }  from './config.js'
import { initDB }    from './db.js'
import { initOverlay } from './overlay.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// SAB — 1KB is enough for Model 1 only
// [0] propeller  [1] daily_rev  [2] flash_avail  [3] reserve
// [4] crash_sig  [5] treasury   [6] exec_count   [7] uptime
// [20-39] gas/chain  [40-59] chain_active
// Signals: byte 1016=chains→nexus, 1020=nexus→apex, 1024=ctrl
export const SAB     = new SharedArrayBuffer(1280)
export const HOT     = new Float64Array(SAB)
export const SIG_C2N = new Int32Array(SAB, 1016)
export const SIG_N2A = new Int32Array(SAB, 1020)
export const SIG_CTL = new Int32Array(SAB, 1024)
// Ring buffers: 512=chains→nexus (64 slots×8b), 768=nexus→apex (64 slots×8b)

HOT[0] = 5         // default P5
HOT[2] = TOTAL_FLASH

const memGuard = () => {
  const mb = process.memoryUsage().heapUsed / 1024 / 1024
  if (mb > MEMORY_MB * 0.85 && global.gc) global.gc()
  if (mb > MEMORY_MB * 0.95) { Atomics.store(SIG_CTL, 0, 1); if(global.gc) global.gc() }
}

function spawn(file, extra={}) {
  const w = new Worker(new URL(file, import.meta.url), { workerData:{ SAB, ...extra } })
  const tag = path.basename(file,'.js').toUpperCase()
  w.on('error', e => console.error(`[${tag}]`, e.message?.slice(0,80)))
  w.on('exit',  c => { if(c!==0) setTimeout(()=>spawn(file,extra), 2000) })
  return w
}

if (isMainThread) {
  console.log(`[${SYSTEM}] Boot | Executor: ${EXECUTOR.slice(0,20)}... | ${CHAINS.length} chains | $${(TOTAL_FLASH/1e9).toFixed(1)}B flash`)

  await initDB()
  await initOverlay()

  const chainW = spawn('./chains.js', { chains: CHAINS })
  spawn('./nexus.js')
  spawn('./apex.js')

  const [{ startDashboard }, { startTreasury }] = await Promise.all([
    import('./dashboard.js'), import('./treasury.js')
  ])
  startDashboard(SAB, CHAINS, chainW)
  startTreasury(SAB)

  setInterval(memGuard, 5000)
  setInterval(() => HOT[7]++, 1000)
  const mid = () => { const n=new Date(),nx=new Date(); nx.setUTCHours(0,0,0,0); nx.setUTCDate(nx.getUTCDate()+1); setTimeout(()=>{HOT[1]=0;mid()},nx-n) }
  mid()

  // Health
  createServer((req,res) => {
    if(req.url!=='/health'){res.writeHead(404);return res.end()}
    res.writeHead(200,{'Content-Type':'application/json'})
    res.end(JSON.stringify({ok:true,system:SYSTEM,p:HOT[0],rev:HOT[1],chains:CHAINS.length,mb:process.memoryUsage().heapUsed/1024/1024|0}))
  }).listen(3001).on('error',()=>{})

  process.on('uncaughtException',  e => console.error(`[${SYSTEM}]`, e.message?.slice(0,100)))
  process.on('unhandledRejection', r => console.error(`[${SYSTEM}]`, String(r).slice(0,100)))
  process.on('SIGTERM', () => process.exit(0))
  console.log(`[${SYSTEM}] Operational :${PORT} P${HOT[0]}`)
}
