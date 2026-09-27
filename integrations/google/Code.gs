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
    ', trashed=' + trashedMessageIds.length + ', deadlines=' + written);
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
