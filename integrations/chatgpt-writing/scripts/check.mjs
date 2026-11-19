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
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://backend.test/v1');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-test-credential');
    assert.deepEqual(JSON.parse(init.body), { name: 'list_articles', arguments: {} });
    return new Response(JSON.stringify({ result: { total: 0, articles: [] } }));
  };
  const result = await call('tools/call', { name: 'list_articles', arguments: {} },
    { 'oai-authenticated-user-id': 'qa' }, { JIANMOXI_BRIDGE_URL: 'https://backend.test/v1', JIANMOXI_BRIDGE_TOKEN: 'synthetic-test-credential' });
  assert.deepEqual(result.result.structuredContent, { total: 0, articles: [] });
  assert.ok(!JSON.stringify(result).includes('synthetic-test-credential'));
} finally { globalThis.fetch = originalFetch; }
console.log('Discovery, tool schemas, authentication and bridge forwarding passed');
