/**
 * My Teacher Workspace — Google Apps Script 백엔드
 *
 * 설정 방법
 *  1. script.google.com 에서 새 프로젝트를 만들고 이 파일 내용을 붙여 넣는다.
 *  2. 함수 목록에서 setup 을 실행하고 권한을 허용한다. 실행 로그에 "연결 토큰"이 나온다.
 *  3. (선택) 프로젝트 설정 → 스크립트 속성에 GROQ_API_KEY, GEMINI_API_KEY 또는 OPENAI_API_KEY 를 추가한다.
 *     모델을 바꾸려면 GROQ_MODEL / GEMINI_MODEL / OPENAI_MODEL 속성을 추가한다(예: gemini-3.5-flash-lite).
 *  4. 배포 → 새 배포 → 유형: 웹 앱 / 실행 사용자: 나 / 액세스 권한: 모든 사용자 → URL 복사
 *  5. 앱 설정 → Google 동기화 에 URL과 토큰을 넣는다.
 *
 * 모든 비밀값(토큰, API 키)은 PropertiesService에만 저장한다. 코드에 하드코딩하지 않는다.
 */

var ROOT_FOLDER = 'My Teacher Workspace';
var SHEETS = {
  lessons: 'LessonRecords',
  progress: 'Progress34',
  events: 'MonthlyPlan',
  meetings: 'MeetingNotes',
  tasks: 'Tasks',
  pages: 'Pages',
  pageGroups: 'PageGroups',
  attachments: 'Attachments',
  notes: 'Notes',
  inkDocs: 'Pencil',
  settings: 'Settings',
};
var HEADER = ['id', 'updatedAt', 'serverUpdatedAt', 'deleted', 'summary', 'json', 'driveJsonId'];
var MAX_CELL = 40000; // Sheets 셀 한도(5만 자)보다 작게. 넘으면 Drive JSON 파일로 저장

// ---------------------------------------------------------------- 진입점

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('APP_TOKEN')) {
    props.setProperty('APP_TOKEN', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  }
  var ss = getSpreadsheet_();
  getFolders_();
  Logger.log('스프레드시트: ' + ss.getUrl());
  Logger.log('연결 토큰: ' + props.getProperty('APP_TOKEN'));
}

/** 연결 링크·QR이 유출됐을 때 실행: 토큰을 새로 만들고 기존 연결을 모두 끊는다. 각 기기에 새 링크로 다시 연결한다. */
function rotateToken() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('APP_TOKEN', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  Logger.log('새 연결 토큰: ' + props.getProperty('APP_TOKEN'));
}

