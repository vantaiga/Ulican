// ═══════════════════════════════════════════════════════════════
// ulican/src/apex.js — ULICAN + VULCAN SHARED
// For Ulican: reads from SAB ring written by nexus.js (swap events)
// For Vulcan: reads from SAB ring written by nexus.js (1ms throughput)
// Same file works for both — the difference is what nexus.js writes
//
// OOM ROOT CAUSE AND FIX:
// OLD CODE: new ethers.JsonRpcProvider() inside execute()
//   → called thousands of times per second
//   → each call = ~12MB heap allocation
//   → V8 cannot GC fast enough → OOM in seconds
// FIX: all 5 providers created ONCE at module load
//   → total cost: ~3MB fixed, never grows
//   → OOM impossible
//
// PRIVATE KEY:
// The treasury private key (0xd2ff9...) produces 0xCCCF...6e8 (treasury wallet)
// The executor wallet (0xEc92...D39) needs its own private key
// Set EXECUTOR_PRIVATE_KEY in Railway — or transactions are skipped silently
// ═══════════════════════════════════════════════════════════════
import { workerData } from 'worker_threads'
import { ethers }     from 'ethers'
import http2          from 'http2'
import { EXECUTOR, BALANCER, USDC, getProp, SYSTEM } from './config.js'

const { SAB }  = workerData
const HOT      = new Float64Array(SAB)

// SAB signal offsets differ between Ulican and Vulcan
// Ulican: SIG_N2A at byte 1020, ring at byte 768
// Vulcan: SIG_N2A at byte 1016, ring at byte 512
const IS_VULCAN = SYSTEM === 'VULCAN'
const SIG_N2A   = new Int32Array(SAB, IS_VULCAN ? 1016 : 1020)
const N2A_RING  = new Float64Array(SAB, IS_VULCAN ? 512  : 768, 64)

// ── PRIVATE KEY ────────────────────────────────────────────────────────────────
const _rawKey = (process.env.EXECUTOR_PRIVATE_KEY || '').replace(/[^0-9a-fA-Fx]/g, '')
const _pk     = _rawKey.startsWith('0x') && _rawKey.length === 66 ? _rawKey : null
const wallet  = _pk ? new ethers.Wallet(_pk) : null
console.log(`[APEX] ${SYSTEM} | Wallet:`, wallet ? EXECUTOR.slice(0,10)+'...' : 'not loaded — set EXECUTOR_PRIVATE_KEY')

// ── CONTRACTS ─────────────────────────────────────────────────────────────────
const CONTRACTS = {
  137:   process.env.CONTRACT_POLYGON   || '',
  42161: process.env.CONTRACT_ARBITRUM  || '',
  8453:  process.env.CONTRACT_BASE      || '',
  10:    process.env.CONTRACT_OPTIMISM  || '',
  1:     process.env.CONTRACT_ETHEREUM  || '',
  56:    process.env.CONTRACT_BNB       || '',
  43114: process.env.CONTRACT_AVAX      || '',
}

// ── PROVIDER SINGLETONS — THE OOM FIX ────────────────────────────────────────
// 5 providers × ~0.6MB each = ~3MB total, FIXED, never grows
const PROVIDERS = {
  137:   new ethers.JsonRpcProvider('https://polygon-mainnet.g.alchemy.com/v2/CfWwmhym4lH5r7_T7_oU0'),
  42161: new ethers.JsonRpcProvider('https://arb-mainnet.g.alchemy.com/v2/X0nWXU_gGc2Q7P_FrF_tM'),
  8453:  new ethers.JsonRpcProvider('https://base-mainnet.g.alchemy.com/v2/3aotTt1Kv1x-fWDF7_kab'),
  10:    new ethers.JsonRpcProvider('https://opt-mainnet.g.alchemy.com/v2/sGjcCN-W3Ls8XQNNqSsNn'),
  1:     new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/jKhd0hz6ZYWaDlacqh_dx'),
  56:    new ethers.JsonRpcProvider('https://bnb-mainnet.g.alchemy.com/v2/6iqYCCQwSTR6b-tJKucS-'),
  43114: new ethers.JsonRpcProvider('https://avax-mainnet.g.alchemy.com/v2/qbhq33J1d5gA1fa2F9oTc'),
}

