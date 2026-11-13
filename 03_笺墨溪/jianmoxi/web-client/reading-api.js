(() => {
  'use strict';

  const api = () => window.JianMoXiApi || window.JianmoxiApi;
  const ready = () => {
    const client = api();
    if (!client || typeof client.request !== 'function') {
      throw new Error('JianMoXiApi.request is required before loading the reading module.');
    }
    return client;
  };

  function queryString(values) {
    const params = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    const result = params.toString();
    return result ? `?${result}` : '';
  }

  async function catalog(filters = {}) {
    const { q = '', query, genre = '', author = '', collection = '', page = 1, limit = 12, favoritesOnly = false } = filters;
    const values = { q: query ?? q, genre, author, collection, page, limit };
    if (favoritesOnly) values.favorites = 1;
    return ready().request(`/api/library${queryString(values)}`);
  }

  function search(query, options = {}) {
    return catalog({ ...options, q: query });
  }

  async function detail(workId) {
    if (!workId) throw new TypeError('workId is required.');
    return ready().request(`/api/library/${encodeURIComponent(workId)}`);
  }

  async function chapter(workId, index) {
    if (!workId || !Number.isInteger(index) || index < 0) throw new TypeError('A workId and non-negative chapter index are required.');
    return ready().request(`/api/library/${encodeURIComponent(workId)}/chapters/${index}`);
  }

  async function excerpts() {
    return ready().request('/api/excerpts');
  }

  async function saveExcerpt(selection) {
    if (!selection || typeof selection !== 'object') throw new TypeError('A reading selection is required.');
    return ready().request('/api/excerpts', { method: 'POST', body: selection });
  }

  async function deleteExcerpt(id) {
    if (!id) throw new TypeError('Excerpt id is required.');
    return ready().request(`/api/excerpts/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} });
  }

  async function assist(selection, mode = 'interpret', articleId) {
    if (!selection || typeof selection !== 'object') throw new TypeError('A verified reading selection is required.');
    if (!['interpret', 'associate'].includes(mode)) throw new TypeError('mode must be interpret or associate.');
    const body = { ...selection, mode };
    if (articleId) body.articleId = articleId;
    return ready().request('/api/reading/assist', { method: 'POST', body });
  }

  async function favoriteIds() {
    const data = await ready().request('/api/state');
    return Array.isArray(data?.state?.favs) ? data.state.favs : [];
  }

  async function favorite(workId, enabled = true) {
    if (!workId) throw new TypeError('workId is required.');
    const client = ready();
    if (typeof client.getState !== 'function' || typeof client.putState !== 'function') {
      throw new Error('Favorites require JianMoXiApi.getState and putState for versioned state updates.');
    }
    const current = await client.getState();
    const state = current?.state;
    if (!state || !Number.isInteger(current.version)) throw new Error('Cloud state is missing its version or state object.');
    const ids = Array.isArray(state.favs) ? state.favs : [];
    state.favs = enabled ? [...new Set([...ids, workId])] : ids.filter((id) => id !== workId);
    return client.putState(current.version, state);
  }

  window.JianMoXiReading = Object.freeze({ catalog, search, detail, chapter, excerpts, saveExcerpt, deleteExcerpt, assist, favoriteIds, favorite });
})();
