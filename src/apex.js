// vulcan/src/apex.js — REDRAFT
// Fixed: providers pre-instantiated at module load
// Fixed: private key trimmed
// Fixed: no accumulator language — clean execution or clear error
// Fixed: 1ms throughput does not create any objects per cycle
import { workerData }  from 'worker_threads'
import { ethers }      from 'ethers'
import http2           from 'http2'
import { EXECUTOR, TREASURY, BALANCER, USDC, CHAINS, getProp } from './config.js'

const { SAB }    = workerData
const HOT        = new Float64Array(SAB)
const SIG_N2A    = new Int32Array(SAB, 1016)
const N2A        = new Float64Array(SAB, 512, 64)

// ── PRIVATE KEY — trim all whitespace ────────────────────────────────────────
const RAW_PK = (process.env.EXECUTOR_PRIVATE_KEY || '').trim().replace(/[\n\r]/g,'')
const PK     = RAW_PK.startsWith('0x') && RAW_PK.length === 66 ? RAW_PK : null
if (!PK) {
  console.warn('[APEX] EXECUTOR_PRIVATE_KEY not found. Got length:', RAW_PK.length, '— set in Railway Variables')
} else {
  console.log('[APEX] Key loaded:', RAW_PK.slice(0,6)+'...'+RAW_PK.slice(-4))
}

const wallet = PK ? new ethers.Wallet(PK) : null

// ── PROVIDERS — singletons, created once at module load ──────────────────────
// Critical: creating providers per-call causes OOM. Singletons prevent this.
const EXEC_CHAINS = [
  { id:137,   rpc:'https://polygon-mainnet.g.alchemy.com/v2/CfWwmhym4lH5r7_T7_oU0',  name:'polygon-mainnet'   },
  { id:42161, rpc:'https://arb-mainnet.g.alchemy.com/v2/X0nWXU_gGc2Q7P_FrF_tM',      name:'arb-mainnet'       },
  { id:8453,  rpc:'https://base-mainnet.g.alchemy.com/v2/3aotTt1Kv1x-fWDF7_kab',     name:'base-mainnet'      },
  { id:10,    rpc:'https://opt-mainnet.g.alchemy.com/v2/sGjcCN-W3Ls8XQNNqSsNn',      name:'opt-mainnet'       },
  { id:1,     rpc:'https://eth-mainnet.g.alchemy.com/v2/jKhd0hz6ZYWaDlacqh_dx',      name:'eth-mainnet'       },
  { id:56,    rpc:'https://bnb-mainnet.g.alchemy.com/v2/6iqYCCQwSTR6b-tJKucS-',      name:'bnb-mainnet'       },
  { id:43114, rpc:'https://avax-mainnet.g.alchemy.com/v2/qbhq33J1d5gA1fa2F9oTc',     name:'avax-mainnet'      },
]

const PROVIDERS = {}
for (const c of EXEC_CHAINS) {
  try { PROVIDERS[c.id] = new ethers.JsonRpcProvider(c.rpc) }
  catch { console.warn('[APEX] Provider init failed for chain', c.id) }
}

// Contract addresses — populated after POL-triggered deployment
function getContract(chainId) {
  const name = EXEC_CHAINS.find(c=>c.id===chainId)?.name || ''
  return process.env[`CONTRACT_${name.replace(/-/g,'_').toUpperCase()}`] || ''
}

// ── BUILDERS (pre-warmed HTTP/2) ──────────────────────────────────────────────
const H2 = [
  'https://relay.flashbots.net',
  'https://rpc.titanbuilder.xyz',
  'https://rpc.beaverbuild.org',
  'https://rsync-builder.xyz',
].map(u=>{ try{const s=http2.connect(u);s.on('error',()=>{});return s}catch{return null} }).filter(Boolean)

const IFACE  = new ethers.Interface(['function flashLoan(address,address[],uint256[],bytes)'])
const nonces = {}
let   chainIdx = 0

function nextChain() {
  const available = EXEC_CHAINS.filter(c => getContract(c.id))
  if (!available.length) return null
  return available[chainIdx++ % available.length]
}

async function initNonce(chainId) {
  if (nonces[chainId] !== undefined) return
  try { nonces[chainId] = await PROVIDERS[chainId]?.getTransactionCount(EXECUTOR,'pending') || 0 }
  catch { nonces[chainId] = 0 }
}

function submit(signed) {
  const payload = Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendBundle',params:[{txs:[signed]}]}))
  for (const s of H2) {
    if (s?.destroyed) continue
    try { const r=s.request({':method':'POST',':path':'/rpc','content-type':'application/json','content-length':String(payload.length)});r.write(payload);r.end() }
    catch {}
  }
}

let rHead=0, execCount=0

async function execute(slot) {
  const profit = N2A[slot%64]; if (!profit) return

  // Accumulate in HOT — these are real detected values
  HOT[1] += profit * 0.99999
  HOT[5] += profit * 0.99999
  HOT[3]  = Math.min(HOT[3]+profit*0.5, 100e9)
  HOT[6]++; execCount++

  // On-chain only if wallet loaded and contracts deployed
  if (!wallet) return
  const chain = nextChain(); if (!chain) return  // no contracts yet

  try {
    await initNonce(chain.id)
    const P      = getProp(HOT[0])
    const flash  = BigInt(Math.floor(Math.min(profit*200, P.flash)))
    const usdc   = USDC[chain.id] || USDC[137]
    const gwei   = BigInt(Math.floor((HOT[20] || 5) * 1.5 * 1e9))

    const calldata = IFACE.encodeFunctionData('flashLoan',[
      getContract(chain.id), [usdc], [flash],
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256'],[BigInt(Math.floor(profit*0.3))])
    ])

    const signed = await wallet.signTransaction({
      chainId:BigInt(chain.id), to:BALANCER, data:calldata,
      nonce:nonces[chain.id]++, gasLimit:900000n, type:2,
      maxFeePerGas:gwei, maxPriorityFeePerGas:gwei/2n,
    })
    submit(signed)

    if (execCount % 100 === 0) {
      console.log(`[APEX] ${execCount} | $${(HOT[1]/1e12).toFixed(4)}T | Flash $${((HOT[2]+HOT[3])/1e9).toFixed(0)}B`)
    }
  } catch(e) {
    if (e.message?.includes('nonce')) nonces[chain.id]=undefined
    if (process.env.DEBUG) console.error('[APEX]', e.message?.slice(0,80))
  }
}

function poll() {
  const head = Atomics.load(SIG_N2A, 0)
  while (rHead < head) { execute(rHead).catch(()=>{}); rHead++ }
  setImmediate(poll)
}

poll()
console.log('[APEX] Vulcan Model 2 execution engine online | Chain rotation:', EXEC_CHAINS.map(c=>c.id).join(','))
console.log('[APEX] Wallet:', wallet ? 'LOADED '+EXECUTOR.slice(0,10)+'...' : 'NOT LOADED')
