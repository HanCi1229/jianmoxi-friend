import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, '.openai/hosting.json'), 'utf8'));
if (!manifest.project_id || !manifest.capabilities?.includes('mcp')) throw Error('Site identity and MCP capability required');
mkdirSync(path.join(root, 'dist/server'), { recursive: true });
mkdirSync(path.join(root, 'dist/.openai'), { recursive: true });
const storage = readFileSync(path.join(root, 'worker/storage.js'), 'utf8').replace(/^export /gm, '');
const entry = readFileSync(path.join(root, 'worker/index.js'), 'utf8').replace(/^import .* from '\.\/storage\.js';\r?\n/m, '');
writeFileSync(path.join(root, 'dist/server/index.js'), storage + '\n' + entry);
writeFileSync(path.join(root, 'dist/.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Built stateless writing tools Worker');
