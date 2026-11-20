// All durable records stay inside this owner-private Site. Book packs are read by range.
export class WorkspaceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const utf8 = new TextEncoder();
const codepoints = text => [...text];
const normalized = text => text.replace(/\s/gu, '');
const query = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const isoNow = () => new Date().toISOString();
const referenceUrl = (id, chapter = 0, offset = 0) => 'https://jianmoxi-writing-tools.hanxueqing.chatgpt.site/reference?work_id=' + encodeURIComponent(id) + '&chapter=' + chapter + '&offset=' + offset;
const hashHex = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
const setting = async (env, key) => (await query(env, 'SELECT value FROM workspace_settings WHERE key=?', key).first())?.value;
const setSetting = (env, key, value) => query(env, 'INSERT INTO workspace_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
const rowArticle = row => JSON.parse(row.data_json);
const revision = article => hashHex(JSON.stringify(['title', 'content', 'status', 'friendMarkup', 'friendContentHash'].map(key => article[key] ?? null)));
const html = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const articleMeta = row => {
  const article = rowArticle(row);
  return { id: row.id, title: row.title, status: row.status, date: article.date ?? '',
    characters: codepoints(row.content).length, group: article.group ?? '', revision: row.revision };
};

export function validateInput(schema, value, path = '参数') {
  const fail = () => { throw new WorkspaceError(path + '不符合工具要求'); };
  if (schema.enum && !schema.enum.includes(value)) fail();
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail();
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) { if (schema.additionalProperties === false) fail(); }
      else validateInput(schema.properties[key], item, path + '.' + key);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail();
    const length = codepoints(value).length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity) ||
        (schema.pattern && !new RegExp(schema.pattern).test(value))) fail();
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail();
  } else if (schema.type === 'boolean') { if (typeof value !== 'boolean') fail();
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > (schema.maxItems ?? Infinity)) fail();
    for (const item of value) validateInput(schema.items, item, path + '[]');
  }
}

function textPage(text, offset = 0, limit = 10000) {
  const chars = codepoints(text);
  if (offset > chars.length) throw new WorkspaceError('起始位置超出正文长度');
  const end = Math.min(offset + limit, chars.length);
  return { text: chars.slice(offset, end).join(''), offset, next_offset: end < chars.length ? end : null,
    total_characters: chars.length, complete: offset === 0 && end === chars.length };
}
async function getArticle(env, id, inTrash = false) {
  const row = await query(env, 'SELECT * FROM workspace_articles WHERE id=? AND in_trash=?', id, Number(inTrash)).first();
  if (!row) throw new WorkspaceError('没有找到这篇文章，请先读取文章列表', 404);
  return row;
}
async function saveDraft(env, article, previous = null) {
  const digest = await hashHex(article.content ?? '');
  if (article.friendContentHash !== digest) article.friendMarkup = '<p>' + html(article.content ?? '').replace(/\n/g, '</p><p>') + '</p>';
  article.friendContentHash = digest;
  const rev = await revision(article);
  let outcome;
  if (!previous) {
    outcome = await query(env, `INSERT INTO workspace_articles(id,title,content,status,data_json,revision,in_trash,position,updated_at)
      VALUES (?,?,?,?,?,?,0,(SELECT coalesce(min(position),0)-1 FROM workspace_articles WHERE in_trash=0),?) ON CONFLICT(id) DO NOTHING`,
    article.id, article.title, article.content, article.status, JSON.stringify(article), rev, isoNow()).run();
  } else {
    outcome = await query(env, `UPDATE workspace_articles SET title=?,content=?,status=?,data_json=?,revision=?,updated_at=?
      WHERE id=? AND revision=? AND in_trash=0`, article.title, article.content, article.status, JSON.stringify(article), rev,
    isoNow(), article.id, previous.revision).run();
  }
  if (outcome.meta.changes !== 1) throw new WorkspaceError('文章状态已变化，请重新读取后再操作', 409);
  return { ...articleMeta({ id: article.id, title: article.title, content: article.content, status: article.status,
    data_json: JSON.stringify(article), revision: rev }), saved: true };
}
async function moveDraft(env, args, restore) {
  const row = await query(env, 'SELECT * FROM workspace_articles WHERE id=?', args.article_id).first();
  if (!row || row.revision !== args.expected_revision) throw new WorkspaceError('文章已更新，请重新读取后再操作', 409);
  const target = restore ? 0 : 1;
  if (row.in_trash !== target) {
    const changed = await query(env, `UPDATE workspace_articles SET in_trash=?,updated_at=?,
      position=(SELECT coalesce(min(position),0)-1 FROM workspace_articles WHERE in_trash=?)
      WHERE id=? AND revision=? AND in_trash=?`, target, isoNow(), target, row.id, row.revision, row.in_trash).run();
    if (changed.meta.changes !== 1) throw new WorkspaceError('文章状态已变化，请重新读取后再操作', 409);
  }
  return { id: row.id, restored: restore, in_trash: !restore };
}
async function bookChapter(env, id, number = 0) {
  const work = await query(env, "SELECT * FROM workspace_works WHERE id=? AND status='ready'", id).first();
  if (!work) throw new WorkspaceError('没有找到这部作品', 404);
  if (number >= work.chapter_count) throw new WorkspaceError('没有这一章', 404);
  const header = await env.BUCKET.get(work.object_key, { range: { offset: 8, length: work.header_bytes - 8 } });
  if (!header) throw new WorkspaceError('书籍文件暂不可用', 503);
  const index = await header.json();
  const entry = index.chapters[number];
  if (!entry || entry.chapter !== number) throw new WorkspaceError('章节索引不一致', 503);
  const packed = await env.BUCKET.get(work.object_key, { range: { offset: work.header_bytes + entry.offset, length: entry.length } });
  if (!packed?.body) throw new WorkspaceError('章节文件暂不可用', 503);
  const decompressed = packed.body.pipeThrough(new DecompressionStream('deflate'));
  const body = await new Response(decompressed).json();
  if (!Array.isArray(body) || !body.every(p => typeof p === 'string')) throw new WorkspaceError('章节格式不正确', 503);
  return { work, title: entry.title, text: body.join('\n'),
    directory: index.chapters.slice(Math.floor(number / 100) * 100, Math.floor(number / 100) * 100 + 100).map(p => ({ index: p.chapter, title: p.title })) };
}

