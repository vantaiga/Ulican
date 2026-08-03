// ═══════════════════════════════════════════════════════════════
// src/adapters/modempay.js — ModemPay adapter (30-50 LoC)
// The template for all future adapters. Copy, rename, change URL + auth.
// ═══════════════════════════════════════════════════════════════

const BASE = k => k.startsWith('sk_live_') ? 'https://api.modempay.com/v1' : 'https://api.test.modempay.com/v1'
const REF  = '(system) Operator: Bun Omar SECKA'
const FEES = { wave:.015, afrimoney:.015, qmoney:.015, bank:.0125, international:.0125, crypto:.01 }

export async function send(key, params) {
  const { type, amount, phone, accountNumber, accountName, swiftCode, address, network, chain } = params
  if (!amount || amount <= 0) throw new Error('Invalid amount')

  const net_type = network || (
    type?.includes('mobile') ? 'wave' :
    type?.includes('bank')   ? 'bank' :
    type?.includes('intl')   ? 'international' : 'crypto'
  )
  const fee      = amount * (FEES[net_type] || 0.015)
  const reference = `${REF} | ${Date.now()}`

  const body = {
    amount, currency: 'GMD',
    account_number:   phone || accountNumber || address || '',
    network:          net_type,
    beneficiary_name: accountName || 'Recipient',
    reference,
    description:      reference,
  }
  if (swiftCode) body.swift = swiftCode

  const r = await fetch(`${BASE(key)}/transfers`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(60000),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.message || d.error || `ModemPay error: ${r.status}`)
  return { ok:true, result:d, fee:+fee.toFixed(2), net:+(amount-fee).toFixed(2), reference, bridge:'modempay' }
}

export function calcFee(amount, network='wave') {
  const rate = FEES[network] || 0.015
  return { amount, fee:+(amount*rate).toFixed(2), net:+(amount*(1-rate)).toFixed(2), rate:`${(rate*100).toFixed(2)}%` }
}

// getStatus — check transfer status by ID
export async function getStatus(key, transferId) {
  const r = await fetch(`${BASE(key)}/transfers/${transferId}`, { headers:{'Authorization':`Bearer ${key}`}, signal:AbortSignal.timeout(10000) })
  return r.json()
}

// getBalance — check account balance
export async function getBalance(key) {
  const r = await fetch(`${BASE(key)}/balances`, { headers:{'Authorization':`Bearer ${key}`}, signal:AbortSignal.timeout(10000) })
  return r.json()
}
