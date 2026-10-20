# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

OOTD STORE: 빌드 도구 없이 HTML·CSS·바닐라 JS로 만든 쇼핑몰 샘플이에요. 토스페이먼츠 결제위젯(v2, 테스트 키)으로 결제하고, 서버가 결제를 승인해요.

기능 정의와 순서는 `PRD.md`에 있어요. 회원가입·로그인, 내 주문 내역, 주문 취소·환불, 좋아요, 리뷰까지 만들었어요.

## 실행

- `package.json`, 빌드, 린트, 테스트가 없어요. 이 PC에는 Node도 Python도 없어요(`python`은 MS Store 바로가기라 실행 안 돼요). 파일 수정은 Edit 도구나 sed로, 이미지는 PowerShell `System.Drawing`으로 만들어요.
- 로컬 서버: `powershell -ExecutionPolicy Bypass -File serve.ps1` → http://localhost:8080
  - `.claude/launch.json`에 `shop`으로 등록돼 있어요. (preview_start `{name: "shop"}`)
    - `serve.ps1`을 고쳤으면 preview_stop 후 다시 시작해요. 8081 같은 다른 포트를 알려줘도 서버는 `-Port 8080`으로 떠요. 8080으로 들어가요.
  - 다른 시크릿 키: `$env:TOSS_SECRET_KEY = 'test_gsk_...'`. `test_`로 시작하지 않는 키는 거부해요.
- 배포: GitHub `main`에 push하면 Vercel이 배포해요. `api/*.js`가 서버 함수예요.
  - 배포 확인: 이번에 새로 만든 페이지나 API를 15초마다 불러서 404가 바뀌면 끝난 거예요. (보통 30초 안팎)
    `for i in $(seq 1 16); do [ "$(curl -s -o /dev/null -w "%{http_code}" https://testtosspaymentsshop-taupe.vercel.app/<새 파일>)" = 200 ] && break; sleep 15; done`

## 확인 방법

- API: preview 탭에서 `fetch`로 호출하고, `GET /api/orders`(로컬만)로 저장 결과를 봐요.
- 결제 끝까지: 결제위젯 → 퀵계좌이체 → "다음" → 테스트 비밀번호 `000000` (키패드 숫자 위치가 매번 바뀌어요)
- 결제창을 닫으면 위젯이 `USER_CANCEL` 에러를 던져요.
- Claude in Chrome의 `javascript_tool`은 결과에 주소 쿼리·쿠키처럼 보이는 값(응답 헤더 등)이 있으면 `[BLOCKED]`로 가려요. 상태 코드·개수·`@type`처럼 짧은 값만 돌려받아요.
- Vercel 함수(`api/*.js`)는 이 PC에서 실행할 수 없어요. 배포한 뒤에 확인해요.
  - 문법·로직만 미리 보려면 preview 탭에서 소스를 `fetch`해 `new Function("require","module","exports","process","Buffer", src)`로 읽고, `fetch`를 가짜로 바꿔서 핸들러를 불러요. 로컬 서버가 `api/` 경로를 가로채서 `api/*.js` 파일은 그대로 받을 수 없어요(임시 폴더에 복사해서 읽고 지워요).
- DB 권한(RLS): `execute_sql`의 `do` 블록에서 테스트 회원을 `auth.users`에 넣고 `set local role authenticated` + `request.jwt.claims`로 회원을 흉내 낸 뒤, 마지막에 `raise exception`으로 결과를 보여주고 모두 되돌려요.
- 회원 가입·로그인은 Supabase Auth(외부)로 가서 Claude가 대신할 수 없어요. 사용자가 직접 가입해서 확인해요.
  - 메일 링크가 돌아올 주소는 Supabase 대시보드 Authentication → URL Configuration에서 정해요(MCP로는 못 바꿔요). 기본 메일은 팀 멤버 이메일로만 가요. 자세한 건 `README.md`에 있어요.

## 구조에서 알아야 할 것

### 백엔드가 두 개예요

같은 API(`POST /api/orders`, `POST /api/confirm`, `POST /api/fail`, `GET /api/my-orders`, `POST /api/cancel`)를 두 곳에서 따로 구현해요. 한쪽을 바꾸면 다른 쪽도 맞춰야 해요.

