import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useDownloadProgress — survives page navigation via push events from main process.
 *
 * Usage:
 *   const { progress, startDownload, cancelDownload, resumeDownload, checkPersisted } = useDownloadProgress();
 *
 * `progress` is null when no download is active, or:
 *   { id, packType, mode, totalBytes, bytesDownloaded, totalFiles, completedFiles,
 *     currentFile, cancelled, done, error, speed }
 */
export function useDownloadProgress() {
  const [progress, setProgress] = useState(null);
  const pollRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const progressRef = useRef(null); // latest value for cleanup

  // Keep ref in sync
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // Subscribe to push events from main process
  useEffect(() => {
    if (!window.electronAPI?.onDownloadProgress) return;

    unsubscribeRef.current = window.electronAPI.onDownloadProgress((p) => {
      setProgress(prev => {
        // If already in terminal state for same download, don't overwrite
        if (prev && (prev.done || prev.cancelled || prev.error) &&
            (p.done || p.cancelled || p.error) && prev.id === p.id) {
          return prev;
        }
        return p;
      });
      progressRef.current = p;

      // Auto-clear on completion/cancel (done=3s, cancelled=5s, error stays)
      if (p.done) {
        setTimeout(() => {
          if (progressRef.current?.id === p.id && progressRef.current?.done) {
            setProgress(null);
          }
        }, 3000);
      } else if (p.cancelled) {
        setTimeout(() => {
          if (progressRef.current?.id === p.id && progressRef.current?.cancelled) {
            setProgress(null);
          }
        }, 5000);
      }
    });

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  // Fallback polling: periodically check if we missed a push event.
  // Only picks up ACTIVE downloads — never re-sets terminal (done/cancelled/error) state.
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const r = await window.electronAPI?.getDownloadProgress();
        if (r?.downloads?.length > 0) {
          const d = r.downloads[0];
          // Never resurrect a terminal download via polling
          if (d.done || d.cancelled || d.error) return;
          setProgress(prev => {
            if (!prev || prev.id !== d.id ||
                d.currentFile !== prev.currentFile ||
                d.completedFiles !== prev.completedFiles ||
                d.failures !== prev.failures) {
              return d;
            }
            return prev;
          });
          progressRef.current = d;
        }
      } catch (_) {}
    }, 1000); // faster polling for fine-grained updates

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const startDownload = useCallback(async (packPath, packType, fileList) => {
    const r = await window.electronAPI?.startPackDownload(packPath, packType, fileList);
    if (r?.success) {
      // Don't set progress here — wait for push event
      return r;
    }
    return r;
  }, []);

  const cancelDownload = useCallback(async (downloadId) => {
    await window.electronAPI?.cancelDownload(downloadId);
  }, []);

  const resumeDownload = useCallback(async (packPath) => {
    const r = await window.electronAPI?.resumeDownload(packPath);
    if (r?.success) {
      return r;
    }
    return r;
  }, []);

  const checkPersisted = useCallback(async (packPath) => {
    try {
      const r = await window.electronAPI?.getPersistedDownload(packPath);
      return r?.success ? r.download : null;
    } catch (_) {
      return null;
    }
  }, []);

  return {
    progress,
    startDownload,
    cancelDownload,
    resumeDownload,
    checkPersisted,
  };
}
