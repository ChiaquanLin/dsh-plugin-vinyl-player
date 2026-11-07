/**
 * Verify the tonearm geometry against the real deck layout.
 *
 * The arm's pivot sits to the right of the platter. On screen, CSS
 * `rotate(t)` maps a downward unit vector to (-sin t, cos t), so a POSITIVE
 * rotation swings the stylus LEFT, over the record; a NEGATIVE one parks it
 * on the rest. This test pins that relationship so the resting and playing
 * angles can never be swapped again.
 */

const ARM_REST = -16;
const ARM_PLAY = 30;
const ARM_MIN = -20;
const ARM_MAX = 44;
const ARM_ENGAGED = 20;

// Deck percentage layout, mirrored from the stylesheet.
const PLATTER_LEFT = 7;
const PLATTER_WIDTH = 62;
const RECORD_LEFT = PLATTER_LEFT + PLATTER_WIDTH * 0.04;
const RECORD_RIGHT = PLATTER_LEFT + PLATTER_WIDTH * 0.96;
const PIVOT_X = 74 + 13 / 2;
const PIVOT_Y = 9 + (13 / 2) * 0.16; // base is ~16% of the arm's height
const ARM_REACH = 58; // arm height (66% of deck) minus the head

const checks = [];
const check = (label, condition, detail) => {
  checks.push({ label, condition: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
};

/** Where the stylus lands, in deck-percentage coordinates, for a CSS rotation. */
const stylusAt = (degrees) => {
  const radians = (degrees * Math.PI) / 180;
  return { x: PIVOT_X - Math.sin(radians) * ARM_REACH, y: PIVOT_Y + Math.cos(radians) * ARM_REACH };
};

const onRecord = (degrees) => {
  const tip = stylusAt(degrees);
  return tip.x >= RECORD_LEFT && tip.x <= RECORD_RIGHT;
};

// --- the two home positions -------------------------------------------------
check('resting arm parks OUTSIDE the record', !onRecord(ARM_REST), `stylus x=${stylusAt(ARM_REST).x.toFixed(1)}%, record spans ${RECORD_LEFT.toFixed(1)}–${RECORD_RIGHT.toFixed(1)}%`);
check('playing arm drops ONTO the record', onRecord(ARM_PLAY), `stylus x=${stylusAt(ARM_PLAY).x.toFixed(1)}%`);

// --- the engagement rule must agree with the geometry ------------------------
check('rest is below the engagement threshold', ARM_REST < ARM_ENGAGED, `${ARM_REST} < ${ARM_ENGAGED}`);
check('play is at or above the engagement threshold', ARM_PLAY >= ARM_ENGAGED, `${ARM_PLAY} >= ${ARM_ENGAGED}`);
check(
  'the threshold itself lands on the record',
  onRecord(ARM_ENGAGED),
  `stylus x=${stylusAt(ARM_ENGAGED).x.toFixed(1)}%`,
);

// --- both home positions must be reachable by dragging -----------------------
check('rest is inside the draggable range', ARM_REST >= ARM_MIN && ARM_REST <= ARM_MAX);
check('play is inside the draggable range', ARM_PLAY >= ARM_MIN && ARM_PLAY <= ARM_MAX);

// --- the sweep moves the stylus further left as the angle grows ---------------
// Within the swept arc (< 90deg) `sin` is monotonic, so the stylus travels
// steadily leftwards; this pins the drag direction to the visual direction.
let monotonic = true;
let previous = Infinity;
for (let degrees = ARM_MIN; degrees <= ARM_MAX; degrees += 1) {
  const x = stylusAt(degrees).x;
  if (x > previous + 1e-9) monotonic = false;
  previous = x;
}
check('rotating further swings the stylus steadily left', monotonic, `sweep ${ARM_MIN}..${ARM_MAX}deg`);

// --- polarity of the drag maths ---------------------------------------------
// angleOf must invert the on-screen rotation: a pointer to the LEFT of the
// pivot (smaller clientX) must produce a LARGER angle.
const angleOf = (clientX, clientY, cx, cy) => {
  const degrees = (Math.atan2(cx - clientX, clientY - cy) * 180) / Math.PI;
  return Math.min(ARM_MAX, Math.max(ARM_MIN, degrees));
};
const down = angleOf(100, 200, 100, 100);
const left = angleOf(40, 160, 100, 100);
const right = angleOf(160, 160, 100, 100);
check('pointer straight below gives 0deg', Math.round(down) === 0, `${down.toFixed(1)}`);
check('pointer to the left yields a positive angle', left > 0, `${left.toFixed(1)}deg`);
check('pointer to the right yields a negative angle', right < 0, `${right.toFixed(1)}deg`);
check('dragging left therefore engages playback', left >= ARM_ENGAGED, `${left.toFixed(1)} >= ${ARM_ENGAGED}`);

// --- the two extremes must reach opposite intents ---------------------------
check('the sweep reaches a parked position', ARM_MIN < ARM_ENGAGED);
check('the sweep reaches an engaged position', ARM_MAX >= ARM_ENGAGED);

const failed = checks.filter((entry) => !entry.condition);
console.log(`\n${checks.length - failed.length}/${checks.length} tonearm checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