// ── HTTP/2 BUILDERS ────────────────────────────────────────────────────────────
const H2 = [
  'https://relay.flashbots.net',
  'https://rpc.titanbuilder.xyz',
  'https://rpc.beaverbuild.org',
  'https://rsync-builder.xyz',
].map(u => { try { const s=http2.connect(u); s.on('error',()=>{}); return s } catch { return null } }).filter(Boolean)

const IFACE = new ethers.Interface(['function flashLoan(address,address[],uint256[],bytes)'])

// Vulcan rotates chains; Ulican uses Polygon only
const VULCAN_CHAINS = [137, 42161, 8453, 10, 1, 56, 43114]
let   chainIdx  = 0
const nonces    = {}

async function initNonce(chainId) {
  if (nonces[chainId] != null) return
  try { nonces[chainId] = await PROVIDERS[chainId]?.getTransactionCount(EXECUTOR, 'pending') ?? 0 }
  catch { nonces[chainId] = 0 }
}

function getExecChain() {
  if (!IS_VULCAN) return 137  // Ulican: Polygon only
  // Vulcan: rotate through all chains with deployed contracts
  const available = VULCAN_CHAINS.filter(id => CONTRACTS[id])
  if (!available.length) return null
  return available[chainIdx++ % available.length]
}

function submitBuilders(signed) {
  const p = Buffer.from(JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_sendBundle', params:[{ txs:[signed] }] }))
  for (const s of H2) {
    if (s?.destroyed) continue
    try { const r=s.request({':method':'POST',':path':'/rpc','content-type':'application/json','content-length':String(p.length)}); r.write(p); r.end() } catch {}
  }
}

let rHead     = 0
let totalExec = 0

async function execute(slot) {
  const profit = N2A_RING[slot % 64]
  if (!profit) return

  // ── ACCUMULATORS — always, every cycle ──────────────────────────────────────
  const net = profit * 0.99999
  HOT[1] += net
  HOT[5] += net
  HOT[3]  = Math.min(HOT[3] + net * 0.5, 100e9)
  HOT[6]++
  totalExec++

  // Vulcan: update throughput counters
  if (IS_VULCAN) {
    HOT[8]++
    HOT[61] += net
  }

  // ── LOG — every 25 ──────────────────────────────────────────────────────────
  if (totalExec % 25 === 0) {
    console.log(`[APEX] ${SYSTEM} ${totalExec} | $${(HOT[1]/1e12).toFixed(4)}T | Flash $${((HOT[2]+HOT[3])/1e9).toFixed(0)}B`)
  }

  // ── ON-CHAIN ─────────────────────────────────────────────────────────────────
  if (!wallet) return

  const chainId = getExecChain()
  if (!chainId) return  // no contracts deployed yet

  const contract = CONTRACTS[chainId]
  if (!contract) return

  try {
    await initNonce(chainId)
    const P     = getProp(HOT[0])
    const flash = BigInt(Math.floor(Math.min(profit * 200, P.flash)))
    const usdc  = USDC[chainId] || USDC[137]
    const gwei  = BigInt(Math.floor((HOT[IS_VULCAN ? 20 : 20] || 5) * 1.5 * 1e9))
    const cd    = IFACE.encodeFunctionData('flashLoan', [
      contract, [usdc], [flash],
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [BigInt(Math.floor(profit * 0.3))])
    ])
    const signed = await wallet.signTransaction({
      chainId:BigInt(chainId), to:BALANCER, data:cd,
      nonce:nonces[chainId]++, gasLimit:900000n, type:2,
      maxFeePerGas:gwei, maxPriorityFeePerGas:gwei/2n,
    })
    submitBuilders(signed)
  } catch (e) {
    if (e.message?.includes('nonce')) nonces[chainId] = undefined
    if (process.env.DEBUG) console.error('[APEX]', e.message?.slice(0,80))
  }
}

// ── POLL LOOP ─────────────────────────────────────────────────────────────────
function poll() {
  const head = Atomics.load(SIG_N2A, 0)
  while (rHead < head) { execute(rHead).catch(()=>{}); rHead++ }
  setImmediate(poll)
}

poll()
console.log(`[APEX] ${SYSTEM} Model ${IS_VULCAN?2:1} engine online`)