| | `serve.ps1` (로컬) | `api/*.js` + `lib/shop.js` (Vercel) |
|---|---|---|
| 주문 저장 (`/api/orders`) | 메모리 + `server-data/orders.json`. 재시작하면 메모리가 비어서 승인이 404 | Supabase `orders`에 `PENDING`으로 저장. 저장 실패면 결제를 막음(502) |
| 승인 때 금액 확인 | 저장된 주문 금액과 비교 | 저장된 주문 금액과 비교. Supabase가 없거나 조회가 실패하면 body의 `items`로 다시 계산 |
| 승인 결과 저장 | 성공: 토스 `status`(`DONE` 등)와 `payment`. 실패: `FAILED` + 실패 코드·메시지 | 같음 (Supabase) |
| 결제 안 됨 (`/api/fail`) | 결제창 닫음(`USER_CANCEL`, `PAY_PROCESS_CANCELED`)은 `USER_CANCELED`, 그 밖은 `FAILED`. 결제된 주문은 바꾸지 않음 | 같음 |
| 새로고침 중복 승인 방지 | 결제된 주문이면 저장된 결과 반환 (다른 `paymentKey`면 409) | 같음 |
| 회원 확인 | `Authorization: Bearer <토큰>`을 Supabase `/auth/v1/user`에 물어봄(publishable 키). 토큰 없으면 비회원, 틀리면 401 | 같음(서비스 롤 키) |
| 내 주문 (`/api/my-orders`) | 메모리에서 `userId`가 같은 주문 | Supabase `orders?user_id=eq.` |
| 취소 (`/api/cancel`) | 본인·`DONE`·승인 후 7일 이내만. 토스 `/v1/payments/{paymentKey}/cancel` (`Idempotency-Key: cancel-<orderId>`) | 같음 |

- 주문 응답 모양은 `lib/shop.js`의 `toMyOrder`와 `serve.ps1`의 `ConvertTo-MyOrder`가 맞춰요.
- 취소 이유 목록이 `lib/shop.js`, `serve.ps1`, `js/order.js` 세 곳에 있어요. `serve.ps1`에는 `\uXXXX`로 써요. (BOM 없는 파일을 Windows PowerShell 5.1이 ANSI로 읽어서 한글이 깨져요. Edit 도구로 넣으면 한글로 바뀌니 셸에서 넣어요.)
- 로컬 주문은 Supabase에 없어서, 로컬에서 결제한 주문에는 리뷰를 쓸 수 없어요.

### 금액 규칙이 세 곳에 있어요

배송비 규칙(3만원 이상 또는 전 상품 무료배송이면 0원, 아니면 3,000원)이 `js/common.js`의 `summarize`(화면 표시), `lib/shop.js`의 `calcAmount`, `serve.ps1`의 `Get-OrderAmount`에 각각 있어요. 바꿀 때는 세 곳을 함께 바꿔요. 검색엔진·AI용 글에도 같은 규칙이 적혀 있어서 `js/common.js`의 `productJsonLd`(배송비)·`productDescription`, `index.html` FAQ(화면·JSON-LD), `llms.txt`, `og-image.png`도 고쳐요. `checkout.js`는 서버가 돌려준 금액이 화면 금액과 다르면 결제를 막아요.

### 상품 데이터는 정규식으로 읽어요

서버 두 곳 모두 `js/products.js`를 실행하지 않고 정규식(`id: "..." ... sale: N ... free: true|false`)으로 읽어요. 그래서 상품 하나는 한 줄에 두고, 필드 순서는 `id` → `sale` → `free`를 지켜야 해요. 열을 맞추느라 `sale:  99000`처럼 공백 수가 줄마다 달라서, 셸에서 뽑을 때도 `sale: *([0-9]+)`처럼 써요. Vercel에서는 `vercel.json`의 `includeFiles`로 이 파일을 함수에 포함해요.

### 결제 흐름

1. `checkout.html` / `js/checkout.js`: `POST /api/orders`로 금액 확인·주문 저장(받는 분 정보 포함) → `localStorage`의 `pendingOrder`에 주문·배송 정보 저장 → `widgets.requestPayment`
2. 토스 결제창 → `success.html?paymentKey=&orderId=&amount=` (실패 시 `fail.html`). 결제창을 닫거나 실패하면 `reportPaymentFail`(`js/common.js`)이 `POST /api/fail`로 이유를 남겨요.
3. `success.html`: `pendingOrder.items`를 담아 `POST /api/confirm` → 서버가 시크릿 키로 `https://api.tosspayments.com/v1/payments/confirm` 호출

### 프론트엔드

모듈 없이 전역 스크립트예요. 모든 페이지가 supabase-js(CDN, `@2.45.4` UMD) → `js/products.js` → `js/common.js` → 페이지 스크립트 순서로 불러와요. 장바구니, 주문 정보는 `localStorage`(`load`/`save` 헬퍼)에 저장해요. 레이아웃(헤더·푸터)은 `renderLayout`이 그려요.

