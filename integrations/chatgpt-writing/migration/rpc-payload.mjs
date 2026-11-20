// Emits private payload JSON to a tool orchestrator; never save its stdout in public source.
import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const directory = fileURLToPath(new URL('../outputs/migration/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
const plan = JSON.parse(readFileSync(join(directory, 'rpc-jobs.json'), 'utf8'));
const [mode, rawOffset = '0', rawLimit = '1'] = process.argv.slice(2);
const offset = Number(rawOffset), limit = Number(rawLimit);
if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 8) throw Error('Invalid batch bounds');
function payload(job) {
  if (job.operation === 'objects') return { operation: job.operation, payload: JSON.stringify({ files: job.files.map(file => ({ key: file.key,
    sha256: file.sha256, bytes: file.bytes, data: readFileSync(join(directory, file.file)).toString('base64') })) }) };
  if (job.operation === 'part') {
    const data = Buffer.alloc(job.length);
    const fd = openSync(join(directory, job.file), 'r');
    try { if (readSync(fd, data, 0, data.length, job.offset) !== data.length) throw Error('Incomplete source chunk'); }
    finally { closeSync(fd); }
    return { operation: job.operation, payload: JSON.stringify({ key: job.key, index: job.index, sha256: job.sha256, data: data.toString('base64') }) };
  }
  return { operation: job.operation, payload: JSON.stringify(job) };
}
let result;
if (mode === 'jobs') result = plan.jobs.slice(offset, offset + limit).map(payload);
else if (mode === 'finish') result = plan.finish.slice(offset, offset + limit).map(payload);
else if (mode === 'start') result = [{ operation: 'start', payload: JSON.stringify({ snapshot: manifest.snapshot, counts: manifest.counts }) }];
else if (mode === 'workspace') result = [{ operation: 'workspace', payload: JSON.stringify({ snapshot: manifest.snapshot, workspace: JSON.parse(readFileSync(join(directory, 'workspace.json'), 'utf8')) }) }];
else if (mode === 'works') result = [{ operation: 'works', payload: JSON.stringify({ snapshot: manifest.snapshot, works: manifest.files.filter(file => file.kind === 'work').slice(offset, offset + limit) }) }];
else if (mode === 'complete') result = [{ operation: 'complete', payload: JSON.stringify({ snapshot: manifest.snapshot }) }];
else if (mode === 'status') result = [{ operation: 'status', payload: '{}' }];
else throw Error('Unknown phase');
process.stdout.write(JSON.stringify(result));
