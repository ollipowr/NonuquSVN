// Removes the dev app's saved state and web caches so `npm run dev:clean` starts fresh.
// Keeps Chromium cookies (Network/) and Preferences. Close the app before running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// Unpackaged Electron uses the package name as its userData folder.
const userData = path.join(process.env.APPDATA ?? path.join(os.homedir(), '.config'), pkg.name);

const targets = [
  'svn-client-storage.json',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Local Storage',
  'Session Storage',
  'WebStorage',
  'blob_storage',
  'Shared Dictionary',
];

for (const name of targets) {
  const target = path.join(userData, name);
  try {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`removed ${target}`);
  } catch (e) {
    console.error(`could not remove ${target}: ${e.message}`);
  }
}