function doGet() {
  return json_({ ok: true, data: { app: 'my-teacher-workspace' } });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('APP_TOKEN');
    if (!token || req.token !== token) return json_({ ok: false, error: '연결 토큰이 맞지 않아요.' });
    var handler = ACTIONS[req.action];
    if (!handler) return json_({ ok: false, error: '알 수 없는 요청: ' + req.action });
    return json_({ ok: true, data: handler(req.payload || {}) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

var ACTIONS = {
  ping: function () {
    return { ok: true, spreadsheetUrl: getSpreadsheet_().getUrl() };
  },
  syncRecords: function (p) {
    return syncRecords(p.push || []);
  },
  pullChanges: function (p) {
    return pullChanges(p.since);
  },
  uploadAttachment: function (p) {
    return uploadAttachment(p);
  },
  getAttachment: function (p) {
    return getAttachment(p.fileId);
  },
  createBackup: function (p) {
    return createBackup(p.json, p.name);
  },
  calendarCreateEvent: function (p) {
    return calendarCreateEvent(p);
  },
  aiChat: function (p) {
    return aiChat(p);
  },
  aiTest: function () {
    return { lines: testAI() };
  },
  // 역할별 API (다른 클라이언트나 자동화에서 쓰기 쉽도록 제공)
  getTodayPlan: function (p) {
    return getTodayPlan(p.date);
  },
  getWeeklyPlan: function (p) {
    return getWeeklyPlan(p.from, p.to);
  },
  saveLesson: function (p) {
    return saveRecord_('lessons', p);
  },
  updateLesson: function (p) {
    return saveRecord_('lessons', p);
  },
  deleteLesson: function (p) {
    return deleteRecord_('lessons', p.id);
  },
  getProgress: function () {
    return listRecords_('progress');
  },
  updateProgress: function (p) {
    return saveRecord_('progress', p);
  },
  saveMeetingNote: function (p) {
    return saveRecord_('meetings', p);
  },
  saveTask: function (p) {
    return saveRecord_('tasks', p);
  },
  updateTask: function (p) {
    return saveRecord_('tasks', p);
  },
  savePage: function (p) {
    return saveRecord_('pages', p);
  },
  loadPage: function (p) {
    return getRecord_('pages', p.id);
  },
};

// ---------------------------------------------------------------- 동기화

function syncRecords(changes) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = new Date().toISOString();
    var byTable = {};
    changes.forEach(function (c) {
      (byTable[c.table] = byTable[c.table] || []).push(c);
    });
    Object.keys(byTable).forEach(function (table) {
      if (!SHEETS[table]) return;
      var sheet = getSheet_(table);
      var index = indexRows_(sheet);
      byTable[table].forEach(function (c) {
        var row = index[c.id];
        var existing = row ? sheet.getRange(row, 1, 1, HEADER.length).getValues()[0] : null;
        // 서버에 더 최근 값이 있으면 덮어쓰지 않는다(last-write-wins)
        if (existing && String(existing[1]) > String(c.updatedAt) && c.op !== 'delete') return;
        var values;
        if (c.op === 'delete') {
          values = [c.id, c.updatedAt, now, true, '(삭제됨)', '', ''];
        } else {
          var body = JSON.stringify(c.record);
          var driveId = '';
          if (body.length > MAX_CELL) {
            driveId = writeJsonFile_(table, c.id, body, existing ? existing[6] : '');
            body = '';
          }
          values = [c.id, c.updatedAt, now, false, summarize_(table, c.record), body, driveId];
        }
        if (row) sheet.getRange(row, 1, 1, HEADER.length).setValues([values]);
        else {
          sheet.appendRow(values);
          index[c.id] = sheet.getLastRow();
        }
        if (table === 'settings' && c.op !== 'delete') writeWeeklyPlan_(c.record);
      });
    });
    return { serverTime: now };
  } finally {
    lock.releaseLock();
  }
}

function pullChanges(since) {
  var serverTime = new Date().toISOString();
  var out = [];
  Object.keys(SHEETS).forEach(function (table) {
    var sheet = getSheet_(table);
    var last = sheet.getLastRow();
    if (last < 2) return;
    var rows = sheet.getRange(2, 1, last - 1, HEADER.length).getValues();
    rows.forEach(function (r) {
      if (since && String(r[2]) <= String(since)) return;
      if (r[3] === true || r[3] === 'TRUE') {
        out.push({ table: table, op: 'delete', id: String(r[0]), updatedAt: String(r[1]) });
        return;
      }
      var body = r[5] ? String(r[5]) : r[6] ? readJsonFile_(String(r[6])) : '';
      if (!body) return;
      out.push({ table: table, op: 'upsert', id: String(r[0]), updatedAt: String(r[1]), record: JSON.parse(body) });
    });
  });
  return { changes: out, serverTime: serverTime };
}

function saveRecord_(table, record) {
  if (!record.id) record.id = Utilities.getUuid();
  record.updatedAt = record.updatedAt || new Date().toISOString();
  return syncRecords([{ table: table, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record: record }]);
}

function deleteRecord_(table, id) {
  return syncRecords([{ table: table, op: 'delete', id: id, updatedAt: new Date().toISOString() }]);
}

function listRecords_(table) {
  var sheet = getSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet
    .getRange(2, 1, last - 1, HEADER.length)
    .getValues()
    .filter(function (r) {
      return r[3] !== true && r[3] !== 'TRUE';
    })
    .map(function (r) {
      return JSON.parse(r[5] ? String(r[5]) : readJsonFile_(String(r[6])));
    });
}

function getRecord_(table, id) {
  var list = listRecords_(table).filter(function (r) {
    return r.id === id;
  });
  return list[0] || null;
}

function getTodayPlan(date) {
  var d = date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return {
    lessons: listRecords_('lessons').filter(function (l) {
      return l.date === d;
    }),
    tasks: listRecords_('tasks').filter(function (t) {
      return !t.completed && t.dueDate && t.dueDate <= d;
    }),
  };
}

function getWeeklyPlan(from, to) {
  return listRecords_('lessons').filter(function (l) {
    return l.date >= from && l.date <= to;
  });
}

function summarize_(table, r) {
  try {
    switch (table) {
      case 'lessons':
        return [r.date, r.classKey, r.lesson, r.session ? r.session + '차시' : '', r.completed ? '✓완료' : ''].join(' ');
      case 'progress':
        return [r.classKey, r.lesson, r.session + '차시', r.date].join(' ');
      case 'events':
        return [r.date, r.time || '', r.title].join(' ');
      case 'meetings':
        return [r.date, r.title].join(' ');
      case 'tasks':
        return (r.completed ? '☑ ' : '☐ ') + r.title + (r.dueDate ? ' (' + r.dueDate + ')' : '');
      case 'pages':
        return r.title;
      case 'pageGroups':
        return r.name;
      case 'notes':
        return [r.date, String(r.text || '').slice(0, 60)].join(' ');
      case 'attachments':
        return [r.kind, r.name, r.driveFileId || ''].join(' ');
      case 'inkDocs':
        return 'strokes ' + (r.strokes ? r.strokes.length : 0);
      case 'settings':
        return (r.schoolName || '') + ' ' + (r.academicYear || '');
    }
  } catch (e) {}
  return '';
}

function writeWeeklyPlan_(settings) {
  // 정기 시간표를 사람이 읽기 쉬운 WeeklyPlan 시트로도 남긴다(읽기 전용 미러)
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName('WeeklyPlan') || ss.insertSheet('WeeklyPlan');
  sheet.clear();
  var days = ['', '월', '화', '수', '목', '금', '토'];
  var weekdays = settings.weekdays || [1, 2, 3, 4, 5];
  var rows = [['교시'].concat(weekdays.map(function (w) { return days[w]; }))];
  (settings.periods || []).forEach(function (p) {
    rows.push([p.label].concat(weekdays.map(function (w) { return (settings.timetable || {})[w + ':' + p.id] || ''; })));
  });
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.setFrozenRows(1);
}

// ---------------------------------------------------------------- Drive

function uploadAttachment(p) {
  var folders = getFolders_();
  var folder = p.kind === 'photo' ? folders.photos : p.kind === 'ink' ? folders.pencil : folders.documents;
  var name = p.id + '_' + (p.name || 'file');
  var existing = folder.getFilesByName(name);
  if (existing.hasNext()) return { fileId: existing.next().getId() };
  var blob = Utilities.newBlob(Utilities.base64Decode(p.base64), p.mimeType || 'application/octet-stream', name);
  return { fileId: folder.createFile(blob).getId() };
}

function getAttachment(fileId) {
  var f = DriveApp.getFileById(fileId);
  var blob = f.getBlob();
  return { base64: Utilities.base64Encode(blob.getBytes()), mimeType: blob.getContentType() };
}

function createBackup(jsonText, name) {
  var f = getFolders_().backup.createFile(Utilities.newBlob(jsonText, 'application/json', name || 'backup.json'));
  return { fileId: f.getId(), url: f.getUrl() };
}

function writeJsonFile_(table, id, body, existingId) {
  if (existingId) {
    try {
      DriveApp.getFileById(existingId).setContent(body);
      return existingId;
    } catch (e) {}
  }
  var folder = table === 'inkDocs' ? getFolders_().pencil : getFolders_().records;
  return folder.createFile(Utilities.newBlob(body, 'application/json', table + '_' + id + '.json')).getId();
}

function readJsonFile_(id) {
  return id ? DriveApp.getFileById(id).getBlob().getDataAsString() : '';
}

// ---------------------------------------------------------------- Calendar

function calendarCreateEvent(p) {
  var cal = CalendarApp.getDefaultCalendar();
  if (p.eventId) {
    try {
      var ev = cal.getEventById(p.eventId);
      if (ev) {
        ev.setTitle(p.title);
        ev.setDescription(p.description || '');
        return { eventId: ev.getId() };
      }
    } catch (e) {}
  }
  var start = parseDate_(p.date);
  var created;
  if (p.time) {
    var hm = p.time.split(':');
    start.setHours(Number(hm[0]), Number(hm[1]));
    var end = new Date(start.getTime() + 60 * 60 * 1000);
    created = cal.createEvent(p.title, start, end, { description: p.description || '' });
  } else if (p.endDate && p.endDate !== p.date) {
    var last = parseDate_(p.endDate);
    last.setDate(last.getDate() + 1);
    created = cal.createAllDayEvent(p.title, start, last, { description: p.description || '' });
  } else {
    created = cal.createAllDayEvent(p.title, start, { description: p.description || '' });
  }
  return { eventId: created.getId() };
}

function parseDate_(iso) {
  var a = String(iso).split('-');
  return new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
}

// ---------------------------------------------------------------- AI 프록시
// API 키는 스크립트 속성(GROQ_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY)에서만 읽는다.

// 기본 모델. 스크립트 속성 GROQ_MODEL / GEMINI_MODEL / OPENAI_MODEL 을 넣으면 그 값이 우선한다.
var AI_PROVIDERS = {
  groq: { keyName: 'GROQ_API_KEY', modelProp: 'GROQ_MODEL', model: 'llama-3.3-70b-versatile' },
  gemini: { keyName: 'GEMINI_API_KEY', modelProp: 'GEMINI_MODEL', model: 'gemini-3.5-flash-lite' },
  openai: { keyName: 'OPENAI_API_KEY', modelProp: 'OPENAI_MODEL', model: 'gpt-4o-mini' },
};
var AI_ORDER = ['groq', 'gemini', 'openai'];
var OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
var GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'; // Groq는 OpenAI 호환 API

/**
 * 고른 AI를 먼저 쓰고, 키가 없거나 실패(한도 초과·장애 등)하면
 * 스크립트 속성에 키가 있는 다른 AI로 차례대로 넘어간다.
 * 모델 이름이 종료·변경된 경우에는 사용 가능한 모델을 조회해 자동으로 바꿔 다시 시도한다.
 */
function aiChat(p) {
  var system = String(p.system || '');
  var context = String(p.context || '').slice(0, 6000);
  var messages = (p.messages || []).slice(-8);
  var first = AI_PROVIDERS[p.provider] ? p.provider : AI_ORDER[0];
  var chain = [first].concat(AI_ORDER.filter(function (x) { return x !== first; }));
  var errors = [];
  for (var i = 0; i < chain.length; i++) {
    var id = chain[i];
    var key = aiKey_(id);
    if (!key) continue;
    try {
      var r = callWithModelRecovery_(id, key, id === first ? p.model : '', system, context, messages);
      return { text: r.text, provider: id, model: r.model, fallback: id !== first };
    } catch (e) {
      errors.push(id + ': ' + errMsg_(e));
    }
  }
  throw new Error(errors.length ? 'AI 호출 실패 (' + errors.join(' / ') + ')' : '스크립트 속성에 GROQ_API_KEY · GEMINI_API_KEY · OPENAI_API_KEY 중 하나도 없어요.');
}

function aiKey_(id) {
  var v = PropertiesService.getScriptProperties().getProperty(AI_PROVIDERS[id].keyName);
  return v ? String(v).replace(/\s+/g, '') : ''; // 붙여 넣을 때 섞인 공백·줄바꿈 제거
}

function callWithModelRecovery_(id, key, userModel, system, context, messages) {
  var cache = CacheService.getScriptCache();
  var propModel = String(PropertiesService.getScriptProperties().getProperty(AI_PROVIDERS[id].modelProp) || '').trim();
  var model = userModel || propModel || cache.get('ai_model_' + id) || AI_PROVIDERS[id].model;
  try {
    return { text: callProvider_(id, key, model, system, context, messages), model: model };
  } catch (e) {
    if (!looksLikeModelError_(e)) throw e;
    var picked = '';
    try {
      picked = discoverModel_(id, key, model);
    } catch (e2) {
      throw e; // 목록 조회도 실패하면(키 오류 등) 원래 오류를 보여 준다
    }
    if (!picked) throw e;
    cache.put('ai_model_' + id, picked, 21600);
    return { text: callProvider_(id, key, picked, system, context, messages), model: picked };
  }
}

function callProvider_(id, key, model, system, context, messages) {
  var text = id === 'gemini'
    ? geminiChat_(key, model, system, context, messages)
    : openAICompatChat_(id === 'groq' ? GROQ_URL : OPENAI_URL, key, model, system, context, messages);
  if (!text || !String(text).trim()) throw new Error('빈 답변 (' + model + ')');
  return text;
}

function looksLikeModelError_(e) {
  return /model|decommission|not found|not supported|does not exist|404|400/i.test(errMsg_(e));
}

/** 제공자의 모델 목록에서 대화용으로 쓸 만한 모델을 고른다. */
function discoverModel_(id, key, exclude) {
  var names = listModels_(id, key).filter(function (n) { return n !== exclude; });
  var prefs = {
    groq: [/^llama-3\.3-70b/, /gpt-oss-120b/, /llama-4/, /70b/, /gpt-oss/, /llama/, /qwen/, /./],
    gemini: [/^gemini-[\d.]+-flash-lite$/, /^gemini-flash-lite-latest$/, /flash-lite/, /^gemini-flash-latest$/, /^gemini-[\d.]+-flash$/, /flash/, /gemini/],
    openai: [/^gpt-4o-mini$/, /^gpt-4\.1-mini$/, /mini$/, /^gpt-/],
  }[id];
  for (var i = 0; i < prefs.length; i++) {
    for (var j = 0; j < names.length; j++) if (prefs[i].test(names[j])) return names[j];
  }
  return '';
}

function listModels_(id, key) {
  var url, headers;
  if (id === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';
    headers = { 'x-goog-api-key': key };
  } else {
    url = id === 'groq' ? 'https://api.groq.com/openai/v1/models' : 'https://api.openai.com/v1/models';
    headers = { Authorization: 'Bearer ' + key };
  }
  var res = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  var j = parseJson_(res, id + ' 모델 목록');
  if (id === 'gemini') {
    return (j.models || [])
      .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
      .map(function (m) { return String(m.name).replace(/^models\//, ''); })
      .filter(function (n) { return !/(tts|image|embedding|live|audio|vision|aqa|learnlm|robotics|computer)/.test(n); })
      .sort().reverse(); // 숫자가 큰(새) 버전 먼저
  }
  return (j.data || [])
    .filter(function (m) { return m.active !== false; })
    .map(function (m) { return String(m.id); })
    .filter(function (n) { return !/(whisper|tts|guard|embed|playai|orpheus|distil|compound|realtime|audio|transcribe|image|dall|moderation|search)/i.test(n); })
    .sort().reverse();
}

function geminiChat_(key, model, system, context, messages) {
  var contents = messages.map(function (m) {
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
  });
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      system_instruction: { parts: [{ text: system + (context ? '\n\n[참고 자료]\n' + context : '') }] },
      contents: contents,
      // 생각(thinking) 토큰이 한도를 다 쓰면 답이 비므로 넉넉히 준다
      generationConfig: { maxOutputTokens: 4096, temperature: 0.4 },
    }),
  });
  var j = parseJson_(res, 'Gemini');
  var parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  return parts
    .filter(function (x) { return !x.thought; })
    .map(function (x) { return x.text || ''; })
    .join('');
}

