'use strict';

/*
 * Percent of record scoring.
 *
 * Unlike the International Powerlifting Federation (IPF) points formulas,
 * this one needs no hard-coded constants: a LiftingCast export carries the
 * record table itself, in a document whose `data` is nested like
 *
 *   data[sex][equipment][recordType][divisionCode][weightClass][event][lift].W
 *
 * for example data.MALE.RAW.T.O["120+"].FP.T.W = 1152.5, the men's raw open
 * world-record total. The keys mean:
 *
 *   sex           MALE / FEMALE
 *   equipment     RAW / EQUIPPED
 *   recordType    T for drug-tested records
 *   divisionCode  O for Open, matching a division's `usaplDivisionCode`
 *   weightClass   the class limit in kg, with a trailing "+" for the heaviest
 *   event         FP full power, BO bench only
 *   lift          S squat, B bench, D deadlift, T total
 *
 * A division scored `PERCENT_OF_RECORD` ranks lifters on their total as a
 * percentage of the record for their sex and weight class. Raw full power
 * only; equipped and bench-only divisions come back unscored.
 *
 * Note the catch: these divisions usually declare a single "All" weight class,
 * so the lifter's real class has to be worked out from body weight against the
 * class limits the record table itself lists.
 */

/** True if a document looks like the record table. */
function isRecordTable(doc) {
  return Boolean(doc && doc.data && typeof doc.data === 'object'
    && (doc.data.MALE || doc.data.FEMALE));
}

/**
 * Turns a weight class key into something sortable. "120" -> 120, "120+" ->
 * 120 but flagged as the unlimited class above it.
 */
function parseClassKey(key) {
  const unlimited = key.endsWith('+');
  const limit = parseFloat(unlimited ? key.slice(0, -1) : key);
  return { key, limit, unlimited };
}

/**
 * The weight class a body weight falls in, chosen from the classes the record
 * table actually lists. Lightest class that the lifter is not over; if they
 * are over every limit, the unlimited class.
 */
function weightClassFor(classKeys, bodyWeight) {
  const classes = classKeys.map(parseClassKey).sort((a, b) => a.limit - b.limit);
  for (const candidate of classes) {
    if (!candidate.unlimited && bodyWeight <= candidate.limit) return candidate.key;
  }
  const unlimited = classes.find((candidate) => candidate.unlimited);
  // A meet with no unlimited class puts anyone heavier in the top class.
  return unlimited ? unlimited.key : (classes.length ? classes[classes.length - 1].key : null);
}

/**
 * Walks one level of the record table. Takes the preferred key if it is there,
 * otherwise the only key, otherwise nothing - which is how a lifter in a
 * category the table does not cover ends up unscored rather than mis-scored.
 */
function descend(node, preferred) {
  if (!node || typeof node !== 'object') return null;
  for (const key of preferred) {
    if (key && node[key] !== undefined) return node[key];
  }
  const keys = Object.keys(node);
  return keys.length === 1 ? node[keys[0]] : null;
}

/**
 * Looks up the raw full-power records for a body weight.
 *
 * The RAW level is read directly rather than tolerantly: a table holding only
 * equipped records must come back empty, not be mistaken for a raw one.
 *
 * @param {Object} table the record document's `data`
 * @param {{ gender, bodyWeight, divisionCode }} options
 * @returns {{ fullPower: Object, weightClassName: string }|null}
 */
function lookupFullPower(table, options) {
  const bySex = table && table[options.gender];
  const byEquipment = bySex && bySex.RAW;
  // Record type (tested vs untested) is not on a LiftingCast lifter, so take
  // the tested table when there is a choice - that is what federations post.
  const byType = descend(byEquipment, ['T']);
  const byDivision = descend(byType, [options.divisionCode, 'O']);
  if (!byDivision) return null;

  const weightClassName = weightClassFor(Object.keys(byDivision), options.bodyWeight);
  if (!weightClassName) return null;

  const fullPower = byDivision[weightClassName]?.FP;
  return fullPower ? { fullPower, weightClassName } : null;
}

function lookupRecord(table, options) {
  const category = lookupFullPower(table, options);
  if (!category) return null;
  const weight = recordWeight(category.fullPower, 'T');
  return weight === null ? null : { weight, weightClassName: category.weightClassName };
}

