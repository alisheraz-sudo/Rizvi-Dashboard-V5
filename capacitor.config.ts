import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rizvi.dashboard',
  appName: 'Rizvi Dashboard V5',
  webDir: 'www',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    iosScheme: 'rizvi'
  }
};

export default config;