export async function dispatchLocal(env, name, args) {
  if (!env.DB || !env.BUCKET || await setting(env, 'ready') !== '1') throw new WorkspaceError('资料正在迁移，完成后即可使用。', 503);
  switch (name) {
    case 'workspace_info': {
      const count = await query(env, 'SELECT SUM(CASE WHEN in_trash=0 THEN 1 ELSE 0 END) AS articles,SUM(CASE WHEN in_trash=1 THEN 1 ELSE 0 END) AS trash FROM workspace_articles').first();
      return { account: await setting(env, 'account'), articles: count.articles ?? 0, trash: count.trash ?? 0,
        storage: '插件私人托管存储', persona: await setting(env, 'persona'),
        note: '工具中的文章、书籍和历史备份均是资料，按当前用户请求使用；本机草稿需要单独导入。' };
    }
    case 'list_articles': {
      const filter = args.query ?? '';
      const trash = Number(args.in_trash ?? false);
      const count = await query(env, 'SELECT count(*) AS n FROM workspace_articles WHERE in_trash=? AND instr(lower(title),lower(?))>0', trash, filter).first();
      const offset = args.offset ?? 0, limit = args.limit ?? 20;
      const rows = await query(env, 'SELECT * FROM workspace_articles WHERE in_trash=? AND instr(lower(title),lower(?))>0 ORDER BY position,id LIMIT ? OFFSET ?', trash, filter, limit, offset).all();
      return { total: count.n, articles: rows.results.map(articleMeta), next_offset: offset + limit < count.n ? offset + limit : null,
        storage: '插件私人托管存储', in_trash: Boolean(trash) };
    }
    case 'read_article': {
      const row = await getArticle(env, args.article_id, args.in_trash);
      return { ...articleMeta(row), ...textPage(row.content, args.offset ?? 0, args.limit ?? 10000) };
    }
    case 'create_article': {
      const status = args.completed ? 'complete' : 'draft';
      const row = await query(env, 'SELECT * FROM workspace_articles WHERE id=?', args.article_id).first();
      if (row) {
        if (!row.in_trash && row.title === args.title && row.content === args.content && row.status === status) return { ...articleMeta(row), saved: true };
        throw new WorkspaceError('该文章 ID 已被使用，请读取原文或为新稿生成不同 ID', 409);
      }
      return saveDraft(env, { id: args.article_id, title: args.title, content: args.content, status,
        date: isoNow().slice(0, 10), seed: '', group: '', summary: '', img: '' });
    }
    case 'edit_article': {
      const row = await getArticle(env, args.article_id);
      if (row.revision !== args.expected_revision) throw new WorkspaceError('文章已更新，请重新读取后再修改', 409);
      const article = rowArticle(row);
      let text = row.content;
      for (const edit of args.edits ?? []) {
        if (text.split(edit.old_text).length !== 2) throw new WorkspaceError('待替换原文必须在正文中唯一出现，请扩大选段', 409);
        text = text.replace(edit.old_text, () => edit.new_text);
      }
      if (codepoints(text).length > 200000) throw new WorkspaceError('文章正文最多 200000 字');
      article.content = text;
      if (args.title !== undefined) article.title = args.title;
      if (args.completed !== undefined) article.status = args.completed ? 'complete' : 'draft';
      return saveDraft(env, article, row);
    }
    case 'trash_article': return moveDraft(env, args, false);
    case 'restore_article': return moveDraft(env, args, true);
    case 'search_library': {
      const needle = args.query ?? '', author = args.author ?? '';
      const where = "status='ready' AND instr(lower(title||' '||author||' '||collection),lower(?))>0 AND instr(lower(author),lower(?))>0";
      const count = await query(env, 'SELECT count(*) AS n FROM workspace_works WHERE ' + where, needle, author).first();
      const page = args.page ?? 1, limit = args.limit ?? 12;
      const rows = await query(env, 'SELECT id,title,author,genre,collection,characters,chapter_count,metadata_json FROM workspace_works WHERE ' + where + ' ORDER BY author,title,id LIMIT ? OFFSET ?', needle, author, limit, (page - 1) * limit).all();
      return { total: count.n, page, pages: Math.max(1, Math.ceil(count.n / limit)), search_scope: '书名、作者和文集',
        books: rows.results.map(row => ({ id: row.id, title: row.title, author: row.author, genre: row.genre, collection: row.collection,
          characters: row.characters, chapterCount: row.chapter_count, sourceUrl: referenceUrl(row.id), originalSourceUrl: JSON.parse(row.metadata_json).sourceUrl ?? '' })) };
    }
    case 'read_library': {
      const { work, title, text, directory } = await bookChapter(env, args.work_id, args.chapter ?? 0);
      const meta = JSON.parse(work.metadata_json);
      return { work_id: work.id, title: work.title, author: work.author, source_url: referenceUrl(work.id, args.chapter ?? 0, args.offset ?? 0),
        original_source_url: meta.sourceUrl ?? '',
        chapter: args.chapter ?? 0, chapter_title: title, chapter_count: work.chapter_count, directory,
        ...textPage(text, args.offset ?? 0, args.limit ?? 10000) };
    }
    case 'list_excerpts': {
      const filter = args.query ?? '', offset = args.offset ?? 0, limit = args.limit ?? 20;
      const where = 'deleted_at IS NULL AND instr(lower(text||data_json),lower(?))>0';
      const count = await query(env, 'SELECT count(*) AS n FROM workspace_excerpts WHERE ' + where, filter).first();
      const rows = await query(env, 'SELECT * FROM workspace_excerpts WHERE ' + where + ' ORDER BY created_at DESC,id LIMIT ? OFFSET ?', filter, limit, offset).all();
      return { total: count.n, excerpts: rows.results.map(row => ({ ...JSON.parse(row.data_json), id: row.id, createdAt: row.created_at })),
        next_offset: offset + limit < count.n ? offset + limit : null };
    }
    case 'save_excerpt': {
      const { work, title, text } = await bookChapter(env, args.work_id, args.chapter ?? 0);
      if (!normalized(args.text) || !normalized(text).includes(normalized(args.text))) throw new WorkspaceError('选中文字与这一章不一致，请重新选择');
      const id = (await hashHex(work.id + '|' + (args.chapter ?? 0) + '|' + normalized(args.text))).slice(0, 32);
      const item = { workId: work.id, title: work.title, author: work.author, chapter: args.chapter ?? 0, chapterTitle: title, text: args.text };
      const createdAt = isoNow();
      await query(env, `INSERT INTO workspace_excerpts(id,text,data_json,created_at,deleted_at) VALUES (?,?,?,?,NULL)
        ON CONFLICT(id) DO UPDATE SET deleted_at=NULL`, id, args.text, JSON.stringify(item), createdAt).run();
      const saved = await query(env, 'SELECT data_json,created_at FROM workspace_excerpts WHERE id=?', id).first();
      return { item: { ...JSON.parse(saved.data_json), id, createdAt: saved.created_at } };
    }
    default: throw new WorkspaceError('未知工具', 404);
  }
}