/** Record thresholds for entered attempts, without requiring a completed total. */
function liftRecords({ records, bodyWeight, gender, ...options }) {
  if (!Number.isFinite(bodyWeight) || bodyWeight <= 0) return {};
  const ipf = window.MeetIpf;
  if (!ipf || !ipf.isSupported(options)) return {};
  const sex = ipf.normaliseSex(gender);
  if (!sex) return {};
  const category = lookupFullPower(records, { ...options, gender: sex, bodyWeight });
  if (!category) return {};
  return Object.fromEntries(RECORD_LIFTS.filter(({ field }) => field !== 'total')
    .map(({ field, key }) => [field, recordWeight(category.fullPower, key)]));
}

/**
 * A lifter's total as a percentage of the record for their category.
 *
 * @returns {{ value: number|null, recordWeight: number|null,
 *             weightClassName: string|null }}
 */
function percentOfRecord(options) {
  const empty = { value: null, recordWeight: null, weightClassName: null };
  if (!options.records) return empty;
  if (typeof options.total !== 'number' || options.total <= 0) return empty;
  if (typeof options.bodyWeight !== 'number' || options.bodyWeight <= 0) return empty;

  const ipf = window.MeetIpf;
  // Raw full power only, same as the points formulas.
  if (!ipf.isSupported(options)) return empty;
  const sex = ipf.normaliseSex(options.gender);
  if (!sex) return empty;

  const record = lookupRecord(options.records, {
    gender: sex,
    bodyWeight: options.bodyWeight,
    divisionCode: options.divisionCode,
  });
  if (!record) return empty;

  return {
    value: Math.round((options.total / record.weight) * 10000) / 100,
    recordWeight: record.weight,
    weightClassName: record.weightClassName,
  };
}

const SEX_LABELS = { MALE: 'Men', FEMALE: 'Women' };

/** The four record weights a full-power table carries, in lifting order. */
const RECORD_LIFTS = [
  { field: 'squat', key: 'S', label: 'Squat' },
  { field: 'bench', key: 'B', label: 'Bench' },
  { field: 'dead', key: 'D', label: 'Deadlift' },
  { field: 'total', key: 'T', label: 'Total' },
];

/** The record weight for one lift, or null if the table does not carry it. */
function recordWeight(fullPower, key) {
  const record = fullPower && fullPower[key];
  const weight = record && typeof record.W === 'number' ? record.W : null;
  return weight !== null && weight > 0 ? weight : null;
}

/**
 * The raw full-power records, laid out for display: one block per sex, each
 * listing every weight class the table covers, lightest first, with the squat,
 * bench, deadlift and total record for that class.
 *
 * Walks the table exactly the way `lookupRecord` does, so what is shown is
 * what lifters are actually scored against.
 *
 * @param {Object} table the record document's `data`
 * @param {string[]} divisionCodes division codes the meet uses, preferred over
 *   the generic Open table when the record table has more than one
 * @returns {{ sex, label, classes: { name, squat, bench, dead, total }[] }[]}
 */
function recordTotals(table, divisionCodes) {
  if (!table) return [];
  const preferred = [...(divisionCodes || []).filter(Boolean), 'O'];

  return Object.keys(SEX_LABELS).reduce((blocks, sex) => {
    const bySex = table[sex];
    const byDivision = descend(descend(bySex && bySex.RAW, ['T']), preferred);
    if (!byDivision) return blocks;

    const classes = Object.keys(byDivision)
      .map((name) => {
        const fullPower = descend(byDivision[name], ['FP']);
        const weights = { name };
        for (const lift of RECORD_LIFTS) weights[lift.field] = recordWeight(fullPower, lift.key);
        return weights;
      })
      // A class with nothing in it is dropped; a class missing one lift is not.
      .filter((entry) => RECORD_LIFTS.some((lift) => entry[lift.field] !== null))
      .sort((a, b) => parseClassKey(a.name).limit - parseClassKey(b.name).limit);

    if (classes.length) blocks.push({ sex, label: SEX_LABELS[sex], classes });
    return blocks;
  }, []);
}

window.MeetRecords = {
  isRecordTable,
  percentOfRecord,
  weightClassFor,
  lookupRecord,
  liftRecords,
  recordTotals,
  RECORD_LIFTS,
};
