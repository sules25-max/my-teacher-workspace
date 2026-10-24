# My Teacher Workspace ✦

나만 쓰는 교사용 디지털 업무수첩. 수업 플래너 · 34차시 진도표 · 월간 수첩 · 회의 메모 · Apple Pencil 필기 · AI 이나(작은 업무 비서)를 하나의 local-first PWA로 묶었습니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173 (같은 Wi-Fi의 iPad에서도 접속 가능)
npm run build      # 타입 검사 + 프로덕션 빌드 (dist/)
```

## GitHub Pages 배포 → iPad/iPhone 홈 화면 설치

1. 이 폴더를 GitHub 저장소로 올립니다(`main` 브랜치).
2. 저장소 **Settings → Pages → Source: GitHub Actions** 로 설정합니다.
3. push하면 `.github/workflows/deploy.yml` 이 빌드해 `https://<아이디>.github.io/<저장소>/` 로 배포합니다.
   - 상대 경로(`base: './'`) + 해시 라우팅이라 저장소 이름과 상관없이 동작합니다.
4. iPad/iPhone Safari에서 주소를 열고 **공유 → 홈 화면에 추가**. standalone 모드로 앱처럼 열립니다.
5. 오프라인에서도 열리고(서비스 워커 캐시) 모든 입력은 기기 IndexedDB에 먼저 저장됩니다.

> 기기별 데이터는 각 기기의 브라우저 안에 저장됩니다. 여러 기기에서 같은 수첩을 쓰려면 아래 Google 동기화를 연결하세요. Safari 탭과 홈 화면 앱은 저장소가 분리될 수 있으니 한쪽(홈 화면 앱)으로 쓰는 것을 권장합니다.

## Google 동기화 (Apps Script)

