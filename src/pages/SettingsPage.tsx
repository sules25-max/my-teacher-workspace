import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, CloudUpload, Download, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { db, requestPersistence } from '../services/localDb';
import { saveSettings, updateSettings } from '../services/repo';
import { useSettings } from '../hooks/useData';
import { navigate, useRoute } from '../hooks/useRoute';
import { allClasses, periodAllowsGrade, slotKey } from '../services/planner';
import { defaultCurriculum } from '../data/defaults';
import type { CurriculumLesson, PeriodSlot, Settings } from '../types';
import { WEEKDAY_KO } from '../utils/date';
import { cx, uuid } from '../utils/id';
import { confirmDialog, toast } from '../components/common/overlays';
import { useSyncState } from '../services/sync/syncStatus';
import { runSync, getSyncAdapter } from '../services/sync/syncEngine';
import { AppsScriptSyncAdapter } from '../services/sync/adapter';
import { backupFileName, downloadJSON, exportStructureOnly, exportWorkspace, importWorkspace, startNewAcademicYear, validateExport } from '../services/backup';
import { getAIProvider } from '../services/ai/provider';
import { callAppsScript } from '../services/google/appsScriptClient';
import { setDevMode, useDevMode } from '../services/devMode';
import { PasteConnectCode, ShareConnection } from '../components/common/DeviceConnect';

type Tab = 'basic' | 'periods' | 'timetable' | 'curriculum' | 'calendar' | 'sync' | 'ai' | 'backup';
const TABS: [Tab, string][] = [
  ['basic', '기본'],
  ['periods', '교시'],
  ['timetable', '시간표'],
  ['curriculum', '차시 · 학기'],
  ['calendar', '카테고리 · 연동'],
  ['sync', 'Google 동기화'],
  ['ai', 'AI 비서'],
  ['backup', '백업 · 내보내기'],
];

export const ALL_GRADES = [1, 2, 3, 4, 5, 6];

