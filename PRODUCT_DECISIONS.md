# Powerlifting Scoresheet Replay product decisions

This is the product reference for anyone continuing the project. Preserve these decisions unless the user changes them. See [README.md](README.md) for setup and tests. This is an entirely vibe-coded replay companion, not an official scoresheet.

## Audience and setup

- The app is for people watching a powerlifting meet replay who want the scoresheet to update without seeing results ahead of time. The video plays separately; viewers can step manually or sync the replay clock to a result. Keep the app simple and dependency-free.
- The default setup is to download or check out the whole folder and open `index.html` in a desktop browser. Current and recent meets need internet but no Python, terminal, account, build step, or hosting.
- Full archive search is optional. The LiftingCast archive does not allow the local browser page to read it directly, so `serve.py` serves the app and relays public, read-only archive requests on localhost. The archive picker stays hidden when opening the file directly. The historical `Sheffield 2026-01-31` archive entry is a useful manual check.
- Search is the only way to load a meet in the app. No sample buttons, file importer, or drag-and-drop. Keep synthetic fixtures for offline tests.

## Meet discovery and traffic

- Use one type-ahead field per catalog: current LiftingCast meets and, when available, archived meets. Search by name, date (`YYYY-MM-DD`), or meet ID. Show matches beneath the field; support click, arrows and Enter, and Escape to close.
- Search the full eligible catalog rather than the latest 30, but cap displayed suggestions. For the current catalog, keep past meets and those up to seven calendar days ahead, inclusive, using the browser's local date rather than the server's. Keep entries without a usable date searchable. Archive search has no date cutoff.
- Do not describe the list as completed-only. The public listing has no verified completion flag; meets can contain test results before lifting starts. Don't probe each meet just to populate search.
- Typing, stepping, and autoplay send no requests. Cache current catalogs for one hour and archive catalogs for one day, persisting them across reloads when browser storage allows. Reuse recently downloaded snapshots while the page is open and share identical requests already in flight.
- **Refresh meet** is explicit, current-catalog only, limited to once per minute per meet after a successful download, and restarts the replay. No polling or automatic retries. Honor upstream `Retry-After`, including through the archive relay; use a five-minute fallback for a rate-limit response without a usable wait time. Cached data can still be used while waiting.

## Replay and spoilers

- Reconstruct the sheet from timestamped field changes in the meet export, grouped by document and revision so related edits appear together. Replay actual entry order rather than simulating the lifting order. If the database returns conflicting versions, use the version LiftingCast returns; don't merge alternatives.
- Open just before the first recorded result, with only the declarations available by then. Space reveals the next result; arrows go to the previous or next change. Keep the timeline. Replace fixed-pace playback with **Sync & Play**: manually match the next result to the video, then apply all subsequent changes at their recorded offsets. Pause and resume preserve that timing; manual navigation resets the sync. The video and scoresheet are not linked.
- Keep the most recent weight preview visible across other updates. Preview newly entered or changed weights only when they are the immediate next update; rewinding discards previews ahead of the cursor. Show a separate red result warning when that next update touches judging, even when it also changes the weight. Reserve a line for the warning even when it is absent, so toggling it does not shift the scoresheet. Neither display advances the sheet or changes Space behavior.
- The blue outline marks the first pending attempt in recorded judging order and stays there until that attempt gets a good or bad result. **Next up** marks the second pending attempt. Outline the cell even if it has no weight yet; include the weight in **Next up** only when already on the sheet. Highlight the outlined attempt’s lifter row, and keep the latest judged flight grouping independent. Use the same outline regardless of verdict.
- Avoid spoilers, but don't claim a hard guarantee. An incomplete export can expose a final value if its history is missing, and the timeline can jump to the end. Hiding unreconstructable results and adding jump confirmation were deliberately deferred.
- Show the meet name once. Don't expose internal step or revision counts. The left toolbar shows only the current lifter and weight. After a verdict, keep the judged lifter and weight with the lights in left/head/right order for 10 seconds of wall-clock time, unless replaced by a newer verdict or rewound. Show missing lights as a dash or say none were recorded; don't guess from the result.

## Scoresheet and standings

- Group lifters by session and flight; move the most recently judged lifter's entire flight to the top, without a separate **Current flight** caption. Keep other flights in their usual order, lot order within a flight, and an unassigned group when needed. Keep **Lot** immediately after body weight.
- Show the lifter, division, class, body weight, lot, attempts, total, projected total, place and projected place. No separate best-attempt column per lift and no points or percentage columns on the main sheet. Scores and projected scores belong on the standings boards beneath it.
- The main row shows one division, but competitors are placed in every declared division. Rank within the division and weight class according to its scoring method; break score ties by lighter body weight. Keep all entrants on their boards, including people who haven't been scored or missed every attempt on a lift. Missing scores and places stay blank.
- A confirmed total sums the best good attempt in every contested lift. For each lift's projection, take the heaviest of the made attempts and the declared, still-unjudged attempts. Never assume an undeclared weight or count a miss. Leave the projection blank if any contested lift lacks a usable weight. Rank projected scores independently using the same scoring method and tie break; compare against everyone else's projections.
- Score raw, full-power lifting only. Equipped and bench-only divisions remain unscored rather than using the wrong coefficients. Use International Powerlifting Federation Goodlift (GL) points, not the legacy points formula; divisions still labelled `IPF_POINTS` use Goodlift and display that label accurately. Ordinary total-based classes still rank by total.
- Sheffield ranks by total as a percentage of the world-record total for the lifter's actual weigh-in class, with one men's and one women's overall winner, not class winners. Derive the class and the denominator from the export's record table; don't hard-code current records, guess missing records, or substitute another equipment category. Below the standings, show squat, bench, deadlift and total records per class when available.

## Cell and lifter details

- **R**, top right: entered attempt weight strictly above the matching individual lift record in the export. It appears when the weight is declared and stays on made or missed attempts; hover for the threshold.
- **Green + / red −**, top left: current weight above/below the first weight entered since the attempt weight was last cleared. Clearing only the result does not reset the comparison. Tooltip says **Increased from … to …** or **Decreased from … to …** with the meet's units when known. Judging alone doesn't trigger the badge; restoring the original weight or rewinding before the edit removes it.
- **Purple J**, bottom right: an explicitly recorded jury overturn, not an inferred correction. The attempt color follows the changed verdict; undo clears the badge. The tooltip can show the original judges' lights, labelled as such; the toolbar does not show a written verdict.
- Completed attempt tooltips show recorded white and red lights in judge order, with red, blue or yellow cards under the corresponding red light. Use a dash for missing positions, and a clear message if the entire panel is missing. Don't guess cards or reveal pending votes. Preserve the weight-change and record details when badges share a cell. Tooltips work on hover and keyboard focus.
- Lifter-name tooltip shows **Age** on meet day, not the birth date; also show body weight with units, country, team, and squat and bench rack heights as recorded. Omit missing fields and avoid duplicating country as team. Use the data available at the current replay position.

## Deferred or out of scope

- No exact attempt countdown: the inspected exports show timer settings, not start/stop history. Time between results is not an