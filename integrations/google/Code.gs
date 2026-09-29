/**
 * Command Center — Google sync (phase 3).
 *
 * One copy of this script per Google account (each tagged with its own ACCOUNT
 * label in Script Properties). Pushes calendar events + candidate reviewer mail
 * to POST /api/google/sync. No OAuth client lives in the app — this script runs
 * entirely inside the user's own Google account using CalendarApp/GmailApp, and
 * only ever sends data outward over HTTPS with a bearer token.
 *
 * Never logs CC_TOKEN or any mail/event body — only the HTTP response status.
 *
 * Script Properties (Project Settings > Script Properties):
 *   CC_URL         e.g. https://your-app.vercel.app
 *   CC_TOKEN       GOOGLE_SYNC_TOKEN from the app's .env.local / Vercel env
 *   ACCOUNT        a short label for this account, e.g. 'main' or 'lab'
 *   CALENDAR_IDS   comma-separated calendar ids (default: 'primary')
 *   GMAIL_QUERY    Gmail search query for candidate reviewer mail (default below)
 *   DAYS_BACK      how many days of past calendar events to sync (default 7)
 *   DAYS_AHEAD     how many days of future calendar events to sync (default 60)
 *   WRITE_DEADLINES 'true' on ONE account only: mirror the dashboard's due dates
 *                  (paper revisions, accepted reviews, other deadlines) into this
 *                  account's default calendar as all-day events tagged [CC:...]
 *   WORK_SHEET_ID  (optional, opt-in) id of the clinic's shared shift sheet. Unset = no
 *                  work sync and no `work` key in the payload.
 *   WORK_NAME      the name cell of YOUR row in that sheet. Only that row is read; only
 *                  {date, code} pairs are sent (never the name or other rows).
 *   WORK_MONTHS_BACK months before the current one to read (default 1)
 */

var DEFAULT_GMAIL_QUERY =
  'newer_than:21d -category:promotions -category:social ' +
  '(subject:(review OR reviewer OR reviewing OR 심사 OR decision OR revision OR revise OR 수정) ' +
  'OR "invitation to review" OR "review is due")';

function getProp_(name, fallback) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  return value ? value : fallback;
}

function requireProps_() {
  var ccUrl = getProp_('CC_URL', null);
  var ccToken = getProp_('CC_TOKEN', null);
  var account = getProp_('ACCOUNT', null);
  if (!ccUrl || !ccToken || !account) {
    throw new Error('CC_URL, CC_TOKEN, and ACCOUNT must all be set in Script Properties.');
  }
  return { ccUrl: ccUrl, ccToken: ccToken, account: account };
}

/** Validates properties, runs sync() once, and installs the hourly trigger (idempotent). */
function setup() {
  requireProps_();
  sync();
  installTrigger_();
  Logger.log('Setup complete: ran one sync and installed the hourly trigger.');
}

/** Removes every trigger created by this script. */
function teardown() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(triggers[i]);
  }
  Logger.log('Removed ' + triggers.length + ' trigger(s).');
}

function installTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('sync').timeBased().everyHours(1).create();
}

