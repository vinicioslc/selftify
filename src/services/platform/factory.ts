import type { PlatformService } from './types';

let instance: PlatformService | null = null;

export async function getPlatformService(): Promise<PlatformService> {
  if (instance) return instance;

  const isElectron = !!(window as any).electronApi;

  if (isElectron) {
    const { createElectronPlatformService } = await import('./electron');
    instance = createElectronPlatformService();
  } else {
    const { createWebPlatformService } = await import('./web');
    instance = createWebPlatformService();
  }

  return instance!;
}
