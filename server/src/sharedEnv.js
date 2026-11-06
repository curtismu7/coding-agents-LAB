// The one shared settings file (~/Development/.env, or STANDALONE_ENV), read for the Real-mode keys only.
// Same rules as settings.js: values are never returned to a client, never logged, never echoed. The Real-mode
// keys are parsed here (not merged into process.env) so a test can pass its own file and isolate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const REAL_KEYS = ['CODING_AGENTS_LAB_AIGATEWAY_URL', 'CODING_AGENTS_LAB_AIGATEWAY_BEARER', 'CENTRAL_AGENT_A2A_URL', 'CENTRAL_AGENT_A2A_BEARER'];

export const realEnvPath = (env = process.env) => env.STANDALONE_ENV || path.join(os.homedir(), 'Development', '.env');

export function loadSharedEnv(file = realEnvPath()) {
  try {
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    return Object.fromEntries(REAL_KEYS.filter((k) => typeof parsed[k] === 'string' && parsed[k] !== '').map((k) => [k, parsed[k]]));
  } catch { return {}; }
}
