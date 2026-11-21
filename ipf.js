'use strict';

/*
 * IPF scoring formulas, for raw full-power lifting only.
 *
 * These are NOT in a LiftingCast export. The export only carries the inputs -
 * body weight, sex, and the attempt results that make up the total. The
 * coefficients below are published by the International Powerlifting
 * Federation (IPF) and have to be hard-coded.
 *
 * Only the current formula is implemented: IPF GL points, also called
 * Goodlift, introduced in 2020. It is a multiplier on the total, scaled so
 * that about 100 is a world record. The 2019 formula it replaced is not here;
 * divisions still asking for it are scored on GL points instead.
 *
 * The IPF also publishes coefficients for equipped lifting and for bench-only
 * meets. Those are deliberately left out. `isSupported` below rejects such
 * divisions so they come back unscored, rather than being scored against raw
 * full-power numbers and producing a believable wrong answer.
 */

// 2020 IPF GL points: 100 / (a - b * e^(-c * bw)) * total.
const IPF_GL_COEFFICIENTS = {
  MALE: { a: 1199.72839, b: 1025.18162, c: 0.00921 },
  FEMALE: { a: 610.32796, b: 1045.59282, c: 0.03048 },
};

// The IPF only publishes coefficients down to these body weights, and the
// formulas misbehave below them, so lighter lifters are scored at the floor.
const MINIMUM_BODY_WEIGHT = { MALE: 40, FEMALE: 30 };

function normaliseSex(gender) {
  const value = String(gender || '').toUpperCase();
  if (value === 'FEMALE' || value === 'F' || value === 'WOMAN') return 'FEMALE';
  if (value === 'MALE' || value === 'M' || value === 'MAN') return 'MALE';
  return null;
}

/**
 * Raw full-power only. LiftingCast writes RAW / EQUIPPED, and leaves
 * `rawOrEquipped` unset on some documents, which we read as raw.
 */
function isSupported(options) {
  const equipment = String(options.rawOrEquipped || 'RAW').toUpperCase();
  if (equipment !== 'RAW' && equipment !== 'CLASSIC') return false;
  const lifts = options.lifts;
  if (!lifts) return true;
  return Boolean(lifts.squat && lifts.bench && lifts.dead);
}

function clampBodyWeight(bodyWeight, sex) {
  return Math.max(bodyWeight, MINIMUM_BODY_WEIGHT[sex] || 0);
}

/** Common input validation. @returns {string|null} the sex key, or null */
function scorableSex(options) {
  if (!isSupported(options)) return null;
  if (typeof options.total !== 'number' || options.total <= 0) return null;
  if (typeof options.bodyWeight !== 'number' || options.bodyWeight <= 0) return null;
  return normaliseSex(options.gender);
}

/**
 * @param {{ total: number, bodyWeight: number, gender: string,
 *           rawOrEquipped?: string, lifts?: Object }} options
 * @returns {number|null} IPF GL points, or null if an input is missing or the
 *          division is not raw full power
 */
function ipfGlPoints(options) {
  const sex = scorableSex(options);
  const coefficients = sex && IPF_GL_COEFFICIENTS[sex];
  if (!coefficients) return null;

  const bodyWeight = clampBodyWeight(options.bodyWeight, sex);
  const denominator = coefficients.a - coefficients.b * Math.exp(-coefficients.c * bodyWeight);
  if (!(denominator > 0)) return null;

  return Math.max(0, round2((100 / denominator) * options.total));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

window.MeetIpf = {
  ipfGlPoints,
  normaliseSex,
  isSupported,
};
