import type { PlatformService } from './types';

let instance: PlatformService | null = null;

export async function getPlatformService(): Promise<PlatformService> {
  if (instance) return instance;

  const isElectron = !!(window as any).electronApi;

  if (isElectron) {
    const { createElectronPlatformService } = await import('./electron');
    instance = createElectronPlatformService();
  } else {
    let isCapacitorNative = false;
    try {
      const { Capacitor } = await import('@capacitor/core');
      isCapacitorNative = Capacitor.isNativePlatform();
    } catch {
      // @capacitor/core not available — web or test environment
    }

    if (isCapacitorNative) {
      const { createCapacitorPlatformService } = await import('./capacitor');
      instance = createCapacitorPlatformService();
    } else {
      const { createWebPlatformService } = await import('./web');
      instance = createWebPlatformService();
    }
  }

  return instance!;
}
