/** Narrow home-screen API helpers. No requests run during module loading. */
(() => {
  'use strict';

  const api = () => {
    const client = window.JianMoXiApi;
    if (!client || typeof client.request !== 'function') {
      throw new Error('Cloud API client is unavailable.');
    }
    return client;
  };

  function normalizeMood(mood) {
    return typeof mood === 'string' ? mood.trim() : '';
  }

  async function getInspiration({ cursor = 0, signal } = {}) {
    const safeCursor = Number.isInteger(Number(cursor)) && Number(cursor) >= 0
      ? Number(cursor)
      : 0;
    const query = new URLSearchParams({ cursor: String(safeCursor) });
    return api().request(`/api/inspiration/library?${query}`, { signal });
  }

  async function searchCities(query, { signal } = {}) {
    if (typeof query !== 'string' || query.trim().length < 2) {
      throw new TypeError('请输入至少两个字的城市名');
    }
    return api().request('/api/weather', {
      method: 'POST',
      body: { action: 'cities', query: query.trim() },
      signal,
    });
  }

  async function getCurrentWeather({ lat, lon, name = '', signal } = {}) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new TypeError('天气坐标无效');
    }
    return api().request('/api/weather', {
      method: 'POST',
      body: {
        action: 'current',
        lat: latitude,
        lon: longitude,
        name: typeof name === 'string' ? name.trim() : '',
      },
      signal,
    });
  }

  async function getGreeting(mood = '', { signal } = {}) {
    return api().request('/api/companion/greeting', {
      method: 'POST',
      body: { mood: normalizeMood(mood) },
      signal,
    });
  }

  window.JianMoXiHome = Object.freeze({
    getInspiration,
    searchCities,
    getCurrentWeather,
    getGreeting,
  });
})();
