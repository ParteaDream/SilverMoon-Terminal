#!/usr/bin/env node
/**
 * 发布自检 / 补传 —— 校验 GitHub Release 上的安装包与更新元数据（latest-mac.yml / latest.yml）
 *
 *   node scripts/release-check.mjs            只检查，不改动任何东西
 *   node scripts/release-check.mjs --repair   删除损坏资产并从 release/ 补传缺失文件
 *   node scripts/release-check.mjs --prune    删除与更新元数据无关的多余资产（谨慎，会打印清单）
 *
 * 为什么需要它：
 * electron-builder 把 latest-*.yml 放在**整轮构建的最后**才上传。只要中途失败、网络中断或
 * 手动 Ctrl-C，release 里就会缺 yaml，客户端"检查更新"会一直报 404；大文件还可能停在
 * GitHub 的 "starter"（传到一半）状态，下载链接是坏的。这个脚本把这两种情况都查出来。
 *
 * 需要 GH_TOKEN 环境变量（Publish.txt 里已 export）。
 *
 * 仅供本地联调：设置 SMC_API_BASE / SMC_UPLOAD_BASE 可把请求指向 mock 服务（见 scripts 测试）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const OWNER = 'ParteaDream';
const REPO = 'SilverMoon-Terminal';
const API_ROOT = process.env.SMC_API_BASE ?? 'https://api.github.com';
const API = `${API_ROOT}/repos/${OWNER}/${REPO}`;
const UPLOAD_BASE = process.env.SMC_UPLOAD_BASE ?? 'https://uploads.github.com';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIR = path.join(ROOT, 'release');
const YAML_NAMES = ['latest-mac.yml', 'latest.yml'];

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const PRODUCT = PKG.build?.productName ?? PKG.name;
const TAG = `v${VERSION}`;

const asTargets = (cfg) => {
  const t = cfg?.target;
  return (Array.isArray(t) ? t : t ? [t] : []).map((x) => (typeof x === 'string' ? { target: x, arch: [] } : x));
};

/**
 * 按当前 package.json 的 build 配置推算"本次发版应该产出的安装包"文件名
 * （本地文件名里带空格，GitHub 上会被换成 "-"，比较时统一归一化）
 */
function expectedInstallerNames() {
  const names = [];
  for (const t of asTargets(PKG.build?.mac)) {
    if (t.target !== 'dmg') continue;
    for (const arch of t.arch?.length ? t.arch : ['x64', 'arm64']) {
      names.push(`${PRODUCT}-${VERSION}-${arch}.dmg`);
      if (arch === 'x64') names.push(`${PRODUCT}-${VERSION}.dmg`); // 默认架构不带后缀
    }
  }
  for (const t of asTargets(PKG.build?.win)) {
    if (t.target === 'nsis') names.push(`${PRODUCT} Setup ${VERSION}.exe`);
    if (t.target === 'portable') names.push(`${PRODUCT} ${VERSION}.exe`);
  }
  return names;
}

const flags = new Set(process.argv.slice(2));
for (const f of flags) {
  if (!['--repair', '--prune', '--help', '-h'].includes(f)) {
    console.error(`❌ 未知参数: ${f}`);
    usage(2);
  }
}
if (flags.has('--help') || flags.has('-h')) usage(0);
const DO_REPAIR = flags.has('--repair');
const DO_PRUNE = flags.has('--prune');

function usage(code) {
  console.log(`用法: node scripts/release-check.mjs [--repair] [--prune]

  (无参数)    检查 ${TAG} 这个 release 的 yaml 与安装包是否完整
  --repair   删除半截资产，并从 release/ 目录补传缺失的 yaml / 安装包
  --prune    删除与更新元数据无关的多余资产（不带参数时可以先看到清单）

环境变量: GH_TOKEN（必填）`);
  process.exit(code);
}

