import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function loadConfigFile() {
  const possiblePaths = [
    process.env.DSH_CONFIG,
    path.join(os.homedir(), '.config', 'dsh', 'config.json'),
    '/opt/data/.config/dsh/config.json'
  ].filter(Boolean);

  for (const cfgPath of possiblePaths) {
    try {
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
  }
  return {};
}

const fileCfg = loadConfigFile();

export const config = {
  host: process.env.DSH_HOST || fileCfg.host || 'http://localhost:53080',
  token: process.env.DSH_TOKEN || fileCfg.token || '',
  defaultWorkspaceBase: process.env.DSH_WORKSPACE_BASE || fileCfg.workspaceBase || '/workspace/code',
  timeoutMs: parseInt(process.env.DSH_TIMEOUT_MS || fileCfg.timeoutMs || '180000', 10),
  pollIntervalMs: parseInt(process.env.DSH_POLL_INTERVAL_MS || fileCfg.pollIntervalMs || '2500', 10)
};
