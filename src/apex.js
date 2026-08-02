// ulican/src/apex.js — Worker Thread. JIT execution. Model 1 only.
import { workerData } from 'worker_threads'
import { ethers }     from 'ethers'
import http2          from 'http2'
import { EXECUTOR, TREASURY, BALANCER, USDC } from './config.js'

const { SAB }   = workerData
const HOT       = new Float64Array(SAB)
const SIG_N2A   = new Int32Array(SAB, 1020)
const N2A       = new Float64Array(SAB, 768, 64)

const PK     = process.env.EXECUTOR_PRIVATE_KEY
const wallet = PK?.startsWith('0x')&&PK.length===66 ? new ethers.Wallet(PK) : null
if (!wallet) console.warn('[APEX] No EXECUTOR_PRIVATE_KEY — accumulators active')

const CONTRACTS = {
  137:   process.env.CONTRACT_POLYGON   || '',
  1:     process.env.CONTRACT_ETHEREUM  || '',
  42161: process.env.CONTRACT_ARBITRUM  || '',
  8453:  process.env.CONTRACT_BASE      || '',
  10:    process.env.CONTRACT_OPTIMISM  || '',
}

const HTTP = {
  137:'https://polygon-mainnet.g.alchemy.com/v2/CfWwmhym4lH5r7_T7_oU0',
  42161:'https://arb-mainnet.g.alchemy.com/v2/X0nWXU_gGc2Q7P_FrF_tM',
}

const BUILDERS = ['https://relay.flashbots.net','https://rpc.titanbuilder.xyz','https://rpc.beaverbuild.org']
const H2 = BUILDERS.map(u=>{try{const s=http2.connect(u);s.on('error',()=>{});return s}catch{return null}}).filter(Boolean)
const IFACE = new ethers.Interface(['function flashLoan(address,address[],uint256[],bytes)'])
const nonces = {}

async function execute(slot) {
  const profit = N2A[slot%64]
  if (!profit) return
  // Always update accumulators (real detection, real potential)
  HOT[1] += profit * 0.99999
  HOT[5] += profit * 0.99999
  HOT[3]  = Math.min(HOT[3]+profit*0.5, 100e9)
  HOT[6]++

  if (!wallet) return
  const chainId=137, contract=CONTRACTS[chainId]
  if (!contract) return

  try {
    const provider = new ethers.JsonRpcProvider(HTTP[chainId])
    if (!nonces[chainId]) nonces[chainId] = await provider.getTransactionCount(EXECUTOR,'pending')
    const gwei    = BigInt(Math.floor((HOT[20]||30)*1.5*1e9))
    const calldata= IFACE.encodeFunctionData('flashLoan',[contract,[USDC[chainId]],[BigInt(Math.floor(profit*200))],
      ethers.AbiCoder.defaultAbiCoder().encode(['uint256'],[BigInt(Math.floor(profit*0.3))])])
    const signed  = await wallet.signTransaction({chainId:BigInt(chainId),to:BALANCER,data:calldata,
      nonce:nonces[chainId]++,gasLimit:900000n,type:2,maxFeePerGas:gwei,maxPriorityFeePerGas:gwei/2n})
    const payload = Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendBundle',params:[{txs:[signed]}]}))
    for(const s of H2){if(!s?.destroyed)try{const r=s.request({':method':'POST',':path':'/rpc','content-type':'application/json','content-length':String(payload.length)});r.write(payload);r.end()}catch{}}
  } catch(e) { if(e.message?.includes('nonce'))delete nonces[chainId] }
}

let rHead=0
function poll(){
  const head=Atomics.load(SIG_N2A,0)
  while(rHead<head){execute(rHead).catch(()=>{});rHead++}
  setImmediate(poll)
}
poll()
console.log('[APEX] Model 1 execution online')
