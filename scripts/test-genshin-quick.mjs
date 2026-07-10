#!/usr/bin/env node
/** 第二轮测试：全部 cookie + 替代域名 + Referer */
import crypto from 'crypto'

const COOKIE = process.env.GENSHIN_COOKIE || ''
if (!COOKIE) { console.error('请设置 GENSHIN_COOKIE'); process.exit(1) }

const uid = process.argv[2] || '198286947'
const server = process.argv[3] || 'cn_gf01'
const DEVICE_ID = crypto.randomUUID()
const SALT = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs'
const APP_VERSION = '2.51.1'

function genDS(query, body) {
  const t = Math.floor(Date.now() / 1000)
  let r = Math.floor(Math.random() * 100001 + 100000)
  if (r === 100000) r = 642367
  const main = `salt=${SALT}&t=${t}&r=${r}&b=${body}&q=${query}`
  return `${t},${r},${crypto.createHash('md5').update(main).digest('hex')}`
}

const hdrs = {
  'Host': '', 'x-rpc-app_version': APP_VERSION, 'x-rpc-client_type': '5',
  'x-rpc-device_id': DEVICE_ID, 'Cookie': COOKIE, 'X-Requested-With': 'com.mihoyo.hyperion',
  'User-Agent': `Mozilla/5.0 (Linux; Android 13; M2101K9C Build/TKQ1.220829.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36 miHoYoBBS/${APP_VERSION}`,
}

async function test(baseUrl, path, params, opts = {}) {
  const qs = Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&')
  const ds = genDS(qs, '')
  const url = `${baseUrl}${path}?${qs}`
  const h = { ...hdrs, 'Host': new URL(baseUrl).host, 'DS': ds,
    'Origin': `${new URL(baseUrl).protocol}//${new URL(baseUrl).host}`,
    'Referer': opts.referer || 'https://webstatic.mihoyo.com',
  }
  if (opts.extraHeaders) Object.assign(h, opts.extraHeaders)
  try {
    const resp = await fetch(url, { headers: h })
    const text = await resp.text()
    const j = JSON.parse(text)
    const ok = j.retcode === 0
    const label = `${baseUrl.replace('https://','')}${path}`
    console.log(`  [${ok?'OK':'FAIL'}] retcode=${j.retcode} ${j.message||''} | ${label}${opts.note?' ('+opts.note+')':''}`)
    if (ok) console.log(`         data: ${JSON.stringify(j.data).slice(0,200)}`)
    return ok
  } catch(e) { console.log(`  [ERR] ${e.message}`); return false }
}

const params = { role_id: uid, server }
const API_PATHS = [
  '/game_record/app/genshin/api/index',
  '/game_record/genshin/api/index',
]
const BASES = [
  'https://api-takumi-record.mihoyo.com',
  'https://api-takumi.mihoyo.com',
  'https://bbs-api.mihoyo.com',
  'https://hk4e-api.mihoyo.com',
]
const REFERERS = [
  'https://webstatic.mihoyo.com',
  'https://app.mihoyo.com',
  'https://www.miyoushe.com',
]

console.log(`UID=${uid} server=${server}`)
console.log(`Cookie: ${COOKIE.slice(0,80)}... (${COOKIE.split(';').length} fields)`)
console.log('')

let found = false
for (const base of BASES) {
  for (const path of API_PATHS) {
    for (const ref of REFERERS) {
      if (found) break
      if (await test(base, path, params, { referer: ref })) found = true
    }
  }
}

if (!found) console.log('\n全部组合均失败。可能需要：1) 游戏数据未公开 2) 需要SToken而非LToken 3) Cookie格式不对')
