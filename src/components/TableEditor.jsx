import { useState } from 'react'
import { Plus, Trash2, GripVertical } from 'lucide-react'

/**
 * 通用表格编辑器：支持多表、动态行列、单元格编辑
 * data: [{ title, headers: string[], rows: string[][] }]
 */
export default function TableEditor({ data, onChange }) {
  const tables = data || []

  function updateTable(ti, patch) {
    const next = tables.map((t, i) => i === ti ? { ...t, ...patch } : t)
    onChange(next)
  }

  function removeTable(ti) {
    onChange(tables.filter((_, i) => i !== ti))
  }

  function addTable() {
    onChange([...tables, { title: '', headers: ['列1', '列2'], rows: [['', '']] }])
  }

  function updateCell(ti, ri, ci, value) {
    const next = tables.map((t, i) => {
      if (i !== ti) return t
      const rows = t.rows.map((row, r) => r === ri ? row.map((c, j) => j === ci ? value : c) : row)
      return { ...t, rows }
    })
    onChange(next)
  }

  function updateHeader(ti, ci, value) {
    const next = tables.map((t, i) => {
      if (i !== ti) return t
      const headers = t.headers.map((h, j) => j === ci ? value : h)
      return { ...t, headers }
    })
    onChange(next)
  }

  function addRow(ti) {
    const next = tables.map((t, i) => {
      if (i !== ti) return t
      return { ...t, rows: [...t.rows, Array(t.headers.length).fill('')] }
    })
    onChange(next)
  }

  function removeRow(ti, ri) {
    const next = tables.map((t, i) => {
      if (i !== ti) return t
      return { ...t, rows: t.rows.filter((_, r) => r !== ri) }
    })
    onChange(next)
  }

  function addColumn(ti) {
    const next = tables.map((t, i) => {
      if (i !== ti) return t
      return {
        ...t,
        headers: [...t.headers, ''],
        rows: t.rows.map(row => [...row, '']),
      }
    })
    onChange(next)
  }

  function removeColumn(ti, ci) {
    const next = tables.map((t, i) => {
      if (i !== ti) return t
      return {
        ...t,
        headers: t.headers.filter((_, j) => j !== ci),
        rows: t.rows.map(row => row.filter((_, j) => j !== ci)),
      }
    })
    onChange(next)
  }

  function handlePaste(ti, ri, ci, e) {
    const raw = e.clipboardData?.getData('text/plain')
    if (!raw) return
    // 解析 TSV（Excel 粘贴格式）
    const lines = raw.trim().split(/\r?\n/)
    const pasteData = lines.map(line => line.split('\t'))
    if (pasteData.length === 0) return
    e.preventDefault()

    const table = tables[ti]
    const pasteRows = pasteData.length
    const pasteCols = Math.max(...pasteData.map(r => r.length))

    // 计算需要的行数和列数
    const neededRows = ri + pasteRows
    const neededCols = ci + pasteCols

    const headers = [...table.headers]
    while (headers.length < neededCols) headers.push('')

    let rows = table.rows.map(row => [...row])
    while (rows.length < neededRows) rows.push(Array(headers.length).fill(''))
    // 确保所有行有足够的列
    rows = rows.map(row => {
      const r = [...row]
      while (r.length < headers.length) r.push('')
      return r
    })

    // 填入粘贴数据
    for (let r = 0; r < pasteRows; r++) {
      for (let c = 0; c < pasteCols; c++) {
        rows[ri + r][ci + c] = pasteData[r][c] || ''
      }
    }

    const next = tables.map((t, i) => i === ti ? { ...t, headers, rows } : t)
    onChange(next)
  }

  const cellClass = `px-2 py-1.5 bg-surface-800 border border-surface-700 text-xs text-white
    focus:outline-none focus:border-primary-500 focus:bg-surface-700 min-w-[80px]
    placeholder-surface-600`

  return (
    <div className="space-y-4">
      {tables.map((table, ti) => (
        <div key={ti} className="border border-surface-700 rounded-lg overflow-hidden">
          {/* 表头：标题 + 操作 */}
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-800/50 border-b border-surface-700">
            <GripVertical className="w-3.5 h-3.5 text-surface-600 flex-shrink-0" />
            <input
              type="text"
              value={table.title}
              onChange={e => updateTable(ti, { title: e.target.value })}
              placeholder="表格标题..."
              className="flex-1 bg-transparent text-sm font-medium text-white placeholder-surface-600
                         focus:outline-none"
            />
            <button
              onClick={() => removeTable(ti)}
              className="p-1 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="删除表格"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 表格滚动容器 */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-10 bg-surface-850 border-b border-surface-700" />
                  {table.headers.map((h, ci) => (
                    <th key={ci} className="bg-surface-850 border-b border-r border-surface-700 px-1 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={h}
                          onChange={e => updateHeader(ti, ci, e.target.value)}
                          placeholder={`列${ci + 1}`}
                          className="flex-1 bg-transparent text-[11px] font-medium text-surface-300 text-center
                                     focus:outline-none focus:text-white min-w-[60px] placeholder-surface-600"
                        />
                        {table.headers.length > 1 && (
                          <button
                            onClick={() => removeColumn(ti, ci)}
                            className="p-0.5 text-surface-600 hover:text-red-400 transition-colors flex-shrink-0"
                            title="删除列"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="bg-surface-850 border-b border-surface-700 px-1 py-1 w-8">
                    <button
                      onClick={() => addColumn(ti)}
                      className="p-0.5 text-surface-500 hover:text-primary-400 transition-colors"
                      title="添加列"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr key={ri} className="group">
                    <td className="bg-surface-850 border-b border-surface-700 text-center">
                      <button
                        onClick={() => removeRow(ti, ri)}
                        className="p-0.5 text-surface-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="删除行"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border-b border-r border-surface-700 p-0">
                        <input
                          type="text"
                          value={cell}
                          onChange={e => updateCell(ti, ri, ci, e.target.value)}
                          onPaste={e => handlePaste(ti, ri, ci, e)}
                          className={`w-full ${cellClass}`}
                          placeholder="-"
                        />
                      </td>
                    ))}
                    <td className="border-b border-surface-700" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 添加行 */}
          <button
            onClick={() => addRow(ti)}
            className="w-full py-2 text-xs text-surface-500 hover:text-primary-400 hover:bg-primary-500/5
                       transition-colors flex items-center justify-center gap-1"
          >
            <Plus className="w-3 h-3" />添加行
          </button>
        </div>
      ))}

      {/* 添加表格 */}
      <button
        onClick={addTable}
        className="w-full py-3 border border-dashed border-surface-700 rounded-lg text-xs text-surface-500
                   hover:text-primary-400 hover:border-primary-500/30 hover:bg-primary-500/5
                   transition-colors flex items-center justify-center gap-1.5"
      >
        <Plus className="w-3.5 h-3.5" />添加表格
      </button>
    </div>
  )
}
