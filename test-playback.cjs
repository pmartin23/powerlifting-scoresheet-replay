'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const files = ['ipf.js', 'records.js', 'replay.js', 'fixtures/sample-meet.js', 'app.js'];

test('Sync & Play follows recorded changes, pauses, and resets on manual navigation', async () => {
  function element() {
    return {
      children: [], value: '', classList: { remove() {}, toggle() {} }, parentElement: { classList: { toggle() {} } },
      events: {}, addEventListener(name, handler) { this.events[name] = handler; },
      setAttribute() {}, removeAttribute() {}, replaceChildren(...children) { this.children = children; },
    };
  }
  const els = new Map();
  const id = (name) => {
    if (!els.has(name)) els.set(name, element());
    return els.get(name);
  };
  const document = Object.assign(element(), { getElementById: id, createElement: element });
  const window = {
    location: { protocol: 'file:' },
    MeetRender: {
      renderHeader: () => ({}),
      renderSheet(node, sheet, highlight) { node.highlight = highlight; },
      renderEvent(node, current, nextUp) { Object.assign(node, { current, nextUp }); },
      renderStandings() {},
    },
    MeetLiftingCast: {
      listMeets: async () => [{ id: 'sample', name: 'Sample meet' }],
      fetchMeet: async () => window.MEET_REPLAY_SAMPLE,
      searchMeets: (meets) => meets,
      ageAtMeet: () => null,
    },
  };
  let now = 100;
  let sequence = 0;
  const timers = new Map();
  const context = vm.createContext({
    window, document, structuredClone, performance: { now: () => now },
    setTimeout(fn, delay) { const key = ++sequence; timers.set(key, { fn, at: now + delay }); return key; },
    clearTimeout(key) { timers.delete(key); },
  });
  for (const file of files) vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file });
  document.events.DOMContentLoaded();
  await new Promise(setImmediate);
  id('meet-search').events.focus();
  await id('meet-results').children[0].events.click();

  const replay = window.MeetReplay.buildReplay(window.MEET_REPLAY_SAMPLE);
  const anchor = replay.firstResultIndex;
  const cursor = () => Number(id('scrub').value);
  const clickPlay = () => id('play').events.click();
  const earliestTimer = () => [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
  const wake = () => {
    const [key, timer] = earliestTimer();
    timers.delete(key);
    timer.fn();
  };
  const firstGap = Date.parse(replay.steps[anchor + 1].timeStamp) - Date.parse(replay.steps[anchor].timeStamp);
  assert.ok(firstGap > 1);
  assert.equal(cursor(), anchor, id('status').textContent);
  assert.equal(id('play').textContent, 'Sync & Play');
  const firstThreeIds = [...new Set(replay.steps.slice(anchor)
    .filter(window.MeetReplay.stepRecordsResult).map(({ docId }) => docId))].slice(0, 3);
  const assertIndicators = (outlinedId, nextUpId) => {
    const { docs } = window.MeetReplay.buildStateAt(replay, cursor());
    const attempt = docs[nextUpId];
    assert.equal(id('sheet').highlight.nextAttemptId, outlinedId);
    assert.equal(id('sheet').highlight.lifterId, docs[outlinedId].lifterId);
    assert.equal(id('event').nextUp.name, docs[attempt.lifterId].name);
    assert.equal(id('event').nextUp.weight, attempt.weight);
  };
  assertIndicators(firstThreeIds[0], firstThreeIds[1]);
  const left = () => id('event').current;
  assert.equal(left().name, 'Ana Fielding');
  assert.equal(left().lights, undefined);
  clickPlay();
  assert.equal(cursor(), anchor + 1);
  assertIndicators(firstThreeIds[1], firstThreeIds[2]);
  assert.equal(id('play').textContent, 'Pause');
  assert.equal(left().name, 'Ana Fielding');
  assert.equal(left().weight, 150);
  assert.equal(left().lights, 'No judges’ lights recorded');
  now = 10_099;
  clickPlay();
  assert.equal(left().name, 'Ana Fielding');
  assert.equal(earliestTimer()[1].at, 10_100);
  now++;
  wake();
  assert.equal(left().name, 'Bea Okonkwo');
  assert.equal(left().lights, undefined);
  clickPlay();
  assert.equal(earliestTimer()[1].at, 101 + firstGap);
  now = 100 + firstGap;
  clickPlay();
  assert.equal(id('play').textContent, 'Resume');
  assert.equal(timers.size, 0);
  now += 60_000;
  clickPlay();
  assert.equal(cursor(), anchor + 1);
  assert.equal([...timers.values()][0].at, now + 1);
  now += 1;
  wake();
  assert.equal(cursor(), anchor + 2);
  // Each subsequent timer is based on the same sync clock, not the prior callback.
  const nextOffset = Date.parse(replay.steps[anchor + 2].timeStamp) - Date.parse(replay.steps[anchor].timeStamp);
  assert.ok([...timers.values()].some(({ at }) => at === 60_101 + nextOffset));
  id('prev').events.click();
  assert.equal(id('play').textContent, 'Sync & Play');
  assert.equal(timers.size, 0);

  clickPlay();
  assert.equal(cursor(), window.MeetReplay.nextResultIndex(replay, anchor + 1));
  while (timers.size) {
    now = earliestTimer()[1].at;
    wake();
  }
  assert.equal(cursor(), replay.steps.length);
  assert.equal(id('play').disabled, true);

  const scrubTo = (index) => {
    id('scrub').value = String(index);
    id('scrub').events.input();
  };
  scrubTo(anchor);
  assert.equal(id('attempt-preview').hidden, true);
  const warningIndex = replay.steps.findIndex((step, index) => index > anchor + 1
    && window.MeetReplay.stepRecordsResult(step)
    && window.MeetReplay.describeNextStep(replay, index - 1,
      window.MeetReplay.buildStateAt(replay, index - 1), 'KG')?.weightPreview);
  assert.ok(warningIndex > 0);
  scrubTo(warningIndex - 1);
  const preview = id('next-change').textContent;
  assert.ok(preview);
  assert.equal(id('attempt-preview').hidden, false);
  assert.equal(id('result-warning').hidden, true);
  id('next').events.click();
  assert.equal(id('next-change').textContent, preview);
  assert.equal(id('result-warning').hidden, false);
  assert.match(id('result-warning').textContent, /^⚠️ (Squat|Bench|Deadlift) result next$/);
  scrubTo(anchor);
  assert.equal(id('attempt-preview').hidden, true);
  assert.equal(id('result-warning').textContent, '⚠️ Squat result next');
});
