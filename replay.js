'use strict';

/*
 * Pure replay engine for a LiftingCast (CouchDB) meet database.
 *
 * No DOM, no network. Everything here is a function of the documents you
 * hand it, so it works the same whether those documents came from a file,
 * a sample fixture, or a live meet.
 *
 * The core idea: every LiftingCast document carries a `changes` array of
 * { rev, attribute, value, timeStamp } entries. That is an append-only
 * audit log of the meet. So:
 *
 *   1. Strip from each document every attribute that ever appears in its
 *      own `changes`. What remains is the pre-meet baseline - names, lots,
 *      divisions, weight classes - with no results in it.
 *   2. Flatten all `changes` into one list, grouped by revision so that a
 *      single real-world action (result + judges' decisions, written
 *      together) advances the replay by one step.
 *   3. Replay steps in timestamp order to reach any point in the meet.
 */

const LIFT_ORDER = ['squat', 'bench', 'dead'];

const LIFT_LABELS = {
  squat: 'Squat',
  bench: 'Bench',
  dead: 'Deadlift',
};

const ATTEMPT_NUMBERS = ['1', '2', '3'];

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function parseRevNumber(rev) {
  const parsed = parseInt(String(rev == null ? '' : rev).split('-')[0], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * `attribute` is usually a plain field name, but LiftingCast also writes
 * nested paths as arrays, e.g. ["divisions", 0, "declaredAwardsWeightClassId"].
 */
function toPath(attribute) {
  if (Array.isArray(attribute)) return attribute.slice();
  return [attribute];
}

function pathToString(path) {
  return path.join('.');
}

function setAtPath(target, path, value) {
  let node = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (node[key] === null || typeof node[key] !== 'object') {
      node[key] = typeof path[i + 1] === 'number' ? [] : {};
    }
    node = node[key];
  }
  node[path[path.length - 1]] = value;
}

function deleteAtPath(target, path) {
  let node = target;
  for (let i = 0; i < path.length - 1; i++) {
    if (node === null || typeof node !== 'object') return;
    node = node[path[i]];
  }
  if (node === null || typeof node !== 'object') return;
  delete node[path[path.length - 1]];
}

// ---------------------------------------------------------------------------
// document intake
// ---------------------------------------------------------------------------

/**
 * Accepts any of:
 *   - a CouchDB `_all_docs?include_docs=true` response  { rows: [ { doc } ] }
 *   - a bare array of rows                              [ { doc } ]
 *   - a bare array of documents                         [ { _id, ... } ]
 */
function extractDocs(input) {
  const rows = Array.isArray(input) ? input : (input && input.rows) || [];
  const docs = [];
  for (const row of rows) {
    const doc = row && typeof row === 'object' && row.doc ? row.doc : row;
    if (!doc || typeof doc !== 'object') continue;
    if (typeof doc._id !== 'string') continue;
    if (doc._id.startsWith('_design/')) continue;
    docs.push(doc);
  }
  return docs;
}

/**
 * Work out what a document is from its shape rather than its id prefix, so
 * this keeps working if LiftingCast changes its id scheme.
 */
function classifyDoc(doc) {
  if (doc.liftName && doc.lifterId) return 'attempt';
  if (doc.weightClasses) return 'division';
  if (Array.isArray(doc.divisions) && doc.name) return 'lifter';
  if (doc.plates) return 'meet';
  if (doc.position && doc.platformId) return 'referee';
  if (doc.clockState || doc.barAndCollarsWeight) return 'platform';
  if (window.MeetRecords && window.MeetRecords.isRecordTable(doc)) return 'records';
  return 'other';
}

// ---------------------------------------------------------------------------
// building the replay
// ---------------------------------------------------------------------------

function compareSteps(a, b) {
  const timeA = a.timeStamp || '';
  const timeB = b.timeStamp || '';
  // Change timestamps are ISO-8601 UTC ("...Z"), so string order is time order.
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;
  if (a.revNumber !== b.revNumber) return a.revNumber - b.revNumber;
  if (a.docId !== b.docId) return a.docId < b.docId ? -1 : 1;
  return 0;
}

/**
 * @returns {{
 *   baseline: Object<string, Object>,  spoiler-free starting documents
 *   steps: Array<Step>,                ordered revisions to replay
 *   types: Object<string, string>,     docId -> document type
 *   labels: Object<string, string>,    docId -> human label, for the event log
 *   firstResultIndex: number           first step that records a lift result
 * }}
 */
function buildReplay(input) {
  const docs = extractDocs(input);
  const baseline = {};
  const types = {};
  const labels = {};
  const steps = [];

  for (const doc of docs) {
    const docId = doc._id;
    // Classify from the original document: some identifying fields (a lifter's
    // name, for instance) can themselves have been edited during the meet.
    types[docId] = classifyDoc(doc);
    labels[docId] = doc.name || docId;

    const stripped = deepClone(doc);
    delete stripped._rev;
    delete stripped._conflicts;
    delete stripped.changes;
    // A final jury flag must not appear before its recorded override.
    if (types[docId] === 'attempt') {
      delete stripped.juryOverride;
      delete stripped.preJuryOverturnDecisions;
    }

    const changes = Array.isArray(doc.changes) ? doc.changes : [];
    const byRev = new Map();

    for (const change of changes) {
      if (!change || change.attribute === undefined) continue;
      const path = toPath(change.attribute);

      // Anything that was ever written during the meet is removed from the
      // baseline. This is what keeps the final scoresheet out of the UI.
      deleteAtPath(stripped, path);

      const revKey = String(change.rev);
      if (!byRev.has(revKey)) {
        byRev.set(revKey, {
          docId,
          docType: types[docId],
          rev: revKey,
          revNumber: parseRevNumber(change.rev),
          timeStamp: change.timeStamp || null,
          entries: [],
        });
      }
      const step = byRev.get(revKey);
      step.entries.push({ path, value: change.value });
      if (change.timeStamp && (!step.timeStamp || change.timeStamp < step.timeStamp)) {
        step.timeStamp = change.timeStamp;
      }
    }

    baseline[docId] = stripped;
    for (const step of byRev.values()) steps.push(step);
  }

  steps.sort(compareSteps);
  steps.forEach((step, index) => {
    step.index = index;
  });

  const firstResultIndex = steps.findIndex(stepRecordsResult);

  return {
    baseline,
    steps,
    types,
    labels,
    firstResultIndex: firstResultIndex === -1 ? steps.length : firstResultIndex,
  };
}

function stepRecordsResult(step) {
  return step.docType === 'attempt'
    && step.entries.some((entry) => entry.path.length === 1 && entry.path[0] === 'result');
}

/**
 * Rebuild the meet state from the baseline by applying the first `cursor`
 * steps. Replaying from scratch rather than inverting steps keeps "previous"
 * trivially correct, and a full meet is only a few hundred cheap writes.
 */
function buildStateAt(replay, cursor) {
  const clamped = Math.max(0, Math.min(cursor, replay.steps.length));
  const docs = deepClone(replay.baseline);
  const initialWeights = new Map();
  let activeLifterId = null;
  for (let i = 0; i < clamped; i++) {
    const step = replay.steps[i];
    const doc = docs[step.docId];
    if (!doc) continue;
    for (const { path, value } of step.entries) {
      setAtPath(doc, path, value && typeof value === 'object' ? deepClone(value) : value);
    }
    if (step.docType === 'attempt' && !initialWeights.has(step.docId)
      && Number.isFinite(doc.weight) && doc.weight > 0) {
      initialWeights.set(step.docId, doc.weight);
    }
    if (stepRecordsResult(step) && (doc.result === 'good' || doc.result === 'bad')) {
      activeLifterId = doc.lifterId;
    }
  }
  return { docs, cursor: clamped, initialWeights, activeLifterId };
}

// ---------------------------------------------------------------------------
// turning state into a scoresheet
// ---------------------------------------------------------------------------

function attemptKey(lifterId, liftName, attemptNumber) {
  return `${lifterId}|${liftName}|${attemptNumber}`;
}

/**
 * The heaviest weight this lifter still has in front of them on a lift: an
 * attempt whose weight is declared but which has not been judged yet.
 */
function pendingLift(attempts) {
  let heaviest = null;
  for (const attempt of attempts) {
    if (!attempt || attempt.result) continue;
    if (typeof attempt.weight !== 'number') continue;
    if (heaviest === null || attempt.weight > heaviest) heaviest = attempt.weight;
  }
  return heaviest;
}

function bestLift(attempts) {
  let best = null;
  for (const attempt of attempts) {
    if (!attempt || attempt.result !== 'good') continue;
    if (typeof attempt.weight !== 'number') continue;
    if (best === null || attempt.weight > best) best = attempt.weight;
  }
  return best;
}

/**
 * Derives everything the UI needs from a point-in-time state. Called on every
 * step, so it must only read state - never the original documents.
 */
function buildSheet(state, replay) {
  const docs = state.docs;
  const types = replay.types;

  let meet = null;
  let records = null;
  const divisions = {};
  const lifters = [];
  const attemptsByKey = {};

  for (const docId of Object.keys(docs)) {
    const doc = docs[docId];
    switch (types[docId]) {
      case 'meet':
        meet = doc;
        break;
      case 'division':
        divisions[docId] = doc;
        break;
      case 'lifter':
        lifters.push(doc);
        break;
      case 'attempt':
        attemptsByKey[attemptKey(doc.lifterId, doc.liftName, String(doc.attemptNumber))] = doc;
        break;
      case 'records':
        records = doc.data;
        break;
      default:
        break;
    }
  }

  // If any division is scored on a points formula, the whole sheet gets a
  // points column - it is the same number for every lifter either way.
  const pointsKind = findPointsKind(divisions);

  const rows = lifters.map((lifter) => {
    const declared = resolveDeclaredDivisions(lifter, divisions);
    // The "primary" placing is the one a scoresheet normally shows: the weight
    // class. Best Lifter and other points awards are extra placings on top.
    const primary = declared.find((item) => item.scoreBy === 'TOTAL') || declared[0] || null;
    const division = primary ? primary.division : null;

    const lifts = {};
    for (const liftName of LIFT_ORDER) {
      lifts[liftName] = ATTEMPT_NUMBERS.map((attemptNumber) => {
        const doc = attemptsByKey[attemptKey(lifter._id, liftName, attemptNumber)];
        if (!doc) return null;
        return {
          docId: doc._id,
          attemptNumber,
          weight: typeof doc.weight === 'number' ? doc.weight : null,
          initialWeight: state.initialWeights?.get(doc._id) ?? null,
          result: doc.result || null,
          decisions: doc.decisions || null,
          juryOverride: doc.juryOverride === true,
          originalDecisions: doc.preJuryOverturnDecisions || null,
        };
      });
    }

    const best = {};
    // What each lift would come to if every attempt still standing is made:
    // the best good lift so far, or a heavier declared attempt still to come.
    const projected = {};
    for (const liftName of LIFT_ORDER) {
      best[liftName] = bestLift(lifts[liftName]);
      const pending = pendingLift(lifts[liftName]);
      const candidates = [best[liftName], pending].filter((value) => value !== null);
      projected[liftName] = candidates.length ? Math.max(...candidates) : null;
    }

    const contested = LIFT_ORDER.filter((liftName) => {
      if (!division || !division.lifts) return true;
      return Boolean(division.lifts[liftName]);
    });
    const total = sumLifts(contested, best);
    // Null once a lifter can no longer complete the total - three missed
    // deadlifts leave nothing good and nothing pending.
    const projectedTotal = sumLifts(contested, projected);

    const bodyWeight = typeof lifter.bodyWeight === 'number' ? lifter.bodyWeight : null;
    const scoreInputs = {
      total,
      bodyWeight,
      gender: lifter.gender || (division && division.gender),
      rawOrEquipped: (primary && primary.rawOrEquipped)
        || (division && division.rawOrEquipped),
      lifts: division ? division.lifts : null,
      records,
      divisionCode: division ? division.usaplDivisionCode : null,
    };

    const projectedInputs = { ...scoreInputs, total: projectedTotal };
    const points = pointsKind ? score(pointsKind, scoreInputs) : null;
    const projectedPoints = pointsKind ? score(pointsKind, projectedInputs) : null;

    return {
      lifterId: lifter._id,
      name: lifter.name || replay.labels[lifter._id] || lifter._id,
      team: lifter.team || '',
      country: lifter.country || '',
      age: window.MeetLiftingCast?.ageAtMeet(lifter.birthDate, meet) ?? null,
      squatRackHeight: lifter.squatRackHeight,
      benchRackHeight: lifter.benchRackHeight,
      lot: typeof lifter.lot === 'number' ? lifter.lot : null,
      flight: lifter.flight || '',
      session: lifter.session == null ? '' : lifter.session,
      gender: lifter.gender || (division && division.gender) || '',
      bodyWeight,
      divisionId: primary ? primary.divisionId : null,
      divisionName: division ? division.name : '',
      weightClassId: primary ? primary.weightClassId : null,
      weightClassName: primary ? primary.weightClassName : '',
      lifts,
      liftRecords: window.MeetRecords ? window.MeetRecords.liftRecords(scoreInputs) : {},
      best,
      total,
      projectedTotal,
      points: points ? points.value : null,
      pointsLabel: points ? points.label : '',
      projectedPoints: projectedPoints ? projectedPoints.value : null,
      // Only set for percent-of-record meets, where the class is derived.
      recordWeight: (points && points.recordWeight) || null,
      recordWeightClassName: (points && points.recordWeightClassName) || '',
      // One entry per division the lifter declared, each with its own score
      // and place. `place` is filled in by assignPlaces below.
      placings: declared.map((item) => {
        const inputs = {
          ...scoreInputs,
          rawOrEquipped: item.rawOrEquipped,
          lifts: item.division ? item.division.lifts : scoreInputs.lifts,
          divisionCode: item.division ? item.division.usaplDivisionCode : null,
        };
        const scored = score(item.scoreBy, inputs);
        const projectedScore = score(item.scoreBy, { ...inputs, total: projectedTotal });
        return {
          divisionId: item.divisionId,
          divisionName: item.division ? item.division.name : '',
          weightClassId: item.weightClassId,
          weightClassName: item.weightClassName,
          scoreBy: item.scoreBy,
          hideOnBoard: Boolean(item.division && item.division.hideOnBoard),
          ...scored,
          // `place` is where they stand now, `projectedPlace` where they would
          // stand if everyone makes the attempt they have loaded. Both are
          // filled in by assignPlaces.
          projectedValue: projectedScore.value,
          place: null,
          projectedPlace: null,
        };
      }),
      place: null,
      projectedPlace: null,
    };
  });

  rows.sort((a, b) => {
    if (a.lot !== null && b.lot !== null && a.lot !== b.lot) return a.lot - b.lot;
    if (a.lot === null && b.lot !== null) return 1;
    if (a.lot !== null && b.lot === null) return -1;
    return a.name.localeCompare(b.name);
  });

  const standings = assignPlaces(rows);

  return { meet, divisions, rows, records, pointsKind, standings, activeLifterId: state.activeLifterId };
}

/**
 * Scores a lifter the way a division asks to be scored. The arithmetic lives
 * in ipf.js and records.js; this only chooses between them, and falls back to
 * the raw total if a scoring module was not loaded.
 */
function score(scoreBy, inputs) {
  const total = typeof inputs.total === 'number' ? inputs.total : null;
  const ipf = window.MeetIpf;
  const records = window.MeetRecords;

  switch (String(scoreBy || '').toUpperCase()) {
    // Divisions asking for the superseded 2019 formula are scored on GL
    // points too - it is the only points formula implemented.
    case 'IPF_POINTS':
    case 'IPF_GL_POINTS':
    case 'GOODLIFT':
      if (!ipf) break;
      return { value: ipf.ipfGlPoints(inputs), kind: 'IPF_GL_POINTS', label: 'GL pts' };
    case 'PERCENT_OF_RECORD': {
      if (!records) break;
      const scored = records.percentOfRecord(inputs);
      return {
        value: scored.value,
        kind: 'PERCENT_OF_RECORD',
        label: '% of record',
        // The record and the class it came from are worth showing: these
        // divisions declare a single "All" class, so the lifter's real class
        // is only knowable from their body weight.
        recordWeight: scored.recordWeight,
        recordWeightClassName: scored.weightClassName,
      };
    }
    default:
      break;
  }
  return { value: total, kind: 'TOTAL', label: 'Total' };
}

const POINTS_SCORE_KINDS = ['IPF_POINTS', 'IPF_GL_POINTS', 'GOODLIFT', 'PERCENT_OF_RECORD'];

/**
 * The points formula this meet is scored on, if any division asks for one.
 * Reported as the formula actually used, which is not always the one asked
 * for: a division wanting the 2019 IPF formula is scored on GL points.
 */
function findPointsKind(divisions) {
  for (const divisionId of Object.keys(divisions).sort()) {
    const scoreBy = String(divisions[divisionId].scoreBy || '').toUpperCase();
    if (POINTS_SCORE_KINDS.includes(scoreBy)) return score(scoreBy, {}).kind;
  }
  return null;
}

/**
 * A lifter usually declares more than one division - a weight class scored on
 * total, plus a Best Lifter award scored on points. Resolve them all.
 */
function resolveDeclaredDivisions(lifter, divisions) {
  const entries = Array.isArray(lifter.divisions) ? lifter.divisions : [];
  return entries
    .filter((entry) => entry && entry.divisionId)
    .map((entry) => {
      const division = divisions[entry.divisionId] || null;
      const weightClassId = entry.declaredAwardsWeightClassId || null;
      const weightClass = division && division.weightClasses && weightClassId
        ? division.weightClasses[weightClassId]
        : null;
      return {
        divisionId: entry.divisionId,
        division,
        weightClassId,
        weightClassName: weightClass ? weightClass.name : '',
        rawOrEquipped: entry.rawOrEquipped || (division && division.rawOrEquipped) || null,
        scoreBy: String((division && division.scoreBy) || 'TOTAL').toUpperCase(),
      };
    });
}

/**
 * Place every lifter in every division they declared, grouped by weight class
 * and ranked by whatever that division is scored on. Ties go to the lighter
 * lifter. Lifters without a score are unplaced.
 *
 * @returns {Array} one standings group per division and weight class
 */
/**
 * Orders a group by one score, highest first, and writes 1, 2, 3... into the
 * matching place field. Ties go to the lighter lifter. Anyone without that
 * score is left unplaced at the bottom.
 */
function rank(entries, valueField, placeField) {
  entries.sort((a, b) => {
    const valueA = a.placing[valueField];
    const valueB = b.placing[valueField];
    if (valueA === null && valueB === null) return 0;
    if (valueA === null) return 1;
    if (valueB === null) return -1;
    if (valueB !== valueA) return valueB - valueA;
    const weightA = a.row.bodyWeight === null ? Infinity : a.row.bodyWeight;
    const weightB = b.row.bodyWeight === null ? Infinity : b.row.bodyWeight;
    return weightA - weightB;
  });
  let position = 0;
  for (const entry of entries) {
    entry.placing[placeField] = entry.placing[valueField] === null ? null : ++position;
  }
}

/** Sums one weight per contested lift, or null if any is still unknown. */
function sumLifts(contested, weightByLift) {
  let sum = 0;
  for (const liftName of contested) {
    if (weightByLift[liftName] === null) return null;
    sum += weightByLift[liftName];
  }
  return sum;
}

function assignPlaces(rows) {
  const groups = new Map();

  for (const row of rows) {
    for (const placing of row.placings) {
      // Keep every division entrant visible; rank leaves missing scores unplaced.
      const key = `${placing.divisionId}|${placing.weightClassId}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          divisionId: placing.divisionId,
          divisionName: placing.divisionName,
          weightClassId: placing.weightClassId,
          weightClassName: placing.weightClassName,
          scoreBy: placing.kind,
          scoreLabel: placing.label,
          entries: [],
        });
      }
      groups.get(key).entries.push({ row, placing });
    }
  }

  for (const group of groups.values()) {
    rank(group.entries, 'projectedValue', 'projectedPlace');
    // Rank on the real score last, so the group stays sorted by it.
    rank(group.entries, 'value', 'place');
  }

  // Mirror the weight-class places onto the row, for the main scoresheet.
  for (const row of rows) {
    const primary = row.placings.find((placing) => placing.divisionId === row.divisionId
      && placing.weightClassId === row.weightClassId);
    row.place = primary ? primary.place : null;
    row.projectedPlace = primary ? primary.projectedPlace : null;
  }

  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// describing a step, for the event log
// ---------------------------------------------------------------------------

const ATTRIBUTE_LABELS = {
  weight: 'weight',
  result: 'result',
  decisions: 'judges',
  juryOverride: 'jury override',
  juryOverturnCard: 'jury card',
  preJuryOverturnDecisions: 'pre-jury judges',
  bodyWeight: 'body weight',
  squatRackHeight: 'squat rack',
  benchRackHeight: 'bench rack',
  platformId: 'platform',
};

function describeValue(value) {
  if (value === null || value === undefined) return 'cleared';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const positions = ['left', 'head', 'right'];
    const decisions = positions
      .filter((position) => value[position])
      .map((position) => `${position[0]}:${value[position].decision || '?'}`);
    if (decisions.length) return decisions.join(' ');
  }
  return JSON.stringify(value);
}

function describeAttemptLights(decisions) {
  const lights = ['left', 'head', 'right'].map((position) => {
    const decision = decisions?.[position]?.decision;
    return decision === 'good' ? '⚪️' : decision === 'bad' ? '🔴' : '—';
  });
  return lights.every((light) => light === '—') ? 'No judges’ lights recorded' : lights.join(' ');
}

function describeStep(step, replay, state) {
  const doc = state.docs[step.docId];
  const isResult = stepRecordsResult(step);
  const isJudgingStep = step.docType === 'attempt' && step.entries.some(({ path }) =>
    ['result', 'decisions', 'juryOverride', 'juryOverturnCard', 'preJuryOverturnDecisions'].includes(path[0]));
  const completed = doc?.result === 'good' || doc?.result === 'bad';
  const isJuryOverturn = isJudgingStep && completed && doc.juryOverride === true;
  const detail = isJuryOverturn ? `JURY OVERTURNED TO ${doc.result === 'good' ? 'GOOD LIFT' : 'NO LIFT'}`
    : isJudgingStep ? (completed ? describeAttemptLights(doc.decisions) : 'Judging cleared')
    : step.entries.map(({ path, value }) => {
      const attribute = pathToString(path);
      return `${ATTRIBUTE_LABELS[attribute] || attribute} ${describeValue(value)}`;
    }).join(', ');

  let subject = replay.labels[step.docId] || step.docId;
  if (step.docType === 'attempt' && doc) {
    const lifterName = replay.labels[doc.lifterId] || doc.lifterId;
    const lift = LIFT_LABELS[doc.liftName] || doc.liftName;
    subject = `${lifterName} - ${lift} ${doc.attemptNumber}`;
  }

  return {
    subject,
    detail,
    timeStamp: step.timeStamp,
    docType: step.docType,
    isResult,
    isJuryOverturn,
    juryVerdict: isJuryOverturn ? doc.result : null,
  };
}

/** Index of the next step that records a lift result, for attempt-by-attempt stepping. */
function nextResultIndex(replay, cursor) {
  for (let i = cursor; i < replay.steps.length; i++) {
    if (stepRecordsResult(replay.steps[i])) return i + 1;
  }
  return replay.steps.length;
}

function previousResultIndex(replay, cursor) {
  for (let i = cursor - 2; i >= 0; i--) {
    if (stepRecordsResult(replay.steps[i])) return i + 1;
  }
  return 0;
}

window.MeetReplay = {
  LIFT_ORDER,
  LIFT_LABELS,
  ATTEMPT_NUMBERS,
  buildReplay,
  buildStateAt,
  buildSheet,
  describeStep,
  nextResultIndex,
  previousResultIndex,
  stepRecordsResult,
  extractDocs,
  classifyDoc,
};
