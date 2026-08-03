// ═══════════════════════════════════════════════════════════════
// ulican/src/dashboard.js — ULICAN
// Same PIN fix. HOT-only. Pre+post deployment data split.
// ═══════════════════════════════════════════════════════════════
import { createRequire }    from 'module'
import { createServer }     from 'http'
import { existsSync }       from 'fs'
import { fileURLToPath }    from 'url'
import path                 from 'path'

const __dir  = path.dirname(fileURLToPath(import.meta.url))
const req    = createRequire(import.meta.url)
const express= req(path.join(__dir,'../node_modules/express'))
const { WebSocketServer } = req(path.join(__dir,'../node_modules/ws'))

import { getDB, getExecs, exportSnapshot, recTransfer } from './db.js'
import { queueSize }   from './overlay.js'
import { CHAINS, TOTAL_FLASH, getProp, EXECUTOR, TREASURY, SYSTEM } from './config.js'

let SAB_REF=null, CHAINS_REF=[]
const WS_CLIENTS=new Set()
let wsRejections=0

const cleanPin = s=>String(s||'').replace(/[^0-9a-zA-Z]/g,'')
const PIN      = cleanPin(process.env.DASHBOARD_PASSKEY||'3530588')
const PORT     = parseInt(process.env.PORT||'3000')

const app=express(), srv=createServer(app), wss=new WebSocketServer({server:srv,perMessageDeflate:false})
app.use(express.json({limit:'512kb'}))
app.get('/',(_,res)=>{const p=path.join(__dir,'../dashboard/ulican.html');existsSync(p)?res.sendFile(p):res.status(404).send('ulican.html missing')})
app.use(express.static(path.join(__dir,'../dashboard')))

app.get('/ping',(_,res)=>res.json({ok:true,system:SYSTEM,pin_length:PIN.length,ws_clients:WS_CLIENTS.size,ws_rejections:wsRejections,uptime:SAB_REF?new Float64Array(SAB_REF)[7]|0:0}))
app.get('/health',(_,res)=>{const HOT=SAB_REF?new Float64Array(SAB_REF):null;res.json({ok:true,system:SYSTEM,uptime:HOT?HOT[7]|0:0,propeller:HOT?HOT[0]:0,rev:HOT?HOT[1]:0,chains:CHAINS_REF.length,mb:process.memoryUsage().heapUsed/1024/1024|0})})

const auth=(req,res,next)=>{const p=cleanPin(req.headers['x-pin']||req.query.pin||req.body?.pin||'');if(p!==PIN)return res.status(401).json({error:'Invalid PIN'});next()}

function state(){
  if(!SAB_REF)return{type:'state',ts:Date.now(),error:'booting'}
  const HOT=new Float64Array(SAB_REF)
  const lvl=Math.max(1,Math.min(10,Math.round(HOT[0]))), P=getProp(lvl)
  return{
    type:'state',ts:Date.now(),system:SYSTEM,
    propeller:HOT[0],target:P.r,dailyRevenue:HOT[1],
    revPct:P.r>0?Math.min(HOT[1]/P.r*100,100):0,
    flashBase:HOT[2],flashReserve:HOT[3],flashTotal:HOT[2]+HOT[3],
    treasury:HOT[5],executions:HOT[6]|0,uptime:HOT[7]|0,
    crashSignal:HOT[4],queueSize:queueSize(),
    chainCount:CHAINS_REF.length,
    activeWS:CHAINS_REF.filter((_,i)=>HOT[40+i]>0).length,
    chains:CHAINS_REF.map((c,i)=>({name:c.name,id:c.id,active:!!HOT[40+i],gas:HOT[20+i]?.toFixed(1)||'0'})),
    memMB:process.memoryUsage().heapUsed/1024/1024|0,
    executor:EXECUTOR,treasury_addr:TREASURY,
  }
}

function broadcast(d){const p=JSON.stringify(d);for(const ws of WS_CLIENTS){if(ws.readyState===1)try{ws.send(p)}catch{WS_CLIENTS.delete(ws)}}}
setInterval(()=>{if(WS_CLIENTS.size>0)broadcast(state())},500)

wss.on('connection',(ws,req)=>{
  let pin=''; try{pin=cleanPin(new URL(req.url||'/','http://x').searchParams.get('pin')||'')}catch{}
  if(pin!==PIN){wsRejections++;console.warn(`[DASHBOARD] WS REJECTED #${wsRejections} | got:'${pin}' expected:'${PIN}'`);ws.close(4001,'Unauthorized');return}
  WS_CLIENTS.add(ws)
  ws.send(JSON.stringify(state()))
  ws.on('close',()=>WS_CLIENTS.delete(ws))
  ws.on('error',()=>WS_CLIENTS.delete(ws))
  ws.on('message',raw=>{try{const m=JSON.parse(raw.toString());if(m.type==='propeller'&&typeof m.level==='number'){const HOT=new Float64Array(SAB_REF);HOT[0]=Math.max(1,Math.min(10,m.level));broadcast({type:'propeller',level:HOT[0],target:getProp(Math.round(HOT[0])).r})}}catch{}})
  console.log(`[DASHBOARD] ${SYSTEM} WS connected | clients:${WS_CLIENTS.size}`)
})

app.get('/api/state',auth,(_,res)=>res.json(state()))
app.get('/api/executions',auth,(req,res)=>{try{res.json(getExecs(parseInt(req.query.limit)||50))}catch{res.json([])}})
app.post('/api/propeller',auth,(req,res)=>{
  const{level}=req.body;if(typeof level!=='number'||level<1||level>10)return res.status(400).json({error:'1-10'})
  const HOT=new Float64Array(SAB_REF);HOT[0]=level;broadcast({type:'propeller',level,target:getProp(Math.round(level)).r});res.json({ok:true,level,target:getProp(Math.round(level)).r})
})
app.post('/api/transfer',auth,async(req,res)=>{
  try{const{send}=await import('./settlement.js');res.json(await send(req.body.bridge||'modempay',req.body))}catch(e){res.status(500).json({error:e.message})}
})
app.post('/api/snapshot',auth,(_,res)=>{try{res.json({ok:true,...exportSnapshot()})}catch(e){res.status(500).json({error:e.message})}})
app.get('/api/snapshot/download',auth,(_,res)=>{const p=['/data/snapshot.json','./data/snapshot.json'].find(existsSync);if(!p)return res.status(404).json({error:'POST /api/snapshot first'});res.download(p,'snapshot.json')})
app.post('/api/halt',auth,(_,res)=>{new Float64Array(SAB_REF)[0]=0;broadcast({type:'halt'});res.json({ok:true})})

export function startDashboard(SAB,chains){
  SAB_REF=SAB;CHAINS_REF=chains
  srv.listen(PORT,()=>{console.log(`[DASHBOARD] ${SYSTEM} :${PORT} | PIN:${PIN}`);console.log(`[DASHBOARD] Test: /ping | Health: /health`)})
}
