'use strict';

/*
 * Renders a point-in-time scoresheet. Reads only the sheet built by
 * replay.js, so it cannot accidentally show a value from the future.
 */

(function () {
  const { LIFT_ORDER, LIFT_LABELS, ATTEMPT_NUMBERS } = window.MeetReplay;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatWeight(value) {
    if (value === null || value === undefined) return '';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function renderHeader(sheet) {
    const meet = sheet.meet || {};
    const title = meet.name || 'Meet replay';
    const bits = [];
    if (meet.date) bits.push(meet.date);
    if (meet.federation) bits.push(meet.federation);
    if (meet.units) bits.push(meet.units);
    return { title, subtitle: bits.join('  ·  ') };
  }

  function formatPoints(value) {
    return value === null || value === undefined ? '' : value.toFixed(2);
  }

  function buildHeadRow() {
    const head = document.createElement('tr');
    head.appendChild(element('th', 'col-name', 'Lifter'));
    head.appendChild(element('th', 'col-div', 'Division'));
    head.appendChild(element('th', 'col-class', 'Class'));
    head.appendChild(element('th', 'col-bwt', 'BWt'));
    head.appendChild(element('th', 'col-lot', 'Lot'));
    for (const liftName of LIFT_ORDER) {
      for (const attemptNumber of ATTEMPT_NUMBERS) {
        const label = `${LIFT_LABELS[liftName].slice(0, 2)}${attemptNumber}`;
        const cell = element('th', `col-attempt lift-${liftName}`, label);
        cell.title = `${LIFT_LABELS[liftName]} attempt ${attemptNumber}`;
        head.appendChild(cell);
      }
    }
    head.appendChild(element('th', 'col-total', 'Total'));
    const projectedTotal = element('th', 'col-projected', 'Proj total');
    projectedTotal.title = 'Total if every attempt still standing is made';
    head.appendChild(projectedTotal);
    head.appendChild(element('th', 'col-place', 'Place'));
    const projectedPlace = element('th', 'col-projected', 'Proj place');
    projectedPlace.title = 'Place if every lifter makes the attempt they have loaded';
    head.appendChild(projectedPlace);
    return head;
  }

  function addAttemptBadge(cell, className, badgeClass, text) {
    cell.classList.add(className);
    const badge = element('span', `attempt-badge ${badgeClass}`, text);
    badge.setAttribute('aria-hidden', 'true');
    cell.appendChild(badge);
  }

  const JUDGE_POSITIONS = ['left', 'head', 'right'];
  const CARD_SYMBOLS = { red: '🔴', blue: '🔵', yellow: '🟡' };

  function renderJudgeLights(decisions) {
    const lights = element('span', 'judge-lights');
    for (const position of JUDGE_POSITIONS) {
      const vote = decisions?.[position];
      const good = vote?.decision === 'good';
      const bad = vote?.decision === 'bad';
      const cards = bad ? Object.keys(CARD_SYMBOLS).filter((color) => vote.cards?.[color] === true) : [];
      const light = element('span', 'judge-light', good ? '⚪️' : bad ? '🔴' : '—');
      light.setAttribute('aria-hidden', 'true');
      const judge = element('span', 'judge-column');
      judge.setAttribute('role', 'img');
      const cardText = cards.length ? `, ${cards.map((color) => `${color} card`).join(', ')}` : '';
      judge.setAttribute('aria-label', `${position} judge: ${good ? 'white light' : bad ? 'red light' : 'no decision recorded'}${cardText}`);
      judge.appendChild(light);
      if (cards.length) {
        const icons = element('span', 'judge-cards', cards.map((color) => CARD_SYMBOLS[color]).join(''));
        icons.setAttribute('aria-hidden', 'true');
        judge.appendChild(icons);
      }
      lights.appendChild(judge);
    }
    return lights;
  }

  function renderAttemptCell(attempt, highlightDocId, recordWeight, units) {
    const classes = ['cell-attempt'];
    let text = '';

    if (attempt && attempt.weight !== null) {
      text = formatWeight(attempt.weight);
      if (attempt.result === 'good') classes.push('result-good');
      else if (attempt.result === 'bad') classes.push('result-bad');
      else classes.push('result-pending');
    }
    if (attempt && highlightDocId && attempt.docId === highlightDocId) {
      classes.push('just-changed');
    }

    const cell = element('td', classes.join(' '));
    if (text) cell.appendChild(element('span', 'attempt-weight', text));
    const completed = attempt?.result === 'good' || attempt?.result === 'bad';
    let weightChange = '';
    if (attempt && Number.isFinite(recordWeight) && attempt.weight > recordWeight) {
      const description = `Record attempt (record: ${recordWeight})`;
      addAttemptBadge(cell, 'record-attempt', 'record-badge', 'R');
      cell.title = [description, cell.title].filter(Boolean).join('\n');
    }
    if (attempt && Number.isFinite(attempt.initialWeight) && Number.isFinite(attempt.weight)
      && attempt.weight > 0 && attempt.weight !== attempt.initialWeight) {
      const suffix = typeof units === 'string' && units ? ` ${units.toLowerCase()}` : '';
      const increased = attempt.weight > attempt.initialWeight;
      const direction = increased ? 'Increased' : 'Decreased';
      weightChange = `${direction} from ${attempt.initialWeight}${suffix} to ${attempt.weight}${suffix}`;
      addAttemptBadge(cell, 'weight-changed',
        `weight-change-badge ${increased ? 'weight-increased' : 'weight-decreased'}`,
        increased ? '+' : '−');
    }
    const jury = completed && attempt.juryOverride;
    if (jury) addAttemptBadge(cell, 'jury-overturn', 'jury-badge', 'J');
    if (completed || weightChange) {
      cell.classList.add('has-attempt-tooltip');
      const verdict = jury ? `Jury overturned to ${attempt.result === 'good' ? 'Good lift' : 'No lift'}` : '';
      const details = [verdict, weightChange, cell.title].filter(Boolean).join('\n');
      const tooltip = element('span', 'attempt-tooltip');
      tooltip.id = `attempt-tooltip-${encodeURIComponent(attempt.docId)}`;
      tooltip.setAttribute('role', 'tooltip');
      if (completed) {
        const decisions = jury ? attempt.originalDecisions : attempt.decisions;
        const recordedCount = JUDGE_POSITIONS.filter((position) =>
          ['good', 'bad'].includes(decisions?.[position]?.decision)).length;
        if (recordedCount > 0) {
          if (jury) tooltip.appendChild(element('span', 'attempt-tooltip-detail', 'Original judges’ lights'));
          tooltip.appendChild(renderJudgeLights(decisions));
        }
        if (recordedCount < JUDGE_POSITIONS.length) {
          const message = recordedCount === 0 ? 'No judges’ lights recorded' : '— = light not recorded';
          tooltip.appendChild(element('span', 'judge-data-note', message));
        }
      }
      if (details) tooltip.appendChild(element('span', 'attempt-tooltip-detail', details));
      cell.removeAttribute('title');
      cell.tabIndex = 0;
      cell.setAttribute('aria-describedby', tooltip.id);
      cell.appendChild(tooltip);
    }
    return cell;
  }

  function renderLifterName(row, units) {
    const cell = element('td', 'cell-name', row.name);
    const bodyWeight = Number.isFinite(row.bodyWeight) && row.bodyWeight > 0
      ? [formatWeight(row.bodyWeight), units?.toLowerCase()].filter(Boolean).join(' ')
      : null;
    const fields = [
      ['Age', row.age],
      ['Body weight', bodyWeight],
      ['Country', row.country],
      ['Team', row.team === row.country ? null : row.team],
      ['Squat rack height', row.squatRackHeight],
      ['Bench rack height', row.benchRackHeight],
    ];
    const details = fields.flatMap(([label, value]) => {
      if (typeof value === 'string' && value.trim()) return [`${label}: ${value.trim()}`];
      if (Number.isFinite(value)) return [`${label}: ${value}`];
      return [];
    });
    if (!details.length) return cell;
    const tooltip = element('span', 'attempt-tooltip', details.join('\n'));
    tooltip.id = `lifter-tooltip-${encodeURIComponent(row.lifterId)}`;
    tooltip.setAttribute('role', 'tooltip');
    cell.classList.add('has-attempt-tooltip');
    cell.tabIndex = 0;
    cell.setAttribute('aria-describedby', tooltip.id);
    cell.appendChild(tooltip);
    return cell;
  }

  function renderRow(row, highlight, units) {
    const tr = document.createElement('tr');
    if (highlight.lifterId === row.lifterId) tr.classList.add('row-active');

    tr.appendChild(renderLifterName(row, units));
    tr.appendChild(element('td', 'cell-div', row.divisionName));
    const weightClassName = row.recordWeightClassName || row.weightClassName;
    const classCell = element('td', 'cell-class', weightClassName);
    if (row.recordWeight) classCell.title = `record total ${formatWeight(row.recordWeight)}`;
    tr.appendChild(classCell);
    tr.appendChild(element('td', 'cell-bwt', formatWeight(row.bodyWeight)));
    tr.appendChild(element('td', 'cell-lot', row.lot === null ? '' : String(row.lot)));

    for (const liftName of LIFT_ORDER) {
      for (let i = 0; i < ATTEMPT_NUMBERS.length; i++) {
        tr.appendChild(renderAttemptCell(
          row.lifts[liftName][i], highlight.docId, row.liftRecords[liftName], units,
        ));
      }
    }

    tr.appendChild(element('td', 'cell-total', formatWeight(row.total)));
    tr.appendChild(element('td', 'cell-projected', formatWeight(row.projectedTotal)));
    tr.appendChild(element('td', 'cell-place', row.place === null ? '' : String(row.place)));
    tr.appendChild(element(
      'td',
      'cell-projected',
      row.projectedPlace === null ? '' : String(row.projectedPlace),
    ));
    return tr;
  }

  function groupFlights(rows) {
    const groups = new Map();
    for (const row of rows) {
      const session = String(row.session ?? '').trim();
      const flight = String(row.flight ?? '').trim();
      const key = JSON.stringify([session, flight]);
      if (!groups.has(key)) groups.set(key, { session, flight, rows: [] });
      groups.get(key).rows.push(row);
    }
    const byLabel = (a, b) => Number(!a) - Number(!b) || a.localeCompare(b, undefined, { numeric: true });
    return [...groups.values()].sort((a, b) => byLabel(a.session, b.session) || byLabel(a.flight, b.flight));
  }

  function renderSheet(container, sheet, highlight) {
    const table = element('table', 'scoresheet');
    const groups = groupFlights(sheet.rows);
    const showSession = new Set(groups.map(({ session }) => session)).size > 1;
    const flightLabel = (group) => {
      const flight = group.flight ? `Flight ${group.flight}` : 'Unassigned flight';
      const session = group.session ? `Session ${group.session}` : 'Unassigned session';
      return showSession ? `${session} · ${flight}` : flight;
    };
    if (sheet.activeLifterId != null) {
      const activeIndex = groups.findIndex(({ rows }) => rows.some(({ lifterId }) => lifterId === sheet.activeLifterId));
      if (activeIndex > 0) groups.unshift(...groups.splice(activeIndex, 1));
    }

    const thead = document.createElement('thead');
    const columnHead = buildHeadRow();
    thead.appendChild(columnHead);
    table.appendChild(thead);

    for (const group of groups) {
      const tbody = document.createElement('tbody');
      const heading = document.createElement('tr');
      const header = element('th', 'flight-heading', flightLabel(group));
      header.setAttribute('scope', 'rowgroup');
      header.colSpan = columnHead.children.length;
      heading.appendChild(header);
      tbody.appendChild(heading);
      for (const row of group.rows) tbody.appendChild(renderRow(row, highlight, sheet.meet?.units));
      table.appendChild(tbody);
    }

    container.replaceChildren(table);
  }

  function renderEvent(container, description) {
    if (!description) {
      container.replaceChildren(element('span', 'event-empty', 'Nothing applied yet.'));
      return;
    }
    const style = description.isJuryOverturn ? ' event-jury' : description.isResult ? ' event-result' : '';
    const verdictStyle = description.isJuryOverturn && description.juryVerdict === 'good' ? ' event-jury-good' : '';
    const wrap = element('div', `event${style}${verdictStyle}`);
    wrap.appendChild(element('span', 'event-time', description.timeStamp || ''));
    wrap.appendChild(element('span', 'event-subject', description.subject));
    wrap.appendChild(element('span', 'event-detail', description.detail));
    container.replaceChildren(wrap);
  }

  /**
   * The points-scored standings - "Best Lifter" in most IPF meets. Kept
   * separate from the scoresheet because it reorders lifters, and it is the
   * only place a lifter's second declared division shows up.
   */
  function renderStandings(container, sheet) {
    const groups = (sheet.standings || [])
      .filter((group) => group.scoreBy !== 'TOTAL' && group.entries.length)
      .sort((a, b) => a.divisionName.localeCompare(b.divisionName));

    const wrap = element('div', 'standings');
    for (const group of groups) {
      const block = element('div', 'standings-group');
      const heading = group.weightClassName && group.weightClassName !== 'All'
        ? `${group.divisionName} - ${group.weightClassName}`
        : group.divisionName;
      block.appendChild(element('h3', null, heading));

      const table = element('table', 'standings-table');
      const head = document.createElement('tr');
      head.appendChild(element('th', null, '#'));
      head.appendChild(element('th', null, 'Lifter'));
      head.appendChild(element('th', null, 'Total'));
      head.appendChild(element('th', null, group.scoreLabel));
      head.appendChild(element('th', null, `Proj ${group.scoreLabel}`));
      head.appendChild(element('th', null, 'Proj place'));
      table.appendChild(head);

      for (const entry of group.entries) {
        const tr = document.createElement('tr');
        tr.appendChild(element('td', 'cell-place', entry.placing.place === null ? '' : String(entry.placing.place)));
        tr.appendChild(element('td', 'cell-name', entry.row.name));
        tr.appendChild(element('td', 'cell-total', formatWeight(entry.row.total)));
        tr.appendChild(element('td', 'cell-points', formatPoints(entry.placing.value)));
        tr.appendChild(element(
          'td',
          'cell-projected',
          formatPoints(entry.placing.projectedValue),
        ));
        tr.appendChild(element(
          'td',
          'cell-projected',
          entry.placing.projectedPlace === null ? '' : String(entry.placing.projectedPlace),
        ));
        table.appendChild(tr);
      }
      block.appendChild(table);
      wrap.appendChild(block);
    }

    const recordsBlock = renderRecords(sheet);
    if (recordsBlock) wrap.appendChild(recordsBlock);

    if (!wrap.childElementCount) {
      container.replaceChildren();
      return;
    }
    container.replaceChildren(wrap);
  }

  /**
   * The record table the meet is scored against, shown under the boards so a
   * percentage on the board can be checked against the number behind it. No
   * spoiler: these are world records, fixed before anyone lifts.
   */
  function renderRecords(sheet) {
    const records = window.MeetRecords;
    if (!records || !sheet.records) return null;

    const divisionCodes = Object.values(sheet.divisions || {})
      .map((division) => division.usaplDivisionCode);
    const blocks = records.recordTotals(sheet.records, divisionCodes);
    if (!blocks.length) return null;

    const wrap = element('div', 'records');
    wrap.appendChild(element('h3', null, 'World record totals'));
    for (const block of blocks) {
      const table = element('table', 'records-table');
      const head = document.createElement('tr');
      head.appendChild(element('th', null, block.label));
      for (const lift of records.RECORD_LIFTS) {
        head.appendChild(element('th', null, lift.label));
      }
      table.appendChild(head);

      for (const weightClass of block.classes) {
        const tr = document.createElement('tr');
        tr.appendChild(element('td', 'cell-class', weightClass.name));
        for (const lift of records.RECORD_LIFTS) {
          tr.appendChild(element('td', 'cell-total', formatWeight(weightClass[lift.field])));
        }
        table.appendChild(tr);
      }
      wrap.appendChild(table);
    }
    return wrap;
  }

  window.MeetRender = { renderSheet, renderEvent, renderHeader, renderStandings };
}());
