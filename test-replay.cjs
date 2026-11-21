'use strict';

global.window = global;
require('./fixtures/sample-meet.js');
require('./ipf.js');
require('./records.js');
require('./replay.js');

const R = global.MeetReplay;
const replay = R.buildReplay(global.MEET_REPLAY_SAMPLE);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

console.log(`steps=${replay.steps.length} firstResultIndex=${replay.firstResultIndex}`);

// --- ordering: every step is non-decreasing in time
let ordered = true;
for (let i = 1; i < replay.steps.length; i++) {
  if ((replay.steps[i - 1].timeStamp || '') > (replay.steps[i].timeStamp || '')) ordered = false;
}
check('steps are in timestamp order', ordered, true);

// --- baseline hides results but keeps registration data
const start = R.buildStateAt(replay, 0);
const startSheet = R.buildSheet(start, replay);
check('baseline has 3 lifters', startSheet.rows.length, 3);
check('baseline hides every result', startSheet.rows.every((r) =>
  R.LIFT_ORDER.every((l) => r.lifts[l].every((a) => a === null || (a.weight === null && a.result === null)))), true);
check('baseline hides body weight', startSheet.rows.every((r) => r.bodyWeight === null), true);
check('baseline keeps lifter names', startSheet.rows.map((r) => r.name), ['Ana Fielding', 'Bea Okonkwo', 'Cal Mendoza']);
check('baseline keeps weight classes', startSheet.rows.map((r) => r.weightClassName), ['83', '93', '93']);

// --- default start: declarations applied, no results
const atFirstResult = R.buildStateAt(replay, replay.firstResultIndex);
const firstSheet = R.buildSheet(atFirstResult, replay);
check('at first result: body weights known', firstSheet.rows.map((r) => r.bodyWeight), [82.4, 90.1, 92.8]);
check('at first result: squat 1 weights known', firstSheet.rows.map((r) => r.lifts.squat[0].weight), [150, 170, 180]);
check('at first result: no results yet', firstSheet.rows.every((r) =>
  R.LIFT_ORDER.every((l) => r.lifts[l].every((a) => a.result === null))), true);
check('at first result: no totals', firstSheet.rows.map((r) => r.total), [null, null, null]);

// --- final state
const end = R.buildStateAt(replay, replay.steps.length);
const endSheet = R.buildSheet(end, replay);
const byName = {};
for (const row of endSheet.rows) byName[row.name] = row;

check('Ana best lifts', R.LIFT_ORDER.map((l) => byName['Ana Fielding'].best[l]), [167.5, 100, 192.5]);
check('Ana total', byName['Ana Fielding'].total, 460);
check('Bea best lifts', R.LIFT_ORDER.map((l) => byName['Bea Okonkwo'].best[l]), [180, 112.5, 222.5]);
check('Bea total', byName['Bea Okonkwo'].total, 515);
check('Cal bombed deadlift, no total', byName['Cal Mendoza'].total, null);
check('Cal unplaced', byName['Cal Mendoza'].place, null);
check('Ana placed in 83', byName['Ana Fielding'].place, 1);
check('Bea placed in 93', byName['Bea Okonkwo'].place, 1);

// --- jury reversal: Ana squat 2 ends good, and was cleared mid-way
check('Ana squat 2 final result', byName['Ana Fielding'].lifts.squat[1].result, 'good');
const clearIndex = replay.steps.findIndex((s) =>
  s.docId === 'a2s-l-ana' && s.entries.some((e) => e.path[0] === 'result' && e.value === null));
check('jury clear exists as a step', clearIndex > -1, true);
const duringClear = R.buildSheet(R.buildStateAt(replay, clearIndex + 1), replay);
check('mid-jury, squat 2 shows no result', duringClear.rows.find((r) => r.name === 'Ana Fielding').lifts.squat[1].result, null);

