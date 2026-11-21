'use strict';

(function () {
  const LIST_URL = 'https://liftingcast.com/api/meets';
  const DATA_HOST = 'https://couchdb.liftingcast.com';
  const ARCHIVE_LIST = '/archive-api/meets';
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const pending = new Map();
  const snapshots = new Map();
  const catalogs = new Map();
  const cooldowns = new Map();

  function readCache(key) {
    try { return JSON.parse(window.localStorage.getItem(`powerlifting-scoresheet-replay:${key}`)); }
    catch { return null; }
  }

  function writeCache(key, value) {
    try { window.localStorage.setItem(`powerlifting-scoresheet-replay:${key}`, JSON.stringify(value)); }
    catch { /* Cached data is still available for this page. */ }
  }

  function retryDelay(header, now) {
    if (!header) return 5 * MINUTE;
    if (/^\d+$/.test(header)) {
      const delay = Number(header) * 1000;
      return Number.isFinite(delay) ? delay : 5 * MINUTE;
    }
    const date = Date.parse(header);
    return Number.isFinite(date) ? Math.max(0, date - now) : 5 * MINUTE;
  }

  function waitMessage(until) {
    const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    return `LiftingCast asked us to slow down. Try again in ${seconds} seconds.`;
  }
  const DATE_ORDERS = new Map([
    ['MM/DD/YYYY', [2, 0, 1]],
    ['DD/MM/YYYY', [2, 1, 0]],
    ['YYYY/MM/DD', [0, 1, 2]],
    ['YYYY-MM-DD', [0, 1, 2]],
  ]);
  const validMeetId = (id) => typeof id === 'string' && /^m[a-z0-9]+$/.test(id);

  function calendarDate(date, format) {
    if (typeof date !== 'string') return null;
    const value = date.trim();
    const dateFormat = /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'YYYY-MM-DD' : format;
    const order = DATE_ORDERS.get(dateFormat);
    if (!order) return null;
    const parts = value.split(dateFormat === 'YYYY-MM-DD' ? '-' : '/');
    if (parts.length !== 3 || !parts.every((part) => /^\d{1,4}$/.test(part))
      || parts[order[0]].length !== 4) return null;
    const [year, month, day] = order.map((index) => Number(parts[index]));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month
      || parsed.getUTCDate() !== day) return null;
    return parsed.toISOString().slice(0, 10);
  }

  function fetchJson(url, refresh = false) {
    const existing = pending.get(url);
    if (existing) return existing;
    const source = url.startsWith('/archive-api/') ? 'archive' : 'current';
    const key = `cooldown-${source}`;
    const until = Math.max(cooldowns.get(source) || 0, Number(readCache(key)) || 0);
    if (until > Date.now()) return Promise.reject(new Error(waitMessage(until)));

    const request = (async () => {
      const response = await fetch(url, {
        credentials: 'omit', cache: refresh ? 'no-cache' : 'default',
        signal: AbortSignal.timeout(25_000),
      });
      const retryAfter = response.headers?.get('Retry-After');
      if (response.status === 429 || (response.status === 503 && retryAfter)) {
        const now = Date.now();
        const deadline = Math.max(cooldowns.get(source) || 0, Number(readCache(key)) || 0,
          now + retryDelay(retryAfter, now));
        cooldowns.set(source, deadline);
        writeCache(key, deadline);
        throw new Error(waitMessage(deadline));
      }
      if (!response.ok) throw new Error(`LiftingCast returned HTTP ${response.status}.`);
      return response.json();
    })().finally(() => pending.delete(url));
    pending.set(url, request);
    return request;
  }

  async function fetchCatalog(url, ttl, extract) {
    const cached = catalogs.get(url) ?? readCache(url);
    if (Array.isArray(cached?.docs) && cached.expires > Date.now()) return cached.docs;
    const docs = extract(await fetchJson(url));
    if (!Array.isArray(docs)) throw new Error('Unexpected meet list format.');
    const entry = { docs, expires: Date.now() + ttl };
    catalogs.set(url, entry);
    writeCache(url, entry);
    return docs;
  }

  async function listMeets(now = new Date()) {
    const docs = await fetchCatalog(LIST_URL, HOUR, (listing) => listing?.docs);
    // Do calendar arithmetic using the browser's date, not the server's time zone.
    const cutoff = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 7))
      .toISOString().slice(0, 10);
    return normalizeMeets(docs, cutoff);
  }

  async function listArchivedMeets() {
    if (window.location?.protocol === 'file:') throw new Error('Start the local server for archived meets.');
    return normalizeMeets(await fetchCatalog(ARCHIVE_LIST, DAY, (listing) => listing));
  }

  function normalizeMeets(docs, cutoff) {
    return docs.flatMap((meet) => {
      if (!validMeetId(meet?._id)) return [];
      const name = typeof meet.name === 'string' ? meet.name.trim() : '';
      const date = calendarDate(meet.date, meet.dateFormat) ?? '';
      return cutoff && date > cutoff ? [] : [{ id: meet._id, name: name || meet._id, date }];
    }).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  }

  function searchMeets(meets, query) {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return meets.filter(({ id, name, date }) => {
      const label = `${name} ${date} ${id}`.toLowerCase();
      return words.every((word) => label.includes(word));
    });
  }

  async function fetchMeet(id, { refresh = false } = {}) {
    if (!validMeetId(id)) throw new Error('Invalid LiftingCast meet ID.');
    return fetchSnapshot(`${DATA_HOST}/${id}_readonly/_all_docs?include_docs=true`, refresh);
  }

  async function fetchArchivedMeet(id) {
    if (!validMeetId(id)) throw new Error('Invalid LiftingCast meet ID.');
    return fetchSnapshot(`/archive-api/meets/${id}`);
  }

  async function fetchSnapshot(url, refresh = false) {
    const cached = snapshots.get(url);
    if (cached && !refresh) return cached.data;
    if (refresh && cached && Date.now() - cached.downloaded < MINUTE) {
      const seconds = Math.ceil((cached.downloaded + MINUTE - Date.now()) / 1000);
      throw new Error(`This meet was just downloaded. Try refreshing in ${seconds} seconds.`);
    }
    const data = await fetchJson(url, refresh);
    if (!Array.isArray(data?.rows)) throw new Error('Unexpected meet data format.');
    snapshots.delete(url);
    snapshots.set(url, { data, downloaded: Date.now() });
    if (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value);
    return data;
  }

  function ageAtMeet(birthDate, meet) {
    const birthday = calendarDate(birthDate, meet?.dateFormat);
    const date = calendarDate(meet?.date, meet?.dateFormat);
    if (!birthday || !date || birthday > date) return null;
    return Number(date.slice(0, 4)) - Number(birthday.slice(0, 4))
      - Number(date.slice(5) < birthday.slice(5));
  }

  window.MeetLiftingCast = { listMeets, listArchivedMeets, searchMeets, fetchMeet, fetchArchivedMeet, ageAtMeet };
}());
