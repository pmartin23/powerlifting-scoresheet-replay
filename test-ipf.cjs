'use strict';

/* node test-ipf.cjs - checks the IPF scoring formulas and division placing. */

global.window = global;
require('./fixtures/sample-meet.js');
require('./ipf.js');
require('./records.js');
require('./replay.js');

const { ipfGlPoints, isSupported } = window.MeetIpf;
const Replay = window.MeetReplay;

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function near(label, actual, expected, tolerance) {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  actual=${actual} expected=${expected}±${tolerance}`);
}

const FULL = { squat: true, bench: true, dead: true };
const BENCH_ONLY = { squat: false, bench: true, dead: false };

// --- IPF GL points, against published scores for real record totals ---------
// Tolerance is 0.3 because published figures round body weight to 0.1 kg.

near(
  'GL: 1152.5 at 167.5 kg male raw (world record total)',
  ipfGlPoints({ total: 1152.5, bodyWeight: 167.5, gender: 'MALE', rawOrEquipped: 'RAW', lifts: FULL }),
  117.5,
  0.3,
);

near(
  'GL: 800 at 74 kg male raw',
  ipfGlPoints({ total: 800, bodyWeight: 74, gender: 'MALE', rawOrEquipped: 'RAW', lifts: FULL }),
  117.5,
  0.3,
);

near(
  'GL: 647.5 at 90 kg female raw',
  ipfGlPoints({ total: 647.5, bodyWeight: 90, gender: 'FEMALE', rawOrEquipped: 'RAW', lifts: FULL }),
  119.2,
  0.3,
);

// --- input handling --------------------------------------------------------

// Only raw full power is scored. Anything else must come back unscored
// rather than be scored against the wrong coefficients.
check('raw full power is scored', isSupported({ rawOrEquipped: 'RAW', lifts: FULL }), true);
check('unset equipment is read as raw', isSupported({ lifts: FULL }), true);
check('equipped is not scored', isSupported({ rawOrEquipped: 'EQUIPPED', lifts: FULL }), false);
check('bench only is not scored', isSupported({ rawOrEquipped: 'RAW', lifts: BENCH_ONLY }), false);
check(
  'an equipped lifter gets no points, not raw points',
  ipfGlPoints({ total: 700, bodyWeight: 93, gender: 'MALE', rawOrEquipped: 'EQUIPPED', lifts: FULL }),
  null,
);
check('missing total scores nothing', ipfGlPoints({ total: null, bodyWeight: 93, gender: 'MALE' }), null);
check('missing body weight scores nothing', ipfGlPoints({ total: 600, bodyWeight: null, gender: 'MALE' }), null);
check('missing sex scores nothing', ipfGlPoints({ total: 600, bodyWeight: 93, gender: '' }), null);

const lightest = ipfGlPoints({ total: 200, bodyWeight: 25, gender: 'MALE', rawOrEquipped: 'RAW', lifts: FULL });
check('body weight below the published floor still scores', typeof lightest === 'number' && lightest > 0, true);

// --- the sample meet: two declared divisions, two sets of places -----------

const replay = Replay.buildReplay(window.MEET_REPLAY_SAMPLE);
const sheet = Replay.buildSheet(Replay.buildStateAt(replay, replay.steps.length), replay);

// The sample's Best Lifter division asks for the superseded 2019 formula;
// it is scored on GL points instead, since that is the only one implemented.
check('meet is recognised as points-scored', sheet.pointsKind, 'IPF_GL_POINTS');

const byName = {};
for (const row of sheet.rows) byName[row.name] = row;

check('every lifter has two placings', sheet.rows.map((row) => row.placings.length), [2, 2, 2]);
check(
  'the weight class is still the primary placing',
  sheet.rows.map((row) => row.weightClassName),
  ['83', '93', '93'],
);

// Ana: 460 at 82.4 kg. Bea: 515 at 90.1 kg. Both win their weight class on
// total, so Best Lifter is decided on points instead.
near('Ana GL points', byName['Ana Fielding'].points, 63.91, 0.1);
near('Bea GL points', byName['Bea Okonkwo'].points, 68.43, 0.1);
check('Cal has no points without a total', byName['Cal Mendoza'].points, null);

const best = sheet.standings.find((group) => group.scoreBy === 'IPF_GL_POINTS');
check('Best Lifter standings exist', Boolean(best), true);
check('Best Lifter is one group, not split by weight class', best.weightClassName, 'All');
check(
  'Best Lifter ranks on points, so Bea wins',
  best.entries.map((entry) => [entry.row.name, entry.placing.place]),
  [['Bea Okonkwo', 1], ['Ana Fielding', 2], ['Cal Mendoza', null]],
);
check('Cal has no projected place after missing all deadlifts',
  best.entries[2].placing.projectedPlace, null);

// Before anyone has a total, the standings show projected places only.
const midway = Replay.buildSheet(Replay.buildStateAt(replay, replay.firstResultIndex), replay);
check(
  'no points before anyone has a total',
  midway.rows.every((row) => row.points === null),
  true,
);
// Standings appear as soon as the openers are declared, carrying projected
// places only - the real places stay blank until someone has a total.
const bestLifter = midway.standings.find((group) => group.scoreBy === 'IPF_GL_POINTS');
check('a Best Lifter board exists from the openers', Boolean(bestLifter), true);
check(
  'with no real places yet',
  bestLifter.entries.every((entry) => entry.placing.place === null),
  true,
);
check(
  'but a projected order',
  bestLifter.entries.map((entry) => entry.placing.projectedPlace).sort(),
  [1, 2, 3],
);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
