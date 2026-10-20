# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

OOTD STORE: 빌드 도구 없이 HTML·CSS·바닐라 JS로 만든 쇼핑몰 샘플이에요. 토스페이먼츠 결제위젯(v2, 테스트 키)으로 결제하고, 서버가 결제를 승인해요.

앞으로 만들 기능(회원, 주문 내역, 취소·환불, 리뷰, 좋아요)과 순서는 `PRD.md`에 있어요.

## 실행

- `package.json`, 빌드, 린트, 테스트가 없어요. 이 PC에는 Node도 설치돼 있지 않아요.
- 로컬 서버: `powershell -ExecutionPolicy Bypass -File serve.ps1` → http://localhost:8080
  - `.claude/launch.json`에 `shop`으로 등록돼 있어요. (preview_start `{name: "shop"}`)
  - 다른 시크릿 키: `$env:TOSS_SECRET_KEY = 'test_gsk_...'`. `test_`로 시작하지 않는 키는 거부해요.
- 배포: GitHub `main`에 push하면 Vercel이 배포해요. `api/*.js`가 서버 함수예요.

## 확인 방법

- API: preview 탭에서 `fetch`로 호출하고, `GET /api/orders`(로컬만)로 저장 결과를 봐요.
- 결제 끝까지: 결제위젯 → 퀵계좌이체 → "다음" → 테스트 비밀번호 `000000` (키패드 숫자 위치가 매번 바뀌어요)
- 결제창을 닫으면 위젯이 `USER_CANCEL` 에러를 던져요.
- Vercel 함수(`api/*.js`)는 이 PC에서 실행할 수 없어요. 배포한 뒤에 확인해요.

## 구조에서 알아야 할 것

### 백엔드가 두 개예요

같은 API(`POST /api/orders`, `POST /api/confirm`, `POST /api/fail`)를 두 곳에서 따로 구현해요. 한쪽을 바꾸면 다른 쪽도 맞춰야 해요.

| | `serve.ps1` (로컬) | `api/*.js` + `lib/shop.js` (Vercel) |
|---|---|---|
| 주문 저장 (`/api/orders`) | 메모리 + `server-data/orders.json`. 재시작하면 메모리가 비어서 승인이 404 | Supabase `orders`에 `PENDING`으로 저장. 저장 실패면 결제를 막음(502) |
| 승인 때 금액 확인 | 저장된 주문 금액과 비교 | 저장된 주문 금액과 비교. Supabase가 없거나 조회가 실패하면 body의 `items`로 다시 계산 |
| 승인 결과 저장 | 성공: 토스 `status`(`DONE` 등)와 `payment`. 실패: `FAILED` + 실패 코드·메시지 | 같음 (Supabase) |
| 결제 안 됨 (`/api/fail`) | 결제창 닫음(`USER_CANCEL`, `PAY_PROCESS_CANCELED`)은 `USER_CANCELED`, 그 밖은 `FAILED`. 결제된 주문은 바꾸지 않음 | 같음 |
| 새로고침 중복 승인 방지 | 결제된 주문이면 저장된 결과 반환 (다른 `paymentKey`면 409) | 같음 |

### 금액 규칙이 세 곳에 있어요

배송비 규칙(3만원 이상 또는 전 상품 무료배송이면 0원, 아니면 3,000원)이 `js/common.js`의 `summarize`(화면 표시), `lib/shop.js`의 `calcAmount`, `serve.ps1`의 `Get-OrderAmount`에 각각 있어요. 바꿀 때는 세 곳을 함께 바꿔요. `checkout.js`는 서버가 돌려준 금액이 화면 금액과 다르면 결제를 막아요.

### 상품 데이터는 정규식으로 읽어요

서버 두 곳 모두 `js/products.js`를 실행하지 않고 정규식(`id: "..." ... sale: N ... free: true|false`)으로 읽어요. 그래서 상품 하나는 한 줄에 두고, 필드 순서는 `id` → `sale` → `free`를 지켜야 해요. Vercel에서는 `vercel.json`의 `includeFiles`로 이 파일을 함수에 포함해요.

### 결제 흐름

1. `checkout.html` / `js/checkout.js`: `POST /api/orders`로 금액 확인·주문 저장(받는 분 정보 포함) → `localStorage`의 `pendingOrder`에 주문·배송 정보 저장 → `widgets.requestPayment`
2. 토스 결제창 → `success.html?paymentKey=&orderId=&amount=` (실패 시 `fail.html`). 결제창을 닫거나 실패하면 `reportPaymentFail`(`js/common.js`)이 `POST /api/fail`로 이유를 남겨요.
3. `success.html`: `pendingOrder.items`를 담아 `POST /api/confirm` → 서버가 시크릿 키로 `https://api.tosspayments.com/v1/payments/confirm` 호출

### 프론트엔드

모듈 없이 전역 스크립트예요. 모든 페이지가 `js/products.js` → `js/common.js` → 페이지 스크립트 순서로 불러와요. 장바구니, 좋아요, 주문 정보는 `localStorage`(`load`/`save` 헬퍼)에 저장해요. 레이아웃(헤더·푸터)은 `renderLayout`이 그려요.

## 키와 환경변수

- 클라이언트 키: `js/checkout.js`의 `TOSS_CLIENT_KEY` (문서용 공개 테스트 키)
- `TOSS_SECRET_KEY`: 없으면 문서용 공개 테스트 시크릿 키를 써요.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: Vercel에만 있어요. 없으면 주문 저장을 건너뛰어요. Supabase는 npm 패키지 없이 `fetch`로 REST API(`/rest/v1/orders`)를 호출해요.
- Supabase 프로젝트 `ootd-store` (id `bxtfhadwhteljgzmuecy`, 서울). `orders` 테이블은 RLS가 켜져 있고 정책이 없어서 서비스 롤 키로만 접근돼요. 컬럼은 `README.md`에 있어요.
- 스키마 변경은 Supabase MCP `apply_migration`으로 해요. `orders.status`는 check 제약(`orders_status_check`)이 있어서, 새 상태를 쓰려면 제약부터 고쳐요.
- `.vercelignore`가 `serve.ps1`, `server-data`, `.claude`, `.mcp.json`을 배포에서 빼요.

## 관례

- 코드 주석과 화면 문구는 한국어 해요체로 써요. (`serve.ps1` 주석만 영어)
- 커밋 메시지는 영어로 써요.
- 사용자에게는 코드보다 기능(화면에서 무엇을 할 수 있는지) 중심으로 설명해요.
