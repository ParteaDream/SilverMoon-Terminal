export default function SearchBar({ value, onChange, placeholder = '搜索...' }) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 bg-surface-800 border border-surface-700 rounded-lg
                   text-sm text-white placeholder-surface-500
                   focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20
                   transition-colors"
      />
    </div>
  )
}
