'use strict';

// Real documents lifted from the Novocastrian Classic export, to exercise the
// shapes the synthetic fixture does not have: a nested array attribute path,
// _conflicts, and the jury override fields.

global.window = global;
require('./ipf.js');
require('./records.js');
require('./replay.js');
const R = global.MeetReplay;

const real = {
  total_rows: 4,
  offset: 0,
  rows: [
    { id: '_design/write_access', key: '_design/write_access', value: { rev: '1-x' }, doc: { _id: '_design/write_access', _rev: '1-x', validate_doc_update: 'function(){}' } },
    { id: 'lytt6vx4oui7', key: 'lytt6vx4oui7', value: { rev: '7-x' }, doc: {
      _id: 'lytt6vx4oui7', _rev: '7-x', name: 'Amelia Crawford', team: 'NSW', lot: 2, session: 1, flight: 'A',
      birthDate: '30/10/2007', country: 'AU', gender: 'FEMALE',
      divisions: [
        { rawOrEquipped: 'RAW', divisionId: 'dm7bdh1mis3j', declaredAwardsWeightClassId: 'w-8' },
        { rawOrEquipped: 'RAW', divisionId: 'dlvytaiebhxt', declaredAwardsWeightClassId: 'w-58' },
      ],
      squatRackHeight: '13', wasDrugTested: 'N',
      changes: [
        { rev: '1-a', attribute: 'platformId', value: 'pvshui6yo8bz', timeStamp: '2026-11-12T03:56:23Z' },
        { rev: '2-b', attribute: ['divisions', 0, 'declaredAwardsWeightClassId'], value: 'w-8', timeStamp: '2026-11-14T21:13:37Z' },
        { rev: '3-c', attribute: 'bodyWeight', value: 85.2, timeStamp: '2026-11-14T21:34:39Z' },
        { rev: '4-d', attribute: 'squatRackHeight', value: '13', timeStamp: '2026-11-14T22:00:14Z' },
      ],
      createDate: '2026-11-12T14:55:53+11:00', platformId: 'pvshui6yo8bz', bodyWeight: 85.2,
    } },
    { id: 'dm7bdh1mis3j', key: 'dm7bdh1mis3j', value: { rev: '1-x' }, doc: {
      _id: 'dm7bdh1mis3j', _rev: '1-x', name: 'Classic Junior Women', gender: 'FEMALE', rawOrEquipped: 'RAW',
      lifts: { squat: true, bench: true, dead: true }, scoreBy: 'TOTAL',
      weightClasses: { 'w-8': { _id: 'w-8', name: '84+', maxWeight: 9999 } },
      usaplDivisionCode: 'J', hideOnBoard: false, schema: 1, changes: [], createDate: '2026-11-02T16:45:12+11:00',
    } },
    { id: 'a1s-lytt6vx4oui7', key: 'a1s-lytt6vx4oui7', value: { rev: '5-x' }, doc: {
      _id: 'a1s-lytt6vx4oui7', _rev: '5-x', liftName: 'squat', attemptNumber: '1', lifterId: 'lytt6vx4oui7',
      changes: [
        { rev: '1-a', attribute: 'weight', value: 100, timeStamp: '2026-11-14T21:35:53Z' },
        { rev: '2-b', attribute: 'result', value: 'good', timeStamp: '2026-11-14T23:00:49Z' },
        { rev: '2-b', attribute: 'decisions', value: { left: { decision: 'good', cards: {} }, head: { decision: 'good', cards: {} }, right: { decision: 'bad', cards: { red: true } } }, timeStamp: '2026-11-14T23:00:49Z' },
        { rev: '3-c', attribute: 'result', value: null, timeStamp: '2026-11-14T23:01:22Z' },
        { rev: '3-c', attribute: 'decisions', value: null, timeStamp: '2026-11-14T23:01:22Z' },
        { rev: '3-c', attribute: 'juryOverride', value: null, timeStamp: '2026-11-14T23:01:22Z' },
        { rev: '3-c', attribute: 'juryOverturnCard', value: null, timeStamp: '2026-11-14T23:01:22Z' },
        { rev: '3-c', attribute: 'preJuryOverturnDecisions', value: null, timeStamp: '2026-11-14T23:01:22Z' },
        { rev: '4-d', attribute: 'result', value: 'good', timeStamp: '2026-11-14T23:02:45Z' },
      ],
      createDate: '2026-11-12T14:55:53+11:00', weight: 100, result: 'good',
      decisions: null, juryOverride: null, juryOverturnCard: null, preJuryOverturnDecisions: null,
      _conflicts: ['5-7402fdbc8d59dc4f2a5a43c06266ca17'],
    } },
  ],
};

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const replay = R.buildReplay(real);
console.log(`steps=${replay.steps.length} firstResultIndex=${replay.firstResultIndex}`);

check('design doc skipped', Object.keys(replay.baseline).includes('_design/write_access'), false);
// 4 lifter revisions + 4 attempt revisions, grouped per document
check('revisions grouped (13 changes -> 8 steps)', replay.steps.length, 8);

// the multi-attribute jury clear must be one atomic step
const clear = replay.steps.find((s) => s.docId === 'a1s-lytt6vx4oui7' && s.rev === '3-c');
check('jury clear is one step with 5 entries', clear.entries.length, 5);

const baselineLifter = replay.baseline.lytt6vx4oui7;
check('nested path stripped from baseline', baselineLifter.divisions[0].declaredAwardsWeightClassId, undefined);
check('untouched sibling division survives', baselineLifter.divisions[1].declaredAwardsWeightClassId, 'w-58');
check('_conflicts dropped', replay.baseline['a1s-lytt6vx4oui7']._conflicts, undefined);
check('result stripped from baseline', replay.baseline['a1s-lytt6vx4oui7'].result, undefined);

// replay the nested path back in
const afterNested = R.buildSheet(R.buildStateAt(replay, 2), replay);
check('nested path replays', afterNested.rows[0].weightClassName, '84+');

const end = R.buildStateAt(replay, replay.steps.length);
const endSheet = R.buildSheet(end, replay);
check('final squat 1', [endSheet.rows[0].lifts.squat[0].weight, endSheet.rows[0].lifts.squat[0].result], [100, 'good']);
check('best squat', endSheet.rows[0].best.squat, 100);
check('no total (bench/dead missing)', endSheet.rows[0].total, null);

for (const step of replay.steps) {
  const desc = R.describeStep(step, replay, R.buildStateAt(replay, step.index + 1));
  console.log(`  ${desc.timeStamp}  ${desc.subject}  |  ${desc.detail}`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
