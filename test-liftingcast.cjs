'use strict';

const assert = require('node:assert/strict');
global.window = {};
require('./liftingcast.js');
const { listMeets, searchMeets, fetchMeet } = window.MeetLiftingCast;
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const listed = (id, date, dateFormat, showOnHomePage = true) => ({ _id: id, name: id, date, dateFormat, showOnHomePage });

async function main() {
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://liftingcast.com/api/meets');
    assert.equal(options.credentials, 'omit');
    return response({ docs: [
      listed('molder', '10/11/2026', 'MM/DD/YYYY'),
      listed('mnewer', '20/11/2026', 'DD/MM/YYYY'),
      listed('mtoday', '2026/11/21', 'YYYY/MM/DD'),
      listed('mhidden', '11/21/2026', 'MM/DD/YYYY', false),
      listed('mfuture', '11/22/2026', 'MM/DD/YYYY'),
      listed('mboundary', '28/11/2026', 'DD/MM/YYYY'),
      listed('mtooearly', '2026/11/29', 'YYYY/MM/DD'),
      listed('minvalid', '31/10/2026', 'MM/DD/YYYY'),
    ] });
  };
  const meets = await listMeets(new Date(2026, 10, 21, 23, 59));
  assert.deepEqual(meets.map(({ id }) => id), ['mboundary', 'mfuture', 'mhidden', 'mtoday', 'mnewer', 'molder', 'minvalid']);
  assert.equal(meets.at(-1).date, '');
  assert.equal(searchMeets(meets, '   ').length, 7);
  assert.deepEqual(searchMeets(meets, 'mtooearly'), []);
  assert.deepEqual(searchMeets(meets, 'OLDER  2026-10').map(({ id }) => id), ['molder']);
  assert.deepEqual(searchMeets(meets, '2026-11-21').map(({ id }) => id), ['mhidden', 'mtoday']);
  assert.deepEqual(searchMeets(meets, 'no matching meet'), []);

  const snapshot = { rows: [{ doc: { _id: 'mnewer' } }] };
  let downloads = 0;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://couchdb.liftingcast.com/mnewer_readonly/_all_docs?include_docs=true');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    downloads++;
    return response(snapshot);
  };
  assert.deepEqual(await Promise.all([fetchMeet('mnewer'), fetchMeet('mnewer')]), [snapshot, snapshot]);
  assert.equal(await fetchMeet('mnewer'), snapshot);
  await assert.rejects(fetchMeet('mnewer', { refresh: true }), /just downloaded/);
  assert.equal(downloads, 1);
  await assert.rejects(fetchMeet('../private'), /Invalid LiftingCast meet ID/);
  global.fetch = async () => response({}, 404);
  await assert.rejects(fetchMeet('mmissing'), /HTTP 404/);
  global.fetch = async () => response({});
  await assert.rejects(fetchMeet('mmissing'), /Unexpected meet data format/);
  const { listArchivedMeets, fetchArchivedMeet } = window.MeetLiftingCast;
  global.fetch = async (url, options) => {
    assert.equal(url, '/archive-api/meets');
    assert.equal(options.credentials, 'omit');
    return response([{ ...listed('mhistorical', '31/01/2026', 'DD/MM/YYYY'), name: 'Historical Sheffield' }]);
  };
  assert.deepEqual(searchMeets(await listArchivedMeets(), 'sheffield 2026'), [
    { id: 'mhistorical', name: 'Historical Sheffield', date: '2026-01-31' },
  ]);
  global.fetch = async (url, options) => {
    assert.equal(url, '/archive-api/meets/mhistorical');
    assert.ok(options.signal instanceof AbortSignal);
    return response(snapshot);
  };
  assert.equal(await fetchArchivedMeet('mhistorical'), snapshot);
  await assert.rejects(fetchArchivedMeet('../private'), /Invalid LiftingCast meet ID/);

  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    let requests = 0;
    global.fetch = async () => {
      requests++;
      return { ...response({}, 429), headers: new Headers({ 'Retry-After': '120' }) };
    };
    await assert.rejects(fetchMeet('mlimited'), /120 seconds/);
    await assert.rejects(fetchMeet('manother'), /120 seconds/);
    assert.equal(await fetchMeet('mnewer'), snapshot);
    assert.equal(requests, 1);
    now += 120_000;
    global.fetch = async (url, options) => {
      assert.equal(options.cache, 'no-cache');
      return response({ rows: [] });
    };
    assert.deepEqual(await fetchMeet('mnewer', { refresh: true }), { rows: [] });
    global.fetch = async () => {
      requests++;
      return { ...response({}, 503), headers: new Headers({ 'Retry-After': new Date(now + 120_000).toUTCString() }) };
    };
    await assert.rejects(fetchArchivedMeet('mlimited'), /slow down/);
    await assert.rejects(fetchArchivedMeet('manother'), /slow down/);
    assert.equal(requests, 2);
  } finally {
    Date.now = realNow;
  }
  // Catalog storage survives a fresh page; expiration still triggers one read.
  const storage = new Map();
  window.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const reload = () => {
    delete require.cache[require.resolve('./liftingcast.js')];
    require('./liftingcast.js');
    return window.MeetLiftingCast;
  };
  let catalogReads = 0;
  global.fetch = async () => { catalogReads++; return response({ docs: [] }); };
  await Promise.all([reload().listMeets(), window.MeetLiftingCast.listMeets()]);
  await reload().listMeets();
  assert.equal(catalogReads, 1);
  const [cacheKey] = storage.keys();
  storage.set(cacheKey, JSON.stringify({ docs: [], expires: Date.now() - 1 }));
  await reload().listMeets();
  assert.equal(catalogReads, 2);

  window.location = { protocol: 'file:' };
  await assert.rejects(listArchivedMeets(), /Start the local server/);
  console.log('ALL CHECKS PASSED');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
