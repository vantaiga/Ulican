// ulican/src/dashboard.js — Super file. HOT-only broadcast. Model 1 dashboard.
import { createRequire }    from 'module'
import { createServer }     from 'http'
import { existsSync }       from 'fs'
import { fileURLToPath }    from 'url'
import path                 from 'path'
const __dir  = path.dirname(fileURLToPath(import.meta.url))
const req    = createRequire(import.meta.url)
const express= req(path.join(__dir,'../node_modules/express'))
const { WebSocketServer } = req(path.join(__dir,'../node_modules/ws'))
import { getExecs, exportSnapshot, recTransfer } from './db.js'
import { queueSize }   from './overlay.js'
import { sendPayment } from './treasury.js'
import { CHAINS, TOTAL_FLASH, TOTAL_CYCLES, getProp,
         EXECUTOR, TREASURY, SYSTEM, PIN, PORT, MPKEY } from './config.js'

let SAB_REF=null, CHAINS_REF=[], SOVEREIGN_W=null
const WS_CLIENTS=new Set()

const app = express()
const srv  = createServer(app)
const wss  = new WebSocketServer({ server:srv, perMessageDeflate:false })

app.use(express.json({limit:'512kb'}))
app.use(express.static(path.join(__dir,'../dashboard')))
app.get('/', (_,res)=>{ const p=path.join(__dir,'../dashboard/ulican.html'); existsSync(p)?res.sendFile(p):res.send(`${SYSTEM} dashboard not found`) })

const auth = (req,res,next) => { const p=req.headers['x-pin']||req.query.pin||req.body?.pin; if(String(p)!==String(PIN))return res.status(401).json({error:'Invalid PIN'}); next() }

function state(){
  if(!SAB_REF) return {type:'state',error:'not ready'}
  const HOT   = new Float64Array(SAB_REF)
  const lvl   = Math.max(1,Math.min(10,Math.round(HOT[0])))
  const P     = getProp(lvl)
  const flash = HOT[2]+HOT[3]
  return {
    type:'state', ts:Date.now(), system:SYSTEM,
    propeller:HOT[0], target:P.r, dailyRevenue:HOT[1],
    revPct:P.r>0?Math.min(HOT[1]/P.r*100,100):0,
    flashTotal:flash, flashBase:HOT[2], reserve:HOT[3],
    treasury:HOT[5], executions:HOT[6]|0, uptime:HOT[7]|0,
    crashSignal:HOT[4], queueSize:queueSize(),
    chainCount:CHAINS_REF.length,
    activeWS:CHAINS_REF.filter((_,i)=>HOT[40+i]>0).length,
    chains:CHAINS_REF.map((c,i)=>({name:c.name,id:c.id,active:!!HOT[40+i],gas:HOT[20+i]?.toFixed(1)||'0'})),
    memMB:process.memoryUsage().heapUsed/1024/1024|0,
    executor:EXECUTOR, treasury_addr:TREASURY, mpMode:MPKEY.startsWith('sk_live_')?'LIVE':'TEST',
  }
}

function broadcast(d){ const p=JSON.stringify(d); for(const ws of WS_CLIENTS){if(ws.readyState===1)try{ws.send(p)}catch{WS_CLIENTS.delete(ws)}} }
setInterval(()=>{ if(WS_CLIENTS.size) broadcast(state()) },500)

wss.on('connection',(ws,req)=>{
  let pin=''
  try{ const u=new URL(req.url||'/','http://x'); pin=u.searchParams.get('pin')||'' }catch{}
  if(String(pin)!==String(PIN)){ws.close(4001,'Unauthorized');return}
  WS_CLIENTS.add(ws)
  ws.send(JSON.stringify(state()))
  ws.on('close',()=>WS_CLIENTS.delete(ws))
  ws.on('error',()=>WS_CLIENTS.delete(ws))
  ws.on('message',raw=>{
    try{
      const m=JSON.parse(raw.toString())
      if(m.type==='propeller'&&typeof m.level==='number'){
        const HOT=new Float64Array(SAB_REF); HOT[0]=Math.max(1,Math.min(10,m.level))
        broadcast({type:'propeller',level:HOT[0],target:getProp(Math.round(HOT[0])).r})
      }
    }catch{}
  })
})

app.get('/health',(_,res)=>{ const HOT=SAB_REF?new Float64Array(SAB_REF):null; res.json({ok:true,system:SYSTEM,p:HOT?HOT[0]:0,rev:HOT?HOT[1]:0}) })
app.get('/api/state',auth,(_,res)=>res.json(state()))
app.get('/api/executions',auth,(req,res)=>{ try{res.json(getExecs(parseInt(req.query.limit)||50))}catch{res.json([])} })
app.post('/api/propeller',auth,(req,res)=>{
  const{level}=req.body; if(typeof level!=='number'||level<1||level>10)return res.status(400).json({error:'Level 1-10'})
  const HOT=new Float64Array(SAB_REF); HOT[0]=level
  broadcast({type:'propeller',level,target:getProp(Math.round(level)).r})
  res.json({ok:true,level,target:getProp(Math.round(level)).r})
})
app.post('/api/transfer',auth,async(req,res)=>{
  try{ const r=await sendPayment(req.body); res.json(r) }
  catch(e){ res.status(500).json({error:e.message}) }
})
app.post('/api/snapshot',auth,(_,res)=>{ try{res.json({ok:true,...exportSnapshot()})}catch(e){res.status(500).json({error:e.message})} })
app.get('/api/snapshot/download',auth,(req,res)=>{
  const p=['/data/snapshot.json','./data/snapshot.json'].find(existsSync)
  if(!p)return res.status(404).json({error:'No snapshot'})
  res.download(p,'snapshot.json')
})
app.post('/api/halt',auth,(_,res)=>{ const HOT=new Float64Array(SAB_REF); HOT[0]=0; broadcast({type:'halt'}); res.json({ok:true}) })

export function startDashboard(SAB, chains, sovereignWorker){
  SAB_REF=SAB; CHAINS_REF=chains; SOVEREIGN_W=sovereignWorker||null
  srv.listen(PORT,()=>console.log(`[DASHBOARD] :${PORT}`))
}
