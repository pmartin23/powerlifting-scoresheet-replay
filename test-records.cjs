'use strict';

/*
 * node test-records.cjs
 *
 * Checks percent-of-record scoring, the format used at the Sheffield
 * Championships: lifters weigh in at whatever class they like and the winner
 * is whoever totals the highest percentage of the world record for the class
 * they landed in.
 *
 * The record table and document shapes below are copied from a real Sheffield
 * export, so this also guards against the export's nesting changing.
 */

global.window = global;
require('./ipf.js');
require('./records.js');
require('./replay.js');

const Replay = window.MeetReplay;
const Records = window.MeetRecords;

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// --- the record table, exactly as a Sheffield export nests it --------------

function fullPower(squat, bench, dead, total) {
  return { FP: { S: { W: squat }, B: { W: bench }, D: { W: dead }, T: { W: total } } };
}

const RECORD_TABLE = {
  MALE: {
    RAW: {
      T: {
        O: {
          59: fullPower(240.5, 171, 303, 669.5),
          66: fullPower(275.5, 213.5, 324.5, 782),
          74: fullPower(341, 216, 344, 891.5),
          83: fullPower(338, 219, 383, 890),
          93: fullPower(356, 246, 380, 927.5),
          105: fullPower(393, 251, 400, 980),
          120: fullPower(393, 265.5, 401.5, 1000),
          '120+': fullPower(478, 291.5, 411, 1152.5),
        },
      },
    },
  },
  FEMALE: {
    RAW: {
      T: {
        O: {
          47: fullPower(170.5, 107.5, 212.5, 453),
          52: fullPower(182.5, 114, 220.5, 486.5),
          57: fullPower(200, 123, 238, 530.5),
          63: fullPower(214, 143.5, 241.5, 582.5),
          69: fullPower(227, 158, 260, 628),
          76: fullPower(238, 155.5, 263, 628.5),
          84: fullPower(250.5, 156, 270, 648),
          '84+': fullPower(318.5, 167, 292.5, 756.5),
        },
      },
    },
  },
};

const MALE_CLASSES = Object.keys(RECORD_TABLE.MALE.RAW.T.O);
const FEMALE_CLASSES = Object.keys(RECORD_TABLE.FEMALE.RAW.T.O);

// --- weight class derivation ----------------------------------------------
// The division declares a single "All" class, so the real class has to come
// from body weight against the limits the record table itself lists.

check('exactly on a class limit stays in that class', Records.weightClassFor(MALE_CLASSES, 93), '93');
check('a gram over moves up a class', Records.weightClassFor(MALE_CLASSES, 93.01), '105');
check('lightest class', Records.weightClassFor(MALE_CLASSES, 58.4), '59');
check('over every limit lands in the unlimited class', Records.weightClassFor(MALE_CLASSES, 167.5), '120+');
check('women have their own limits', Records.weightClassFor(FEMALE_CLASSES, 83.9), '84');
check('women over the top limit', Records.weightClassFor(FEMALE_CLASSES, 110), '84+');

// --- record lookup ---------------------------------------------------------

check(
  'mens unlimited raw open record total',
  Records.lookupRecord(RECORD_TABLE, { gender: 'MALE', bodyWeight: 167.5, divisionCode: 'O' }),
  { weight: 1152.5, weightClassName: '120+' },
);

check(
  'womens 76 kg record total',
  Records.lookupRecord(RECORD_TABLE, { gender: 'FEMALE', bodyWeight: 71.2, divisionCode: 'O' }).weight,
  628.5,
);

check(
  'a sex the table does not cover scores nothing, rather than wrongly',
  Records.lookupRecord(RECORD_TABLE, { gender: 'OTHER', bodyWeight: 93, divisionCode: 'O' }),
  null,
);

// --- percentages -----------------------------------------------------------

const shared = { records: RECORD_TABLE, rawOrEquipped: 'RAW', divisionCode: 'O', lifts: { squat: true, bench: true, dead: true } };

check(
  'equalling the record is 100 per cent',
  Records.percentOfRecord({ ...shared, gender: 'MALE', bodyWeight: 92.5, total: 927.5 }).value,
  100,
);
check(
  'beating the record goes over 100',
  Records.percentOfRecord({ ...shared, gender: 'MALE', bodyWeight: 92.5, total: 950 }).value,
  102.43,
);
check(
  'a womens percentage',
  Records.percentOfRecord({ ...shared, gender: 'FEMALE', bodyWeight: 62.4, total: 525 }).value,
  90.13,
);
check(
  'no total, no percentage',
  Records.percentOfRecord({ ...shared, gender: 'MALE', bodyWeight: 92.5, total: null }).value,
  null,
);
check(
  'an equipped lifter is not scored against raw records',
  Records.percentOfRecord({
    ...shared, gender: 'MALE', bodyWeight: 92.5, total: 927.5, rawOrEquipped: 'EQUIPPED',
  }).value,
  null,
);
check(
  'a bench-only division is not scored against full-power records',
  Records.percentOfRecord({
    ...shared, gender: 'MALE', bodyWeight: 92.5, total: 927.5, lifts: { squat: false, bench: true, dead: false },
  }).value,
  null,
);
check(
  'no body weight, no percentage - nobody has weighed in yet',
  Records.percentOfRecord({ ...shared, gender: 'MALE', bodyWeight: null, total: 900 }).value,
  null,
);