export async function workspaceStatus(env) {
  if (!env.DB || !env.BUCKET) return { ready: false };
  const articles = await query(env, 'SELECT count(*) AS total,SUM(CASE WHEN in_trash=0 THEN 1 ELSE 0 END) AS active FROM workspace_articles').first();
  const works = await query(env, "SELECT count(*) AS total,SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) AS active,SUM(chapter_count) AS chapters,SUM(object_bytes) AS bytes FROM workspace_works").first();
  const excerpts = await query(env, 'SELECT count(*) AS n FROM workspace_excerpts WHERE deleted_at IS NULL').first();
  return { ready: await setting(env, 'ready') === '1', articles: articles.active ?? 0,
    trash: articles.total - (articles.active ?? 0), works: works.total, ready_works: works.active ?? 0,
    chapters: works.chapters ?? 0, object_bytes: works.bytes ?? 0, excerpts: excerpts.n };
}

export async function migrationRoute(request, env) {
  const secret = env.MIGRATION_TOKEN;
  if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) throw new WorkspaceError('Unauthorized', 401);
  if (!env.DB || !env.BUCKET) throw new WorkspaceError('Storage unavailable', 503);
  const url = new URL(request.url);
  if (url.pathname === '/admin/status' && request.method === 'GET') return workspaceStatus(env);
  const key = url.searchParams.get('key');
  if (url.pathname === '/admin/object' && request.method === 'PUT') {
    if (!/^migration-\d+\/(?:works\/[A-Za-z0-9_-]{1,100}\.jmx|workspace\.json|legacy-owner\.json\.gz)$/.test(key ?? '')) throw new WorkspaceError('Invalid object key');
    const sha = request.headers.get('x-content-sha256');
    if (!/^[a-f0-9]{64}$/.test(sha ?? '')) throw new WorkspaceError('Invalid checksum');
    const length = Number(request.headers.get('content-length'));
    if (!Number.isSafeInteger(length) || length < 1 || length > 64 * 1024 * 1024) throw new WorkspaceError('Invalid object size');
    const existing = await env.BUCKET.head(key);
    if (existing) {
      if (existing.size !== length || existing.customMetadata?.sha256 !== sha) throw new WorkspaceError('Existing object differs', 409);
      return { stored: true, bytes: existing.size, sha256: sha };
    }
    if (await setting(env, 'ready') === '1') throw new WorkspaceError('Migration already finalized', 409);
    const object = await env.BUCKET.put(key, request.body, { sha256: sha, customMetadata: { sha256: sha },
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' } });
    return { stored: true, bytes: object.size, sha256: sha };
  }
  if (request.method !== 'POST') throw new WorkspaceError('Use POST', 405);
  const raw = await request.text();
  if (utf8.encode(raw).length > 2 * 1024 * 1024) throw new WorkspaceError('Import batch too large', 413);
  const input = JSON.parse(raw);
  if (!/^migration-\d+$/.test(input.snapshot ?? '')) throw new WorkspaceError('Invalid snapshot');
  const previous = await setting(env, 'snapshot');
  if (previous && previous !== input.snapshot) throw new WorkspaceError('A different snapshot is already present', 409);
  if (await setting(env, 'ready') === '1') {
    if (url.pathname === '/admin/complete') return workspaceStatus(env);
    throw new WorkspaceError('Migration already finalized', 409);
  }
  if (url.pathname === '/admin/start') {
    await env.DB.batch([setSetting(env, 'snapshot', input.snapshot), setSetting(env, 'expected_counts', JSON.stringify(input.counts))]);
    return { started: true };
  }
  if (!previous) throw new WorkspaceError('Start migration first');
  if (url.pathname === '/admin/workspace') {
    const source = input.workspace;
    if (source.snapshot !== input.snapshot || !Array.isArray(source.state?.articles) || !Array.isArray(source.state?.trash)) throw new WorkspaceError('Invalid workspace');
    const inserts = [];
    for (const [trash, rows] of [[0, source.state.articles], [1, source.state.trash]]) {
      for (const [position, article] of rows.entries()) {
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(article.id) || typeof article.content !== 'string') throw new WorkspaceError('Invalid article');
        inserts.push(query(env, 'INSERT OR IGNORE INTO workspace_articles VALUES (?,?,?,?,?,?,?,?,?)', article.id, article.title ?? '', article.content,
          article.status ?? 'draft', JSON.stringify(article), await revision(article), trash, position, isoNow()));
      }
    }
    for (const row of source.excerpts) {
      const record = JSON.parse(row.record);
      inserts.push(query(env, 'INSERT OR IGNORE INTO workspace_excerpts VALUES (?,?,?,?,?)', row.id, record.text ?? '', row.record, row.created_at, row.deleted_at));
    }
    inserts.push(setSetting(env, 'account', source.account), setSetting(env, 'persona', source.persona),
      setSetting(env, 'source_state_version', source.version), setSetting(env, 'legacy_archive_key', input.snapshot + '/legacy-owner.json.gz'));
    for (let i = 0; i < inserts.length; i += 80) await env.DB.batch(inserts.slice(i, i + 80));
    return { imported: true };
  }
  if (url.pathname === '/admin/works') {
    if (!Array.isArray(input.works) || input.works.length > 50) throw new WorkspaceError('Invalid works batch');
    const inserts = [];
    for (const entry of input.works) {
      const meta = entry.metadata;
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(meta?.id ?? '') || entry.key !== input.snapshot + '/works/' + meta.id + '.jmx') throw new WorkspaceError('Invalid work');
      const object = await env.BUCKET.head(entry.key);
      if (!object || object.size !== entry.bytes || object.customMetadata?.sha256 !== entry.sha256) throw new WorkspaceError('Book checksum was not verified');
      if (!Number.isSafeInteger(meta.header_bytes) || meta.header_bytes < 8 || meta.header_bytes > object.size || meta.header_bytes > 8 * 1024 * 1024 ||
          !Number.isSafeInteger(meta.chapter_count) || meta.chapter_count < 1) throw new WorkspaceError('Invalid chapter index');
      inserts.push(query(env, 'INSERT OR IGNORE INTO workspace_works VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', meta.id, meta.title, meta.author ?? '', meta.genre ?? '',
        meta.collection ?? '', meta.characters ?? 0, meta.status, entry.key, entry.sha256, entry.bytes, meta.header_bytes,
        meta.chapter_count, JSON.stringify(meta)));
    }
    // Exactly thirteen bound columns; keep SQL and schema aligned.
    if (inserts.length) await env.DB.batch(inserts);
    return { imported: inserts.length };
  }
  if (url.pathname === '/admin/complete') {
    const actual = await workspaceStatus(env);
    const expected = JSON.parse(await setting(env, 'expected_counts'));
    for (const name of ['articles', 'trash', 'works', 'ready_works', 'chapters', 'excerpts']) {
      if (actual[name] !== expected[name]) throw new WorkspaceError('Migration count mismatch for ' + name, 409);
    }
    if (!await env.BUCKET.head(input.snapshot + '/legacy-owner.json.gz') || !await env.BUCKET.head(input.snapshot + '/workspace.json')) throw new WorkspaceError('Original backup missing');
    await setSetting(env, 'ready', '1').run();
    return workspaceStatus(env);
  }
  throw new WorkspaceError('Not found', 404);
}