/** Main entry point: gathers calendar events + candidate mail and POSTs them once. */
function sync() {
  var props = requireProps_();
  var calendarIds = getProp_('CALENDAR_IDS', 'primary').split(',').map(function (s) {
    return s.trim();
  }).filter(function (s) {
    return s.length > 0;
  });
  var daysBack = parseInt(getProp_('DAYS_BACK', '7'), 10);
  var daysAhead = parseInt(getProp_('DAYS_AHEAD', '60'), 10);

  var now = new Date();
  var from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  var to = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  var events = collectEvents_(calendarIds, from, to);
  var mails = collectMails_();
  var trashedMessageIds = collectTrashedIds_();
  var work = collectWorkShifts_();

  var payload = {
    account: props.account,
    calendar: {
      from: formatDate_(from),
      to: formatDate_(to),
      events: events,
    },
    mails: mails,
    trashedMessageIds: trashedMessageIds,
  };
  if (work !== null) payload.work = work;

  var response = UrlFetchApp.fetch(props.ccUrl.replace(/\/$/, '') + '/api/google/sync', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + props.ccToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = response.getResponseCode();
  var written = '-';
  if (code === 200 && getProp_('WRITE_DEADLINES', '') === 'true') {
    var body = JSON.parse(response.getContentText());
    written = writeDeadlines_(body.deadlines || []);
  }
  // Log status only — never the token or the payload body.
  Logger.log('sync() -> HTTP ' + code + ', events=' + events.length + ', mails=' + mails.length +
    ', trashed=' + trashedMessageIds.length + ', deadlines=' + written +
    (work !== null ? ', work=' + work.shifts.length : ''));
}

var WORK_TAB_RE = /^(\d{2})\.(\d{1,2})$/;
var WORK_DATE_RE = /^\d{1,2}\/\d{1,2}$/;

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Reads only the owner's row (name cell === WORK_NAME) from the shared shift sheet's
 * `YY.MM` tabs. Returns {from, to, shifts:[{date, code}]} or null (unset / error /
 * no tab in range). Never logs names or cell values. */
function collectWorkShifts_() {
  var sheetId = getProp_('WORK_SHEET_ID', null);
  var name = getProp_('WORK_NAME', null);
  if (!sheetId || !name) return null;
  try {
    var back = parseInt(getProp_('WORK_MONTHS_BACK', '1'), 10);
    if (isNaN(back) || back < 0) back = 1;
    var nowKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM').split('-');
    var minKey = Number(nowKey[0]) * 12 + Number(nowKey[1]) - 1 - back;
    var tabs = [];
    var sheets = SpreadsheetApp.openById(sheetId).getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var m = WORK_TAB_RE.exec(sheets[i].getName());
      if (!m) continue;
      var year = 2000 + Number(m[1]);
      var month = Number(m[2]);
      if (year * 12 + month - 1 < minKey) continue;
      tabs.push({ sheet: sheets[i], year: year, month: month });
    }
    if (tabs.length === 0) return null;
    tabs.sort(function (a, b) { return (a.year * 12 + a.month) - (b.year * 12 + b.month); });

    var byDate = {};
    for (var t = 0; t < tabs.length; t++) {
      var rows = tabs[t].sheet.getDataRange().getDisplayValues();
      var dateRow = null;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var hits = 0;
        for (var c = 0; c < row.length; c++) if (WORK_DATE_RE.test(String(row[c]).trim())) hits++;
        if (hits >= 5) { dateRow = row; continue; }
        if (!dateRow || String(row[0]).trim() !== name) continue;
        for (var col = 0; col < dateRow.length && col < row.length; col++) {
          var cell = String(dateRow[col]).trim();
          var code = String(row[col]).trim().slice(0, 30);
          if (!WORK_DATE_RE.test(cell) || !code) continue;
          var parts = cell.split('/');
          var dMonth = Number(parts[0]);
          var y = tabs[t].year;
          if (tabs[t].month === 12 && dMonth === 1) y++;
          else if (tabs[t].month === 1 && dMonth === 12) y--;
          byDate[y + '-' + pad2_(dMonth) + '-' + pad2_(Number(parts[1]))] = code; // later tab wins
        }
      }
    }
    var shifts = [];
    for (var d in byDate) shifts.push({ date: d, code: byDate[d] });
    shifts.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var first = tabs[0];
    var last = tabs[tabs.length - 1];
    var lastDay = new Date(Date.UTC(last.year, last.month, 0)).getUTCDate();
    return {
      from: first.year + '-' + pad2_(first.month) + '-01',
      to: last.year + '-' + pad2_(last.month) + '-' + pad2_(lastDay),
      shifts: shifts,
    };
  } catch (e) {
    Logger.log('work: error ' + e.name);
    return null;
  }
}

var CC_MARKER_RE = /\[CC:([^\]]+)\]/;

/** Upserts one all-day event per dashboard deadline (matched by the [CC:key] marker in
 * the description) and deletes marker events whose deadline is gone or done. Only
 * touches events carrying a marker — never the user's own events. */
function writeDeadlines_(deadlines) {
  var cal = CalendarApp.getDefaultCalendar();
  var now = new Date();
  var existing = cal.getEvents(new Date(now.getTime() - 30 * 864e5), new Date(now.getTime() + 400 * 864e5));
  var byKey = {};
  for (var i = 0; i < existing.length; i++) {
    var m = CC_MARKER_RE.exec(existing[i].getDescription() || '');
    if (m) byKey[m[1]] = existing[i];
  }
  var wanted = {};
  var created = 0, updated = 0, removed = 0;
  for (var j = 0; j < deadlines.length; j++) {
    var d = deadlines[j];
    wanted[d.key] = true;
    var parts = d.date.split('-');
    var day = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var ev = byKey[d.key];
    if (!ev) {
      cal.createAllDayEvent(d.title, day, { description: 'Command Center 마감 [CC:' + d.key + ']' });
      created++;
    } else {
      var changed = false;
      if (ev.getTitle() !== d.title) { ev.setTitle(d.title); changed = true; }
      if (!ev.isAllDayEvent() || formatLocal_(ev.getAllDayStartDate()) !== d.date) { ev.setAllDayDate(day); changed = true; }
      if (changed) updated++;
    }
  }
  for (var key in byKey) {
    if (!wanted[key]) { byKey[key].deleteEvent(); removed++; }
  }
  return '+' + created + '/~' + updated + '/-' + removed;
}

