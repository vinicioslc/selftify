import type { PlatformService } from './types';
import { createWebPlatformService } from './web';

let instance: PlatformService | null = null;

export async function getPlatformService(): Promise<PlatformService> {
  if (!instance) {
    instance = createWebPlatformService();
  }
  return instance;
}
