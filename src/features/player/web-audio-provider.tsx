import { WebAudioProvider as BrowserProvider } from './browser-audio-provider';

export function WebAudioProvider({ children }: { children: React.ReactNode }) {
  return <BrowserProvider>{children}</BrowserProvider>;
}
