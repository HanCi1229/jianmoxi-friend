import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import worker from '../worker/index.js';
import { dispatchLocal, migrationRoute, validateInput, WorkspaceError, authorizeWorkspace, migrationRpc } from '../worker/storage.js';

const catalog = JSON.parse(readFileSync(new URL('../tools.json', import.meta.url)));
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../drizzle/0001_hosted_workspace.sql', import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
const DB = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; }
    };
  },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
};
const blobs = new Map();
const BUCKET = {
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) blobs.delete(key); },
  async head(key) { const row = blobs.get(key); return row ? { size: row.body.length, customMetadata: row.meta } : null; },
  async put(key, body, options) {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    assert.equal(sha, options.sha256);
    blobs.set(key, { body: bytes, meta: options.customMetadata });
    return { size: bytes.length };
  },
  async get(key, options) {
    const row = blobs.get(key); if (!row) return null;
    const offset = options?.range?.offset ?? 0;
    const bytes = row.body.slice(offset, options?.range?.length === undefined ? undefined : offset + options.range.length);
    const response = new Response(bytes);
    return { body: response.body, json: () => response.json(), arrayBuffer: () => response.arrayBuffer() };
  }
};
const env = { DB, BUCKET, MIGRATION_TOKEN: 'synthetic-migration-test-credential' };
const snapshot = 'migration-123';
async function admin(path, body) {
  return migrationRoute(new Request('https://test.chatgpt.site/admin/' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.MIGRATION_TOKEN }, body: JSON.stringify({ snapshot, ...body })
  }), env);
}
async function call(method, params = {}, headers = {}, targetEnv = env) {
  const response = await worker.fetch(new Request('https://test.chatgpt.site/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  }), targetEnv);
  return response.json();
}
assert.deepEqual((await call('tools/list', {}, {}, { ...env, MIGRATION_TOKEN: undefined })).result.tools, catalog);
assert.equal((await call('tools/list')).result.tools.at(-1).name, 'migration_import');
assert.equal((await call('initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion, '2025-03-26');
assert.equal((await call('server/discover')).result.serverInfo.version, '2.0.0');
assert.equal((await call('tools/call', { name: 'list_articles' })).result.isError, true);
assert.equal((await call('tools/call', { name: 'shell' }, { 'oai-authenticated-user-id': 'owner' })).error.code, -32602);
await assert.rejects(dispatchLocal(env, 'list_articles', {}), error => error.status === 503);
await assert.rejects(migrationRoute(new Request('https://test.chatgpt.site/admin/status'), env), error => error.status === 401);
await authorizeWorkspace(env, 'owner');
await assert.rejects(authorizeWorkspace(env, 'different-user'), error => error.status === 403);
await admin('start', { counts: { articles: 1, trash: 1, works: 1, ready_works: 1, chapters: 1, excerpts: 0 } });
await assert.rejects(admin('complete', {}), error => error.status === 409);

const original = { id: 'original', title: '原稿', content: '旧文😀\n第二行', status: 'draft', friendMarkup: '<p>旧文😀</p><p>第二行</p>', friendContentHash: 'preserved-original', date: '2026-11-20' };
await admin('workspace', { workspace: { snapshot, version: 42, account: 'test-owner', persona: '测试人设',
  state: { articles: [original], trash: [{ ...original, id: 'trashed' }] }, excerpts: [] } });
const packed = deflateSync(Buffer.from(JSON.stringify(['春山可望。', '流水相伴。'])));
const index = Buffer.from(JSON.stringify({ version: 1, chapters: [{ chapter: 0, title: '第一章', offset: 0, length: packed.length, characters: 11 }] }));
const prefix = Buffer.alloc(8); prefix.write('JMX1'); prefix.writeUInt32BE(index.length, 4);
const content = Buffer.concat([prefix, index, packed]);
const objectKey = snapshot + '/works/test-book.jmx';
const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', content))].map(b => b.toString(16).padStart(2, '0')).join('');
const upload = new Request('https://test.chatgpt.site/admin/object?key=' + encodeURIComponent(objectKey), {
  method: 'PUT', headers: { Authorization: 'Bearer ' + env.MIGRATION_TOKEN, 'x-content-sha256': hash, 'Content-Length': String(content.length) }, body: content
});
assert.equal((await migrationRoute(upload, env)).stored, true);
await admin('works', { works: [{ key: objectKey, sha256: hash, bytes: content.length, metadata: {
  id: 'test-book', title: '山水小记', author: '测试作者', genre: '散文', collection: '测试集', characters: 11,
  status: 'ready', chapter_count: 1, header_bytes: 8 + index.length, sourceUrl: 'https://example.com/source'
} }] });
blobs.set(snapshot + '/legacy-owner.json.gz', { body: Buffer.from('archive'), meta: {} });
blobs.set(snapshot + '/workspace.json', { body: Buffer.from('{}'), meta: {} });
assert.equal((await migrationRpc(env, 'objects', JSON.stringify({ files: [{ key: objectKey, sha256: hash, bytes: content.length, data: content.toString('base64') }] }))).stored, 1);
const transport = Buffer.alloc(512 * 1024 + 17, 7);
const transportKey = snapshot + '/works/transport-fixture.jmx';
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
for (let offset = 0, index = 0; offset < transport.length; offset += 512 * 1024, index++) {
  const chunk = transport.subarray(offset, offset + 512 * 1024);
  const rpc = await call('tools/call', { name: 'migration_import', arguments: { operation: 'part', payload: JSON.stringify({ key: transportKey, index, sha256: await digest(chunk), data: chunk.toString('base64') }) } }, { 'oai-authenticated-user-id': 'owner' });
  assert.equal(rpc.result.structuredContent.stored, true);
}
assert.equal((await migrationRpc(env, 'finish_object', JSON.stringify({ key: transportKey, bytes: transport.length, parts: 2, sha256: await digest(transport) }))).stored, true);
assert.deepEqual(Buffer.from(blobs.get(transportKey).body), transport);
assert.equal(blobs.has(transportKey + '.part-0'), false);
await assert.rejects(migrationRpc({ ...env, MIGRATION_TOKEN: undefined }, 'status', '{}'), error => error.status === 403);
assert.equal((await admin('complete', {})).ready, true);

const first = await dispatchLocal(env, 'list_articles', {});
assert.equal(first.total, 1);
const read = await dispatchLocal(env, 'read_article', { article_id: 'original', offset: 2, limit: 1 });
assert.equal(read.text, '😀');
assert.equal(read.total_characters, 7);
assert.equal((await dispatchLocal(env, 'read_article', { article_id: 'trashed', in_trash: true })).title, '原稿');
const entry = await dispatchLocal(env, 'read_library', { work_id: 'test-book', offset: 0, limit: 5 });
assert.equal(entry.text, '春山可望。');
assert.equal(entry.next_offset, 5);
assert.equal(entry.directory[0].title, '第一章');
assert.ok(entry.source_url.startsWith('https://jianmoxi-writing-tools.hanxueqing.chatgpt.site/reference?'));
assert.equal(entry.original_source_url, 'https://example.com/source');
assert.equal((await dispatchLocal(env, 'search_library', { query: '山水', author: '测试作者' })).total, 1);
await assert.rejects(dispatchLocal(env, 'read_library', { work_id: 'test-book', chapter: 3 }), error => error.status === 404);
const quote = await dispatchLocal(env, 'save_excerpt', { work_id: 'test-book', text: '春山可望。' });
assert.equal((await dispatchLocal(env, 'save_excerpt', { work_id: 'test-book', text: ' 春山可望。 ' })).item.id, quote.item.id);
assert.equal((await dispatchLocal(env, 'list_excerpts', {})).total, 1);
await assert.rejects(dispatchLocal(env, 'save_excerpt', { work_id: 'test-book', text: '不存在的句子' }), error => error.status === 400);

const id = '367bdb47-c740-48a5-b35c-36a7f3053f72';
const created = await dispatchLocal(env, 'create_article', { article_id: id, title: '新稿', content: '第一句，第二句。' });
assert.equal((await dispatchLocal(env, 'create_article', { article_id: id, title: '新稿', content: '第一句，第二句。' })).revision, created.revision);
await assert.rejects(dispatchLocal(env, 'create_article', { article_id: id, title: '不同稿', content: '第一句，第二句。' }), error => error.status === 409);
const revised = await dispatchLocal(env, 'edit_article', { article_id: id, expected_revision: created.revision, edits: [{ old_text: '第二句', new_text: '$&原样保存' }] });
assert.equal((await dispatchLocal(env, 'read_article', { article_id: id })).text, '第一句，$&原样保存。');
await assert.rejects(dispatchLocal(env, 'edit_article', { article_id: id, expected_revision: created.revision, title: '过期修改' }), error => error.status === 409);
const concurrent = await Promise.allSettled([
  dispatchLocal(env, 'edit_article', { article_id: id, expected_revision: revised.revision, title: '并发修改一' }),
  dispatchLocal(env, 'edit_article', { article_id: id, expected_revision: revised.revision, title: '并发修改二' })
]);
assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
const current = await dispatchLocal(env, 'read_article', { article_id: id });
await dispatchLocal(env, 'trash_article', { article_id: id, expected_revision: current.revision });
await dispatchLocal(env, 'trash_article', { article_id: id, expected_revision: current.revision });
await assert.rejects(dispatchLocal(env, 'read_article', { article_id: id }), error => error.status === 404);
await dispatchLocal(env, 'restore_article', { article_id: id, expected_revision: current.revision });
assert.equal((await dispatchLocal(env, 'read_article', { article_id: id })).revision, current.revision);
assert.throws(() => validateInput(catalog.find(tool => tool.name === 'read_article').inputSchema, { article_id: '../escape' }), WorkspaceError);
assert.throws(() => validateInput(catalog.find(tool => tool.name === 'list_articles').inputSchema, { limit: 10000 }), WorkspaceError);
const rpc = await call('tools/call', { name: 'list_articles', arguments: { limit: 1 } }, { 'oai-authenticated-user-id': 'owner' });
assert.equal(rpc.result.structuredContent.total, 2);
assert.equal((await call('tools/call', { name: 'list_articles', arguments: { account: 'other' } }, { 'oai-authenticated-user-id': 'owner' })).result.isError, true);
assert.ok(!JSON.stringify(rpc).includes(env.MIGRATION_TOKEN));
assert.equal((await call('tools/call', { name: 'list_articles' }, { 'oai-authenticated-user-id': 'different-user' })).result.isError, true);
assert.equal((await worker.fetch(new Request('https://test.chatgpt.site/backup'), env)).status, 401);
assert.equal((await worker.fetch(new Request('https://test.chatgpt.site/reference?work_id=test-book'), env)).status, 401);
const reference = await worker.fetch(new Request('https://test.chatgpt.site/reference?work_id=test-book', { headers: { 'oai-authenticated-user-id': 'owner' } }), env);
assert.equal((await reference.json()).text, '春山可望。\n流水相伴。');
assert.equal((await worker.fetch(new Request('https://test.chatgpt.site/reference?work_id=test-book&chapter=-1', { headers: { 'oai-authenticated-user-id': 'owner' } }), env)).status, 400);
console.log('Hosted storage integration passed: import integrity, account isolation, real SQLite CAS, Unicode pagination, R2 chapter ranges, excerpt source checks, retries and recovery.');
sqlite.close();
