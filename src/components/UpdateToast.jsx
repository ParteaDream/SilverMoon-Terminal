import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, X, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * Global update notification toast.
 * On mount, checks if auto-update is enabled. If so, checks for updates.
 * Shows a 5s modal-style popup when an update is available.
 * Survives page navigation (rendered in App.jsx outside Routes).
 */
export default function UpdateToast() {
  const [toast, setToast] = useState(null); // { version } | null
  const timerRef = useRef(null);
  const navigate = useNavigate();

  // On mount: check if auto-update is enabled, and if so, check for updates
  useEffect(() => {
    let cancelled = false;
    async function checkOnStartup() {
      try {
        // 1. 查询是否开启了自动检查
        if (!window.electronAPI?.getUpdateAutoCheck) return;
        const autoR = await window.electronAPI.getUpdateAutoCheck();
        if (!autoR?.success || !autoR.enabled) return;
        if (cancelled) return;

        // 2. 检查更新（autoUpdater 事件会通过 update-status 推送回来）
        if (window.electronAPI?.checkForUpdate) {
          window.electronAPI.checkForUpdate().catch(() => {});
        }
      } catch (_) {}
    }
    checkOnStartup();
    return () => { cancelled = true; };
  }, []);

  // Listen for update-status push events
  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;

    const cleanup = window.electronAPI.onUpdateStatus((status) => {
      if (status.event === 'available' && status.version) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setToast({ version: status.version });

        // Auto-dismiss after 5s
        timerRef.current = setTimeout(() => {
          setToast(null);
          timerRef.current = null;
        }, 5000);
      }
    });

    return () => {
      cleanup?.();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const handleGoToSettings = useCallback(() => {
    navigate('/settings?module=version');
    setToast(null);
  }, [navigate]);

  if (!toast) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] animate-slide-in-right">
      <div className="flex items-start gap-3 p-4 rounded-xl bg-primary-600 border border-primary-400/40 shadow-2xl backdrop-blur-sm max-w-sm">
        <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Download className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">发现新版本 v{toast.version}</p>
          <p className="text-xs text-primary-200 mt-1 leading-relaxed">
            新功能已上线，建议更新到最新版本以获得更好的体验
          </p>
          <button
            onClick={handleGoToSettings}
            className="inline-flex items-center gap-1 mt-2 text-xs text-white/80 hover:text-white transition-colors"
          >
            <ExternalLink className="w-3 h-3" />前往设置下载
          </button>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