export async function legacyBackup(env) {
  const key = await setting(env, 'legacy_archive_key');
  return key ? env.BUCKET.get(key) : null;
}

export async function authorizeWorkspace(env, actor) {
  if (!actor) throw new WorkspaceError('请先登录并连接这个私人插件。', 401);
  await query(env, 'INSERT OR IGNORE INTO workspace_settings(key,value) VALUES (?,?)', 'owner_identity', actor).run();
  if (await setting(env, 'owner_identity') !== actor) throw new WorkspaceError('这个工作区属于其他用户。', 403);
}

// Temporary owner-authenticated migration RPC uses the same reliable MCP transport as normal tools.
export async function migrationRpc(env, operation, payload) {
  if (!env.MIGRATION_TOKEN) throw new WorkspaceError('迁移入口已关闭', 403);
  const input = JSON.parse(payload);
  const validKey = key => /^migration-\d+\/(?:works\/[A-Za-z0-9_-]{1,100}\.jmx|workspace\.json|legacy-owner\.json\.gz)$/.test(key ?? '');
  const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const post = (path, body) => migrationRoute(new Request('https://migration.internal/admin/' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.MIGRATION_TOKEN }, body: JSON.stringify(body)
  }), env);
  if (['start', 'workspace', 'works', 'complete'].includes(operation)) return post(operation, input);
  if (operation === 'status') return workspaceStatus(env);
  if (operation === 'objects') {
    if (!Array.isArray(input.files) || input.files.length > 50) throw new WorkspaceError('Invalid object batch');
    let bytes = 0;
    for (const file of input.files) {
      const data = decode(file.data);
      bytes += data.length;
      if (bytes > 512 * 1024 || data.length !== file.bytes) throw new WorkspaceError('Object batch too large');
      await migrationRoute(new Request('https://migration.internal/admin/object?key=' + encodeURIComponent(file.key), {
        method: 'PUT', headers: { Authorization: 'Bearer ' + env.MIGRATION_TOKEN, 'x-content-sha256': file.sha256, 'content-length': String(data.length) }, body: data
      }), env);
    }
    return { stored: input.files.length, bytes };
  }
  if (operation === 'part') {
    if (!validKey(input.key) || !Number.isSafeInteger(input.index) || input.index < 0 || input.index > 127 ||
        !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) throw new WorkspaceError('Invalid part');
    if (await setting(env, 'ready') === '1') throw new WorkspaceError('Migration already finalized', 409);
    const bytes = decode(input.data);
    if (!bytes.length || bytes.length > 512 * 1024) throw new WorkspaceError('Invalid part size');
    await env.BUCKET.put(input.key + '.part-' + input.index, bytes, {
      sha256: input.sha256, customMetadata: { sha256: input.sha256 }
    });
    return { stored: true, index: input.index, bytes: bytes.length };
  }
  if (operation === 'finish_object') {
    if (!validKey(input.key) || !Number.isSafeInteger(input.bytes) || input.bytes < 1 || input.bytes > 32 * 1024 * 1024 ||
        !Number.isSafeInteger(input.parts) || input.parts < 1 || input.parts > 128 || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) throw new WorkspaceError('Invalid object');
    const existing = await env.BUCKET.head(input.key);
    if (existing) {
      if (existing.size !== input.bytes || existing.customMetadata?.sha256 !== input.sha256) throw new WorkspaceError('Existing object differs', 409);
      return { stored: true, bytes: existing.size };
    }
    if (await setting(env, 'ready') === '1') throw new WorkspaceError('Migration already finalized', 409);
    const bytes = new Uint8Array(input.bytes);
    let offset = 0;
    const keys = [];
    for (let index = 0; index < input.parts; index++) {
      const key = input.key + '.part-' + index;
      const part = await env.BUCKET.get(key);
      if (!part) throw new WorkspaceError('Missing object part', 409);
      const chunk = new Uint8Array(await part.arrayBuffer());
      if (offset + chunk.length > bytes.length) throw new WorkspaceError('Object part size mismatch');
      bytes.set(chunk, offset); offset += chunk.length; keys.push(key);
    }
    if (offset !== bytes.length) throw new WorkspaceError('Object size mismatch');
    await env.BUCKET.put(input.key, bytes, { sha256: input.sha256, customMetadata: { sha256: input.sha256 } });
    await env.BUCKET.delete(keys);
    return { stored: true, bytes: bytes.length };
  }
  throw new WorkspaceError('Unknown migration operation');
}