function openAICompatChat_(url, key, model, system, context, messages) {
  var msgs = [{ role: 'system', content: system + (context ? '\n\n[참고 자료]\n' + context : '') }].concat(
    messages.map(function (m) {
      return { role: m.role, content: m.content };
    }),
  );
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
    payload: JSON.stringify({ model: model, messages: msgs, max_tokens: 2048, temperature: 0.4 }),
  });
  var j = parseJson_(res, model);
  return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
}

/** 오류 응답이 HTML(차단 페이지 등)이어도 원인을 읽을 수 있게 HTTP 코드와 앞부분을 남긴다. */
function parseJson_(res, label) {
  var code = res.getResponseCode();
  var body = res.getContentText();
  var j = null;
  try {
    j = JSON.parse(body);
  } catch (e) {}
  if (code >= 300 || !j) {
    var msg = j && j.error ? (j.error.message || JSON.stringify(j.error)) : String(body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(label + ' HTTP ' + code + ': ' + msg);
  }
  return j;
}

function errMsg_(e) {
  return String(e && e.message ? e.message : e);
}

/**
 * 진단용: 편집기에서 testAI 를 선택해 ▶ 실행하면, 키가 있는 AI마다 실제로 호출해 보고
 * 결과(성공 모델 또는 오류 원인)를 실행 로그에 남긴다. 키 값은 로그에 남기지 않는다.
 */
function testAI() {
  var lines = [];
  var log = function (m) {
    lines.push(m);
    Logger.log(m);
  };
  AI_ORDER.forEach(function (id) {
    var key = aiKey_(id);
    if (!key) {
      log(id + ': 키 없음 (' + AI_PROVIDERS[id].keyName + ')');
      return;
    }
    try {
      var r = callWithModelRecovery_(id, key, '', '한 단어로만 답해.', '', [{ role: 'user', content: '안녕?' }]);
      log(id + ': ✓ 성공 · 모델 ' + r.model + ' · 답: ' + String(r.text).slice(0, 40));
    } catch (e) {
      log(id + ': ✗ 실패 · ' + errMsg_(e));
      try {
        log('   사용 가능한 모델 예: ' + listModels_(id, key).slice(0, 8).join(', '));
      } catch (e2) {
        log('   모델 목록도 실패: ' + errMsg_(e2));
      }
    }
  });
  return lines;
}

// ---------------------------------------------------------------- 도우미

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {}
  }
  var ss = SpreadsheetApp.create('My Teacher Workspace Data');
  DriveApp.getFileById(ss.getId()).moveTo(getFolders_().root);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function getSheet_(table) {
  var ss = getSpreadsheet_();
  var name = SHEETS[table];
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sheet.setFrozenRows(1);
    var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
    if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  }
  return sheet;
}

function indexRows_(sheet) {
  var last = sheet.getLastRow();
  var map = {};
  if (last < 2) return map;
  sheet
    .getRange(2, 1, last - 1, 1)
    .getValues()
    .forEach(function (r, i) {
      map[String(r[0])] = i + 2;
    });
  return map;
}

function getFolders_() {
  var root = child_(DriveApp.getRootFolder(), ROOT_FOLDER);
  var attachments = child_(root, 'Attachments');
  return {
    root: root,
    photos: child_(attachments, 'Photos'),
    documents: child_(attachments, 'Documents'),
    pencil: child_(attachments, 'Pencil'),
    records: child_(root, 'Records'),
    backup: child_(root, 'Backup'),
    export: child_(root, 'Export'),
  };
}

function child_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