// ── GitHub API ────────────────────────────────────────────────────────────────
async function api(pathname, init = {}, base = API) {
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'silvermoon-release-check',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${init.method ?? 'GET'} ${pathname} → ${res.status} ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/**
 * electron-builder 生成的 yaml 结构固定（version / files[].url / files[].size / path），
 * 这里做定向解析，避免依赖传递安装的 js-yaml。
 */
function parseUpdateYaml(text) {
  const files = [];
  let current = null;
  let inFiles = false;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (/^files:\s*$/.test(line)) { inFiles = true; continue; }
    if (/^[a-zA-Z]/.test(line)) inFiles = false; // 回到顶层键
    const url = line.match(/^\s*-?\s*url:\s*(.+?)\s*$/);
    if (inFiles && url) {
      current = { name: unquote(url[1]) };
      files.push(current);
      continue;
    }
    const size = line.match(/^\s*size:\s*(\d+)\s*$/);
    if (inFiles && size && current) current.size = Number(size[1]);
  }
  const version = text.match(/^version:\s*(.+?)\s*$/m);
  const entry = text.match(/^path:\s*(.+?)\s*$/m);
  return { version: version ? unquote(version[1]) : null, files, path: entry ? unquote(entry[1]) : null };
}
const unquote = (s) => s.replace(/^['"]|['"]$/g, '');

// ── 本地文件查找（GitHub 会把资产名里的空格换成点，所以做归一化匹配）───────
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// electron-builder 上传到 GitHub 时会把文件名里的空格换成 "-"（本地 release/ 里仍是空格）
const safeAssetName = (s) => s.replace(/ /g, '-');
function findLocalFile(name) {
  if (!existsSync(RELEASE_DIR)) return null;
  const exact = path.join(RELEASE_DIR, name);
  if (existsSync(exact) && statSync(exact).isFile()) return exact;
  const target = norm(name);
  for (const f of readdirSync(RELEASE_DIR)) {
    const p = path.join(RELEASE_DIR, f);
    if (statSync(p).isFile() && norm(f) === target) return p;
  }
  return null;
}

// 本地这次构建出来的安装包（只认当前版本号，避免上一次发版的残留文件干扰）
function localInstallersFor(version) {
  if (!existsSync(RELEASE_DIR)) return [];
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^0-9.])${esc}(?![0-9])`);
  return readdirSync(RELEASE_DIR)
    .filter((f) => /\.(dmg|exe)$/i.test(f) && re.test(f))
    .map((f) => ({ file: f, path: path.join(RELEASE_DIR, f), size: statSync(path.join(RELEASE_DIR, f)).size }));
}

function uploadAsset(releaseId, assetName, filePath) {
  const url = `${UPLOAD_BASE}/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
  const args = ['-sS', '--fail-with-body', '-X', 'POST',
    '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Content-Type: application/octet-stream',
    '-H', 'Accept: application/vnd.github+json',
    '--data-binary', `@${filePath}`, url];
  if (process.stdout.isTTY) args.unshift('--progress-bar');
  const r = spawnSync('curl', args, { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || '').slice(0, 200) || `curl exit ${r.status}` };
  return { ok: true };
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;

/** 安装包被替换后，把配套的 .blockmap 一起更新，避免 release 里留下对不上号的旧块映射 */
async function refreshBlockmap(assetName) {
  if (!/\.(dmg|exe)$/i.test(assetName)) return;
  const blockName = `${assetName}.blockmap`;
  const local = findLocalFile(blockName);
  if (!local) return;
  const existing = byName.get(blockName);
  if (existing) {
    if (existing.state === 'uploaded' && existing.size === statSync(local).size) return; // 本来就一致
    await api(`/releases/assets/${existing.id}`, { method: 'DELETE' });
  }
  const r = uploadAsset(release.id, blockName, local);
  console.log(r.ok ? `      ✅ 同步 ${blockName}` : `      ⚠️  ${blockName} 上传失败: ${r.error}`);
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
if (!TOKEN) {
  console.error('❌ 未设置 GH_TOKEN。请先执行：export GH_TOKEN=你的token');
  process.exit(1);
}

const problems = [];
const notes = [];

let me;
try {
  me = await api('/user', {}, API_ROOT);
} catch (e) {
  console.error(`❌ token 无效或无法访问 GitHub：${e.message}`);
  process.exit(1);
}
console.log(`🔑 已认证: ${me.login}`);
console.log(`📦 目标 release: ${TAG}（版本来自 package.json）\n`);

let release;
try {
  release = await api(`/releases/tags/${TAG}`);
} catch (e) {
  if (e.status === 404) {
    console.error(`❌ 找不到 release ${TAG}。说明发布没跑到"创建 release"这一步，请重新发布。`);
    process.exit(1);
  }
  throw e;
}

const assets = release.assets.map((a) => ({
  id: a.id, name: a.name, size: a.size, state: a.state, url: a.browser_download_url,
}));
const byName = new Map(assets.map((a) => [a.name, a]));
console.log(`📄 release 现有 ${assets.length} 个资产：`);
for (const a of assets) {
  const bad = a.state === 'uploaded' ? '' : `  ← ⚠️ 状态 ${a.state}（上传未完成）`;
  console.log(`   ${a.state === 'uploaded' ? '✅' : '⚠️ '} ${a.name}  ${mb(a.size)}${bad}`);
}
console.log('');

// 1) 哪些平台发过东西 → 就必须有对应的 yaml
const installers = assets.filter((a) => /\.(dmg|exe)$/i.test(a.name));
const needYaml = [];
if (installers.some((a) => a.name.endsWith('.dmg'))) needYaml.push('latest-mac.yml');
if (installers.some((a) => a.name.endsWith('.exe'))) needYaml.push('latest.yml');

// 2) 逐个 yaml 校验：远端存在、状态完整、版本号一致、它引用的文件都真的传完了
const referenced = new Set();   // 被线上 yaml 引用的文件名
const yamlDeclared = new Map(); // 文件名 → yaml 里声明的大小（补传时用来确认本地文件是同一份构建）
const remoteParsed = new Map(); // yaml 名 → 线上 yaml 解析结果（补传时用来发现"大小不符"）
for (const yamlName of YAML_NAMES) {
  const required = needYaml.includes(yamlName);
  const asset = byName.get(yamlName);
  const localPath = findLocalFile(yamlName);

  if (!asset) {
    if (required) {
      problems.push(`${yamlName} 缺失 → 客户端"检查更新"会 404`);
      if (localPath) notes.push(`本地 ${path.relative(ROOT, localPath)} 可用于补传（--repair）`);
    } else {
      notes.push(`${yamlName} 不存在（该平台本次未发布，正常）`);
    }
    continue;
  }
  if (asset.state !== 'uploaded') {
    problems.push(`${yamlName} 状态为 ${asset.state}（上传未完成）`);
    continue;
  }

  let text;
  try {
    text = await (await fetch(asset.url)).text();
  } catch (e) {
    problems.push(`${yamlName} 下载失败：${e.message}`);
    continue;
  }
  const parsed = parseUpdateYaml(text);
  remoteParsed.set(yamlName, parsed);
  console.log(`📝 ${yamlName}: version=${parsed.version} path=${parsed.path}`);
  console.log(`   引用 ${parsed.files.length} 个文件: ${parsed.files.map((f) => f.name).join(', ')}`);

  if (parsed.version && parsed.version !== VERSION) {
    problems.push(`${yamlName} 里的 version=${parsed.version} 与 package.json 的 ${VERSION} 不一致`);
  }
  for (const f of parsed.files) {
    referenced.add(f.name);
    if (f.size) yamlDeclared.set(f.name, f.size);
    const a = byName.get(f.name);
    if (!a) problems.push(`${yamlName} 引用的 ${f.name} 在 release 里不存在`);
    else if (a.state !== 'uploaded') problems.push(`${yamlName} 引用的 ${f.name} 状态为 ${a.state}（下载链接是坏的）`);
    else if (f.size && a.size !== f.size) problems.push(`${yamlName} 引用的 ${f.name} 大小不符（yaml ${f.size} / 实际 ${a.size}），线上不是同一次构建`);
  }
  console.log('');
}

// 3) 本次配置应该产出的安装包，是否都在 release 上
//    （portable 免安装版不被任何 yaml 引用，只靠 yaml 校验是发现不了它上传失败的）
const localByName = new Map(localInstallersFor(VERSION).map((f) => [norm(f.file), f]));
const notUploaded = [];
for (const name of expectedInstallerNames()) {
  const local = localByName.get(norm(name));
  if (!local) continue; // 本地没构建过这个平台的文件，跳过（例如只发了 macOS）
  const a = assets.find((x) => norm(x.name) === norm(name));
  if (!a) notUploaded.push({ ...local, assetName: safeAssetName(name) });
  else if (a.state === 'uploaded' && a.size !== local.size) {
    notes.push(`本地 ${local.file}（${mb(local.size)}）与线上 ${a.name}（${mb(a.size)}）大小不同，可能不是同一次构建`);
  }
}

// 4) 半截资产 + 多余资产
const broken = assets.filter((a) => a.state !== 'uploaded');
const brokenInstallers = broken.filter((a) => /\.(dmg|exe)$/i.test(a.name));
for (const a of brokenInstallers) {
  problems.push(`${a.name} 状态为 ${a.state}（下载链接是坏的，用户下不了）`);
}
// 多余的旧资产：不被 yaml 引用，也不在本次配置该产出的清单里（如残留的 x64 dmg、mac zip）
const expectedNorms = new Set(expectedInstallerNames().map(norm));
const extra = assets.filter(
  (a) => !referenced.has(a.name) && !YAML_NAMES.includes(a.name) && !a.name.endsWith('.blockmap') && !expectedNorms.has(norm(a.name)),
);

// ── 结论 ─────────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  console.log('✅ 发布完整：yaml 齐全，引用的安装包都已上传完成。');
  for (const name of expectedInstallerNames()) {
    const a = assets.find((x) => norm(x.name) === norm(name) && x.state === 'uploaded');
    if (a) console.log(`   🔗 ${a.url}`);
  }
} else {
  console.log(`❌ 发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log(`   • ${p}`);
}
for (const n of notes) console.log(`ℹ️  ${n}`);
if (notUploaded.length) {
  console.log(`\n⚠️  本地构建出来但 release 上没有的安装包（上传失败，或本次只发了另一个平台）：`);
  for (const f of notUploaded) console.log(`   • ${f.file}  ${mb(f.size)}`);
  console.log('   （加 --repair 可补传）');
}
if (extra.length) {
  console.log(`\n⚠️  ${extra.length} 个资产不被任何 yaml 引用（多余的旧版本/其它架构文件、半截文件）：`);
  for (const a of extra) console.log(`   • ${a.name}  ${mb(a.size)}${a.state === 'uploaded' ? '' : `  (${a.state})`}`);
  console.log('   （加 --prune 可删除它们）');
}

// ── 修补 ─────────────────────────────────────────────────────────────────────
if (DO_REPAIR) {
  console.log('\n🔧 开始补传...');
  const targets = new Map(); // assetName → reason

  // 只修"本次配置该产出的"或"被 yaml 引用的"半截资产；
  // 其它半截文件属于多余旧产物，补传它们等于白传，交给 --prune 清理
  for (const a of broken) {
    if (expectedNorms.has(norm(a.name)) || referenced.has(a.name)) targets.set(a.name, `状态 ${a.state}`);
  }
  for (const yamlName of needYaml) {
    const a = byName.get(yamlName);
    if (!a || a.state !== 'uploaded') targets.set(yamlName, '更新元数据缺失');
  }
  for (const yamlName of YAML_NAMES) {
    const localPath = findLocalFile(yamlName);
    if (!localPath) continue;
    for (const f of parseUpdateYaml(readFileSync(localPath, 'utf8')).files) {
      const a = byName.get(f.name);
      if (!a || a.state !== 'uploaded') targets.set(f.name, '被 yaml 引用但线上缺失/损坏');
    }
  }
  // 线上 yaml 引用的文件存在、但大小与 yaml 声明不符 → 线上不是同一次构建，用本地文件替换
  for (const [yamlName, parsed] of remoteParsed) {
    for (const f of parsed.files) {
      const a = byName.get(f.name);
      if (a && a.state === 'uploaded' && f.size && a.size !== f.size) {
        targets.set(f.name, `与 ${yamlName} 声明的大小不符（线上 ${mb(a.size)} / yaml ${mb(f.size)}）`);
      }
    }
  }
  // 本地有、线上没有的安装包（如 portable 免安装版），按 electron-builder 的命名规则补传
  for (const f of notUploaded) targets.set(f.assetName, '本地已构建但没上传');

  if (targets.size === 0) console.log('   没有需要补传的文件。');
  for (const [name, reason] of targets) {
    const local = findLocalFile(name);
    const existing = byName.get(name);

    // 安全第一：本地找不到文件就只报告、绝不删除线上资产
    if (!local) {
      console.log(`   ❌ ${name}：${reason}，但 release/ 里没有对应本地文件 → 需要重新构建发布`);
      continue;
    }
    const localSize = statSync(local).size;
    const declared = yamlDeclared.get(name);
    // 只有当线上 yaml 已经存在且声明了大小、而本地文件大小不符时，才认为"本地不是同一次构建"
    if (existing && declared && existing.state === 'uploaded' && declared !== localSize) {
      console.log(`   ❌ ${name}：本地文件 ${mb(localSize)} 与线上 yaml 声明的 ${mb(declared)} 不是同一次构建 → 请重新构建发布`);
      continue;
    }

    if (existing) {
      console.log(`   🗑  删除损坏资产 ${name}（${existing.state}）`);
      await api(`/releases/assets/${existing.id}`, { method: 'DELETE' });
    }
    console.log(`   ⬆️  上传 ${name}（${mb(localSize)}，源 ${path.basename(local)}）...`);
    const r = uploadAsset(release.id, name, local);
    console.log(r.ok ? '      ✅ 完成' : `      ❌ 失败: ${r.error}`);
    if (r.ok) await refreshBlockmap(name);
  }
  console.log('   补传结束，建议再跑一次本脚本复核。');
}

// ── 清理多余资产 ─────────────────────────────────────────────────────────────
if (DO_PRUNE) {
  if (extra.length === 0) {
    console.log('\n🧹 没有需要清理的多余资产。');
  } else {
    console.log(`\n🧹 删除 ${extra.length} 个不被任何 yaml 引用的多余资产...`);
    for (const a of extra) {
      await api(`/releases/assets/${a.id}`, { method: 'DELETE' });
      console.log(`   🗑  ${a.name}`);
    }
  }
}

// 只读自检用退出码报错；带 --repair/--prune 的运行本身成功就返回 0，并提示复核
if (problems.length > 0 && (DO_REPAIR || DO_PRUNE)) {
  console.log(`\n⚠️  自检时发现 ${problems.length} 个问题，本次已尝试修补 → 请再跑一次 node scripts/release-check.mjs 确认结果。`);
}
process.exit(problems.length > 0 && !DO_REPAIR && !DO_PRUNE ? 1 : 0);
