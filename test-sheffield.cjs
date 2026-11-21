'use strict';

// The Sheffield-format fixture, checked end to end: percent-of-record scoring,
// classes derived from body weight, and a lead that changes on the last lift.

global.window = global;
require('./ipf.js');
require('./records.js');
require('./liftingcast.js');
require('./replay.js');
require('./fixtures/sheffield-meet.js');
const R = global.MeetReplay;

let failures = 0;
function check(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failures++;
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label}  actual=${JSON.stringify(actual)}${same ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

const replay = R.buildReplay(global.MEET_REPLAY_SHEFFIELD);
const sheet = R.buildSheet(R.buildStateAt(replay, replay.steps.length), replay);
const byName = {};
for (const row of sheet.rows) byName[row.name] = row;

check('the meet is scored on percent of record', sheet.pointsKind, 'PERCENT_OF_RECORD');
check('the record table comes through', Boolean(sheet.records), true);
check('eight lifters', sheet.rows.length, 8);

// Nobody declares a class, so every class here was worked out at the scale.
check(
  'classes are derived from body weight',
  sheet.rows.map((row) => [row.bodyWeight, row.recordWeightClassName]),
  [[73.4, '74'], [82.6, '83'], [92.1, '93'], [104.2, '105'],
    [51.2, '52'], [62.4, '63'], [68.5, '69'], [82.9, '84']],
);

check('a total scores as a percentage', byName['Niko Volkov'].total, 872.5);
check('against the record for that class', byName['Niko Volkov'].recordWeight, 890);
check('giving the percentage', byName['Niko Volkov'].points, 98.03);

// A total over the record for the class a lifter weighed into goes past 100.
check('beating the record reads over 100%', byName['Hanna Virtanen'].points, 100.69);

function leader(divisionName, state) {
  const board = R.buildSheet(state, replay).standings
    .find((group) => group.divisionName === divisionName);
  const entry = board && board.entries.find((item) => item.placing.place === 1);
  return entry ? entry.row.name : null;
}

check('the men are won on the last attempt of the meet',
  leader('Men', R.buildStateAt(replay, replay.steps.length)), 'Dmitri Sawicki');
// The final result and judges' lights are one step.
check('and somebody else led right up until it',
  leader('Men', R.buildStateAt(replay, replay.steps.length - 1)), 'Niko Volkov');
check('the women are won by the lifter who beat the record',
  leader('Women', R.buildStateAt(replay, replay.steps.length)), 'Hanna Virtanen');

// Before the scale nothing can be scored, which is what keeps the baseline
// spoiler-free even though the record table is sitting right there.
const start = R.buildSheet(R.buildStateAt(replay, 0), replay);
check('no body weights before weigh-in', start.rows.every((row) => row.bodyWeight === null), true);
check('so no percentages either', start.rows.every((row) => row.points === null), true);
check('and no derived classes', start.rows.every((row) => row.recordWeightClassName === ''), true);

// A minimal document double lets this test check actual cell output in Node.
global.document = { createElement() {
  const node = { children: [], className: '', title: '', textContent: '',
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
  };
  node.classList = { add(name) { node.className += ` ${name}`; } };
  return node;
} };
require('./render.js');
const nextUpBar = document.createElement('div');
global.MeetRender.renderEvent(nextUpBar, { name: 'Current lifter', weight: 100, units: 'KG', lights: '⚪️ — 🔴' },
  { name: 'Paige Martin', weight: 105, units: 'KG' });
check('left toolbar shows only the lifter, weight and lights',
  nextUpBar.children[0].children.map((node) => node.textContent), ['Current lifter 100kg', '⚪️ — 🔴']);
check('right toolbar still shows the next lifter and entered weight',
  nextUpBar.children[1].textContent, 'Next up: Paige Martin 105kg');
global.MeetRender.renderEvent(nextUpBar, null, { name: 'Paige Martin', weight: null, units: 'KG' });
check('Next up still shows the lifter before the weight is known',
  nextUpBar.children.at(-1).textContent, 'Next up: Paige Martin');
global.MeetRender.renderEvent(nextUpBar, null, null);
check('the toolbar is empty when no attempt is pending or held', nextUpBar.children.length, 0);
const groupedSheet = { ...sheet, rows: sheet.rows.slice(0, 5).map((row, index) => ({
  ...row,
  name: `Lifter ${index + 1}`,
  session: index === 1 ? 2 : 1,
  flight: ['B', 'A', 'A', 'B', ''][index],
})) };
const groupedContainer = document.createElement('div');
function renderedFlights(activeLifterId) {
  global.MeetRender.renderSheet(groupedContainer, { ...groupedSheet, activeLifterId }, {});
  return groupedContainer.children[0].children.slice(1).map((body) => [
    body.children[0].children[0].textContent,
    ...body.children.slice(1).map((row) => row.children[0].textContent),
  ]);
}
const defaultFlights = [
  ['Session 1 · Flight A', 'Lifter 3'],
  ['Session 1 · Flight B', 'Lifter 1', 'Lifter 4'],
  ['Session 1 · Unassigned flight', 'Lifter 5'],
  ['Session 2 · Flight A', 'Lifter 2'],
];
check('before results the flights are in session order', renderedFlights(start.activeLifterId), defaultFlights);
const columnHead = groupedContainer.children[0].children[0].children[0];
check('the table starts with column headings and puts lot next to body weight',
  columnHead.children.slice(0, 5).map((cell) => cell.textContent),
  ['Lifter', 'Division', 'Class', 'BWt', 'Lot']);
check('the active flight and all its lifters move up', renderedFlights(groupedSheet.rows[0].lifterId),
  [defaultFlights[1], defaultFlights[0], defaultFlights[2], defaultFlights[3]]);
check('the active flight is identified by session as well as label', renderedFlights(groupedSheet.rows[1].lifterId),
  [defaultFlights[3], ...defaultFlights.slice(0, 3)]);
check('rewinding before results restores default order', renderedFlights(start.activeLifterId), defaultFlights);
function renderedLifterRow(sheetAtStep, name) {
  const container = document.createElement('div');
  global.MeetRender.renderSheet(container, sheetAtStep, {});
  return container.children[0].children.slice(1).flatMap((group) => group.children.slice(1))
    .find((tr) => tr.children[0]?.textContent === name);
}
function attemptCell(sheetAtStep, name, lift, attemptNumber) {
  const cellIndex = 5 + R.LIFT_ORDER.indexOf(lift) * 3 + attemptNumber - 1;
  return renderedLifterRow(sheetAtStep, name).children[cellIndex];
}
const tomasRow = renderedLifterRow(sheet, 'Tomas Herrera');
check('the lifter row shows its lot number after body weight',
  tomasRow.children.slice(3, 5).map((cell) => cell.textContent), ['73.4', '1']);
const detailsCell = tomasRow.children[0];
const lifterTooltip = (cell) => cell.children.find((child) => child.role === 'tooltip');
check('lifter tooltip shows age at meet and rack settings without revealing birth date',
  lifterTooltip(detailsCell)?.textContent, 'Age: 30\nBody weight: 73.4 kg\nCountry: ES\nSquat rack height: 14IN\nBench rack height: 12/5');
check('lifter tooltip is available from the keyboard', detailsCell.tabIndex, 0);
check('body weight and rack heights do not appear before they are entered',
  lifterTooltip(renderedLifterRow(start, 'Tomas Herrera').children[0])?.textContent, 'Age: 30\nCountry: ES');
check('a missing birth date or rack setting is omitted',
  lifterTooltip(renderedLifterRow(sheet, 'Niko Volkov').children[0])?.textContent, 'Body weight: 82.6 kg\nCountry: FI');
const lifterName = 'Niko Volkov';
const pending = replay.steps.findIndex((step) => step.docId === byName[lifterName].lifts.squat[1].docId);
const at = (cursor) => R.buildSheet(R.buildStateAt(replay, cursor), replay);
const badge = (cell) => cell.children.some((child) => child.textContent === 'R');
check('no badge before weight entry', badge(attemptCell(at(pending), lifterName, 'squat', 2)), false);
const entered = attemptCell(at(pending + 1), lifterName, 'squat', 2);
check('record weight is marked while pending', badge(entered), true);
check('badge tooltip includes the record', entered.title.includes('338'), true);
check('missed record attempts stay marked', badge(attemptCell(sheet, lifterName, 'squat', 3)), true);
check('equaling the record is not marked', badge(attemptCell(sheet, 'Aisha Nakamura', 'squat', 3)), false);
check('a below-record lift is not marked', badge(attemptCell(sheet, lifterName, 'dead', 1)), false);

const editedExport = JSON.parse(JSON.stringify(global.MEET_REPLAY_SHEFFIELD));
const editedAttempt = editedExport.rows.find(({ id }) => id === byName[lifterName].lifts.squat[1].docId).doc;
const originalEntry = editedAttempt.changes.find(({ attribute }) => attribute === 'weight');
const judgedEntry = editedAttempt.changes.find(({ attribute }) => attribute === 'result');
originalEntry.value = 337.5;
editedAttempt.changes.push(
  { rev: '10-edit', attribute: 'weight', value: 340,
    timeStamp: new Date(Date.parse(originalEntry.timeStamp) + 1000).toISOString() },
  { rev: '11-restore', attribute: 'weight', value: 337.5,
    timeStamp: new Date(Date.parse(judgedEntry.timeStamp) + 1000).toISOString() },
);
editedAttempt.weight = 337.5;
const editedReplay = R.buildReplay(editedExport);
const editIndex = editedReplay.steps.findIndex(({ rev }) => rev === '10-edit');
const restoreIndex = editedReplay.steps.findIndex(({ rev }) => rev === '11-restore');
function editedCell(cursor) {
  const currentSheet = R.buildSheet(R.buildStateAt(editedReplay, cursor), editedReplay);
  return attemptCell(currentSheet, lifterName, 'squat', 2);
}
const changeBadgeOf = (cell) => cell.children.find((child) => child.className.split(' ').includes('weight-change-badge'));
const hasChangedBadge = (cell) => Boolean(changeBadgeOf(cell));
const tooltipOf = (cell) => cell.children.find((child) => child.role === 'tooltip');
const tooltipDetail = (cell) => tooltipOf(cell)?.children
  .find((child) => child.className === 'attempt-tooltip-detail')?.textContent;
const judgesOf = (cell) => tooltipOf(cell)?.children.find((child) => child.className === 'judge-lights')?.children;
const lightsOf = (cell) => judgesOf(cell)?.map((judge) => judge.children[0].textContent);
const cardsOf = (cell) => judgesOf(cell)?.map((judge) => judge.children[1]?.textContent ?? null);
check('a pending attempt shows no lights', lightsOf(entered), undefined);
const judgedStep = replay.steps.find((step) => step.docId === byName[lifterName].lifts.squat[2].docId
  && step.entries.some(({ path }) => path[0] === 'decisions'));
const judgedState = R.buildStateAt(replay, judgedStep.index + 1);
check('the event line shows only lights, not cards', R.describeStep(judgedStep, replay, judgedState).detail, '🔴 🔴 ⚪️');
const partialState = R.buildStateAt(replay, judgedStep.index + 1);
const partialDoc = partialState.docs[judgedStep.docId];
partialDoc.decisions = { ...partialDoc.decisions, head: null };
check('the event line does not guess missing lights', R.describeStep(judgedStep, replay, partialState).detail, '🔴 — ⚪️');
partialState.docs[judgedStep.docId].decisions = null;
check('the event line handles a missing panel', R.describeStep(judgedStep, replay, partialState).detail,
  'No judges’ lights recorded');
check('a successful attempt shows three white lights',
  lightsOf(attemptCell(sheet, lifterName, 'squat', 2)), ['⚪️', '⚪️', '⚪️']);
const failed = attemptCell(sheet, lifterName, 'squat', 3);
check('a missed attempt shows the actual lights in judge order', lightsOf(failed), ['🔴', '🔴', '⚪️']);
check('cards sit under their own judge', cardsOf(failed), ['🔴', '🔵🟡', null]);
check('cards have accessible names', judgesOf(failed)?.[1]['aria-label'], 'head judge: red light, blue card, yellow card');
const greenSplit = JSON.parse(JSON.stringify(sheet));
const splitAttempt = greenSplit.rows.find((row) => row.name === lifterName).lifts.squat[1];
splitAttempt.decisions.head = { decision: 'bad', cards: { blue: true } };
check('a made lift can have a red light', lightsOf(attemptCell(greenSplit, lifterName, 'squat', 2)),
  ['⚪️', '🔴', '⚪️']);
const judgeNote = (cell) => tooltipOf(cell)?.children
  .find((child) => child.className === 'judge-data-note')?.textContent;
delete splitAttempt.decisions.left;
splitAttempt.decisions.head = { decision: 'bad' };
const partial = attemptCell(greenSplit, lifterName, 'squat', 2);
check('partial panels keep each light in its position', lightsOf(partial), ['—', '🔴', '⚪️']);
check('a red light without a card still shows its light', cardsOf(partial), [null, null, null]);
check('the tooltip explains a missing light', judgeNote(partial), '— = light not recorded');
for (const decisions of [null, {}, { head: { decision: null, cards: { red: true } } }]) {
  splitAttempt.decisions = decisions;
  const unrecorded = attemptCell(greenSplit, lifterName, 'squat', 2);
  check('missing decisions are not guessed', judgeNote(unrecorded), 'No judges’ lights recorded');
  check('an empty panel does not show lights or cards', lightsOf(unrecorded), undefined);
}
for (const [name, lift, number, original, changed] of [
  ['Tomas Herrera', 'squat', 1, 302.5, 300],
  ['Hanna Virtanen', 'dead', 3, 255, 250],
  ['Dmitri Sawicki', 'dead', 3, 330, 337.5],
]) {
  const { docId } = byName[name].lifts[lift][number - 1];
  const weightSteps = replay.steps.filter((step) => step.docId === docId
    && step.entries.some(({ path }) => path[0] === 'weight'));
  check(`${name} has two weight declarations`, weightSteps.length, 2);
  if (weightSteps.length !== 2) continue;
  const cursor = weightSteps[1].index;
  const before = attemptCell(at(cursor), name, lift, number);
  const after = attemptCell(at(cursor + 1), name, lift, number);
  check(`${name} has no badge before the change`, hasChangedBadge(before), false);
  const increased = changed > original;
  const changeBadge = changeBadgeOf(after);
  check(`${name} shows the direction symbol`, changeBadge?.textContent, increased ? '+' : '−');
  check(`${name} uses the direction color`,
    changeBadge?.className.split(' ').includes(increased ? 'weight-increased' : 'weight-decreased'), true);
  check(`${name} shows the direction and both weights`, tooltipDetail(after),
    `${increased ? 'Increased' : 'Decreased'} from ${original} kg to ${changed} kg`);
  check(`${name} can focus the changed cell`, after.tabIndex, 0);
  check(`${name} has a linked tooltip`, after['aria-describedby'], tooltipOf(after)?.id);
}

check('editing adds a weight-change badge', hasChangedBadge(editedCell(editIndex + 1)), true);
check('both badges fit the same attempt', badge(editedCell(editIndex + 1)), true);
check('tooltip names the original and current weights',
  tooltipDetail(editedCell(editIndex + 1))?.includes('Increased from 337.5 kg to 340 kg'), true);
check('a completed changed attempt shows both lights and weight change',
  lightsOf(editedCell(restoreIndex)), ['⚪️', '⚪️', '⚪️']);
check('a completed changed attempt preserves record and weight details',
  tooltipDetail(editedCell(restoreIndex)), 'Increased from 337.5 kg to 340 kg\nRecord attempt (record: 338)');
check('judging preserves the weight-change badge', hasChangedBadge(editedCell(restoreIndex)), true);
check('restoring the original weight clears the badge', hasChangedBadge(editedCell(restoreIndex + 1)), false);
check('rewinding before the edit clears the badge', hasChangedBadge(editedCell(editIndex)), false);
check('judging an unchanged attempt shows no change badge',
  hasChangedBadge(attemptCell(sheet, lifterName, 'squat', 2)), false);

for (const clearedWeight of [null, '', 0]) {
  const data = JSON.parse(JSON.stringify(editedExport));
  const doc = data.rows.find(({ id }) => id === editedAttempt._id).doc;
  const start = Date.parse(originalEntry.timeStamp);
  const changes = [
    ['20-clear-result', 'result', null],
    ['21-clear-weight', 'weight', clearedWeight],
    ['22-reenter', 'weight', 335],
    ['23-edit-new-weight', 'weight', 337.5],
  ];
  changes.forEach(([rev, attribute, value], i) => {
    doc.changes.push({ rev, attribute, value, timeStamp: new Date(start + (i + 2) * 1000).toISOString() });
  });
  const resetReplay = R.buildReplay(data);
  const cellAt = (rev) => {
    const cursor = resetReplay.steps.findIndex((step) => step.rev === rev) + 1;
    return attemptCell(R.buildSheet(R.buildStateAt(resetReplay, cursor), resetReplay), lifterName, 'squat', 2);
  };
  const label = `clear with ${JSON.stringify(clearedWeight)}`;
  check(`${label}: clearing just the result keeps the badge`, hasChangedBadge(cellAt('20-clear-result')), true);
  check(`${label}: no badge on a cleared weight`, hasChangedBadge(cellAt('21-clear-weight')), false);
  check(`${label}: no badge on the new declaration`, hasChangedBadge(cellAt('22-reenter')), false);
  check(`${label}: edit compares against the new declaration`, tooltipDetail(cellAt('23-edit-new-weight')),
    'Increased from 335 kg to 337.5 kg');
  check(`${label}: rewinding restores the old comparison`, tooltipDetail(cellAt('10-edit')),
    'Increased from 337.5 kg to 340 kg\nRecord attempt (record: 338)');
}

for (const verdict of ['good', 'bad']) {
  const data = JSON.parse(JSON.stringify(global.MEET_REPLAY_SHEFFIELD));
  const docId = byName[lifterName].lifts.squat[verdict === 'good' ? 2 : 1].docId;
  const doc = data.rows.find(({ id }) => id === docId).doc;
  const original = doc.result;
  const originalLights = doc.decisions;
  for (const [attribute, value] of Object.entries({
    result: verdict, juryOverride: true, decisions: null, preJuryOverturnDecisions: originalLights,
  })) doc.changes.push({ rev: '20-jury', attribute, value, timeStamp: '2026-11-22T00:00:00Z' });
  for (const [attribute, value] of Object.entries({ result: original, juryOverride: null })) {
    doc.changes.push({ rev: '21-undo', attribute, value, timeStamp: '2026-11-22T00:01:00Z' });
  }
  const juryReplay = R.buildReplay(data);
  const step = juryReplay.steps.find(({ rev }) => rev === '20-jury');
  const state = R.buildStateAt(juryReplay, step.index + 1);
  const cellAt = (current) => attemptCell(R.buildSheet(current, juryReplay), lifterName, 'squat', Number(doc.attemptNumber));
  const hasJ = (cell) => cell.children.some((child) => child.textContent === 'J');
  check(`no J before the ${verdict} overturn`, hasJ(cellAt(R.buildStateAt(juryReplay, step.index))), false);
  check(`J appears after the ${verdict} overturn`, hasJ(cellAt(state)), true);
  check(`the ${verdict} ruling sets the cell color`, cellAt(state).className.includes(`result-${verdict}`), true);
  check('the tooltip keeps the original judges’ lights', lightsOf(cellAt(state)),
    ['left', 'head', 'right'].map((position) => originalLights[position].decision === 'good' ? '⚪️' : '🔴'));
  check('undoing the overturn clears the J', hasJ(cellAt(R.buildStateAt(juryReplay, step.index + 2))), false);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