// --- a whole meet in Sheffield's shape ------------------------------------

function buildSheffieldExport() {
  const docs = [
    { _id: '_design/write_access', _rev: '1-x', validate_doc_update: 'function () {}' },
    { _id: 'crecords', _rev: '3-x', data: RECORD_TABLE, createDate: '2026-11-11T10:38:41-06:00' },
    {
      _id: 'm-sheffield',
      _rev: '10-x',
      name: 'Sheffield V Powerlifting Championships',
      date: '11/21/2026',
      units: 'KG',
      federation: 'IPF',
      plates: { plate_25: { pairsCount: 12, weight: 25, color: '#88262D' } },
      changes: [],
      createDate: '2026-07-03T11:02:04-05:00',
    },
    // One division per sex, both with a single "All" class, both scored on
    // percentage of record. This is what makes Sheffield Sheffield.
    {
      _id: 'd-men',
      _rev: '6-x',
      name: 'Men',
      gender: 'MALE',
      rawOrEquipped: 'RAW',
      usaplDivisionCode: 'O',
      lifts: { squat: true, bench: true, dead: true },
      scoreBy: 'PERCENT_OF_RECORD',
      weightClasses: { 'w-men-all': { name: 'All', maxWeight: 9999, _id: 'w-men-all' } },
      changes: [],
      createDate: '2026-11-11T10:33:21-06:00',
    },
    {
      _id: 'd-women',
      _rev: '7-x',
      name: 'Women',
      gender: 'FEMALE',
      rawOrEquipped: 'RAW',
      usaplDivisionCode: 'O',
      lifts: { squat: true, bench: true, dead: true },
      scoreBy: 'PERCENT_OF_RECORD',
      weightClasses: { 'w-women-all': { name: 'All', maxWeight: 9999, _id: 'w-women-all' } },
      changes: [],
      createDate: '2026-11-11T10:33:24-06:00',
    },
  ];

  let clock = 0;
  function nextTime() {
    clock += 60;
    return new Date(Date.UTC(2026, 10, 21, 10, 0, clock)).toISOString().replace('.000', '');
  }

  function lifter(id, name, gender, bodyWeight, lifts) {
    const divisionId = gender === 'MALE' ? 'd-men' : 'd-women';
    const weightClassId = gender === 'MALE' ? 'w-men-all' : 'w-women-all';
    docs.push({
      _id: id,
      _rev: '2-x',
      name,
      team: '',
      gender,
      session: 1,
      flight: gender === 'MALE' ? 'B' : 'A',
      country: 'GB',
      divisions: [{ rawOrEquipped: 'RAW', divisionId, declaredAwardsWeightClassId: weightClassId }],
      wasDrugTested: 'N',
      changes: [{ rev: '2-bw', attribute: 'bodyWeight', value: bodyWeight, timeStamp: nextTime() }],
      createDate: '2026-11-11T10:45:53-06:00',
      bodyWeight,
    });

    for (const liftName of ['squat', 'bench', 'dead']) {
      lifts[liftName].forEach((attempt, index) => {
        const attemptNumber = String(index + 1);
        const changes = [
          { rev: `1-${id}${liftName}${attemptNumber}`, attribute: 'weight', value: attempt[0], timeStamp: nextTime() },
          { rev: `2-${id}${liftName}${attemptNumber}`, attribute: 'result', value: attempt[1], timeStamp: nextTime() },
        ];
        docs.push({
          _id: `a${attemptNumber}${liftName[0]}-${id}`,
          _rev: '3-x',
          liftName,
          attemptNumber,
          lifterId: id,
          weight: attempt[0],
          result: attempt[1],
          changes,
          createDate: '2026-11-11T10:45:53-06:00',
        });
      });
    }
  }

  // A heavyweight man with a big absolute total, and a lighter man with a
  // smaller total that is a greater share of his own class record. The point
  // of the format is that the lighter lifter can win.
  lifter('l-heavy', 'Heavyweight Entrant', 'MALE', 167.5, {
    squat: [[420, 'good'], [450, 'good'], [470, 'bad']],
    bench: [[260, 'good'], [275, 'bad'], [275, 'bad']],
    dead: [[370, 'good'], [390, 'good'], [400, 'bad']],
  });
  lifter('l-light', 'Lightweight Entrant', 'MALE', 73.4, {
    squat: [[320, 'good'], [335, 'good'], [345, 'bad']],
    bench: [[200, 'good'], [210, 'good'], [218, 'bad']],
    dead: [[320, 'good'], [335, 'good'], [345, 'bad']],
  });
  lifter('l-woman', 'Womens Entrant', 'FEMALE', 62.4, {
    squat: [[195, 'good'], [205, 'good'], [212, 'bad']],
    bench: [[125, 'good'], [132, 'good'], [138, 'bad']],
    dead: [[200, 'good'], [210, 'good'], [218, 'bad']],
  });
  // Bombs out on bench, so has no total and cannot be ranked.
  lifter('l-bomb', 'No Total Entrant', 'MALE', 82.1, {
    squat: [[300, 'good'], [310, 'good'], [320, 'bad']],
    bench: [[200, 'bad'], [200, 'bad'], [202, 'bad']],
    dead: [[300, 'good'], [310, 'good'], [320, 'bad']],
  });

  return { total_rows: docs.length, offset: 0, rows: docs.map((doc) => ({ id: doc._id, key: doc._id, value: { rev: doc._rev }, doc })) };
}

