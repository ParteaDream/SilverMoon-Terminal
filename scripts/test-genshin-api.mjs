#!/usr/bin/env node
/**
 * 世界树 API 独立测试脚本
 * 用法: node scripts/test-genshin-api.mjs <uid> [server]
 * 示例: node scripts/test-genshin-api.mjs 198286947
 *        node scripts/test-genshin-api.mjs 198286947 cn_gf01
 *
 * 先用浏览器登录 https://user.mihoyo.com ，然后从 DevTools > Application > Cookies 获取 cookie 值
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ── 从命令行参数读取 ──
const uid = process.argv[2]
const server = process.argv[3] || 'cn_gf01'

if (!uid) {
  console.log('用法: node scripts/test-genshin-api.mjs <uid> [server]')
  console.log('示例: node scripts/test-genshin-api.mjs 198286947')
  process.exit(1)
}

// ── Cookie — 从环境变量或直接写在这里 ──
const COOKIE = process.env.GENSHIN_COOKIE || ''
if (!COOKIE) {
  console.error('请设置环境变量 GENSHIN_COOKIE')
  console.error('例如: GENSHIN_COOKIE="ltoken=xxx; ltuid=xxx; cookie_token=xxx; account_id=xxx" node scripts/test-genshin-api.mjs 198286947')
  process.exit(1)
}

// ── DS 签名 ── (匹配 Snap Hutao: SaltType.X4, Gen2, CNVersion 2.95.1)
const SALT_X4 = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs'
const APP_VERSION = '2.95.1'
const DEVICE_ID = crypto.randomUUID()

function generateDS(query = '', body = '') {
  const t = Math.floor(Date.now() / 1000)
  let r = Math.floor(Math.random() * 100001 + 100000)
  if (r === 100000) r = 642367
  const main = `salt=${SALT_X4}&t=${t}&r=${r}&b=${body}&q=${query}`
  const ds = crypto.createHash('md5').update(main).digest('hex')
  return `${t},${r},${ds}`
}

// ── API 调用 ──
async function apiFetch(baseUrl, params = {}, method = 'GET', postBody = null) {
  const sortedQs = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const bodyStr = postBody ? JSON.stringify(postBody, Object.keys(postBody).sort()) : ''
  const ds = generateDS(sortedQs, bodyStr)

  const url = method === 'POST' ? baseUrl : `${baseUrl}?${sortedQs}`
  console.log(`\n=== ${method} ${url} ===`)
  console.log(`DS: ${ds}`)
  console.log(`query: ${sortedQs || '(none)'}`)
  console.log(`body: ${bodyStr || '(none)'}`)

  const headers = {
    'Accept': 'application/json',
    'x-rpc-app_version': APP_VERSION,
    'x-rpc-client_type': '5',
    'x-rpc-device_id': DEVICE_ID,
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) miHoYoBBS/${APP_VERSION}`,
    'DS': ds,
    'Referer': 'https://webstatic.mihoyo.com/app/community-game-records/index.html?v=6',
    'Cookie': COOKIE,
    'X-Requested-With': 'com.mihoyo.hyperion',
  }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
  }

  const fetchOpts = { method, headers }
  if (method === 'POST' && postBody) {
    fetchOpts.body = JSON.stringify(postBody, Object.keys(postBody).sort())
  }

  try {
    const resp = await fetch(url, fetchOpts)
    const text = await resp.text()
    console.log(`Status: ${resp.status}`)
    console.log(`Response headers: ${JSON.stringify(Object.fromEntries(resp.headers.entries()))}`)

    let data
    try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 500) } }
    console.log(`retcode: ${data.retcode}, message: ${data.message}`)
    if (data.retcode !== 0) {
      console.log(`  -> ERROR (retcode=${data.retcode}): ${data.message}`)
    } else {
      console.log(`  -> SUCCESS`)
    }
    return data
  } catch (e) {
    console.error(`FETCH ERROR:`, e.message)
    return { error: e.message }
  }
}

// ── 主流程 ──
console.log(`测试 UID: ${uid}, 服务器: ${server}`)
console.log(`Cookie 长度: ${COOKIE.length} 字符`)

const outputDir = path.join(os.homedir(), 'Downloads')
const results = {}

try {
  // 0. 先查账号绑定 — 确认该米游社账号下有哪些原神 UID
  console.log('\n========== 步骤0：查询账号绑定的原神 UID ==========')
  results.binding = await apiFetch(
    'https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie',
    { game_biz: 'hk4e_cn' }
  )
  if (results.binding.retcode === 0 && results.binding.data?.list) {
    const uids = results.binding.data.list.map(r => `${r.game_uid} (${r.nickname}, ${r.region_name}, Lv${r.level})`)
    console.log(`绑定的原神账号 (${uids.length}个):`)
    uids.forEach(u => console.log(`  - ${u}`))
    const match = results.binding.data.list.find(r => String(r.game_uid) === String(uid))
    if (!match) {
      console.log(`\n⚠️  UID ${uid} 不在绑定列表中！请用上面列出的 UID 重试。`)
    }
  } else {
    console.log('绑定查询返回:', JSON.stringify(results.binding).slice(0, 300))
  }

  // 1. 首页
  console.log('\n========== 步骤1：首页信息 ==========')
  results.index = await apiFetch(
    'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/index',
    { role_id: uid, server }
  )

  // 2. 实时便笺
  console.log('\n========== 步骤2：实时便笺 ==========')
  results.dailyNote = await apiFetch(
    'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/dailyNote',
    { server, role_id: uid }
  )

  // 3. 角色信息 (POST)
  console.log('\n========== 步骤3：角色详情 ==========')
  results.characters = await apiFetch(
    'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/character',
    {},
    'POST',
    { role_id: String(uid), server }
  )

  // 4. 深境螺旋
  console.log('\n========== 步骤4：深境螺旋 ==========')
  results.spiralAbyss = await apiFetch(
    'https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/spiralAbyss',
    { server, role_id: uid, schedule_type: '1' }
  )

} catch (e) {
  console.error('Unhandled error:', e)
}

// ── 保存 ──
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const prefix = `genshin_${uid}_${ts}`
for (const [key, data] of Object.entries(results)) {
  const fp = path.join(outputDir, `${prefix}_${key}.json`)
  fs.writeFileSync(fp, JSON.stringify(data, null, 2))
  console.log(`\nSaved: ${fp}`)
}

console.log('\n=== 完成 ===')
