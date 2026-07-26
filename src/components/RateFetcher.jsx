import { useState, useEffect, useRef, useCallback } from 'react'
import { useTerminal } from '../context/TerminalContext'
import { Search, X, Check, FolderOpen, Download, Loader2, AlertCircle, CheckCircle2, FileText } from 'lucide-react'

// ═══════════════════════════════════════════════
// 倍率格式化（移植自 Python fetch_genshin_rates.py）
// ═══════════════════════════════════════════════

function formatParam(value, fmt) {
  if (fmt === 'F1P') return `${(value * 100).toFixed(1)}%`
  if (fmt === 'F2P') return `${(value * 100).toFixed(2)}%`
  if (fmt === 'P') {
    const v = value * 100
    return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`
  }
  if (fmt === 'F1') return Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1)
  if (fmt === 'F2') return Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(2)
  if (fmt === 'I') return String(Math.round(value))
  return String(value)
}

function parseDescParams(desc) {
  desc = desc.trim()
  const pattern = /\{param(\d+):([A-Z0-9]+)\}/g
  const matches = [...desc.matchAll(pattern)]
  if (matches.length === 0) return [{ label: desc, paramIndices: [-1], fmtCode: '' }]

  // 每行 desc 固定对应一列：| 左边是 label，右边是 template，/ 永远是字面文字
  const [labelPart, template] = desc.includes('|') ? desc.split('|', 2) : ['', desc]
  const label = labelPart || `参数${matches[0][1]}`
  const paramIndices = matches.map(m => parseInt(m[1]) - 1)
  const fmtCode = matches[0][2]

  return [{ label, paramIndices, fmtCode, template }]
}

function buildSkillTable(skill, maxLevel = 15) {
  const name = skill.name || '???'
  const promote = skill.promote || {}
  if (!promote['0']) return [name, []]

  const descLines = promote['0'].desc || []
  const paramColumns = []
  const labelCounts = {}

  for (const line of descLines) {
    if (!line.trim()) continue
    const parts = parseDescParams(line)
    for (const { label, paramIndices, fmtCode, template } of parts) {
      if (paramIndices[0] >= 0) {
        const key = label
        if (labelCounts[key]) {
          labelCounts[key]++
          paramColumns.push({ label: `${label}(${labelCounts[key]})`, paramIndices, fmtCode, template })
        } else {
          labelCounts[key] = 1
          paramColumns.push({ label, paramIndices, fmtCode, template })
        }
      }
    }
  }

  if (paramColumns.length === 0) return [name, []]

  const availableLevels = Object.keys(promote).map(Number).sort((a, b) => a - b)
  const levelsToShow = availableLevels.filter(l => l + 1 <= maxLevel)

  const headerRow = ['', ...levelsToShow.map(l => `Lv.${l + 1}`)]
  const rows = [headerRow]

  for (const { label, paramIndices, fmtCode, template } of paramColumns) {
    const row = [label]
    for (const lvl of levelsToShow) {
      const params = promote[String(lvl)]?.param || []
      // 从模板替换参数占位符，保留周围文字（如 "秒"、"米"）
      let val = template
      let hasValid = false
      for (const pi of paramIndices) {
        const placeholder = `{param${pi + 1}:${fmtCode}}`
        if (pi < params.length) {
          const formatted = formatParam(params[pi], fmtCode)
          val = val.replace(placeholder, formatted)
          hasValid = true
        } else {
          val = val.replace(placeholder, '-')
        }
      }
      if (!hasValid) val = '-'
      row.push(val)
    }
    rows.push(row)
  }

  return [name, rows]
}

function buildCharacterCsv(charData, maxLevel = 15) {
  const skills = charData.skills || []
  if (skills.length === 0) return ''

  // 识别技能类型
  let normalIdx = null, skillIdx = null, burstIdx = null
  for (let i = 0; i < skills.length; i++) {
    const sname = skills[i].name || ''
    if (sname.includes('普通攻击') || sname.includes('Normal Attack')) normalIdx = i
    else if (sname.includes('元素战技') || sname.includes('Elemental Skill')) skillIdx = i
    else if (sname.includes('元素爆发') || sname.includes('Elemental Burst')) burstIdx = i
  }
  if (normalIdx == null && skills.length > 0) normalIdx = 0
  if (skillIdx == null && skills.length > 1) {
    for (let i = 1; i < skills.length; i++) {
      const sname = skills[i].name || ''
      if (!sname.includes('替代') && !sname.includes('Alternate') && i !== burstIdx) {
        skillIdx = i; break
      }
    }
    if (skillIdx == null) skillIdx = 1
  }
  if (burstIdx == null) {
    for (let i = skills.length - 1; i >= 0; i--) {
      const sname = skills[i].name || ''
      if (sname.includes('元素爆发') || sname.includes('Elemental Burst') || sname.includes('爆发') || sname.includes('Burst')) {
        burstIdx = i; break
      }
    }
    if (burstIdx == null && skills.length > 2) burstIdx = skills.length - 1
  }

  const lines = []
  const sections = [
    { idx: normalIdx, label: '【普通攻击】' },
    { idx: skillIdx, label: '【元素战技】' },
    { idx: burstIdx, label: '【元素爆发】' },
  ]

  for (const { idx, label } of sections) {
    if (idx == null || idx >= skills.length) continue
    const [sname, rows] = buildSkillTable(skills[idx], maxLevel)
    if (rows.length > 0) {
      lines.push(`${label} ${sname}`)
      for (const row of rows) {
        lines.push(row.join(','))
      }
      lines.push('')
    }
  }

  // BOM + CSV 内容
  return '\uFEFF' + lines.join('\n')
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

// ═══════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════
export default function RateFetcher() {
  const [charList, setCharList] = useState(null)
  const [charListError, setCharListError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [customIds, setCustomIds] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [maxLevel, setMaxLevel] = useState(15)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState([])   // [{id, name, status, message}]
  const [loadError, setLoadError] = useState(null)

  // 加载角色列表和配置
  useEffect(() => {
    (async () => {
      try {
        setLoadError(null)
        // 获取角色列表
        if (window.electronAPI?.getCharacterList) {
          const res = await window.electronAPI.getCharacterList()
          if (res.success) {
            setCharList(res.data)
          } else {
            setCharListError(res.error || '获取角色列表失败')
          }
        } else {
          setCharListError('electronAPI 不可用（浏览器模式）')
        }

        // 获取默认输出目录
        if (window.electronAPI?.getRateDefaultOutput) {
          const dirRes = await window.electronAPI.getRateDefaultOutput()
          if (dirRes.success) setOutputDir(dirRes.path)
        }

        // 读取已保存的配置
        if (window.electronAPI?.getUserConfig) {
          const cfgRes = await window.electronAPI.getUserConfig()
          if (cfgRes.success && cfgRes.config) {
            if (cfgRes.config.rateFetcherOutputDir) {
              setOutputDir(cfgRes.config.rateFetcherOutputDir)
            }
            if (cfgRes.config.rateFetcherMaxLevel) {
              setMaxLevel(cfgRes.config.rateFetcherMaxLevel)
            }
          }
        }
      } catch (e) {
        setLoadError(e.message)
      }
    })()
  }, [])

  // 搜索过滤
  const filteredChars = useCallback(() => {
    if (!charList) return []
    const query = searchQuery.toLowerCase().trim()
    if (!query) return Object.entries(charList)
    return Object.entries(charList).filter(([id, info]) => {
      const zh = info.zh || ''
      const en = info.en || ''
      return zh.toLowerCase().includes(query) || en.toLowerCase().includes(query) || id.includes(query)
    })
  }, [charList, searchQuery])

  const toggleChar = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addCustomIds = () => {
    const ids = customIds.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
    for (const id of ids) {
      // 尝试匹配角色列表中的 ID 或前缀
      if (charList && charList[id]) {
        setSelectedIds(prev => new Set([...prev, id]))
      } else {
        // 作为自定义 ID 添加（用 id 本身作为 key）
        setSelectedIds(prev => new Set([...prev, id]))
      }
    }
    setCustomIds('')
  }

  const handleSelectOutputDir = async () => {
    if (!window.electronAPI?.selectOutputFolder) return
    const res = await window.electronAPI.selectOutputFolder()
    if (res.success) {
      setOutputDir(res.path)
      // 保存到 user.json
      await window.electronAPI.setUserConfig('rateFetcherOutputDir', res.path)
    }
  }

  // ── 开始导出 ──
  const handleStart = async () => {
    const allTargets = [...selectedIds]
    // 解析自定义 ID（非角色列表中的 ID）
    const custom = customIds.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
    for (const cid of custom) {
      if (!allTargets.includes(cid)) allTargets.push(cid)
    }

    if (allTargets.length === 0) {
      alert('请至少选择一个角色或输入 ID')
      return
    }

    if (!outputDir) {
      alert('请先设置输出目录')
      return
    }

    setRunning(true)
    const tasks = allTargets.map(id => {
      const info = charList?.[id]
      return {
        id,
        name: info ? `${info.zh} (${info.en || id})` : id,
        status: 'pending',
        message: '',
      }
    })
    setProgress(tasks)

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      setProgress(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'running', message: '正在获取数据...' } : t))

      try {
        // 获取角色数据
        const charId = task.id
        let dataRes
        if (window.electronAPI?.fetchRateCharData) {
          dataRes = await window.electronAPI.fetchRateCharData(charId)
        } else {
          // 浏览器模式：直接 fetch
          const manifestRes = await fetch('https://static.nanoka.cc/manifest.json')
          const manifest = await manifestRes.json()
          const version = manifest.gi.latest
          const resp = await fetch(`https://static.nanoka.cc/gi/${version}/zh/character/${charId}.json`)
          dataRes = { success: true, data: await resp.json() }
        }

        if (!dataRes.success) {
          setProgress(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: dataRes.error || '获取失败' } : t))
          continue
        }

        const charData = dataRes.data
        const charName = charData.name || task.id
        const csvContent = buildCharacterCsv(charData, maxLevel)
        if (!csvContent) {
          setProgress(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: '该角色没有可导出的技能数据' } : t))
          continue
        }

        // 保存 CSV
        const filename = `${safeFilename(charName)}_${charId}.csv`
        let saveRes
        if (window.electronAPI?.saveRateCsv) {
          saveRes = await window.electronAPI.saveRateCsv({ dirPath: outputDir, filename, content: csvContent })
        }
        // 浏览器降级：触发下载
        if (!saveRes?.success) {
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = filename; a.click()
          URL.revokeObjectURL(url)
        }

        setProgress(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'done', message: saveRes?.filePath || '已下载' } : t))
      } catch (e) {
        setProgress(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: e.message } : t))
      }
    }

    setRunning(false)
    // 保存 maxLevel 配置
    if (window.electronAPI?.setUserConfig) {
      await window.electronAPI.setUserConfig('rateFetcherMaxLevel', maxLevel)
    }
  }

  const doneCount = progress.filter(t => t.status === 'done').length
  const errorCount = progress.filter(t => t.status === 'error').length

  return (
    <div className="h-full flex flex-col bg-[#030D20] text-sm select-none overflow-hidden">
      {/* 顶部信息 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white/80">RateFetcher</h2>
          <span className="text-[10px] text-surface-500">角色技能倍率导出</span>
        </div>
        {charList && (
          <span className="text-[10px] text-surface-500">
            角色总数: {Object.keys(charList).length}
          </span>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：角色选择 */}
        <div className="w-1/2 flex flex-col border-r border-white/5 overflow-hidden">
          {/* 搜索 */}
          <div className="px-3 py-2 border-b border-white/5">
            <div className="flex items-center gap-2 bg-surface-800/50 rounded-lg px-2.5 py-1.5 border border-surface-700/50">
              <Search className="w-3.5 h-3.5 text-surface-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索角色（中文/英文/ID）…"
                className="flex-1 bg-transparent text-xs text-surface-200 placeholder-surface-500 focus:outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-surface-500 hover:text-surface-300">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* 角色列表 */}
          <div className="flex-1 overflow-y-auto">
            {charListError ? (
              <div className="p-4 text-xs text-red-400">{charListError}</div>
            ) : !charList ? (
              <div className="flex items-center justify-center h-full text-surface-500">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <div className="p-1">
                {filteredChars().map(([id, info]) => {
                  const selected = selectedIds.has(id)
                  return (
                    <button
                      key={id}
                      onClick={() => toggleChar(id)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors text-left ${
                        selected
                          ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
                          : 'text-surface-300 hover:bg-surface-800/50 border border-transparent'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                        selected ? 'bg-cyan-500 border-cyan-500' : 'border-surface-600'
                      }`}>
                        {selected && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      <span className="flex-1 truncate">{info.zh}</span>
                      <span className="text-[9px] text-surface-500 truncate max-w-[100px]">{info.en}</span>
                      <span className="text-[9px] text-surface-600 font-mono">{id}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* 底部统计 */}
          <div className="px-3 py-2 border-t border-white/5 text-[10px] text-surface-500">
            已选 {selectedIds.size} 个角色
          </div>
        </div>

        {/* 右侧：配置 + 进度 */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          {/* 配置区 */}
          <div className="p-3 space-y-3 border-b border-white/5">
            {/* 自定义 ID 输入 */}
            <div>
              <label className="text-[10px] text-surface-500 mb-1 block">自定义 ID（逗号分隔）</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={customIds}
                  onChange={e => setCustomIds(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustomIds()}
                  placeholder="如 10000030 或 10000007-4"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-800/50 border border-surface-700/50 text-xs text-surface-200 placeholder-surface-500 focus:outline-none focus:border-cyan-500/40"
                />
                <button
                  onClick={addCustomIds}
                  disabled={!customIds.trim()}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 disabled:opacity-40 transition-colors"
                >
                  添加
                </button>
              </div>
            </div>

            {/* 输出目录 */}
            <div>
              <label className="text-[10px] text-surface-500 mb-1 block">输出目录</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={outputDir}
                  onChange={e => setOutputDir(e.target.value)}
                  placeholder="选择或输入输出目录"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-800/50 border border-surface-700/50 text-xs text-surface-200 placeholder-surface-500 focus:outline-none focus:border-cyan-500/40"
                />
                <button
                  onClick={handleSelectOutputDir}
                  className="px-2 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors"
                  title="选择文件夹"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 最大等级 */}
            <div className="flex items-center gap-3">
              <label className="text-[10px] text-surface-500">最大天赋等级</label>
              <div className="flex gap-1">
                {[10, 13, 15].map(lv => (
                  <button
                    key={lv}
                    onClick={() => setMaxLevel(lv)}
                    className={`px-2.5 py-1 rounded text-xs transition-colors ${
                      maxLevel === lv
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'bg-surface-800/50 text-surface-400 border border-surface-700/50 hover:border-surface-600'
                    }`}
                  >{lv}级</button>
                ))}
              </div>
            </div>

            {/* 开始按钮 */}
            <button
              onClick={handleStart}
              disabled={running || (!selectedIds.size && !customIds.trim())}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all
                bg-cyan-500/20 text-cyan-300 border border-cyan-500/30
                hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 导出中...</>
              ) : (
                <><Download className="w-3.5 h-3.5" /> 开始导出</>
              )}
            </button>
          </div>

          {/* 进度列表 */}
          <div className="flex-1 overflow-y-auto p-2">
            {progress.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-surface-600 text-xs">
                <FileText className="w-8 h-8 mb-2 opacity-30" />
                <p>从左侧选择角色后点击「开始导出」</p>
                <p className="mt-1 text-[10px]">CSV 文件将保存到输出目录</p>
              </div>
            ) : (
              <div className="space-y-1">
                {progress.map((task, i) => (
                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-800/30 border border-surface-700/30">
                    {task.status === 'running' && <Loader2 className="w-3 h-3 text-cyan-400 animate-spin shrink-0" />}
                    {task.status === 'done' && <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />}
                    {task.status === 'error' && <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />}
                    {task.status === 'pending' && <div className="w-3 h-3 rounded-full border border-surface-600 shrink-0" />}
                    <span className="text-xs text-surface-300 truncate flex-1">{task.name}</span>
                    <span className={`text-[10px] truncate max-w-[180px] ${
                      task.status === 'done' ? 'text-green-500' :
                      task.status === 'error' ? 'text-red-400' :
                      task.status === 'running' ? 'text-cyan-400' : 'text-surface-600'
                    }`}>{task.message}</span>
                  </div>
                ))}
                {doneCount + errorCount === progress.length && progress.length > 0 && (
                  <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-surface-800/40 text-[10px] text-surface-400 text-center">
                    完成 {doneCount}/{progress.length}
                    {errorCount > 0 && <span className="text-red-400">，{errorCount} 个失败</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
