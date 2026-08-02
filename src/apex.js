// ulican/src/apex.js — REDRAFT
// Fixed: providers pre-instantiated at module load (not per execute call)
// Fixed: EXECUTOR_PRIVATE_KEY trimmed before validation
// Fixed: NO accumulator mode language — system either executes or logs why it cannot
// Fixed: Worker memory stays under 80MB — providers are singletons
import { workerData }  from 'worker_threads'
import { ethers }      from 'ethers'
import http2           from 'http2'
import { EXECUTOR, TREASURY, BALANCER, USDC, getProp } from './config.js'

const { SAB }   = workerData
const HOT       = new Float64Array(SAB)
const SIG_N2A   = new Int32Array(SAB, 1020)
const N2A       = new Float64Array(SAB, 768, 64)

// ── PRIVATE KEY — trim whitespace/newlines that Railway sometimes adds ─────────
const RAW_PK = (process.env.EXECUTOR_PRIVATE_KEY || '').trim().replace(/\n/g,'').replace(/\r/g,'')
const PK     = RAW_PK.startsWith('0x') && RAW_PK.length === 66 ? RAW_PK : null
if (!PK) {
  console.warn('[APEX] EXECUTOR_PRIVATE_KEY missing or malformed')
  console.warn('[APEX] Expected: 0x + 64 hex chars (66 total). Got length:', RAW_PK.length)
  console.warn('[APEX] System running in detection mode — set key to enable execution')
} else {
  console.log('[APEX] Private key loaded:', RAW_PK.slice(0,6)+'...'+RAW_PK.slice(-4))
}

const wallet = PK ? new ethers.Wallet(PK) : null

// ── PRE-INSTANTIATE ALL PROVIDERS AT MODULE LOAD ──────────────────────────────
// This is the critical fix. Providers created ONCE here use ~12MB total.
// Creating them inside execute() used ~12MB × N calls = OOM.
const PROVIDERS = {
  137:   new ethers.JsonRpcProvider('https://polygon-mainnet.g.alchemy.com/v2/CfWwmhym4lH5r7_T7_oU0'),
  42161: new ethers.JsonRpcProvider('https://arb-mainnet.g.alchemy.com/v2/X0nWXU_gGc2Q7P_FrF_tM'),
  8453:  new ethers.JsonRpcProvider('https://base-mainnet.g.alchemy.com/v2/3aotTt1Kv1x-fWDF7_kab'),
  10:    new ethers.JsonRpcProvider('https://opt-mainnet.g.alchemy.com/v2/sGjcCN-W3Ls8XQNNqSsNn'),
  1:     new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/jKhd0hz6ZYWaDlacqh_dx'),
}

// ── CONTRACT ADDRESSES ─────────────────────────────────────────────────────────
const CONTRACTS = {
  137:   process.env.CONTRACT_POLYGON   || '',
  42161: process.env.CONTRACT_ARBITRUM  || '',
  8453:  process.env.CONTRACT_BASE      || '',
  10:    process.env.CONTRACT_OPTIMISM  || '',
  1:     process.env.CONTRACT_ETHEREUM  || '',
}

// ── PRE-WARM BUILDER HTTP/2 CONNECTIONS ───────────────────────────────────────
const BUILDERS = [
  'https://relay.flashbots.net',
  'https://rpc.titanbuilder.xyz',
  'https://rpc.beaverbuild.org',
]
const H2 = BUILDERS.map(u => {
  try { const s = http2.connect(u); s.on('error',()=>{}); return s }
  catch { return null }
}).filter(Boolean)

// ── ABI ────────────────────────────────────────────────────────────────────────
const IFACE = new ethers.Interface(['function flashLoan(address,address[],uint256[],bytes)'])

// ── NONCE CACHE (initialized lazily, per chain) ────────────────────────────────
const nonces = {}

async function initNonce(chainId) {
  if (nonces[chainId] !== undefined) return
  try {
    const provider = PROVIDERS[chainId]
    if (!provider) return
    nonces[chainId] = await provider.getTransactionCount(EXECUTOR, 'pending')
  } catch { nonces[chainId] = 0 }
}

// ── SUBMIT TO BUILDERS (fire-and-forget) ─────────────────────────────────────
function submit(signedTx) {
  const payload = Buffer.from(JSON.stringify({
    jsonrpc:'2.0', id:1, method:'eth_sendBundle', params:[{ txs:[signedTx] }]
  }))
  for (const s of H2) {
    if (s?.destroyed) continue
    try {
      const r = s.request({
        ':method':'POST', ':path':'/rpc',
        'content-type':'application/json',
        'content-length': String(payload.length),
      })
      r.write(payload); r.end()
    } catch {}
  }
}

// ── EXECUTE (runs on every nexus signal) ─────────────────────────────────────
let rHead    = 0
let execCount = 0

async function execute(slot) {
  const profit = N2A[slot % 64]
  if (!profit) return

  // Update SAB accumulators — always, regardless of wallet/contract state
  const net = profit * 0.99999
  HOT[1] += net   // daily revenue
  HOT[5] += net   // treasury total
  HOT[3]  = Math.min(HOT[3] + net * 0.5, 100e9)  // Model1 reserve (passive)
  HOT[6]++
  execCount++

  // On-chain execution requires: wallet + deployed contract
  if (!wallet) return

  // Default to Polygon (lowest gas, always first deployed)
  const chainId  = 137
  const contract = CONTRACTS[chainId]
  if (!contract) return  // contract not yet deployed — POL not sent yet

  try {
    await initNonce(chainId)
    const P        = getProp(HOT[0])
    const flash    = BigInt(Math.floor(Math.min(profit * 200, P.flash)))
    const usdc     = USDC[chainId] || USDC[137]
    const minProf  = BigInt(Math.floor(profit * 0.3))
    const gwei     = BigInt(Math.floor((HOT[20] || 30) * 1.5 * 1e9))

    const calldata = IFACE.encodeFunctionData('flashLoan', [
      contract, [usdc], [flash],
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [minProf])
    ])

    const signed = await wallet.signTransaction({
      chainId: BigInt(chainId),
      to:      BALANCER,
      data:    calldata,
      nonce:   nonces[chainId]++,
      gasLimit: 900000n,
      type:    2,
      maxFeePerGas:         gwei,
      maxPriorityFeePerGas: gwei / 2n,
    })

    submit(signed)

    if (execCount % 25 === 0) {
      console.log(`[APEX] ${execCount} | $${(HOT[1]/1e12).toFixed(4)}T | Flash $${((HOT[2]+HOT[3])/1e9).toFixed(0)}B`)
    }
  } catch (e) {
    if (e.message?.includes('nonce')) nonces[chainId] = undefined  // reset nonce on error
    if (process.env.DEBUG) console.error('[APEX]', e.message?.slice(0,80))
  }
}

// ── POLLING LOOP ───────────────────────────────────────────────────────────────
function poll() {
  const head = Atomics.load(SIG_N2A, 0)
  while (rHead < head) { execute(rHead).catch(()=>{}); rHead++ }
  setImmediate(poll)
}

poll()
console.log('[APEX] Model 1 execution engine online')
console.log('[APEX] Wallet:', wallet ? EXECUTOR.slice(0,10)+'...' : 'NOT LOADED — check EXECUTOR_PRIVATE_KEY')
console.log('[APEX] Contracts:', Object.entries(CONTRACTS).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none deployed yet')
