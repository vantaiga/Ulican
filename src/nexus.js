// ulican/src/nexus.js — Worker Thread. Routes MEV opportunities only.
import { workerData } from 'worker_threads'
import { getProp }    from './config.js'

const { SAB }    = workerData
const HOT        = new Float64Array(SAB)
const SIG_C2N    = new Int32Array(SAB, 1016)
const SIG_N2A    = new Int32Array(SAB, 1020)
const C2N        = new Float64Array(SAB, 512, 64)
const N2A        = new Float64Array(SAB, 768, 64)
let   rHead=0, wHead=0

function route(slot) {
  const usd = C2N[slot%64]
  if (!usd) return
  const P   = getProp(HOT[0])
  if (HOT[1] >= P.r) return                          // ceiling
  if (usd < 1e5) return                              // below minimum
  const flash  = Math.min(HOT[2]+HOT[3], P.flash)
  const profit = flash * 0.00045                     // 0.045% JIT extraction
  if (profit < 100) return
  N2A[wHead%64] = profit
  Atomics.add(SIG_N2A, 0, 1)
  wHead++
}

function poll() {
  const head = Atomics.load(SIG_C2N, 0)
  while (rHead < head) { route(rHead); rHead++ }
  setImmediate(poll)
}

poll()
console.log('[NEXUS] Model 1 routing active')
