import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index.js';

const tools = JSON.parse(await readFile(new URL('../tools.json', import.meta.url), 'utf8'));
async function call(method, params = {}, headers = {}, env = {}) {
  const response = await worker.fetch(new Request('https://writing-tools.test/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  }), env);
  return response.json();
}
assert.equal((await call('server/discover')).result.supportedVersions[0], '2026-07-28');
assert.equal((await call('initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion, '2025-03-26');
assert.deepEqual((await call('tools/list')).result.tools, tools);
assert.equal((await call('tools/call', { name: 'list_articles', arguments: {} })).result.isError, true);
assert.equal((await call('tools/call', { name: 'shell', arguments: {} }, { 'oai-authenticated-user-id': 'qa' })).error.code, -32602);
let pendingJob;
const DB = {
  prepare(sql) {
    let values;
    return {
      bind(...args) { values = args; return this; },
      async run() {
        if (sql.startsWith('INSERT INTO writing_jobs')) pendingJob = { id: values[0], name: values[1], args: values[2] };
        return { meta: { changes: 1 } };
      },
      async first() {
        assert.equal(values[0], pendingJob.id);
        return { status: 'done', response: JSON.stringify({ result: { total: 0, articles: [] } }) };
      }
    };
  }
};
const result = await call('tools/call', { name: 'list_articles' },
  { 'oai-authenticated-user-id': 'qa' }, { DB, JIANMOXI_BRIDGE_TOKEN: 'synthetic-test-credential' });
assert.equal(pendingJob.name, 'list_articles');
assert.deepEqual(JSON.parse(pendingJob.args), {});
assert.deepEqual(result.result.structuredContent, { total: 0, articles: [] });
assert.ok(!JSON.stringify(result).includes('synthetic-test-credential'));
const denied = await worker.fetch(new Request('https://writing-tools.test/bridge/poll', {
  method: 'POST', body: '{}'
}), { DB, JIANMOXI_BRIDGE_TOKEN: 'synthetic-test-credential' });
assert.equal(denied.status, 401);
console.log('Discovery, schemas, authentication, queued tool results and private polling passed');