- `js/common.js`의 `sb`(Supabase 클라이언트)·`Auth`(로그인 상태, `Auth.ready` 프로미스)·`api()`(우리 API 호출, 로그인했으면 토큰을 붙임)·`requireLogin()`.
- 회원·좋아요·리뷰는 브라우저가 Supabase에 바로 읽고 써요(RLS). 주문은 개인정보가 있어서 서버 API로만 읽어요.
- 좋아요: 비회원은 `localStorage`의 `likes`만. 로그인하면 `likes` 테이블에 저장하고 `localStorage`는 사본. 로그인하는 순간(`SIGNED_IN`)에만 비회원 좋아요를 계정에 합쳐요. 로그아웃하면 사본을 지워요.
- 좋아요 수·리뷰 수·별점은 `js/products.js`에 없어요. `Stats`가 `product_stats()` RPC로 읽어 `PRODUCTS`에 채우고, 바뀌면 `stats:change` 이벤트로 목록을 다시 그려요. 그 밖의 이벤트: `auth:change`, `likes:change`.
- 페이지: `login.html`(`?mode=signup|find`, `?next=`), `reset.html`(비밀번호 재설정 메일 링크), `mypage.html`(`?tab=likes`), `order.html?id=`(상세·취소·리뷰). 로그인해야 하는 페이지는 `<body data-private="true">`라서 로그아웃하면 홈으로 가요.

## 키와 환경변수

- 클라이언트 키: `js/checkout.js`의 `TOSS_CLIENT_KEY` (문서용 공개 테스트 키)
- `TOSS_SECRET_KEY`: 없으면 문서용 공개 테스트 시크릿 키를 써요.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: Vercel에만 있어요. 없으면 주문 저장을 건너뛰어요. Supabase는 npm 패키지 없이 `fetch`로 REST API(`/rest/v1/orders`)를 호출해요.
- Supabase publishable 키(공개): `js/common.js`의 `SUPABASE_KEY`, `serve.ps1`의 `$SupabasePublishableKey`
- Supabase 프로젝트 `ootd-store` (id `bxtfhadwhteljgzmuecy`, 서울). 표와 권한은 `README.md`에 있어요.
  - `orders`: RLS만 켜고 정책 없음 → 서비스 롤 키(서버)로만 접근
  - `profiles`(가입하면 트리거 `on_auth_user_created`가 만듦), `likes`: 본인 것만 읽기·쓰기
  - `reviews`: 누구나 읽기, 본인만 쓰기. 트리거 `reviews_before_write`가 본인·`DONE` 주문·주문에 있는 상품인지 확인하고, 사이즈와 가린 이름(`mask_name`)을 채워요. 수정할 때는 별점·글만 바뀌어요.
- 스키마 변경은 Supabase MCP `apply_migration`으로 해요. `orders.status`는 check 제약(`orders_status_check`)이 있어서, 새 상태를 쓰려면 제약부터 고쳐요.
- `.vercelignore`가 `serve.ps1`, `server-data`, `.claude`, `.mcp.json`을 배포에서 빼요.

## 검색엔진·AI 검색 (SEO·AEO·GEO)

- 사이트 주소 `https://testtosspaymentsshop-taupe.vercel.app`가 `js/common.js`의 `SITE_URL`, 각 페이지 head(canonical·og), `index.html`·카테고리 페이지의 JSON-LD, `robots.txt`, `sitemap.xml`, `llms.txt`에 들어 있어요. 주소가 바뀌면 모두 바꿔요.
- 공개 페이지(`index`, `tops`·`shoes`·`pants`, `product`)만 색인해요. 장바구니·주문·결제·로그인·마이페이지는 `<meta name="robots" content="noindex">`예요.
- 상품 상세의 제목·설명·canonical과 `Product`·`BreadcrumbList` JSON-LD는 `setMeta`·`productJsonLd`(`js/common.js`)가 그려요. 카테고리 목록의 `ItemList`도 `renderCategoryPage`가 넣어요.
- 홈 FAQ는 화면(`#faq`)과 `FAQPage` JSON-LD 두 곳에 같은 글로 있어요. 배송비·취소 기간 같은 규칙을 바꾸면 FAQ와 `llms.txt`도 고쳐요.
- 상품을 더하거나 가격을 바꾸면 `sitemap.xml`과 `llms.txt`의 상품 목록, 카테고리 페이지의 설명(개수·가격 범위)을 함께 고쳐요.
- `og-image.png`(1200×630)는 PowerShell `System.Drawing`으로 만들었어요.
- Google Search Console(URL 접두어 속성)에 등록돼 있고 `sitemap.xml`을 제출했어요. 소유 확인 파일 `google536bb01c62436244.html`을 지우면 확인이 풀려요.

## 관례

- 코드 주석과 화면 문구는 한국어 해요체로 써요. (`serve.ps1` 주석만 영어)
- 커밋 메시지는 영어로 써요. commit할 때는 이번에 바꾼 파일만 골라 `git add`해요(`git add -A`·`git add .` 금지). 작업 폴더에 올리지 않기로 한 변경이 남아 있을 수 있어요.
- 스터디 노트: 질답이 하나 끝날 때마다 그날 노트(`YYMMDDstudy.md`, 예: `261021study.md`)에 `## N. 제목` / `**질문:**` / `**답:**` 형식으로 이어 쓰고, 그 파일만 commit·push해요.
- 사용자에게는 코드보다 기능(화면에서 무엇을 할 수 있는지) 중심으로 설명해요.
