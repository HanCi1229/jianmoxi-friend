/** Same-origin client for the existing Jianmoxi cloud API. */
(() => {
  'use strict';

  class ApiError extends Error {
    constructor(message, { status = 0, body = null, latestState = null, cause } = {}) {
      super(message, { cause });
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
      this.latestState = latestState;
      this.isUnauthorized = status === 401;
      this.isConflict = status === 409;
    }
  }

  function resolveApiUrl(path) {
    if (typeof path !== 'string' || !path.startsWith('/api/')) {
      throw new TypeError('API paths must start with /api/.');
    }
    const url = new URL(path, window.location.origin);
    if (url.origin !== window.location.origin) {
      throw new TypeError('Cross origin API requests are blocked.');
    }
    return url;
  }

  async function readBody(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        return await response.json();
      } catch (cause) {
        throw new ApiError('The server returned invalid JSON.', {
          status: response.status,
          cause,
        });
      }
    }
    const text = await response.text();
    return text ? { error: text } : null;
  }

  async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
    const options = {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...headers },
      signal,
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(resolveApiUrl(path), options);
    } catch (cause) {
      throw new ApiError('Could not reach the cloud service.', { cause });
    }

    const data = await readBody(response);
    if (!response.ok) {
      throw new ApiError(
        (data && typeof data.error === 'string' && data.error) ||
          `Cloud request failed (${response.status}).`,
        { status: response.status, body: data },
      );
    }
    return data;
  }

  async function getLatestState() {
    return request('/api/state');
  }

  async function putState(version, state) {
    try {
      return await request('/api/state', {
        method: 'PUT',
        body: { version, state },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          error.latestState = await getLatestState();
        } catch (refreshError) {
          error.refreshError = refreshError;
        }
      }
      throw error;
    }
  }

  window.JianmoxiApi = Object.freeze({
    ApiError,
    request,
    getSession: () => request('/api/session'),
    login: (password) => request('/api/login', { method: 'POST', body: { password } }),
    logout: () => request('/api/logout', { method: 'POST', body: {} }),
    getState: getLatestState,
    putState,
  });
})();
