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
    const lastStep = cursor > 0 ? replay.steps[cursor - 1] : null;
    const description = lastStep ? Replay.describeStep(lastStep, replay, state) : null;

    const highlight = { docId: null, lifterId: null };
    if (lastStep) {
      highlight.docId = lastStep.docId;
      const doc = state.docs[lastStep.docId];
      if (lastStep.docType === 'attempt' && doc) highlight.lifterId = doc.lifterId;
      if (lastStep.docType === 'lifter') highlight.lifterId = lastStep.docId;
    }

    const header = Render.renderHeader(sheet);
    ui.title.textContent = header.title;
    ui.subtitle.textContent = header.subtitle;

    Render.renderSheet(ui.sheet, sheet, highlight);
    Render.renderEvent(ui.event, description);
    Render.renderStandings(ui.standings, sheet);

    ui.scrub.max = String(replay.steps.length);
    ui.scrub.value = String(cursor);

    const atStart = cursor <= 0;
    const atEnd = cursor >= replay.steps.length;
    ui.prev.disabled = atStart;
    ui.prevResult.disabled = atStart;
    ui.next.disabled = atEnd;
    ui.nextResult.disabled = atEnd;
    ui.play.textContent = playTimer ? 'Pause' : 'Play';
    if (atEnd) stopPlaying();
  }

  function moveTo(nextCursor) {
    if (!replay) return;
    cursor = Math.max(0, Math.min(nextCursor, replay.steps.length));
    draw();
  }

  function stopPlaying() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }

  function togglePlay() {
    if (!replay) return;
    if (playTimer) {
      stopPlaying();
      draw();
      return;
    }
    playTimer = setInterval(() => {
      if (cursor >= replay.steps.length) {
        stopPlaying();
        draw();
        return;
      }
      moveTo(Replay.nextResultIndex(replay, cursor));
    }, Number(ui.speed.value));
    draw();
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
      prevResult: id('prev-result'),
      nextResult: id('next-result'),
      play: id('play'),
      speed: id('speed'),
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