function formatLocal_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDate_(d) {
  return Utilities.formatDate(d, 'Etc/UTC', 'yyyy-MM-dd');
}

/** Gathers events from every configured calendar, skipping declined events where detectable. */
function collectEvents_(calendarIds, from, to) {
  var out = [];
  for (var i = 0; i < calendarIds.length; i++) {
    var calId = calendarIds[i];
    var cal = CalendarApp.getCalendarById(calId === 'primary' ? CalendarApp.getDefaultCalendar().getId() : calId);
    if (!cal) continue;
    var calName = cal.getName();
    var events = cal.getEvents(from, to);
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      if (isDeclined_(ev)) continue;
      if (CC_MARKER_RE.test(ev.getDescription() || '')) continue; // our own mirrored deadlines
      out.push({
        calendarId: calId,
        calendarName: calName,
        eventId: ev.getId(),
        title: ev.getTitle(),
        start: ev.isAllDayEvent() ? ev.getAllDayStartDate().toISOString() : ev.getStartTime().toISOString(),
        end: ev.isAllDayEvent() ? ev.getAllDayEndDate().toISOString() : ev.getEndTime().toISOString(),
        allDay: ev.isAllDayEvent(),
        location: ev.getLocation() || null,
      });
    }
  }
  return out;
}

function isDeclined_(ev) {
  try {
    var me = Session.getActiveUser().getEmail();
    if (!me) return false;
    var status = ev.getMyStatus ? ev.getMyStatus() : null;
    return status === CalendarApp.GuestStatus.NO;
  } catch (e) {
    return false; // Not detectable on this event type — include it rather than silently drop it.
  }
}

/** Latest message per thread matching GMAIL_QUERY, plain body capped at 4000 chars. */
function collectMails_() {
  var query = getProp_('GMAIL_QUERY', DEFAULT_GMAIL_QUERY);
  var threads = GmailApp.search(query, 0, 50);
  var out = [];
  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    var msg = messages[messages.length - 1]; // latest in thread
    out.push({
      messageId: msg.getId(),
      threadId: threads[i].getId(),
      receivedAt: msg.getDate().toISOString(),
      from: msg.getFrom(),
      subject: msg.getSubject(),
      body: trimBody_(msg.getPlainBody() || ''),
    });
  }
  return out;
}

var DUE_HINT_RE = /\b(due|deadline|within \d+ days?|by [A-Z0-9])|까지|기한/i;

/** First 3000 chars plus, from the rest, lines that look like a due date (a forwarded
 * decision letter's deadline often sits below long reviewer comments). Max 4000. */
function trimBody_(body) {
  if (body.length <= 4000) return body;
  var head = body.slice(0, 3000);
  var hints = body.slice(3000).split(/\r?\n/).filter(function (line) {
    return DUE_HINT_RE.test(line);
  }).join('\n');
  return (head + '\n…\n' + hints).slice(0, 4000);
}

/** Message ids (ids only, no content) of matching mail now in trash. The owner
 * deletes review invitations after declining them, so the server dismisses any
 * still-pending candidate for these. GmailApp.search skips trash by default. */
function collectTrashedIds_() {
  var query = 'in:trash ' + getProp_('GMAIL_QUERY', DEFAULT_GMAIL_QUERY);
  var threads = GmailApp.search(query, 0, 100);
  var out = [];
  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) out.push(messages[j].getId());
  }
  return out;
}

/**
 * Diagnostic: shows where the due-date line sits in the latest matching mail and
 * whether the text sent to the app still contains it. Logs lengths, positions and
 * the due-date line only — never the rest of the body.
 * Edit DEBUG_QUERY below, pick debugDueDate in the editor, press Run.
 */
var DEBUG_QUERY = 'subject:(npj Digital Medicine) newer_than:30d';

function debugDueDate() {
  var threads = GmailApp.search(DEBUG_QUERY, 0, 1);
  if (threads.length === 0) { Logger.log('no mail matches: ' + DEBUG_QUERY); return; }
  var messages = threads[0].getMessages();
  var msg = messages[messages.length - 1];
  var body = msg.getPlainBody() || '';
  var sent = trimBody_(body);
  var re = /deadline|due|within \d+ days?|까지|기한/i;
  var at = body.search(re);
  var line = at >= 0 ? body.slice(body.lastIndexOf('\n', at) + 1, body.indexOf('\n', at) === -1 ? undefined : body.indexOf('\n', at)) : '';
  Logger.log('subject=' + msg.getSubject());
  Logger.log('bodyLength=' + body.length + ', dueLineAt=' + at + ', sentLength=' + sent.length +
    ', sentHasDue=' + (sent.search(re) >= 0));
  Logger.log('dueLine=' + line.slice(0, 200));
}