const replay = Replay.buildReplay(buildSheffieldExport());
const sheet = Replay.buildSheet(Replay.buildStateAt(replay, replay.steps.length), replay);
const byName = {};
for (const row of sheet.rows) byName[row.name] = row;

check('the record table is recognised', Boolean(sheet.records), true);
check('the meet is scored on percentage of record', sheet.pointsKind, 'PERCENT_OF_RECORD');

// 450 + 260 + 390 = 1100 of the 1152.5 unlimited record.
check('heavyweight total', byName['Heavyweight Entrant'].total, 1100);
check('heavyweight percentage', byName['Heavyweight Entrant'].points, 95.44);
check('heavyweight real class derived from body weight', byName['Heavyweight Entrant'].recordWeightClassName, '120+');

// 335 + 210 + 335 = 880 of the 891.5 record for the 74 kg class.
check('lightweight total', byName['Lightweight Entrant'].total, 880);
check('lightweight percentage', byName['Lightweight Entrant'].points, 98.71);
check('lightweight real class', byName['Lightweight Entrant'].recordWeightClassName, '74');

check('bombed lifter has no total', byName['No Total Entrant'].total, null);
check('bombed lifter has no percentage', byName['No Total Entrant'].points, null);

// The whole point: the smaller total wins.
const mens = sheet.standings.find((group) => group.divisionName === 'Men');
check(
  'the lighter lifter wins despite the smaller total',
  mens.entries.map((entry) => [entry.row.name, entry.placing.place]),
  [['Lightweight Entrant', 1], ['Heavyweight Entrant', 2], ['No Total Entrant', null]],
);
check('one winner per sex, not per class', sheet.standings.length, 2);

const womens = sheet.standings.find((group) => group.divisionName === 'Women');
check('womens winner', womens.entries[0].row.name, 'Womens Entrant');
check('womens total', byName['Womens Entrant'].total, 547);
check('womens percentage', byName['Womens Entrant'].points, 93.91);

// Before weigh-in nobody has a body weight, so nobody can be scored.
const start = Replay.buildSheet(Replay.buildStateAt(replay, 0), replay);
check('no body weights in the baseline', start.rows.every((row) => row.bodyWeight === null), true);
check('no percentages in the baseline', start.rows.every((row) => row.points === null), true);
check('record table survives into the baseline, being no spoiler', Boolean(start.records), true);

// Projected place works off percentage of record too, so a lifter can be
// behind on the board and ahead on paper.
check(
  'projected places rank on projected percentage',
  mens.entries.map((entry) => [entry.row.name, entry.placing.projectedPlace]),
  [['Lightweight Entrant', 1], ['Heavyweight Entrant', 2], ['No Total Entrant', null]],
);
check(
  'the bombed lifter has no projected percentage either',
  byName['No Total Entrant'].projectedPoints,
  null,
);
check(
  'the projected percentage is on the row, ready to render',
  mens.entries.map((entry) => [entry.row.name, entry.row.projectedPoints]),
  mens.entries.map((entry) => [entry.row.name, entry.placing.projectedValue]),
);
check(
  'a finished lifter projects their actual percentage',
  byName['Womens Entrant'].projectedPoints,
  byName['Womens Entrant'].points,
);

// The record table is shown under the standings, so it has to come out of the
// document in display order: one block per sex, lightest class first.
const blocks = Records.recordTotals(RECORD_TABLE, ['O']);
check('one block per sex', blocks.map((block) => block.label), ['Men', 'Women']);
check(
  'classes come out lightest first, unlimited last',
  blocks[0].classes.map((weightClass) => weightClass.name),
  ['59', '66', '74', '83', '93', '105', '120', '120+'],
);
check('record totals come through', blocks[0].classes[7].total, 1152.5);
check(
  'so do the individual lifts',
  [blocks[0].classes[7].squat, blocks[0].classes[7].bench, blocks[0].classes[7].dead],
  [478, 291.5, 411],
);
check('women read from their own table', blocks[1].classes[0].total, 453);
check('a table with nothing in it gives nothing', Records.recordTotals(null, ['O']).length, 0);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
