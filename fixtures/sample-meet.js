'use strict';

/*
 * A small synthetic meet in LiftingCast's shape, for checking the replay
 * without a real export. Three lifters, deliberately awkward:
 *   - Ana has a jury reversal on squat 2 (good, cleared, good again)
 *   - Bea changes her deadlift 2 weight after the attempt was declared
 *   - Cal misses every deadlift, so he has no total and no placing
 */

(function () {
  const docs = [];

  function attempt(lifterId, liftName, attemptNumber, events) {
    const changes = events.map((event, index) => ({
      rev: `${index + 1}-sample${lifterId}${liftName}${attemptNumber}${index}`,
      attribute: event[0],
      value: event[1],
      timeStamp: event[2],
    }));

    // The materialised fields mirror the final state, exactly as LiftingCast
    // stores them. The replay engine strips these before replaying.
    const doc = {
      _id: `a${attemptNumber}${liftName[0]}-${lifterId}`,
      _rev: `${events.length + 1}-sample`,
      liftName,
      attemptNumber: String(attemptNumber),
      lifterId,
      changes,
      createDate: '2026-11-12T14:55:53+11:00',
    };
    for (const event of events) doc[event[0]] = event[1];
    docs.push(doc);
  }

  function lifter(id, name, lot, weightClassId, bodyWeight, bodyWeightTime) {
    docs.push({
      _id: id,
      _rev: '2-sample',
      name,
      team: 'SAMPLE',
      lot,
      session: 1,
      flight: 'A',
      country: 'AU',
      gender: 'MALE',
      // Two declared divisions, as in a real IPF meet: the weight class,
      // scored on total, plus a Best Lifter award scored on IPF points.
      divisions: [
        { rawOrEquipped: 'RAW', divisionId: 'd-sample', declaredAwardsWeightClassId: weightClassId },
        { rawOrEquipped: 'RAW', divisionId: 'd-best', declaredAwardsWeightClassId: 'w-all' },
      ],
      changes: [
        { rev: '1-sample', attribute: 'platformId', value: 'p-sample', timeStamp: '2026-11-14T21:00:00Z' },
        { rev: '2-sample', attribute: 'bodyWeight', value: bodyWeight, timeStamp: bodyWeightTime },
      ],
      createDate: '2026-11-12T14:55:53+11:00',
      platformId: 'p-sample',
      bodyWeight,
    });
  }

  docs.push({
    _id: 'm-sample',
    _rev: '1-sample',
    name: 'Sample Classic',
    date: '15/11/2026',
    units: 'KG',
    federation: 'IPF',
    dateFormat: 'DD/MM/YYYY',
    type: 'powerlifting',
    plates: { plate_25: { pairsCount: 8, weight: 25, color: '#C25140' } },
    changes: [],
    createDate: '2026-10-20T21:22:45+11:00',
  });

  docs.push({
    _id: 'd-sample',
    _rev: '1-sample',
    name: 'Open',
    gender: 'MALE',
    rawOrEquipped: 'RAW',
    lifts: { squat: true, bench: true, dead: true },
    scoreBy: 'TOTAL',
    weightClasses: {
      'w-83': { _id: 'w-83', name: '83', maxWeight: 83 },
      'w-93': { _id: 'w-93', name: '93', maxWeight: 93 },
    },
    hideOnBoard: false,
    changes: [],
    createDate: '2026-11-02T16:45:12+11:00',
  });

  docs.push({
    _id: 'd-best',
    _rev: '1-sample',
    name: 'Best Lifter Men',
    gender: 'MALE',
    rawOrEquipped: 'RAW',
    lifts: { squat: true, bench: true, dead: true },
    scoreBy: 'IPF_POINTS',
    weightClasses: {
      'w-all': { _id: 'w-all', name: 'All', maxWeight: 999 },
    },
    hideOnBoard: true,
    changes: [],
    createDate: '2026-11-02T16:45:12+11:00',
  });

  docs.push({
    _id: 'p-sample',
    _rev: '3-sample',
    name: 'Session 1',
    clockState: 'initial',
    clockTimerLength: 60000,
    barAndCollarsWeight: 25,
    changes: [],
    createDate: '2026-10-20T21:22:45+11:00',
  });

  lifter('l-ana', 'Ana Fielding', 1, 'w-83', 82.4, '2026-11-14T21:30:00Z');
  lifter('l-bea', 'Bea Okonkwo', 2, 'w-93', 90.1, '2026-11-14T21:31:00Z');
  lifter('l-cal', 'Cal Mendoza', 3, 'w-93', 92.8, '2026-11-14T21:32:00Z');

  const good = (position) => ({ decision: 'good', cards: { red: false, blue: false, yellow: false } });
  const bad = () => ({ decision: 'bad', cards: { red: true } });
  const panelGood = { left: good(), head: good(), right: good() };
  const panelSplit = { left: bad(), head: good(), right: good() };

  // Openers for every lift are declared at weigh-in, as at a real meet; only
  // second and third attempts are decided during the meet.

  // Squats
  attempt('l-ana', 'squat', 1, [['weight', 150, '2026-11-14T22:00:00Z'], ['result', 'good', '2026-11-14T23:00:00Z']]);
  attempt('l-bea', 'squat', 1, [['weight', 170, '2026-11-14T22:00:10Z'], ['result', 'good', '2026-11-14T23:02:00Z']]);
  attempt('l-cal', 'squat', 1, [['weight', 180, '2026-11-14T22:00:20Z'], ['result', 'bad', '2026-11-14T23:04:00Z']]);

  // Ana's squat 2 is given good, cleared by the jury, then given good again.
  attempt('l-ana', 'squat', 2, [
    ['weight', 160, '2026-11-14T23:01:00Z'],
    ['result', 'good', '2026-11-14T23:10:00Z'],
    ['decisions', panelSplit, '2026-11-14T23:10:00Z'],
    ['result', null, '2026-11-14T23:10:40Z'],
    ['decisions', null, '2026-11-14T23:10:40Z'],
    ['result', 'good', '2026-11-14T23:11:30Z'],
    ['decisions', panelGood, '2026-11-14T23:11:30Z'],
  ]);
  attempt('l-bea', 'squat', 2, [['weight', 180, '2026-11-14T23:03:00Z'], ['result', 'good', '2026-11-14T23:12:00Z'], ['decisions', panelGood, '2026-11-14T23:12:00Z']]);
  attempt('l-cal', 'squat', 2, [['weight', 180, '2026-11-14T23:05:00Z'], ['result', 'good', '2026-11-14T23:14:00Z']]);

  attempt('l-ana', 'squat', 3, [['weight', 167.5, '2026-11-14T23:12:00Z'], ['result', 'good', '2026-11-14T23:20:00Z']]);
  attempt('l-bea', 'squat', 3, [['weight', 187.5, '2026-11-14T23:13:00Z'], ['result', 'bad', '2026-11-14T23:22:00Z']]);
  attempt('l-cal', 'squat', 3, [['weight', 190, '2026-11-14T23:15:00Z'], ['result', 'good', '2026-11-14T23:24:00Z']]);

  // Bench
  attempt('l-ana', 'bench', 1, [['weight', 95, '2026-11-14T21:40:00Z'], ['result', 'good', '2026-11-15T00:10:00Z']]);
  attempt('l-bea', 'bench', 1, [['weight', 105, '2026-11-14T21:40:10Z'], ['result', 'good', '2026-11-15T00:12:00Z']]);
  attempt('l-cal', 'bench', 1, [['weight', 110, '2026-11-14T21:40:20Z'], ['result', 'good', '2026-11-15T00:14:00Z']]);

  attempt('l-ana', 'bench', 2, [['weight', 100, '2026-11-15T00:11:00Z'], ['result', 'bad', '2026-11-15T00:20:00Z']]);
  attempt('l-bea', 'bench', 2, [['weight', 112.5, '2026-11-15T00:13:00Z'], ['result', 'good', '2026-11-15T00:22:00Z']]);
  attempt('l-cal', 'bench', 2, [['weight', 117.5, '2026-11-15T00:15:00Z'], ['result', 'good', '2026-11-15T00:24:00Z']]);

  attempt('l-ana', 'bench', 3, [['weight', 100, '2026-11-15T00:21:00Z'], ['result', 'good', '2026-11-15T00:30:00Z']]);
  attempt('l-bea', 'bench', 3, [['weight', 117.5, '2026-11-15T00:23:00Z'], ['result', 'bad', '2026-11-15T00:32:00Z']]);
  attempt('l-cal', 'bench', 3, [['weight', 122.5, '2026-11-15T00:25:00Z'], ['result', 'bad', '2026-11-15T00:34:00Z']]);

  // Deadlifts. Bea's second attempt is re-declared; Cal misses all three.
  attempt('l-ana', 'dead', 1, [['weight', 180, '2026-11-14T21:41:00Z'], ['result', 'good', '2026-11-15T01:10:00Z']]);
  attempt('l-bea', 'dead', 1, [['weight', 200, '2026-11-14T21:41:10Z'], ['result', 'good', '2026-11-15T01:12:00Z']]);
  attempt('l-cal', 'dead', 1, [['weight', 230, '2026-11-14T21:41:20Z'], ['result', 'bad', '2026-11-15T01:14:00Z']]);

  attempt('l-ana', 'dead', 2, [['weight', 192.5, '2026-11-15T01:11:00Z'], ['result', 'good', '2026-11-15T01:20:00Z']]);
  attempt('l-bea', 'dead', 2, [
    ['weight', 215, '2026-11-15T01:13:00Z'],
    ['weight', 212.5, '2026-11-15T01:16:00Z'],
    ['result', 'good', '2026-11-15T01:22:00Z'],
  ]);
  attempt('l-cal', 'dead', 2, [['weight', 230, '2026-11-15T01:15:00Z'], ['result', 'bad', '2026-11-15T01:24:00Z']]);

  attempt('l-ana', 'dead', 3, [['weight', 200, '2026-11-15T01:21:00Z'], ['result', 'bad', '2026-11-15T01:30:00Z']]);
  attempt('l-bea', 'dead', 3, [['weight', 222.5, '2026-11-15T01:23:00Z'], ['result', 'good', '2026-11-15T01:32:00Z']]);
  attempt('l-cal', 'dead', 3, [['weight', 232.5, '2026-11-15T01:25:00Z'], ['result', 'bad', '2026-11-15T01:34:00Z']]);

  window.MEET_REPLAY_SAMPLE = { total_rows: docs.length, offset: 0, rows: docs.map((doc) => ({ id: doc._id, key: doc._id, value: { rev: doc._rev }, doc })) };
}());
