import { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'wouter';

interface SharedFile {
  name: string;
  type: string;
  size: number;
  base64: string;
}

interface SharedData {
  files: SharedFile[];
  text: string;
  url: string;
  title: string;
}

interface UseShareTargetOptions {
  onShareReceived: (data: SharedData) => void;
}

export function useShareTarget({ onShareReceived }: UseShareTargetOptions) {
  const [isReady, setIsReady] = useState(false);
  const [location] = useLocation();

  const handleMessage = useCallback((event: MessageEvent) => {
    if (event.data && event.data.type === 'SHARE_TARGET_DATA') {
      onShareReceived(event.data.data);
    }
  }, [onShareReceived]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('[PWA] Service worker registered:', registration.scope);
          setIsReady(true);
        })
        .catch((error) => {
          console.warn('[PWA] Service worker registration failed:', error);
        });
    }
  }, []);

  useEffect(() => {
    if (!isReady) return;

    navigator.serviceWorker.addEventListener('message', handleMessage);

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('shared') === 'true') {
      const checkPendingShare = () => {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'CHECK_PENDING_SHARE' });
        }
      };
      
      if (navigator.serviceWorker.controller) {
        checkPendingShare();
      } else {
        navigator.serviceWorker.addEventListener('controllerchange', checkPendingShare, { once: true });
      }
      
      checkPendingShareFromCache(onShareReceived);
      
      window.history.replaceState({}, '', window.location.pathname);
    }

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, [isReady, handleMessage, location, onShareReceived]);

  return { isReady };
}

export function base64ToFile(base64: string, filename: string, mimeType: string): File {
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  
  const blob = new Blob([ab], { type: mimeType });
  return new File([blob], filename, { type: mimeType });
}

async function checkPendingShareFromCache(onShareReceived: (data: SharedData) => void) {
  try {
    const cache = await caches.open('share-target-cache');
    const response = await cache.match('pending-share');
    if (response) {
      const data = await response.json();
      if (data.timestamp && Date.now() - data.timestamp < 60000) {
        onShareReceived(data);
      }
      await cache.delete('pending-share');
    }
  } catch (e) {
    console.warn('[Share Target] Failed to check cache:', e);
  }
}