// --- re-declared weight replays in order
const beaDead2 = replay.steps.filter((s) => s.docId === 'a2d-l-bea');
check('Bea deadlift 2 has 3 revisions', beaDead2.length, 3);
check('Bea deadlift 2 final weight', byName['Bea Okonkwo'].lifts.dead[1].weight, 212.5);
const afterFirstDecl = R.buildSheet(R.buildStateAt(replay, beaDead2[0].index + 1), replay);
check('Bea deadlift 2 first declared 215', afterFirstDecl.rows.find((r) => r.name === 'Bea Okonkwo').lifts.dead[1].weight, 215);

// --- stepping helpers
let cursor = replay.firstResultIndex;
let resultSteps = 0;
while (cursor < replay.steps.length) {
  const next = R.nextResultIndex(replay, cursor);
  if (next <= cursor) break;
  cursor = next;
  resultSteps++;
}
check('next-result walks to the end', cursor, replay.steps.length);
console.log(`next-result stops: ${resultSteps}`);
check('previous-result reverses', R.previousResultIndex(replay, replay.steps.length) < replay.steps.length, true);

// --- describeStep does not throw and names the lifter
const lastDesc = R.describeStep(replay.steps[replay.steps.length - 1], replay, end);
console.log('last event:', JSON.stringify(lastDesc));

// --- projected total -------------------------------------------------------
// The projection assumes every attempt still standing is made: per lift, the
// best good attempt so far or a heavier declared attempt still to come.

const finalRows = byName;

check('once lifting is over, projection equals the total', finalRows['Ana Fielding'].projectedTotal, 460);
check(
  'a lifter who bombed a lift has no projection either',
  finalRows['Cal Mendoza'].projectedTotal,
  null,
);

// Openers for all three lifts are declared at weigh-in, so from the very
// first result there is a projection: nothing has been judged, so it is just
// the sum of Ana's openers, 150 + 95 + 180.
const openingSheet = R.buildSheet(R.buildStateAt(replay, replay.firstResultIndex), replay);
const openingAna = openingSheet.rows.find((row) => row.name === 'Ana Fielding');
check('no total at the first result', openingAna.total, null);
check('but a projection from the openers', openingAna.projectedTotal, 425);
check(
  'every lifter has a projection from the start',
  openingSheet.rows.map((row) => row.projectedTotal),
  [425, 475, 520],
);

// Mid-meet, the projection earns its keep: Ana has 167.5 squat, 100 bench and
// a good 180 deadlift, so her total stands at 447.5. Her deadlift 2 at 192.5
// is declared but not yet judged, so the projection reads 460.
const deadliftTwo = replay.steps.findIndex((step) => step.docId === 'a2d-l-ana'
  && step.entries.some((entry) => entry.path[0] === 'result'));
const midSheet = R.buildSheet(R.buildStateAt(replay, deadliftTwo), replay);
const midAna = midSheet.rows.find((row) => row.name === 'Ana Fielding');
check('mid-meet total counts only good lifts', midAna.total, 447.5);
check('mid-meet projection counts the declared deadlift', midAna.projectedTotal, 460);

// --- projected place -------------------------------------------------------
// Where each lifter would finish if everyone makes the attempt they have
// loaded. The useful case is a lifter who is behind now but ahead on paper.

check('final projected place matches final place', [
  finalRows['Ana Fielding'].projectedPlace,
  finalRows['Bea Okonkwo'].projectedPlace,
  finalRows['Cal Mendoza'].projectedPlace,
], [1, 1, null]);

// Bea and Cal share the 93 kg class. At the first result nobody has lifted,
// so places are blank, but the openers already project an order: Cal's 520
// beats Bea's 475.
check('no real places before anyone has a total', openingSheet.rows.map((row) => row.place), [null, null, null]);
check(
  'but the openers project an order within the weight class',
  openingSheet.rows.map((row) => [row.name, row.weightClassName, row.projectedPlace]),
  [['Ana Fielding', '83', 1], ['Bea Okonkwo', '93', 2], ['Cal Mendoza', '93', 1]],
);

// By the final deadlift Cal has missed everything, so his projection is gone
// and Bea takes the class back.
check('a bombed lifter has no projected place', finalRows['Cal Mendoza'].projectedPlace, null);
check('so Bea is projected to win the class', finalRows['Bea Okonkwo'].projectedPlace, 1);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
