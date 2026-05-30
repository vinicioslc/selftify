import { useState, useEffect } from 'react';
import isElectron from 'is-electron';
import { WebAudioProvider as BrowserProvider } from './browser-audio-provider';
import { IpcAudioProvider } from './ipc-audio-provider';

function checkMpvAvailable(): Promise<boolean> {
  try {
    const api = (window as any).electronApi?.mpv;
    if (!api?.isAvailable) return Promise.resolve(false);
    return api.isAvailable();
  } catch {
    return Promise.resolve(false);
  }
}

function ElectronAudioProvider({ children }: { children: React.ReactNode }) {
  const [useMpv, setUseMpv] = useState<boolean | null>(null);

  useEffect(() => {
    checkMpvAvailable().then((available) => {
      setUseMpv(available);
      if (!available) {
        console.log('[audio] mpv unavailable — using Web Audio API fallback');
      }
    });
  }, []);

  if (useMpv === null) {
    // Still checking — render nothing or a brief loader
    return <>{children}</>;
  }

  if (useMpv) {
    return <IpcAudioProvider>{children}</IpcAudioProvider>;
  }

  return <BrowserProvider>{children}</BrowserProvider>;
}

export function WebAudioProvider({ children }: { children: React.ReactNode }) {
  if (isElectron()) {
    return <ElectronAudioProvider>{children}</ElectronAudioProvider>;
  }
  return <BrowserProvider>{children}</BrowserProvider>;
}
