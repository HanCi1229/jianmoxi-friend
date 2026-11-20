// Reproduce a resumable, bounded import plan from the private verified export.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const directory = fileURLToPath(new URL('../outputs/migration/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
if (manifest.format !== 1 || !/^migration-\d+$/.test(manifest.snapshot)) throw Error('Invalid source manifest');
const jobs = [], finish = [];
let files = [], bytes = 0;
function flush() { if (files.length) { jobs.push({ operation: 'objects', files }); files = []; bytes = 0; } }
for (const file of manifest.files) {
  if (!/^(?:workspace\.json|legacy-owner\.json\.gz|work-[A-Za-z0-9_-]{1,100}\.jmx)$/.test(file.file)) throw Error('Invalid export filename');
  const body = readFileSync(join(directory, file.file));
  if (body.length !== file.bytes || createHash('sha256').update(body).digest('hex') !== file.sha256) throw Error('Source checksum mismatch');
  if (file.bytes <= 384 * 1024) {
    if (files.length >= 12 || bytes + file.bytes > 384 * 1024) flush();
    files.push(file); bytes += file.bytes;
  } else {
    flush();
    let index = 0;
    for (let offset = 0; offset < body.length; offset += 1024 * 1024, index++) {
      const chunk = body.subarray(offset, offset + 1024 * 1024);
      jobs.push({ operation: 'part', file: file.file, key: file.key, index, offset, length: chunk.length,
        sha256: createHash('sha256').update(chunk).digest('hex') });
    }
    finish.push({ operation: 'finish_object', key: file.key, bytes: file.bytes, sha256: file.sha256, parts: index });
  }
}
flush();
const result = JSON.stringify({ format: 3, jobs, finish });
const path = join(directory, 'rpc-jobs-v3.json');
if (existsSync(path) && readFileSync(path, 'utf8') !== result) throw Error('Existing import plan differs; preserve receipts and inspect before replacing it');
if (!existsSync(path)) writeFileSync(path, result);
console.log(JSON.stringify({ files: manifest.files.length, bytes: manifest.bytes, jobs: jobs.length, finish: finish.length }));
