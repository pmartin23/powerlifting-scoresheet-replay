# Meet replay

Follow a powerlifting scoresheet filling in as it happened, so you can watch a
recorded meet without the final result sitting on screen in front of you.

> **Disclaimer:** This app was entirely vibe-coded. Treat it as a replay companion, not an official scoresheet.

## Open in your browser

1. Download or check out the project. If you downloaded a zip, extract it first
   and keep the `meet-replay` folder together.
2. Open **`meet-replay/index.html`** in a current desktop browser. No Python,
   terminal, account, or build is needed.
3. With an internet connection, use **Search LiftingCast meets** to find a meet
   in the current public catalog. Start your video separately and press
   **Space** to reveal results as you watch.

### Optional: search the full archive

The archive search is hidden when you open the file directly. To use it, run
`python3 serve.py` from the `meet-replay` folder (on Windows, `py -3 serve.py`)
and visit <http://127.0.0.1:8000/>. Python 3.10 or newer is recommended. Keep the
terminal open while you watch; press **Ctrl+C** to stop the server. It only
listens on your computer.

In **Search archived meets**, try `Sheffield 2026-01-31` and select
**SBD Sheffield 2026 Powerlifting Championships**.

### Troubleshooting

| What you see | What to do |
| --- | --- |
| `python3` not found | Install Python 3 from [python.org](https://www.python.org/downloads/) and reopen the terminal. On Windows, try `py -3 --version`. |
| Address already in use | Run `python3 serve.py --port 8001` (or `py -3 serve.py --port 8001`) and use <http://127.0.0.1:8001/>. |
| Browser can't connect | Make sure the terminal is still running the server and open the address it prints. |
| Archive search is disabled | Open the local server address, not `index.html` directly. Opening the file directly only supports the current catalog. |
| Meet unavailable or no recorded changes | Try another meet. Some listings don't have enough recorded history to replay. |
| LiftingCast asks you to slow down | Wait for the indicated time before trying again. The app won't retry automatically. |

## Controls

| Control | Does |
| --- | --- |
| `→` / `←` | Next or previous change |
| `Space` | Jump to the next result — the useful one while watching |
| Play / Pause | Auto-advance through results at the selected pace; not synced to the video |
| Timeline slider | Jump anywhere, including straight to the end |

The replay opens just before the first recorded result, with any declarations
already entered by then. Use **Space** to follow the video without jumping ahead.

## What the replay can reconstruct

LiftingCast stores a snapshot and, for some fields, a history of changes. The
engine removes fields with recorded changes from the starting sheet and applies
those changes in timestamp order. It cannot reconstruct an earlier value when
there is no history: some incomplete exports can reveal a final value on load.
The timeline can also reveal results if you jump ahead.

Consequences worth knowing:

- Anything edited during the meet is absent until its first event replays. A
  lifter renamed mid-meet shows no name at step 0.
- Revisions are grouped, so a result and its three judges' decisions — written
  under one `rev` — advance the replay by a single step.
- Jury reversals replay naturally: `result: good` → `result: null` →
  `result: good` shows as the cell being given, taken away, then given back.
- Re-declared attempt weights replay too, so you see 215 become 212.5.

## Tests and project files

Node.js 22 or newer is recommended for the tests only. From `meet-replay`, run:

```sh
node --test test-*.cjs
```

The tests use fixtures and simulated network responses, so they don't need a
local server or make requests to LiftingCast.

| File | Role |
| --- | --- |
| `index.html`, `styles.css` | Browser page and scoresheet styling. |
| `serve.py` | Local server for the page and read-only archive requests. |
| `liftingcast.js` | Meet search, snapshot downloads, caching, and wait times. |
| `ipf.js` | International Powerlifting Federation Goodlift points. |
| `records.js` | Percent-of-record scoring, reading the export's record table. |
| `replay.js` | Pure engine: baseline, event stream, state at a cursor, scoresheet derivation. No DOM, no network. |
| `render.js` | Draws the scoresheet and event log from a derived sheet. |
| `app.js` | Loading, cursor, controls, keyboard. |
| `fixtures/sample-meet.js` | Synthetic meet with a jury reversal, a re-declared weight and a bombed deadlift. |
| `fixtures/sheffield-meet.js` | Synthetic meet in the Sheffield format: percent of record, eight lifters, a real record table, and weight changes on a squat opener and two third deadlifts. |
| `test-replay.cjs` | Checks the engine against the sample meet. `node test-replay.cjs` |
| `test-real-shapes.cjs` | Checks the shapes only real exports have. `node test-real-shapes.cjs` |
| `test-ipf.cjs` | Checks the points formulas and division placing. `node test-ipf.cjs` |
| `test-records.cjs` | Checks percent-of-record scoring. `node test-records.cjs` |
| `test-sheffield.cjs` | Checks the Sheffield fixture end to end. `node test-sheffield.cjs` |

## Searching LiftingCast meets

Type a name, date (`YYYY-MM-DD`), or meet ID in **Search LiftingCast meets**.
Matches appear below the same field as you type. Click a match or use the
arrow keys and Enter to select it. Past meets and meets up to seven calendar
days ahead are shown, based on your browser's local date. Meets without a
usable date remain searchable. Selecting a meet downloads its read-only
snapshot and starts just before the first recorded result when one exists.
Uncached meets require an internet connection. The current catalog is cached
for one hour and the archive catalog for one day, across reloads when browser
storage is available. Recently downloaded snapshots are reused while the page
is open. **Refresh meet** reloads a current meet from the beginning, at most
once per minute for that meet. The app does not poll or retry automatically;
if LiftingCast asks it to wait, it pauses requests to that source.

Hover over a lifter’s name or focus it with Tab to see their age on meet day,
country, team, and squat and bench rack heights when available.

## Flight grouping

The scoresheet groups lifters by flight within each session, in lot order
within each flight. The flight of the most recently judged lifter moves to
the top. Replay still follows the order results were entered.

## Data limits

- The main sheet shows one division per lifter; standings can include the same
  lifter in multiple divisions.
- If the database records conflicting edits, the replay uses the version
  LiftingCast returns, without merging the alternatives.

## Projection

Alongside the total and the place, each row carries a projected total and a
projected place: where the lifter would end up if every attempt still standing
is made, by them and by everyone they are up against. For the total, each lift
takes the best good attempt so far, or a heavier attempt that is declared but
not yet judged, whichever is larger. The place then comes from ranking the
projections the same way the real places are ranked, including through the
points and percent-of-record formulas. On the boards the projected score is
shown next to the real one, so you can see both the place and the number
behind it.

This is the number worth watching. A lifter can be second on the board and
first on paper, with the bar already loaded to put them there.

Since openers for all three lifts are entered at weigh-in, every lifter has a
projection from the first attempt of the meet. It is never a guess about
weights nobody has entered, though: a lift with nothing declared gives no
projection, and a lifter who has missed all three attempts on a lift loses
their projection the same way they lose their total - at which point whoever
was behind them is projected to win.

Standings boards include every entrant in their division, even before they
have openers or after they miss all attempts on a lift. Scores and places
stay blank until there is a score to rank.

## IPF GL points

An export does not contain points. It only contains the inputs: body weight,
sex, and the attempt results that make up the total. `ipf.js` holds the International Powerlifting
Federation's published coefficients and does the arithmetic.

Only the current formula is implemented: IPF GL points, also called Goodlift,
introduced in 2020. It is a multiplier on the total, scaled so that about 100
is a world record. The 2019 formula it replaced is not here, and divisions
still asking for it (`scoreBy: "IPF_POINTS"`) are scored on GL points instead.

Only raw full-power lifting is scored. The IPF publishes coefficients for
equipped and bench-only too, but they are left out on purpose: an equipped or
bench-only division comes back unscored rather than being scored against raw
full-power numbers, which would look believable and be wrong. Body weights
below the lightest published class are scored at that class's floor, which is
what the federation's own calculator does.

A lifter normally declares two divisions: a weight class scored on total, and a
Best Lifter award scored on points. Both are placed. The scoresheet is kept to
weights and places - no points column - because points reorder the field, so
every points-scored division gets its own board below the sheet, showing the
score, the projected score, and both places.

## Percent of record (the Sheffield format)

The Sheffield Championships score differently: lifters weigh in at whatever
class they like, and the winner - one man, one woman - is whoever totals the
highest percentage of the world record for the class they landed in. There are
no class winners. LiftingCast marks these divisions `scoreBy:
"PERCENT_OF_RECORD"`.

This one needs no hard-coded numbers, because the export carries the record
table itself, in a document whose `data` nests like

    data.MALE.RAW.T.O["120+"].FP.T.W = 1152.5

reading sex, equipment, record type, division code, weight class, event, lift,
weight. Two of those levels are not documented, so `records.js` walks the tree
tolerantly: it takes the key it recognises, or the only key when there is one.
The raw level is read directly rather than tolerantly, so a table holding only
equipped records comes back empty instead of being mistaken for a raw one.

The catch is that these divisions declare a single "All" weight class, so a
lifter's real class is not recorded anywhere. It is worked out from their body
weight against the class limits the record table itself lists, which means
nobody can be scored until they have weighed in. The scoresheet shows the
derived class, with the record total in the cell's tooltip.

The records themselves are listed under the boards, one table per sex, with the
squat, bench, deadlift and total record for every class the table covers - so a
percentage can be checked against the number behind it, and a single lift can
be watched against the record too. An **R** marks any entered attempt above
its class record in the export, whether pending, made, or missed.
A green **+** marks an increase and a red **−** marks a decrease from the first
entered weight. Hover over the cell or focus it with Tab to see both weights.
Completed attempts also show each judge’s light (left, head, right) with any
recorded infraction cards beneath the corresponding red light. A purple **J**
marks a recorded jury overturn. The event line announces **JURY OVERTURNED
TO GOOD LIFT** in green or **JURY OVERTURNED TO NO LIFT** in red; hover for the original
judges’ lights if available.
