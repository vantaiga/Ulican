// ulican/src/treasury.js — Real USDC. ModemPay. REF header.
import { TREASURY, EXECUTOR, REF, CHAINS } from './config.js'
import { recTransfer } from './db.js'

const POLYGON_RPC  = 'https://polygon-mainnet.g.alchemy.com/v2/CfWwmhym4lH5r7_T7_oU0'
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
const YIELD        = (0.20*0.065+0.50*0.042+0.30*0.0335)/365  // blended daily
let SAB_REF=null

async function reconcile(){
  try{
    const pad='0x70a08231000000000000000000000000'+TREASURY.replace('0x','').toLowerCase().padStart(64,'0').slice(-40).padStart(64,'0')
    const r=await fetch(POLYGON_RPC,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:USDC_POLYGON,data:pad},'latest']}),signal:AbortSignal.timeout(8000)})
    const d=await r.json()
    if(d.result&&d.result!=='0x'){
      const bal=parseInt(d.result,16)/1e6
      new Float64Array(SAB_REF)[5]=bal
      console.log(`[TREASURY] $${bal.toFixed(2)} USDC on-chain`)
    }
  }catch{}
}

export async function sendPayment({bridge='modempay',type,amount,phone,accountNumber,accountName,swiftCode,address,network}){
  const key=(process.env.MODEMPAY_SECRET_KEY||'').trim()
  if(!key)throw new Error('MODEMPAY_SECRET_KEY not set')
  if(!amount||amount<=0)throw new Error('Invalid amount')
  const FEES={wave:.015,afrimoney:.015,bank:.0125,international:.0125,crypto:.01}
  const nt=network||(type?.includes('mobile')?'wave':type?.includes('bank')?'bank':'international')
  const fee=amount*(FEES[nt]||.015)
  const reference=`${REF} | ${Date.now()}`
  const r=await fetch('https://api.modempay.com/v1/transfers',{method:'POST',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({amount,currency:'GMD',account_number:phone||accountNumber||address||'',
      network:nt,beneficiary_name:accountName||'Recipient',reference,description:reference}),
    signal:AbortSignal.timeout(60000)})
  const result=await r.json()
  if(!r.ok)throw new Error(result.message||'Transfer failed')
  const HOT=new Float64Array(SAB_REF)
  HOT[5]=Math.max(0,HOT[5]-amount)
  try{recTransfer({type,amount,recipient:phone||accountNumber||address||'',status:'submitted',reference})}catch{}
  return{ok:true,result,fee,net:amount-fee,reference}
}

export function startTreasury(SAB){
  SAB_REF=SAB
  reconcile()
  setInterval(reconcile, 5*60*1000)
  setInterval(()=>{
    const HOT=new Float64Array(SAB_REF)
    if(HOT[5]>0) HOT[5]+=HOT[5]*YIELD/24
  }, 3600*1000)
  console.log(`[TREASURY] ${TREASURY}`)
}
