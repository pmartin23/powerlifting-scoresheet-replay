'use strict';

/*
 * A synthetic meet in the Sheffield format, for seeing how percent-of-record
 * scoring looks. Shaped exactly like a LiftingCast export: two divisions
 * scored `PERCENT_OF_RECORD`, each declaring a single "All" weight class, plus
 * the world-record table the export carries in its own document.
 *
 * Eight invited lifters, four each side, weighing in across the classes. The
 * numbers are plausible rather than real: nobody here is a real lifter and no
 * result here happened. The record table is the real one, because that is what
 * the scoring reads.
 *
 * Deliberately awkward in a few places:
 *   - the men's lead changes on the last deadlift of the meet
 *   - one lifter beats the record for the class she weighed into, so her
 *     percentage goes over 100
 *   - one lifter misses two deadlifts, so her projection falls back twice
 */

(function () {
  const docs = [];

  const MEET_ID = 'm-sheffield';
  const PLATFORM_ID = 'p-sheffield';
  const MENS_DIVISION = 'd-sheffield-men';
  const WOMENS_DIVISION = 'd-sheffield-women';
  const MENS_CLASS = 'w-sheffield-men-all';
  const WOMENS_CLASS = 'w-sheffield-women-all';

  const WEIGH_IN = Date.UTC(2026, 10, 21, 7, 0, 0);
  // One platform, one flight each side, so the whole meet runs in sequence.
  const LIFT_STARTS = {
    squat: Date.UTC(2026, 10, 21, 9, 0, 0),
    bench: Date.UTC(2026, 10, 21, 11, 0, 0),
    dead: Date.UTC(2026, 10, 21, 13, 0, 0),
  };

  function at(millis) {
    return new Date(millis).toISOString().replace('.000Z', 'Z');
  }

  /** The record document's `data`, nested the way LiftingCast nests it. */
  function fullPower(squat, bench, dead, total) {
    return { FP: { S: { W: squat }, B: { W: bench }, D: { W: dead }, T: { W: total } } };
  }

  docs.push({
    _id: 'crecords',
    _rev: '1-sheffield',
    data: {
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
    },
    changes: [],
    createDate: '2026-09-30T10:00:00+11:00',
  });

  docs.push({
    _id: MEET_ID,
    _rev: '1-sheffield',
    name: 'Sheffield Invitational (sample)',
    date: '21/11/2026',
    units: 'KG',
    federation: 'IPF',
    dateFormat: 'DD/MM/YYYY',
    type: 'powerlifting',
    plates: { plate_25: { pairsCount: 8, weight: 25, color: '#C25140' } },
    changes: [],
    createDate: '2026-09-30T10:00:00+11:00',
  });

  function division(id, name, gender, weightClassId) {
    docs.push({
      _id: id,
      _rev: '1-sheffield',
      name,
      gender,
      rawOrEquipped: 'RAW',
      usaplDivisionCode: 'O',
      lifts: { squat: true, bench: true, dead: true },
      scoreBy: 'PERCENT_OF_RECORD',
      // The whole point of the format: one class, so where a lifter lands is
      // decided at the scale rather than declared in advance.
      weightClasses: {
        [weightClassId]: { _id: weightClassId, name: 'All', maxWeight: 999 },
      },
      hideOnBoard: false,
      changes: [],
      createDate: '2026-09-30T10:00:00+11:00',
    });
  }

  division(MENS_DIVISION, 'Men', 'MALE', MENS_CLASS);
  division(WOMENS_DIVISION, 'Women', 'FEMALE', WOMENS_CLASS);

  docs.push({
    _id: PLATFORM_ID,
    _rev: '1-sheffield',
    name: 'Platform',
    clockState: 'initial',
    clockTimerLength: 60000,
    barAndCollarsWeight: 25,
    changes: [],
    createDate: '2026-09-30T10:00:00+11:00',
  });

  /*
   * The field. `attempts` is three weights per lift with the decision each
   * one got, in order. `null` means the attempt was never taken.
   */
  const good = { decision: 'good', cards: { red: false, blue: false, yellow: false } };
  const bad = { decision: 'bad', cards: { red: true } };
  const G = 'good';
  const B = 'bad';

  const FIELD = [
    {
      id: 'l-sf-herrera', name: 'Tomas Herrera', country: 'ES', gender: 'MALE', bodyWeight: 73.4,
      squat: [[300, G, 302.5], [312.5, G], [320, B]],
      bench: [[190, G], [197.5, G], [202.5, G]],
      dead: [[310, G], [325, B], [327.5, B]],
    },
    {
      id: 'l-sf-volkov', name: 'Niko Volkov', country: 'FI', gender: 'MALE', bodyWeight: 82.6,
      squat: [[325, G], [340, G], [347.5, B]],
      bench: [[210, G], [217.5, G], [222.5, B]],
      dead: [[300, G], [315, G], [322.5, B]],
    },
    {
      id: 'l-sf-bell', name: 'Marcus Bell', country: 'GB', gender: 'MALE', bodyWeight: 92.1,
      squat: [[340, G], [355, G], [362.5, B]],
      bench: [[225, G], [232.5, B], [240, G]],
      dead: [[290, G], [305, G], [312.5, B]],
    },
    {
      id: 'l-sf-sawicki', name: 'Dmitri Sawicki', country: 'PL', gender: 'MALE', bodyWeight: 104.2,
      squat: [[365, G], [380, G], [390, B]],
      bench: [[245, G], [255, B], [262.5, B]],
      dead: [[310, G], [322.5, G], [337.5, G, 330]],
    },
    {
      id: 'l-sf-nakamura', name: 'Aisha Nakamura', country: 'JP', gender: 'FEMALE', bodyWeight: 51.2,
      squat: [[170, G], [177.5, G], [182.5, B]],
      bench: [[102.5, G], [107.5, G], [110, B]],
      dead: [[182.5, G], [190, G], [195, B]],
    },
    {
      id: 'l-sf-solberg', name: 'Ingrid Solberg', country: 'NO', gender: 'FEMALE', bodyWeight: 62.4,
      squat: [[200, G], [207.5, G], [212.5, B]],
      bench: [[125, G], [130, B], [135, B]],
      dead: [[210, G], [220, B], [222.5, B]],
    },
    {
      id: 'l-sf-raman', name: 'Priya Raman', country: 'IN', gender: 'FEMALE', bodyWeight: 68.5,
      squat: [[215, G], [225, G], [232.5, B]],
      bench: [[140, G], [147.5, B], [152.5, G]],
      dead: [[225, G], [235, G], [242.5, B]],
    },
    {
      id: 'l-sf-virtanen', name: 'Hanna Virtanen', country: 'SE', gender: 'FEMALE', bodyWeight: 82.9,
      squat: [[230, G], [240, B], [247.5, G]],
      bench: [[150, G], [155, G], [160, B]],
      dead: [[230, G], [240, G], [250, G, 255]],
    },
  ];

  // Weigh-in: body weight is the only thing that changes, and until it does
  // nobody has a weight class, so nobody can be scored.
  FIELD.forEach((entry, index) => {
    const weighedAt = at(WEIGH_IN + index * 4 * 60 * 1000);
    const isMan = entry.gender === 'MALE';
    docs.push({
      _id: entry.id,
      _rev: '2-sheffield',
      name: entry.name,
      birthDate: index === 0 ? '25/11/1995' : undefined,
      squatRackHeight: index === 0 ? '14IN' : undefined,
      benchRackHeight: index === 0 ? '12/5' : undefined,
      team: entry.country,
      lot: index + 1,
      session: 1,
      flight: 'A',
      country: entry.country,
      gender: entry.gender,
      divisions: [{
        rawOrEquipped: 'RAW',
        divisionId: isMan ? MENS_DIVISION : WOMENS_DIVISION,
        declaredAwardsWeightClassId: isMan ? MENS_CLASS : WOMENS_CLASS,
      }],
      changes: [
        { rev: '1-sheffield', attribute: 'platformId', value: PLATFORM_ID, timeStamp: at(WEIGH_IN) },
        { rev: '2-sheffield', attribute: 'bodyWeight', value: entry.bodyWeight, timeStamp: weighedAt },
        ...(index === 0 ? [
          { rev: '2-sheffield', attribute: 'squatRackHeight', value: '14IN', timeStamp: weighedAt },
          { rev: '2-sheffield', attribute: 'benchRackHeight', value: '12/5', timeStamp: weighedAt },
        ] : []),
      ],
      platformId: PLATFORM_ID,
      bodyWeight: entry.bodyWeight,
      createDate: '2026-09-30T10:00:00+11:00',
    });
  });

  /*
   * Builds the attempt documents round by round. Within a round the bar only
   * goes up, so the running order is by weight - which is what makes the last
   * attempt of a round the one that can change the lead.
   *
   * An attempt's weight is declared at weigh-in for openers, and straight
   * after the lifter's previous attempt for the rest.
   */
  const attempts = new Map();
  const lastResultAt = new Map();

  function attemptDoc(entry, liftName, attemptNumber) {
    const key = `${entry.id}|${liftName}|${attemptNumber}`;
    if (!attempts.has(key)) {
      const doc = {
        _id: `a${attemptNumber}${liftName[0]}-${entry.id}`,
        _rev: '1-sheffield',
        liftName,
        attemptNumber: String(attemptNumber),
        lifterId: entry.id,
        changes: [],
        createDate: '2026-09-30T10:00:00+11:00',
      };
      attempts.set(key, doc);
      docs.push(doc);
    }
    return attempts.get(key);
  }

  function record(doc, attribute, value, timeStamp) {
    doc.changes.push({
      rev: attribute === 'decisions' ? doc.changes.at(-1).rev : `${doc.changes.length + 1}-sheffield`,
      attribute,
      value,
      timeStamp,
    });
    doc[attribute] = value;
  }

  for (const liftName of ['squat', 'bench', 'dead']) {
    let clock = LIFT_STARTS[liftName];

    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber++) {
      const round = FIELD
        .map((entry) => {
          const [weight, result, initialWeight = weight] = entry[liftName][attemptNumber - 1];
          return { entry, weight, result, initialWeight };
        })
        .filter((item) => item.weight !== null)
        .sort((a, b) => (a.weight - b.weight) || (a.entry.lot - b.entry.lot));

      for (const item of round) {
        const doc = attemptDoc(item.entry, liftName, attemptNumber);
        const declaredAt = attemptNumber === 1
          ? WEIGH_IN + 30 * 60 * 1000
          : lastResultAt.get(item.entry.id) + 60 * 1000;
        record(doc, 'weight', item.initialWeight, at(declaredAt));
        if (item.initialWeight !== item.weight) {
          const changedAt = attemptNumber === 1 ? LIFT_STARTS[liftName] - 10 * 60 * 1000 : clock - 30 * 1000;
          record(doc, 'weight', item.weight, at(changedAt));
        }

        clock += 3 * 60 * 1000;
        const judgedAt = at(clock);
        record(doc, 'result', item.result, judgedAt);
        record(doc, 'decisions', item.result === G
          ? { left: good, head: good, right: good }
          : { left: bad, head: { decision: 'bad', cards: { blue: true, yellow: true } }, right: good }, judgedAt);
        lastResultAt.set(item.entry.id, clock);
      }
    }
  }

  window.MEET_REPLAY_SHEFFIELD = {
    total_rows: docs.length,
    offset: 0,
    rows: docs.map((doc) => ({ id: doc._id, key: doc._id, value: { rev: doc._rev }, doc })),
  };
}());