1. [script.google.com](https://script.google.com) → 새 프로젝트 → `apps-script/Code.gs` 내용을 붙여 넣기 (`appsscript.json`도 프로젝트 설정에서 매니페스트 표시 후 붙여 넣기).
2. `setup` 함수를 한 번 실행 → 권한 허용 → 실행 로그의 **연결 토큰** 복사.
3. (AI 사용 시) 프로젝트 설정 → 스크립트 속성에 `GROQ_API_KEY` · `GEMINI_API_KEY` · `OPENAI_API_KEY` 중 원하는 만큼 추가 → 앱 설정 → AI 비서에서 우선 쓸 AI 선택. 고른 AI가 실패하면 키가 있는 다른 AI로 자동 전환됩니다.
4. 배포 → 새 배포 → 웹 앱 (실행: 나 / 액세스: 모든 사용자) → URL 복사.
5. 앱 **Settings → Google 동기화** 에 URL과 토큰 입력 → 연결 테스트 → 연결하기.

### 다른 기기는 한 번에 연결 (URL·토큰 재입력 없음)

한 기기에서 연결을 마치면 **설정 → Google 동기화 → 다른 기기 연결**에 QR · 연결 링크 · 연결 코드가 생깁니다.

- **Safari / 다른 브라우저**: QR을 찍거나 링크를 열면 `#/connect` 화면에서 [이 기기 연결하기] 한 번이면 끝납니다.
- **홈 화면에 추가한 앱**: iOS에서는 링크가 Safari로 열리므로, ‘연결 코드 복사’ 후 앱의 설정(또는 첫 실행 마법사)에 붙여 넣습니다.
- 새 기기는 클라우드의 설정(학년·반·시간표·커리큘럼)과 모든 기록을 그대로 받아옵니다. AI 키도 Apps Script에 있으므로 따로 넣을 필요가 없습니다.
- 토큰은 공개된 앱 코드에 넣지 않고 내 기기끼리만 주고받습니다. 링크가 유출되면 Apps Script에서 `rotateToken`을 실행하세요.

데이터는 내 Drive의 `My Teacher Workspace/` 폴더에 저장됩니다.

```
My Teacher Workspace
├─ My Teacher Workspace Data (Spreadsheet: LessonRecords, Progress34, MonthlyPlan, MeetingNotes, Tasks, Pages, …, WeeklyPlan)
├─ Attachments/ Photos · Documents · Pencil
├─ Records/   (셀 한도를 넘는 큰 레코드 JSON)
├─ Backup/
└─ Export/
```

## 구조

```
src/
  components/  layout · planner · canvas · assistant · tasks · common
  pages/       Today · Week · Month · Progress · Work · Board · Pages · Tasks · Archive · Settings
  services/    localDb(Dexie) · repo(쓰기+동기화 큐) · planner(진도/복사) · sync · google · ai · neis · weather · calendar · backup · search
  styles/      tokens · base · ui · layout · planner · ink · pages · assistant
apps-script/   Code.gs (Sheets/Drive/Calendar/AI 프록시)
```

- **데이터 흐름**: 입력 → IndexedDB → UI 즉시 반영 → `syncQueue` → 온라인일 때 Apps Script로 업로드/내려받기 (레코드 단위 last-write-wins).
- **필기**: stroke를 JSON(좌표 + 압력)으로 저장하고 썸네일 PNG를 따로 만듭니다. Pencil이 감지되면 손가락은 스크롤로만 동작합니다(손바닥 오입력 방지).
- **AI 이나 – 근거 기반 답변**: 질문을 날짜 · 학년/반 · 기록 종류 · 완료 여부 · 키워드로 해석해 **내 기록을 먼저 검색**하고, 찾은 기록만 근거로 답합니다. 없으면 "관련 기록을 찾지 못했습니다."라고만 답합니다(`services/ai/query.ts · corpus.ts · retrieval.ts · grounded.ts`). 설정 → AI 비서 → **개발자 모드**를 켜면 답변 아래에 실제로 검색 · 사용한 기록 목록이 보입니다.
- **요약(Map-Reduce)**: "이번 주 요약해줘"처럼 요약을 요청하면 범위 안의 기록을 **모두** 모아 묶음별로 요약한 뒤 합칩니다. 결과 아래 "총 N개 기록 중 M개 분석"은 실제로 AI가 읽은 기록 수입니다(`summarize.ts`).
- **✨ 오늘 하루 정리**: Today 화면 버튼 또는 AI 빠른 작업. 오늘 수업 · 할 일 · 일정 · 회의 · 메모 · 진도 · 시간표 변경 · 오늘 수정한 기록을 모아 정리하고, [오늘 기록으로 저장]을 눌렀을 때만 '하루 정리' 메모로 저장합니다. 남은 업무는 이미 Todo에 있는지 확인한 뒤 고른 것만 추가합니다.
- **이미지 분석**: AI 패널에서 사진 첨부 · 붙여넣기 · 끌어놓기(최대 3장). Groq `qwen/qwen3.8-27b`(공식 vision 모델, Preview)로 분석하고 실패하면 Gemini로 넘어갑니다. 스크립트 속성 `GROQ_VISION_MODEL` / `GEMINI_VISION_MODEL`로 모델을 바꿀 수 있습니다. 전송용 사본(긴 변 1600px JPEG)은 메모리에서만 쓰고, 원본은 저장 액션을 고를 때만 기존 첨부 구조로 저장됩니다.
- **갑작스런 수업 변경 · 보결**: 주간 계획에서 수업 칸을 끌어(iPad는 길게 눌러) 다른 칸에 놓으면 이번 주만 옮기고, 수업이 있는 칸이면 서로 바꿉니다. 편집 모드 · 수업 카드에서 담당 반이 아닌 학급(예: 5-3)을 직접 입력하면 '보결'로 남습니다.
- **AI 캐릭터**: `public/aichatbotseat.png` (4열×2행 sprite). 표정 매핑과 얼굴 자르기 비율은 `src/components/assistant/sprite.ts`에서 조정합니다.
