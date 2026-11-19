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
const env = { JIANMOXI_BRIDGE_URL: 'https://test.trycloudflare.com/v1', JIANMOXI_BRIDGE_TOKEN: 'synthetic-test-credential' };
let calls = 0;
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(url, env.JIANMOXI_BRIDGE_URL);
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.Authorization, 'Bearer ' + env.JIANMOXI_BRIDGE_TOKEN);
  assert.deepEqual(JSON.parse(options.body), { name: 'list_articles', arguments: {} });
  return Response.json({ result: { total: 0, articles: [] } });
};
const result = await call('tools/call', { name: 'list_articles' }, { 'oai-authenticated-user-id': 'qa' }, env);
assert.equal(calls, 1);
assert.deepEqual(result.result.structuredContent, { total: 0, articles: [] });
assert.ok(!JSON.stringify(result).includes(env.JIANMOXI_BRIDGE_TOKEN));
globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://example.com' } });
assert.equal((await call('tools/call', { name: 'list_articles' }, { 'oai-authenticated-user-id': 'qa' }, env)).result.isError, true);
globalThis.fetch = async () => Response.json({ error: '文章已更新，请重新读取后再操作' }, { status: 409 });
assert.match((await call('tools/call', { name: 'edit_article' }, { 'oai-authenticated-user-id': 'qa' }, env)).result.content[0].text, /文章已更新/);
console.log('Discovery, schemas, authentication, HTTPS dispatch, redirect refusal and revision errors passed');
