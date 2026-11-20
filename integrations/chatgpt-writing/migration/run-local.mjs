// Credentials arrive through hidden stdin, never command arguments or saved configuration.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdout.write('Ready for private migration configuration (input hidden).\n');
let raw = '';
const config = await new Promise(resolve => process.stdin.on('data', chunk => {
  raw += chunk;
  if (/[\r\n]/.test(raw)) resolve(raw.trim());
}));
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
JSON.parse(config);
const child = spawn('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('./transfer.ps1', import.meta.url))], {
  windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, DOTNET_SYSTEM_NET_DISABLEIPV6: '1' }
});
child.stdin.end(config);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on('close', code => process.exit(code ?? 1));