export function SettingsPage() {
  const s = useSettings();
  const route = useRoute();
  const tab = (route.query.get('tab') as Tab) || 'basic';
  return (
    <div className="settings">
      <div className="page-head">
        <h1 className="page-head__title">Settings</h1>
      </div>
      <div className="settings__layout">
        <nav className="settings__tabs" aria-label="설정 항목">
          {TABS.map(([t, label]) => (
            <button key={t} className={cx('settings__tab', tab === t && 'is-active')} aria-current={tab === t ? 'page' : undefined} onClick={() => navigate(`settings?tab=${t}`)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings__panel card">
          <div className="card__body stack">
            {tab === 'basic' && <BasicSettings s={s} />}
            {tab === 'periods' && <PeriodSettings s={s} />}
            {tab === 'timetable' && <TimetableSettings s={s} />}
            {tab === 'curriculum' && <CurriculumSettings s={s} />}
            {tab === 'calendar' && <CalendarSettings s={s} />}
            {tab === 'sync' && <SyncSettings s={s} />}
            {tab === 'ai' && <AISettings s={s} />}
            {tab === 'backup' && <BackupSettings s={s} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="muted settings__hint">{hint}</span>}
    </label>
  );
}

function TextSetting({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} {...rest} />;
}

/** 학년 선택(1~6학년 다중 선택). 새로 고른 학년은 반 수 4, 기본 커리큘럼으로 시작한다. */
export function GradePicker({ s, onChange }: { s: Pick<Settings, 'grades' | 'classesPerGrade' | 'curriculum' | 'totalSessions'>; onChange: (c: Partial<Settings>) => void }) {
  return (
    <div className="grade-picker" role="group" aria-label="학년 선택">
      {ALL_GRADES.map((g) => {
        const on = s.grades.includes(g);
        return (
          <button
            key={g}
            type="button"
            className={cx('grade-chip', on && 'is-on')}
            aria-pressed={on}
            onClick={() => {
              const grades = on ? s.grades.filter((x) => x !== g) : [...s.grades, g].sort((a, b) => a - b);
              if (!grades.length) return;
              onChange({
                grades,
                classesPerGrade: { ...s.classesPerGrade, [g]: s.classesPerGrade[String(g)] ?? 4 },
                curriculum: { ...s.curriculum, [g]: s.curriculum[String(g)] ?? defaultCurriculum(s.totalSessions) },
              });
            }}
          >
            <span className="grade-chip__box">{on ? '✓' : ''}</span>
            {g}학년
          </button>
        );
      })}
    </div>
  );
}

export function ClassCounts({ s, onChange }: { s: Pick<Settings, 'grades' | 'classesPerGrade'>; onChange: (c: Partial<Settings>) => void }) {
  return (
    <div className="class-counts">
      {s.grades.map((g) => (
        <div key={g} className="class-count">
          <span className="title-font">{g}학년</span>
          <div className="stepper">
            <button type="button" className="icon-btn icon-btn--outline" aria-label={`${g}학년 반 줄이기`} onClick={() => onChange({ classesPerGrade: { ...s.classesPerGrade, [g]: Math.max(1, (s.classesPerGrade[String(g)] ?? 1) - 1) } })}>
              −
            </button>
            <span className="stepper__value">{s.classesPerGrade[String(g)] ?? 0}반</span>
            <button type="button" className="icon-btn icon-btn--outline" aria-label={`${g}학년 반 늘리기`} onClick={() => onChange({ classesPerGrade: { ...s.classesPerGrade, [g]: Math.min(20, (s.classesPerGrade[String(g)] ?? 0) + 1) } })}>
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BasicSettings({ s }: { s: Settings }) {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);
  return (
    <>
      <h2 className="section-title">기본 정보</h2>
      <div className="settings__grid">
        <Field label="표시 이름">
          <TextSetting value={s.displayName} onSave={(displayName) => saveSettings({ displayName })} />
        </Field>
        <Field label="학교">
          <TextSetting value={s.schoolName} onSave={(schoolName) => saveSettings({ schoolName })} placeholder="예) ○○초등학교" />
        </Field>
        <Field label="과목">
          <TextSetting value={s.subject} onSave={(subject) => saveSettings({ subject })} />
        </Field>
        <Field label="학년도">
          <input className="input" type="number" value={s.academicYear} onChange={(e) => void saveSettings({ academicYear: Number(e.target.value) || s.academicYear })} />
        </Field>
      </div>
      <h2 className="section-title">가르치는 학년</h2>
      <GradePicker s={s} onChange={saveSettings} />
      <h2 className="section-title">반 수</h2>
      <ClassCounts s={s} onChange={saveSettings} />
      <h2 className="section-title">수업 요일</h2>
      <div className="row row--wrap">
        {[1, 2, 3, 4, 5, 6].map((wd) => {
          const on = s.weekdays.includes(wd);
          return (
            <button key={wd} className={cx('grade-chip', on && 'is-on')} aria-pressed={on} onClick={() => void saveSettings({ weekdays: on ? s.weekdays.filter((x) => x !== wd) : [...s.weekdays, wd].sort() })}>
              <span className="grade-chip__box">{on ? '✓' : ''}</span>
              {WEEKDAY_KO[wd]}
            </button>
          );
        })}
      </div>
      <h2 className="section-title">기타</h2>
      <label className="check">
        <input type="checkbox" className="checkbox" checked={s.assistant.visible} onChange={(e) => void saveSettings({ assistant: { ...s.assistant, visible: e.target.checked } })} />
        <span>AI 비서 캐릭터 표시</span>
      </label>
      <label className="check">
        <input type="checkbox" className="checkbox" checked={s.weather.enabled} onChange={(e) => void saveSettings({ weather: { ...s.weather, enabled: e.target.checked } })} />
        <span>Today 화면 날씨 ({s.weather.label})</span>
      </label>
      {s.weather.enabled && (
        <div className="settings__grid">
          <Field label="지역 이름">
            <TextSetting value={s.weather.label} onSave={(label) => saveSettings({ weather: { ...s.weather, label } })} />
          </Field>
          <Field label="위도 / 경도" hint="학교 위치. 위치 권한은 쓰지 않아요.">
            <div className="row">
              <TextSetting value={String(s.weather.lat)} inputMode="decimal" onSave={(v) => saveSettings({ weather: { ...s.weather, lat: Number(v) || s.weather.lat } })} />
              <TextSetting value={String(s.weather.lon)} inputMode="decimal" onSave={(v) => saveSettings({ weather: { ...s.weather, lon: Number(v) || s.weather.lon } })} />
            </div>
          </Field>
        </div>
      )}
      <div className="settings__storage">
        <span>기기 저장소: {persisted ? '✓ 영구 저장 허용됨' : '브라우저가 공간이 부족할 때 정리할 수 있음'}</span>
        {!persisted && (
          <button className="btn btn--sm" onClick={async () => setPersisted(await requestPersistence())}>
            영구 저장 요청
          </button>
        )}
      </div>
    </>
  );
}

function PeriodSettings({ s }: { s: Settings }) {
  const update = (periods: PeriodSlot[]) => saveSettings({ periods });
  const set = (i: number, c: Partial<PeriodSlot>) => update(s.periods.map((p, j) => (j === i ? { ...p, ...c } : p)));
  return (
    <>
      <h2 className="section-title">교시</h2>
      <p className="muted">학년마다 시간이 다른 교시는 ‘해당 학년’을 지정해 두 칸으로 나눠요. 예) 4교시 (3·5·6학년) / 4교시 (1·2·4학년)</p>
      <ul className="list-reset period-list">
        {s.periods.map((p, i) => (
          <li key={p.id} className="period-item">
            <div className="period-item__main">
              <Field label="이름">
                <TextSetting value={p.label} onSave={(label) => set(i, { label, short: label.replace(/\s*\(.*\)/, '') })} />
              </Field>
              <Field label="시간">
                <div className="row">
                  <input className="input" type="time" value={p.start ?? ''} onChange={(e) => void set(i, { start: e.target.value })} aria-label="시작" />
                  <input className="input" type="time" value={p.end ?? ''} onChange={(e) => void set(i, { end: e.target.value })} aria-label="끝" />
                </div>
              </Field>
            </div>
            <div className="period-item__grades">
              <span className="field__label">해당 학년</span>
              <div className="row row--wrap">
                <button className={cx('chip', !p.grades?.length && 'chip--done')} onClick={() => void set(i, { grades: undefined })}>
                  전체
                </button>
                {ALL_GRADES.map((g) => {
                  const on = !!p.grades?.includes(g);
                  return (
                    <button key={g} className={cx('chip', on && 'chip--done')} aria-pressed={on} onClick={() => void set(i, { grades: on ? p.grades!.filter((x) => x !== g) : [...(p.grades ?? []), g].sort() })}>
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="period-item__tools">
              <button className="icon-btn" disabled={i === 0} aria-label="위로" onClick={() => update(swap(s.periods, i, i - 1))}>
                <ArrowUp size={16} />
              </button>
              <button className="icon-btn" disabled={i === s.periods.length - 1} aria-label="아래로" onClick={() => update(swap(s.periods, i, i + 1))}>
                <ArrowDown size={16} />
              </button>
              <button
                className="icon-btn"
                aria-label={`${p.label} 삭제`}
                onClick={async () => {
                  if (await confirmDialog({ title: '교시 삭제', message: `${p.label}을(를) 지울까요? 이미 적은 수업 기록은 남아요.`, confirmLabel: '삭제', danger: true })) update(s.periods.filter((_, j) => j !== i));
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={() => update([...s.periods, { id: `p-${uuid().slice(0, 6)}`, label: `${s.periods.length + 1}교시`, short: `${s.periods.length + 1}교시` }])}>
        <Plus size={16} /> 교시 추가
      </button>
    </>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const n = [...arr];
  [n[a], n[b]] = [n[b], n[a]];
  return n;
}

function TimetableSettings({ s }: { s: Settings }) {
  const classes = allClasses(s);
  return (
    <>
      <h2 className="section-title">정기 시간표</h2>
      <p className="muted">여기서 정한 반이 매주 주간 계획에 자동으로 나타나요. 교시에 지정된 학년의 반만 고를 수 있어요.</p>
      <div className="tt-scroll">
        <table className="tt">
          <thead>
            <tr>
              <th />
              {s.weekdays.map((wd) => (
                <th key={wd} className="title-font">
                  {WEEKDAY_KO[wd]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.periods.map((p) => (
              <tr key={p.id}>
                <th scope="row">
                  <span className="title-font">{p.short}</span>
                  {p.grades && <span className="tt__grades">{p.grades.join('·')}학년</span>}
                </th>
                {s.weekdays.map((wd) => {
                  const k = slotKey(wd, p.id);
                  const v = s.timetable[k] ?? '';
                  return (
                    <td key={wd}>
                      <select
                        className={cx('select tt__select', v && 'is-set')}
                        value={v}
                        aria-label={`${WEEKDAY_KO[wd]} ${p.label}`}
                        onChange={(e) => {
                          const value = e.target.value;
                          void updateSettings((cur) => {
                            const timetable = { ...cur.timetable };
                            if (value) timetable[k] = value;
                            else delete timetable[k];
                            return { timetable };
                          });
                        }}
                      >
                        <option value="">—</option>
                        {classes
                          .filter((c) => periodAllowsGrade(p, c.grade))
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.key}
                            </option>
                          ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CurriculumSettings({ s }: { s: Settings }) {
  const [grade, setGrade] = useState(s.grades[0] ?? 3);
  const g = s.grades.includes(grade) ? grade : s.grades[0];
  const lessons = s.curriculum[String(g)] ?? [];
  const sum = lessons.reduce((a, l) => a + l.sessions, 0);
  const setLessons = (ls: CurriculumLesson[]) => saveSettings({ curriculum: { ...s.curriculum, [g]: ls } });
  return (
    <>
      <h2 className="section-title">총 수업 차시</h2>
      <div className="row row--wrap">
        <input className="input settings__num" type="number" min={1} max={200} value={s.totalSessions} onChange={(e) => void saveSettings({ totalSessions: Math.max(1, Number(e.target.value) || 34) })} aria-label="총 차시" />
        <span>차시</span>
      </div>

      <h2 className="section-title">Lesson 구성</h2>
      <div className="seg">
        {s.grades.map((gr) => (
          <button key={gr} aria-pressed={gr === g} onClick={() => setGrade(gr)}>
            {gr}학년
          </button>
        ))}
      </div>
      <p className={cx(sum !== s.totalSessions ? 'chip chip--warn' : 'muted')}>
        Lesson 차시 합계 {sum} / 총 {s.totalSessions}차시
      </p>
      <ul className="list-reset curriculum-list">
        {lessons.map((l, i) => (
          <li key={l.id} className="curriculum-item">
            <TextSetting value={l.name} aria-label="Lesson 이름" onSave={(name) => setLessons(lessons.map((x, j) => (j === i ? { ...x, name } : x)))} />
            <TextSetting value={l.title ?? ''} placeholder="단원 제목 (선택)" aria-label="단원 제목" onSave={(title) => setLessons(lessons.map((x, j) => (j === i ? { ...x, title } : x)))} />
            <div className="stepper">
              <button className="icon-btn icon-btn--outline" aria-label="차시 줄이기" onClick={() => setLessons(lessons.map((x, j) => (j === i ? { ...x, sessions: Math.max(1, x.sessions - 1) } : x)))}>
                −
              </button>
              <span className="stepper__value">{l.sessions}차시</span>
              <button className="icon-btn icon-btn--outline" aria-label="차시 늘리기" onClick={() => setLessons(lessons.map((x, j) => (j === i ? { ...x, sessions: x.sessions + 1 } : x)))}>
                +
              </button>
            </div>
            <button
              className="icon-btn"
              aria-label={`${l.name} 삭제`}
              onClick={async () => {
                if (await confirmDialog({ title: 'Lesson 삭제', message: `${l.name}을(를) 지울까요? 이 Lesson의 진도 기록은 진도표에서 보이지 않게 돼요.`, confirmLabel: '삭제', danger: true })) setLessons(lessons.filter((_, j) => j !== i));
              }}
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
      <div className="row row--wrap">
        <button className="btn btn--sm" onClick={() => setLessons([...lessons, { id: `L${uuid().slice(0, 6)}`, name: `Lesson ${lessons.length + 1}`, sessions: 4 }])}>
          <Plus size={16} /> Lesson 추가
        </button>
        <button
          className="btn btn--sm btn--ghost"
          onClick={async () => {
            if (await confirmDialog({ title: '기본 구성으로', message: `${g}학년 Lesson 구성을 총 ${s.totalSessions}차시 기본값(Lesson 1~8 × 4차시 + 복습)으로 바꿀까요?`, confirmLabel: '바꾸기' })) setLessons(defaultCurriculum(s.totalSessions));
          }}
        >
          기본 구성으로 되돌리기
        </button>
      </div>

      <h2 className="section-title">학기</h2>
      {s.semesters.map((sem, i) => (
        <div key={sem.id} className="settings__grid">
          <Field label="이름">
            <TextSetting value={sem.label} onSave={(label) => saveSettings({ semesters: s.semesters.map((x, j) => (j === i ? { ...x, label } : x)) })} />
          </Field>
          <Field label="기간">
            <div className="row">
              <input className="input" type="date" value={sem.start} onChange={(e) => void saveSettings({ semesters: s.semesters.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
              <input className="input" type="date" value={sem.end} onChange={(e) => void saveSettings({ semesters: s.semesters.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
            </div>
          </Field>
        </div>
      ))}
    </>
  );
}

function CalendarSettings({ s }: { s: Settings }) {
  return (
    <>
      <h2 className="section-title">일정 카테고리 색</h2>
      <ul className="list-reset cat-list">
        {s.categories.map((c, i) => (
          <li key={c.id} className="row">
            <input type="color" className="cat-list__color" value={c.color} onChange={(e) => void saveSettings({ categories: s.categories.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} aria-label={`${c.label} 색`} />
            <TextSetting value={c.label} onSave={(label) => saveSettings({ categories: s.categories.map((x, j) => (j === i ? { ...x, label } : x)) })} />
          </li>
        ))}
      </ul>
      <h2 className="section-title">NEIS 학사일정 · 급식 (선택)</h2>
      <p className="muted">open.neis.go.kr 에서 받은 인증키와 학교 코드를 넣으면 월간 달력에 학사일정이 함께 보여요. 비워 두면 꺼져 있어요.</p>
      <label className="check">
        <input type="checkbox" className="checkbox" checked={s.neis.enabled} onChange={(e) => void saveSettings({ neis: { ...s.neis, enabled: e.target.checked } })} />
        <span>NEIS 연동 사용</span>
      </label>
      {s.neis.enabled && (
        <div className="settings__grid">
          <Field label="인증키">
            <TextSetting value={s.neis.apiKey} type="password" autoComplete="off" onSave={(apiKey) => saveSettings({ neis: { ...s.neis, apiKey } })} />
          </Field>
          <Field label="시도교육청 코드" hint="예) B10 (서울)">
            <TextSetting value={s.neis.officeCode} onSave={(officeCode) => saveSettings({ neis: { ...s.neis, officeCode } })} />
          </Field>
          <Field label="학교 코드">
            <TextSetting value={s.neis.schoolCode} onSave={(schoolCode) => saveSettings({ neis: { ...s.neis, schoolCode } })} />
          </Field>
        </div>
      )}
      <h2 className="section-title">Google Calendar</h2>
      <p className="muted">월간 일정을 펼쳐 ‘Google Calendar로 보내기’를 누른 일정만 보내요. Google 동기화가 연결되어 있어야 해요.</p>
    </>
  );
}

function SyncSettings({ s }: { s: Settings }) {
  const sync = useSyncState();
  const pending = useLiveQuery(() => db.syncQueue.count(), []) ?? 0;
  const [endpoint, setEndpoint] = useState(s.sync.endpoint);
  const [token, setToken] = useState(s.sync.token);
  const [testing, setTesting] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string>();
  useEffect(() => {
    setEndpoint(s.sync.endpoint);
    setToken(s.sync.token);
  }, [s.sync.endpoint, s.sync.token]);

  const saveConn = async (mode: 'local' | 'appsScript') => {
    await db.settings.update('main', { sync: { ...s.sync, mode, endpoint: endpoint.trim(), token: token.trim() } });
    if (mode === 'appsScript') void runSync();
  };

  return (
    <>
      <h2 className="section-title">Google 동기화</h2>
      <p className="muted">
        내 Google 계정의 Apps Script를 백엔드로 써요. 데이터는 Google Sheets, 사진·필기는 Google Drive의 ‘My Teacher Workspace’ 폴더에 저장돼요. 가입이나 별도 아이디는 필요 없어요.
      </p>
      <div className="sync-status card card--blue">
        <div className="card__body">
          <p>
            상태: <b>{{ saved: '✓ 저장됨', saving: '저장 중', syncing: '↻ 동기화 중', offline: '! 오프라인', error: '! 동기화 오류', local: '기기에만 저장' }[sync.status]}</b>
          </p>
          <p className="muted">올라가지 않은 변경: {pending}개</p>
          {s.sync.lastSyncAt && <p className="muted">마지막 동기화: {new Date(s.sync.lastSyncAt).toLocaleString('ko-KR')}</p>}
          {sync.message && sync.status === 'error' && <p className="chip chip--warn">{sync.message}</p>}
        </div>
      </div>
      <Field label="Apps Script 웹 앱 URL" hint="배포 → 웹 앱 → https://script.google.com/macros/s/…/exec">
        <input className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" inputMode="url" autoComplete="off" />
      </Field>
      <Field label="연결 토큰" hint="Apps Script의 setup() 실행 로그에 나온 토큰. 이 기기에만 저장되고 코드나 클라우드에는 올라가지 않아요.">
        <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </Field>
      <div className="row row--wrap">
        <button
          className="btn"
          disabled={!endpoint || !token || testing}
          onClick={async () => {
            setTesting(true);
            try {
              const r = await new AppsScriptSyncAdapter({ endpoint: endpoint.trim(), token: token.trim() }).ping();
              setSheetUrl(r.spreadsheetUrl);
              toast('연결 성공! 이제 ‘연결하기’를 눌러 주세요.');
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setTesting(false);
            }
          }}
        >
          연결 테스트
        </button>
        <button className="btn btn--primary" disabled={!endpoint || !token} onClick={() => saveConn('appsScript')}>
          연결하기
        </button>
        <button className="btn" onClick={() => runSync()} disabled={s.sync.mode !== 'appsScript'}>
          <RefreshCw size={16} /> 지금 동기화
        </button>
        {s.sync.mode === 'appsScript' && (
          <button
            className="btn btn--ghost"
            onClick={async () => {
              if (await confirmDialog({ title: '동기화 끊기', message: '이 기기에서 Google 동기화를 끕니다. 데이터는 기기에 그대로 남아요.', confirmLabel: '끊기' })) await saveConn('local');
            }}
          >
            연결 끊기
          </button>
        )}
      </div>
      {sheetUrl && (
        <a href={sheetUrl} target="_blank" rel="noreferrer">
          연결된 스프레드시트 열기 ↗
        </a>
      )}
      {s.sync.mode === 'appsScript' && s.sync.endpoint && s.sync.token ? (
        <ShareConnection info={{ endpoint: s.sync.endpoint, token: s.sync.token }} />
      ) : (
        <div className="card card--soft">
          <div className="card__body stack">
            <h3 className="section-title">다른 기기에서 이미 연결했다면</h3>
            <p className="muted">연결된 기기의 설정 → Google 동기화에서 ‘연결 코드 복사’를 누른 뒤 여기에 붙여 넣으면 URL과 토큰을 다시 입력할 필요가 없어요.</p>
            <PasteConnectCode />
          </div>
        </div>
      )}
      <details className="settings__howto">
        <summary className="title-font">Apps Script 설정 방법</summary>
        <ol>
          <li>script.google.com → 새 프로젝트를 만들고, 프로젝트의 apps-script/Code.gs 내용을 붙여 넣어요.</li>
          <li>함수 목록에서 setup을 한 번 실행하고 권한을 허용해요. 실행 로그에 연결 토큰이 나와요.</li>
          <li>(AI를 쓸 때) 프로젝트 설정 → 스크립트 속성에 GROQ_API_KEY(또는 GEMINI_API_KEY / OPENAI_API_KEY)를 추가해요.</li>
          <li>배포 → 새 배포 → 웹 앱, 실행 사용자: 나, 액세스: 모든 사용자로 배포하고 URL을 위에 붙여 넣어요.</li>
          <li>한 기기에서 연결하면, 다른 기기는 ‘다른 기기 연결’의 QR · 링크 · 연결 코드로 바로 연결돼요. AI 키도 Apps Script에 있으니 함께 쓸 수 있어요.</li>
        </ol>
      </details>
    </>
  );
}

function AISettings({ s }: { s: Settings }) {
  const [status, setStatus] = useState<string>('확인 중…');
  useEffect(() => {
    getAIProvider(s)
      .available()
      .then((ok) => setStatus(s.ai.provider === 'local' ? '외부 전송 없이 기기 안에서 동작 중' : ok ? '사용 가능 (Apps Script 경유)' : 'Google 동기화를 먼저 연결해 주세요'));
  }, [s]);
  return (
    <>
      <h2 className="section-title">AI 비서</h2>
      <p className="muted">비서는 기본적으로 기기 안에서 계산해요. 외부 AI를 켜도 현재 화면과 관련된 일부 정보만 보내고, 사진·첨부·손글씨는 보내지 않아요. 데이터를 바꾸는 일은 항상 먼저 물어봐요.</p>
      <Field label="AI Provider">
        <select className="select" value={s.ai.provider} onChange={(e) => void saveSettings({ ai: { ...s.ai, provider: e.target.value as Settings['ai']['provider'] } })}>
          <option value="local">기기 안 비서 (외부 전송 없음)</option>
          <option value="groq">Groq 우선</option>
          <option value="gemini">Gemini 우선</option>
          <option value="openai">OpenAI 우선</option>
        </select>
      </Field>
      {s.ai.provider !== 'local' && (
        <Field label="모델 (선택)" hint="비워 두면 Apps Script의 기본 모델을 써요.">
          <TextSetting value={s.ai.model ?? ''} placeholder={{ groq: 'llama-3.3-70b-versatile', gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', local: '' }[s.ai.provider]} onSave={(model) => saveSettings({ ai: { ...s.ai, model: model || undefined } })} />
        </Field>
      )}
      {s.ai.provider !== 'local' && <p className="muted">고른 AI가 안 되면(키 없음 · 한도 초과 · 장애) 스크립트 속성에 키가 있는 다른 AI로 자동으로 넘어가요. 순서: 고른 AI → Groq → Gemini → OpenAI</p>}
      <p className="chip">AI API 상태: {status}</p>
      {s.sync.mode === 'appsScript' && <AITestButton />}
      <DevModeToggle />
      <p className="muted">API 키는 앱 코드나 이 기기에 저장하지 않아요. Apps Script 프로젝트 설정 → 스크립트 속성(PropertiesService)에 GROQ_API_KEY · GEMINI_API_KEY · OPENAI_API_KEY 중 쓰는 것을 넣어 주세요.</p>
    </>
  );
}

/** Apps Script의 testAI를 앱에서 바로 실행해 AI 키 · 모델 상태를 보여 준다 */
function AITestButton() {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[] | null>(null);
  return (
    <div className="ai-test">
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setLines(null);
          try {
            const r = await callAppsScript<{ lines: string[] }>('aiTest', {}, undefined, 90000);
            setLines(r.lines);
          } catch (e) {
            const msg = (e as Error).message;
            setLines([msg.includes('알 수 없는 요청') ? 'Apps Script가 예전 코드예요. 최신 Code.gs를 붙여 넣고 새 버전으로 배포해 주세요.' : msg]);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'AI 확인 중… (최대 1분)' : 'AI 연결 테스트'}
      </button>
      {lines && (
        <pre className="ai-test__log" aria-live="polite">
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}

function DevModeToggle() {
  const dev = useDevMode();
  return (
    <label className="check">
      <input type="checkbox" className="checkbox" checked={dev} onChange={(e) => setDevMode(e.target.checked)} />
      <span>개발자 모드 · AI 답변 아래에 실제로 검색 · 사용한 기록 목록을 보여줘요 (이 기기에서만)</span>
    </label>
  );
}

function BackupSettings({ s }: { s: Settings }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h2 className="section-title">백업</h2>
      <div className="row row--wrap">
        <button
          className="btn btn--primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              downloadJSON(await exportWorkspace(true), backupFileName());
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={16} /> 전체 JSON 내보내기
        </button>
        <button
          className="btn"
          disabled={busy || s.sync.mode !== 'appsScript'}
          onClick={async () => {
            setBusy(true);
            try {
              const adapter = await getSyncAdapter();
              if (!adapter) throw new Error('Google 동기화를 먼저 연결해 주세요.');
              const data = await exportWorkspace(false);
              await adapter.createBackup(JSON.stringify(data), backupFileName());
              toast('Drive의 Backup 폴더에 저장했어요.');
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <CloudUpload size={16} /> Drive에 백업
        </button>
      </div>
      <p className="muted">JSON 파일에는 사진과 필기까지 모두 들어가요. 개인 정보가 담겨 있으니 안전한 곳에 보관해 주세요.</p>

      <h2 className="section-title">가져오기</h2>
      <button className="btn" onClick={() => fileRef.current?.click()}>
        <Upload size={16} /> JSON 가져오기
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            if (!validateExport(data)) throw new Error('My Teacher Workspace 백업 파일이 아니에요.');
            const replace = await confirmDialog({
              title: '가져오기 방식',
              message: `${f.name}\n내보낸 시각: ${new Date(data.exportedAt).toLocaleString('ko-KR')}\n\n‘합치기’는 같은 기록 중 더 최근 것을 남기고, ‘모두 바꾸기’는 이 기기 데이터를 지우고 파일로 바꿔요.`,
              confirmLabel: '모두 바꾸기',
              cancelLabel: '합치기',
              danger: true,
            });
            if (replace && !(await confirmDialog({ title: '정말 바꿀까요?', message: '이 기기의 현재 데이터가 모두 지워져요. 먼저 내보내기로 백업해 두는 걸 추천해요.', confirmLabel: '바꾸기', danger: true }))) return;
            await importWorkspace(data, replace ? 'replace' : 'merge');
            toast('가져오기를 마쳤어요.');
          } catch (err) {
            toast((err as Error).message);
          }
        }}
      />

      <h2 className="section-title">새 학년도 시작</h2>
      <p className="muted">
        {s.academicYear} 구조를 복제해 {s.academicYear + 1} 수첩을 시작해요. 페이지 구조·그룹·템플릿·커리큘럼은 유지하고, 수업 기록·진도·할 일은 복제하지 않아요(지난 기록은 보관함에 남아요).
      </p>
      <div className="row row--wrap">
        <button
          className="btn"
          onClick={async () => {
            if (!(await confirmDialog({ title: `${s.academicYear + 1} 수첩 시작`, message: '현재 페이지는 보관함으로 옮기고, 같은 구조의 빈 페이지를 새로 만들어요. 정기 시간표는 유지해요.', confirmLabel: '시작하기' }))) return;
            await startNewAcademicYear({ copyPages: true, archiveOldPages: true, keepTimetable: true });
            toast(`${s.academicYear + 1}학년도 수첩을 시작했어요.`);
          }}
        >
          {s.academicYear} 구조 복제 → {s.academicYear + 1} 새 수첩
        </button>
        <button className="btn btn--ghost" onClick={async () => downloadJSON(await exportStructureOnly(), backupFileName(`structure-${s.academicYear}`))}>
          구조만 JSON으로 내보내기
        </button>
      </div>

      <h2 className="section-title">데이터 지우기</h2>
      <button
        className="btn btn--ghost"
        onClick={async () => {
          if (!(await confirmDialog({ title: '이 기기 데이터 모두 지우기', message: '이 기기의 모든 기록이 지워져요. Google에 동기화된 데이터는 남아 있어요.\n먼저 백업했는지 확인해 주세요.', confirmLabel: '모두 지우기', danger: true }))) return;
          await db.delete();
          location.reload();
        }}
      >
        <Trash2 size={16} /> 이 기기 데이터 모두 지우기
      </button>
    </>
  );
}
