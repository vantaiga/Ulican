// ulican/src/config.js
// ULICAN — Model 1 Only. MEV. P1:$100K P10:$100B.
export const SYSTEM       = 'ULICAN'
export const VERSION      = '1.0'
export const EXECUTOR     = '0xEc92EF0C897b48A3525Df011D08011c5eB2D6D39'
export const TREASURY     = '0xCCCF1C9A2154750A0D7CceeD51fE0f9b4c1906e8'
export const BALANCER     = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'
export const SWAP_SIG     = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
export const MEMORY_MB    = 80
export const PIN          = process.env.DASHBOARD_PASSKEY || '3530588'
export const PORT         = parseInt(process.env.PORT || '3000')
export const MPKEY        = process.env.MODEMPAY_SECRET_KEY || ''
export const REF          = '(system) Operator: Bun Omar SECKA'

// 20 Alchemy endpoints — hardcoded
export const CHAINS = [
  { name:'arb-mainnet',       id:42161,  http:'https://arb-mainnet.g.alchemy.com/v2/X0nWXU_gGc2Q7P_FrF_tM',       blocks:345600, fl:2100 },
  { name:'sei-mainnet',       id:1329,   http:'https://sei-mainnet.g.alchemy.com/v2/-vnNUoR-xYBdJc-EVAEtr',       blocks:345600, fl:800  },
  { name:'sonic-mainnet',     id:146,    http:'https://sonic-mainnet.g.alchemy.com/v2/bvVHqI4zTiNSN8Hkx9vqj',     blocks:172800, fl:700  },
  { name:'sonic-mainnet-2',   id:146,    http:'https://sonic-mainnet.g.alchemy.com/v2/OwN_yxTn0r3jg4KxlqkYJ',     blocks:172800, fl:700  },
  { name:'solana-mainnet',    id:0,      http:'https://solana-mainnet.g.alchemy.com/v2/FOimj4oVe521S4xNZC9FO',     blocks:172800, fl:1200 },
  { name:'base-mainnet',      id:8453,   http:'https://base-mainnet.g.alchemy.com/v2/3aotTt1Kv1x-fWDF7_kab',      blocks:43200,  fl:1400 },
  { name:'opt-mainnet',       id:10,     http:'https://opt-mainnet.g.alchemy.com/v2/sGjcCN-W3Ls8XQNNqSsNn',       blocks:43200,  fl:1100 },
  { name:'polygon-mainnet',   id:137,    http:'https://polygon-mainnet.g.alchemy.com/v2/CfWwmhym4lH5r7_T7_oU0',   blocks:40754,  fl:1800 },
  { name:'avax-mainnet',      id:43114,  http:'https://avax-mainnet.g.alchemy.com/v2/qbhq33J1d5gA1fa2F9oTc',      blocks:42146,  fl:1200 },
  { name:'blast-mainnet',     id:81457,  http:'https://blast-mainnet.g.alchemy.com/v2/0zddkzYwBs_J7lTLPQJAr',     blocks:43200,  fl:800  },
  { name:'zksync-mainnet',    id:324,    http:'https://zksync-mainnet.g.alchemy.com/v2/-2hgPK_0yIugOtz8gd2bN',    blocks:43200,  fl:900  },
  { name:'scroll-mainnet',    id:534352, http:'https://scroll-mainnet.g.alchemy.com/v2/2Hfl39Jdr3cIONf6P6evX',    blocks:28800,  fl:600  },
  { name:'linea-mainnet',     id:59144,  http:'https://linea-mainnet.g.alchemy.com/v2/1orEe9d1Y0Z6pcu0YsUPH',     blocks:43200,  fl:700  },
  { name:'mantle-mainnet',    id:5000,   http:'https://mantle-mainnet.g.alchemy.com/v2/TjtdcQ2UzexinqajRW1AX',    blocks:43200,  fl:500  },
  { name:'gnosis-mainnet',    id:100,    http:'https://gnosis-mainnet.g.alchemy.com/v2/rcXlHBD_ATzcywKP_3yOv',    blocks:16941,  fl:400  },
  { name:'worldchain-mainnet',id:480,    http:'https://worldchain-mainnet.g.alchemy.com/v2/KYeP7PjTazpg9y1cESm3h',blocks:43200,  fl:300  },
  { name:'berachain-mainnet', id:80094,  http:'https://berachain-mainnet.g.alchemy.com/v2/2dJONPcgoCkGLFULJ1ugZ', blocks:43200,  fl:600  },
  { name:'unichain-mainnet',  id:1301,   http:'https://unichain-mainnet.g.alchemy.com/v2/oFFJFW-FxwGOnCaNx21LO',  blocks:43200,  fl:500  },
  { name:'bnb-mainnet',       id:56,     http:'https://bnb-mainnet.g.alchemy.com/v2/6iqYCCQwSTR6b-tJKucS-',      blocks:28328,  fl:1500 },
  { name:'eth-mainnet',       id:1,      http:'https://eth-mainnet.g.alchemy.com/v2/jKhd0hz6ZYWaDlacqh_dx',      blocks:7200,   fl:8200 },
].map(c => ({ ...c, ws:c.http.replace('https://','wss://') }))

export const TOTAL_FLASH  = CHAINS.reduce((s,c) => s + c.fl, 0) * 1e6  // ~$25.7B
export const TOTAL_CYCLES = CHAINS.reduce((s,c) => s + c.blocks, 0)

// Propeller P1=$100K → P10=$100B (Model 1 hard ceiling)
export const PROPELLER = {
  1:  { r:1e5,   chains:1,  jit:5,   flash:1e9   },
  2:  { r:5e5,   chains:2,  jit:10,  flash:2e9   },
  3:  { r:1e6,   chains:3,  jit:15,  flash:3e9   },
  4:  { r:5e6,   chains:4,  jit:20,  flash:5e9   },
  5:  { r:1e7,   chains:5,  jit:30,  flash:8e9   },
  6:  { r:5e7,   chains:7,  jit:50,  flash:12e9  },
  7:  { r:1e8,   chains:10, jit:80,  flash:16e9  },
  8:  { r:1e9,   chains:13, jit:150, flash:20e9  },
  9:  { r:1e10,  chains:16, jit:300, flash:23e9  },
  10: { r:1e11,  chains:20, jit:500, flash:25.7e9 },  // $100B hard cap
}
export const getProp = (n) => PROPELLER[Math.max(1,Math.min(10,Math.round(n)))]

export const USDC = {
  137:'0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  1:  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  42161:'0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  8453:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
}

export const STABLE0 = new Set([
  '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
  '0x45dda9cb7c25131df268515131f647d726f50608',
  '0x4c36388be6f416a29c8d8eee81c771ce6be14b5',
  '0xc6962004f452be9203591991d15f6b388e09e8d0',
  '0x1fb3cf6e48f1e7b10213e7b6d87d4c073c7fdb7',
])
