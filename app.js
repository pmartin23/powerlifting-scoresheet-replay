'use strict';

/*
 * Wiring: load a meet, hold the cursor, respond to controls.
 *
 * LiftingCast search supplies the meet snapshot for replay.
 */

(function () {
  const Replay = window.MeetReplay;
  const Render = window.MeetRender;

  const ui = {};
  let replay = null;
  let cursor = 0;
  let playTimer = null;
  let playback = null;
  const resultHoldMs = 10_000;
  let resultHold = null;
  const shownPreviews = [];
  let loadVersion = 0;
  let refreshCurrentMeet = null;

  async function openMeet(meet, fetchMeet, canRefresh, refresh = false) {
    const version = ++loadVersion;
    ui.refresh.disabled = true;
    setStatus(`${refresh ? 'Refreshing' : 'Loading'} ${meet.name}…`);
    try {
      const data = await fetchMeet(meet.id, { refresh });
      if (version !== loadVersion || !loadMeet(data, meet.name)) return;
      refreshCurrentMeet = canRefresh ? () => openMeet(meet, fetchMeet, true, true) : null;
      ui.refresh.hidden = !refreshCurrentMeet;
    } catch (error) {
      if (version === loadVersion) setStatus(`Could not load ${meet.name}: ${error.message}`, true);
    } finally {
      if (version === loadVersion) ui.refresh.disabled = false;
    }
  }

  async function bindMeetSearch(prefix, { listMeets, fetchMeet, label, unavailable }) {
    const get = (suffix) => document.getElementById(`${prefix}-${suffix}`);
    const search = get('search');
    const list = get('results');
    const popup = get('popup');
    const empty = get('no-matches');
    let meets;
    try {
      meets = await listMeets();
    } catch (error) {
      search.placeholder = unavailable;
      search.title = error.message;
      return;
    }
    search.placeholder = meets.length ? `Search ${label}…` : `No ${label} found`;
    search.disabled = !meets.length;
    let matches = [];
    let activeIndex = -1;

    function setActive(index) {
      list.children[activeIndex]?.setAttribute('aria-selected', 'false');
      activeIndex = index;
      const option = list.children[index];
      if (option) {
        option.setAttribute('aria-selected', 'true');
        search.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      } else {
        search.removeAttribute('aria-activedescendant');
      }
    }

    function close() {
      popup.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      setActive(-1);
    }

    function open() {
      setActive(-1);
      matches = window.MeetLiftingCast.searchMeets(meets, search.value).slice(0, 100);
      const options = matches.map((meet, index) => {
        const option = document.createElement('li');
        option.id = `${prefix}-option-${index}`;
        option.textContent = meet.date ? `${meet.date} · ${meet.name}` : meet.name;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.addEventListener('mousedown', (event) => event.preventDefault());
        option.addEventListener('click', () => choose(meet));
        return option;
      });
      list.replaceChildren(...options);
      empty.hidden = matches.length > 0;
      popup.hidden = false;
      popup.scrollTop = 0;
      search.setAttribute('aria-expanded', 'true');
    }

    async function choose(meet) {
      search.value = '';
      close();
      await openMeet(meet, fetchMeet, prefix === 'meet');
    }

    search.addEventListener('focus', open);
    search.addEventListener('click', () => { if (popup.hidden) open(); });
    search.addEventListener('input', open);
    search.addEventListener('blur', close);
    search.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (popup.hidden) open();
        if (!matches.length) return;
        const next = event.key === 'ArrowDown' ? activeIndex + 1
          : activeIndex < 0 ? matches.length - 1 : activeIndex - 1;
        setActive(Math.max(0, Math.min(next, matches.length - 1)));
      } else if (event.key === 'Escape' && !popup.hidden) {
        event.preventDefault();
        close();
      } else if (event.key === 'Enter' && !popup.hidden) {
        const meet = matches[activeIndex] || (matches.length === 1 ? matches[0] : null);
        if (!meet) return;
        event.preventDefault();
        choose(meet);
      }
    });
  }

  function setStatus(message, isError) {
    ui.status.textContent = message || '';
    ui.status.classList.toggle('status-error', Boolean(isError));
  }

  function loadMeet(input, label) {
    const loaded = Replay.buildReplay(input);
    if (!loaded.steps.length) {
      setStatus(`${label} has no recorded changes to replay.`, true);
      return;
    }
    stopPlaying();
    clearResultHold();
    shownPreviews.length = 0;
    replay = loaded;

    // Start just before the first recorded result: weights, body weights and
    // rack heights are declarations, not spoilers, so applying them up front
    // gives a fully populated sheet with every result still blank.
    cursor = replay.firstResultIndex;

    ui.app.classList.remove('empty');
    setStatus('');
    draw();
    return true;
  }

  function draw() {
    const state = Replay.buildStateAt(replay, cursor);
    const sheet = Replay.buildSheet(state, replay);
    const currentAttemptId = Replay.nextJudgedAttemptId(replay, cursor, state);
    const nextUpId = Replay.nextJudgedAttemptId(replay, cursor, state, currentAttemptId);
    const currentAttempt = currentAttemptId === null ? null : state.docs[currentAttemptId];
    const highlight = { nextAttemptId: currentAttemptId, lifterId: currentAttempt?.lifterId ?? null };

    const header = Render.renderHeader(sheet);
    ui.title.textContent = header.title;
    ui.subtitle.textContent = header.subtitle;

    Render.renderSheet(ui.sheet, sheet, highlight);
    const nextAttempt = nextUpId === null ? null : state.docs[nextUpId];
    const attemptInfo = (attempt) => attempt ? {
      name: state.docs[attempt.lifterId]?.name || 'Lifter',
      weight: attempt.weight,
      units: sheet.meet?.units,
    } : null;
    const held = resultHold && state.docs[resultHold.docId];
    if (resultHold && (performance.now() >= resultHold.until
      || (held?.result !== 'good' && held?.result !== 'bad'))) clearResultHold();
    const left = resultHold
      ? { ...attemptInfo(held), lights: Replay.describeAttemptLights(held.decisions) }
      : attemptInfo(currentAttempt);
    Render.renderEvent(ui.event, left, attemptInfo(nextAttempt));
    const nextChange = Replay.describeNextStep(replay, cursor, state, sheet.meet?.units);
    while (shownPreviews.length && shownPreviews.at(-1).cursor > cursor) shownPreviews.pop();
    if (nextChange?.weightPreview && shownPreviews.at(-1)?.cursor !== cursor) {
      shownPreviews.push({ cursor, text: nextChange.weightPreview });
    }
    const weightPreview = shownPreviews.at(-1)?.text || '';
    const warning = nextChange?.warning || '';
    if (ui.nextChange.textContent !== weightPreview) ui.nextChange.textContent = weightPreview;
    if (ui.resultWarning.textContent !== warning) ui.resultWarning.textContent = warning;
    ui.attemptPreview.hidden = !weightPreview;
    ui.resultWarning.hidden = !warning;
    Render.renderStandings(ui.standings, sheet);

    ui.scrub.max = String(replay.steps.length);
    ui.scrub.value = String(cursor);

    const atStart = cursor <= 0;
    const atEnd = cursor >= replay.steps.length;
    ui.prev.disabled = atStart;
    ui.prevResult.disabled = atStart;
    ui.next.disabled = atEnd;
    ui.nextResult.disabled = atEnd;
    if (atEnd) stopPlaying();
    const anchor = playback ? null : nextSyncAnchor();
    ui.play.disabled = !playback && anchor === null;
    ui.play.textContent = !playback ? 'Sync & Play' : playback.paused ? 'Resume' : 'Pause';
    ui.play.title = playback
      ? `${ui.play.textContent} the replay clock when you ${ui.play.textContent.toLowerCase()} the video`
      : anchor === null ? 'No upcoming result with a recorded time to sync to'
        : 'Press when the next result appears in the video';
  }

  function clearResultHold() {
    if (resultHold) clearTimeout(resultHold.timer);
    resultHold = null;
  }

  function moveTo(nextCursor) {
    if (!replay) return;
    const target = Math.max(0, Math.min(nextCursor, replay.steps.length));
    if (target < cursor) clearResultHold();
    const step = target > cursor ? replay.steps[target - 1] : null;
    cursor = target;
    if (step && Replay.stepRecordsResult(step)) {
      const result = step.entries.findLast(({ path }) => path.length === 1 && path[0] === 'result');
      if (result.value === 'good' || result.value === 'bad') {
        clearResultHold();
        resultHold = {
          docId: step.docId,
          until: performance.now() + resultHoldMs,
          timer: setTimeout(() => { clearResultHold(); draw(); }, resultHoldMs),
        };
      }
    }
    draw();
  }

  function cancelPlaybackTimer() {
    if (playTimer !== null) clearTimeout(playTimer);
    playTimer = null;
  }

  function stopPlaying() {
    cancelPlaybackTimer();
    playback = null;
  }

  function nextSyncAnchor() {
    const index = Replay.nextResultIndex(replay, cursor) - 1;
    const step = replay.steps[index];
    return index >= cursor && step && Replay.stepRecordsResult(step)
      && Replay.playbackOffset(replay, index, index) !== null ? index : null;
  }

  function schedulePlayback() {
    if (!playback || playback.paused) return;
    const offset = Replay.playbackOffset(replay, playback.anchor, cursor);
    if (offset === null) {
      stopPlaying();
      setStatus('Playback stopped: the next change has no usable recorded time. Step forward manually to continue.');
      draw();
      return;
    }
    const delay = offset - (performance.now() - playback.startedAt);
    // Timer delays use a signed 32-bit value. Recheck on wakeup, including
    // after long gaps, and use the original clock so rendering cannot add drift.
    playTimer = setTimeout(() => {
      playTimer = null;
      if (performance.now() - playback.startedAt >= offset) moveTo(cursor + 1);
      schedulePlayback();
    }, Math.max(0, Math.min(Math.ceil(delay), 2 ** 31 - 1)));
  }

  function togglePlay() {
    if (!replay) return;
    const now = performance.now();
    if (playback && !playback.paused) {
      cancelPlaybackTimer();
      playback.elapsed = now - playback.startedAt;
      playback.paused = true;
      draw();
      return;
    }
    if (playback) {
      playback.startedAt = now - playback.elapsed;
      playback.paused = false;
      draw();
    } else {
      const anchor = nextSyncAnchor();
      if (anchor === null) return;
      playback = { anchor, startedAt: now, paused: false };
      setStatus('');
      moveTo(anchor + 1);
    }
    schedulePlayback();
  }

  function bind() {
    const id = (name) => document.getElementById(name);
    Object.assign(ui, {
      app: id('app'),
      title: id('title'),
      subtitle: id('subtitle'),
      sheet: id('sheet'),
      standings: id('standings'),
      event: id('event'),
      status: id('status'),
      refresh: id('refresh-meet'),
      scrub: id('scrub'),
      prev: id('prev'),
      next: id('next'),
      nextChange: id('next-change'),
      attemptPreview: id('attempt-preview'),
      resultWarning: id('result-warning'),
      prevResult: id('prev-result'),
      nextResult: id('next-result'),
      play: id('play'),
    });
    const { listMeets, fetchMeet, listArchivedMeets, fetchArchivedMeet } = window.MeetLiftingCast;
    bindMeetSearch('meet', {
      listMeets, fetchMeet, label: 'LiftingCast meets', unavailable: 'LiftingCast meet list unavailable',
    });
    if (window.location.protocol !== 'file:') {
      id('archive-picker').hidden = false;
      bindMeetSearch('archive', {
        listMeets: listArchivedMeets, fetchMeet: fetchArchivedMeet, label: 'archived meets',
        unavailable: 'Archived meet list unavailable',
      });
    }

    ui.prev.addEventListener('click', () => { stopPlaying(); moveTo(cursor - 1); });
    ui.next.addEventListener('click', () => { stopPlaying(); moveTo(cursor + 1); });
    ui.prevResult.addEventListener('click', () => {
      stopPlaying();
      moveTo(Replay.previousResultIndex(replay, cursor));
    });
    ui.nextResult.addEventListener('click', () => {
      stopPlaying();
      moveTo(Replay.nextResultIndex(replay, cursor));
    });
    ui.play.addEventListener('click', togglePlay);
    ui.refresh.addEventListener('click', () => refreshCurrentMeet?.());
    ui.scrub.addEventListener('input', () => { stopPlaying(); moveTo(Number(ui.scrub.value)); });

    document.addEventListener('keydown', (event) => {
      if (!replay) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
        || event.target === ui.refresh) return;
      if (event.key === 'ArrowRight') { stopPlaying(); moveTo(cursor + 1); }
      else if (event.key === 'ArrowLeft') { stopPlaying(); moveTo(cursor - 1); }
      else if (event.key === ' ') {
        event.preventDefault();
        stopPlaying();
        moveTo(Replay.nextResultIndex(replay, cursor));
      }
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
}());
