// ulican/src/overlay.js — Swap queue. Max 50 in RAM. Disk-backed.
import { getDB, recExec } from './db.js'
const MAX=50, ACTIVE=[]
let draining=false
export const CONTRACTS={}

export async function initOverlay(){
  try{
    const db=getDB(); if(!db)return
    const r=db.exec('SELECT COUNT(*) FROM overlay WHERE executed=0')
    const n=r[0]?.values[0]?.[0]||0
    console.log(`[OVERLAY] ${n} entries queued`)
    _load()
  }catch{}
}
export function queue(e){
  const db=getDB();if(!db)return
  try{db.run('INSERT INTO overlay(ts,profit_est,flash)VALUES(?,?,?)',[Date.now(),e.profit||0,e.flash||0])}catch{}
  if(ACTIVE.length<MAX) ACTIVE.push(e)
  if(!draining) _drain()
}
export function queueSize(){try{const r=getDB()?.exec('SELECT COUNT(*) FROM overlay WHERE executed=0');return r?.[0]?.values[0]?.[0]||0}catch{return 0}}

function _load(){
  try{
    const r=getDB()?.exec('SELECT id,profit_est,flash FROM overlay WHERE executed=0 ORDER BY profit_est DESC LIMIT 50')
    ACTIVE.length=0
    for(const row of r?.[0]?.values||[]) ACTIVE.push({id:row[0],profit:row[1],flash:row[2]})
    ACTIVE.sort((a,b)=>b.profit-a.profit)
  }catch{}
}
async function _drain(){
  if(draining||!ACTIVE.length)return; draining=true
  for(const e of [...ACTIVE]){
    await new Promise(r=>setTimeout(r,300))
    if(!CONTRACTS.polygon&&!CONTRACTS[137])continue
    try{
      recExec({strategy:'rs1-overlay',profit:e.profit,status:'drain'})
      getDB()?.run('UPDATE overlay SET executed=1 WHERE id=?',[e.id])
      ACTIVE.splice(ACTIVE.indexOf(e),1)
    }catch{}
  }
  _load(); draining=false
  if(ACTIVE.length>0) setTimeout(_drain,100)
}
