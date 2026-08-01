// ulican/src/db.js — sql-asm.js. /data persistence. Snapshot migration.
import { createRequire }                          from 'module'
import { existsSync, mkdirSync, writeFileSync,
         readFileSync, unlinkSync }               from 'fs'
import { fileURLToPath }                          from 'url'
import path                                       from 'path'

const __dir  = path.dirname(fileURLToPath(import.meta.url))
const req    = createRequire(import.meta.url)
const SQL    = await req(path.join(__dir,'../node_modules/sql.js/dist/sql-asm.js'))()
const DIR    = existsSync('/data')?'/data':(mkdirSync('./data',{recursive:true}),'./data')
const BIN    = `${DIR}/ulican.db.bin`
let db=null, dirty=false

const flush = () => { if(db) try{writeFileSync(BIN,Buffer.from(db.export()))}catch{} }
setInterval(()=>{if(dirty){flush();dirty=false}},10000)
process.on('exit',flush); process.on('SIGTERM',()=>{flush();process.exit(0)})

export async function initDB(){
  db = existsSync(BIN)?(() => { try{return new SQL.Database(readFileSync(BIN))}catch{return new SQL.Database()} })():new SQL.Database()
  db.run(`CREATE TABLE IF NOT EXISTS executions(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER,strategy TEXT DEFAULT '',chain TEXT DEFAULT '',profit_usdc REAL DEFAULT 0,status TEXT DEFAULT 'ok');
          CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,val TEXT);
          CREATE TABLE IF NOT EXISTS treasury(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER,type TEXT,amount REAL,recipient TEXT,status TEXT,reference TEXT);
          CREATE TABLE IF NOT EXISTS overlay(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER,profit_est REAL,flash REAL,executed INTEGER DEFAULT 0);`)
  for(const p of ['./snapshot.json',`${DIR}/snapshot.json`]){
    if(!existsSync(p))continue
    try{const s=JSON.parse(readFileSync(p,'utf8'));_imp(s);unlinkSync(p);console.log('[DB] Snapshot imported')}catch{}
    break
  }
  flush(); console.log(`[DB] ${BIN}`)
}
function _imp(snap){
  for(const[t,rows]of Object.entries(snap?.tables??{})){
    if(!Array.isArray(rows)||!rows.length)continue
    const cols=Object.keys(rows[0]).filter(c=>c!=='id'),ph=cols.map(()=>'?').join(',')
    for(const row of rows){try{db.run(`INSERT OR REPLACE INTO ${t}(${cols.join(',')})VALUES(${ph})`,cols.map(c=>row[c]))}catch{}}
  }
}
export function exportSnapshot(){
  const tables=['executions','config','treasury','overlay'],result={}
  for(const t of tables){try{const r=db.exec(`SELECT * FROM ${t} ORDER BY rowid DESC LIMIT 5000`);result[t]=r[0]?r[0].values.map(row=>Object.fromEntries(r[0].columns.map((c,i)=>[c,row[i]]))):[];}catch{result[t]=[]}}
  const snap={version:'1.0',exportedAt:Date.now(),tables:result},out=`${DIR}/snapshot.json`
  writeFileSync(out,JSON.stringify(snap)); flush()
  return{path:out,sizeKB:Math.round(JSON.stringify(snap).length/1024)}
}
export const getDB=()=>db
export function setConfig(k,v){db.run('INSERT OR REPLACE INTO config VALUES(?,?)',[k,String(v)]);dirty=true}
export function getConfig(k,def=null){try{const r=db.exec('SELECT val FROM config WHERE key=?',[k]);return r[0]?.values[0]?.[0]??def}catch{return def}}
export function recExec(d){try{db.run('INSERT INTO executions(ts,strategy,chain,profit_usdc,status)VALUES(?,?,?,?,?)',[Date.now(),d.strategy||'rs1',d.chain||'',d.profit||0,d.status||'ok']);dirty=true}catch{}}
export function getExecs(n=50){try{const r=db.exec(`SELECT * FROM executions ORDER BY rowid DESC LIMIT ${+n|0}`);return r[0]?r[0].values.map(row=>Object.fromEntries(r[0].columns.map((c,i)=>[c,row[i]]))):[];}catch{return[]}}
export function recTransfer(d){try{db.run('INSERT INTO treasury(ts,type,amount,recipient,status,reference)VALUES(?,?,?,?,?,?)',[Date.now(),d.type||'',d.amount||0,d.recipient||'',d.status||'',d.reference||'']);dirty=true}catch{}}
