import { useState, useEffect, useRef } from 'react';
import { Download, X } from 'lucide-react';

/**
 * Global update notification toast.
 * Listens for 'update-status' push events from main process.
 * Shows a 3s toast when an update is available, regardless of current page.
 */
export default function UpdateToast() {
  const [toast, setToast] = useState(null); // { version } | null
  const timerRef = useRef(null);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;

    const cleanup = window.electronAPI.onUpdateStatus((status) => {
      // Only show toast for 'available' event — other events handled by Settings page
      if (status.event === 'available' && status.version) {
        // Clear any existing timer
        if (timerRef.current) clearTimeout(timerRef.current);

        setToast({ version: status.version });

        // Auto-dismiss after 3s
        timerRef.current = setTimeout(() => {
          setToast(null);
          timerRef.current = null;
        }, 3000);
      }
    });

    return () => {
      cleanup?.();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] animate-slide-in-right">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary-600/95 border border-primary-400/40 shadow-2xl backdrop-blur-sm max-w-sm">
        <Download className="w-4 h-4 text-white flex-shrink-0 animate-bounce" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">发现新版本 v{toast.version}</p>
          <p className="text-xs text-primary-200/80 mt-0.5">前往设置 → 版本信息下载更新</p>
        </div>
        <button
          onClick={() => { if (timerRef.current) clearTimeout(timerRef.current); setToast(null); }}
          className="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
