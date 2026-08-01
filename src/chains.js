// ulican/src/chains.js — Worker Thread. Model 1 swap detection only.
import { workerData } from 'worker_threads'
import WebSocket       from 'ws'
import { SWAP_SIG, STABLE0 } from './config.js'

const { SAB, chains=[] } = workerData
const HOT     = new Float64Array(SAB)
const SIG_C2N = new Int32Array(SAB, 1016)
const SIG_CTL = new Int32Array(SAB, 1024)
const C2N     = new Float64Array(SAB, 512, 64)  // 64 slots, [usd]
let   wHead   = 0
const DEAD    = new Set()

function decodeUSD(data, addr) {
  if (!data||data.length<130) return 0
  const hex = data.replace('0x','')
  const H=2n**255n, F=2n**256n
  let a0=BigInt('0x'+hex.slice(0,64)), a1=BigInt('0x'+hex.slice(64,128))
  if(a0>H)a0-=F; if(a1>H)a1-=F
  const abs0=a0<0n?-a0:a0, abs1=a1<0n?-a1:a1
  const stable = STABLE0.has((addr||'').toLowerCase()) ? abs0 : abs1
  const usd = Number(stable)/1e6
  return (usd>=1e5&&usd<=1e13&&isFinite(usd)) ? usd : 0
}

function push(usd) {
  C2N[wHead%64] = usd
  Atomics.add(SIG_C2N, 0, 1)
  wHead++
  HOT[6]++
}

function connect(chain, attempt=0) {
  if (DEAD.has(chain.name)) return
  const ws = new WebSocket(chain.ws, { handshakeTimeout:10000 })
  const TO  = setTimeout(() => { ws.terminate(); DEAD.add(chain.name); httpPoll(chain) }, 15000)
  ws.on('open', () => {
    clearTimeout(TO); HOT[40+chains.indexOf(chain)]=1
    ws.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_subscribe',params:['logs',{topics:[SWAP_SIG]}]}))
    const pi = setInterval(() => { if(ws.readyState===1) ws.ping() }, 20000)
    ws.on('close', () => clearInterval(pi))
    console.log(`[CHAINS] ${chain.name} connected`)
  })
  ws.on('message', raw => {
    if (Atomics.load(SIG_CTL,0)===1) return
    try {
      const m=JSON.parse(raw.toString()), log=m?.params?.result
      if(!log?.topics?.[0]||log.topics[0]!==SWAP_SIG) return
      const usd=decodeUSD(log.data, log.address)
      if(usd>0) push(usd)
    } catch {}
  })
  ws.on('error', e => {
    clearTimeout(TO)
    if(/ENOTFOUND|40[134]/.test(e.message||'')) { DEAD.add(chain.name); httpPoll(chain) }
  })
  ws.on('close', () => {
    clearTimeout(TO); HOT[40+chains.indexOf(chain)]=0
    if(!DEAD.has(chain.name)) setTimeout(()=>connect(chain,attempt+1), Math.min(5000*1.5**Math.min(attempt,5),30000))
  })
}

async function httpPoll(chain) {
  const run = async () => {
    if(Atomics.load(SIG_CTL,0)===1) return
    try {
      const r=await fetch(chain.http,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getLogs',params:[{topics:[SWAP_SIG],fromBlock:'latest',toBlock:'latest'}]}),
        signal:AbortSignal.timeout(8000)})
      if(!r.ok)return
      const d=await r.json()
      for(const log of (d.result||[]).slice(0,20)) { const usd=decodeUSD(log.data,log.address); if(usd>0) push(usd) }
    } catch {}
  }
  setInterval(run, 12000)
  console.log(`[CHAINS] ${chain.name} HTTP fallback`)
}

// Gas updates every 60s
const gasUpdate = async () => {
  for(let i=0;i<chains.length;i++) {
    try {
      const r=await fetch(chains[i].http,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_gasPrice',params:[]}),signal:AbortSignal.timeout(4000)})
      const d=await r.json(); if(d.result) HOT[20+i]=parseInt(d.result,16)/1e9
    } catch {}
  }
}

chains.forEach(c => { if(c.name.includes('solana')) httpPoll(c); else connect(c) })
setInterval(gasUpdate, 60000)
gasUpdate()
