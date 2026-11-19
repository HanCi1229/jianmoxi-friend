import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, '.openai/hosting.json'), 'utf8'));
if (!manifest.project_id || !manifest.capabilities?.includes('mcp')) throw Error('Site identity and MCP capability required');
mkdirSync(path.join(root, 'dist/server'), { recursive: true });
mkdirSync(path.join(root, 'dist/.openai'), { recursive: true });
copyFileSync(path.join(root, 'worker/index.js'), path.join(root, 'dist/server/index.js'));
writeFileSync(path.join(root, 'dist/.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Built stateless writing tools Worker');
