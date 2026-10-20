# OOTD STORE — 토스페이먼츠 테스트 쇼핑몰

HTML·CSS·JS로 만든 쇼핑몰 퍼블리싱 샘플이에요. 토스페이먼츠 결제위젯(v2)을 붙였고, PowerShell 테스트 서버로 결제 승인까지 할 수 있어요.

## 실행

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

브라우저에서 http://localhost:8080 으로 접속하세요. 설치할 것은 없어요.

## 페이지

| 파일 | 내용 |
|---|---|
| `index.html` | 메인 (카테고리별 랭킹) |
| `tops.html` / `shoes.html` / `pants.html` | 상의·신발·바지 상품 목록 |
| `product.html` | 상품 상세 |
| `cart.html` | 장바구니 |
| `checkout.html` | 주문서 + 토스페이먼츠 결제위젯 |
| `success.html` / `fail.html` | 결제 완료(서버 승인) / 실패 |

## 테스트 서버 API (`serve.ps1`)

- `POST /api/orders` — 주문을 "결제 대기"(`PENDING`)로 저장해요. 받는 분 정보도 함께 받아요. 금액은 서버가 `js/products.js`의 가격으로 다시 계산해요.
- `POST /api/confirm` — 저장된 금액과 비교한 뒤 시크릿 키로 토스페이먼츠 결제 승인 API를 호출해요.
- `POST /api/fail` — 결제창을 닫았거나 결제에 실패한 이유를 주문에 남겨요. 이미 결제된 주문은 바꾸지 않아요.
- `GET /api/orders` — 저장된 주문 목록 (테스트용)

## Vercel 배포

`api/orders.js`, `api/confirm.js`, `api/fail.js`가 Vercel 서버 함수로 같은 API를 제공해요(공통 로직은 `lib/shop.js`).
결제 버튼을 누르면 주문을 Supabase `orders` 테이블에 "결제 대기"로 저장하고, 승인 때 저장된 금액과 비교해요. 승인 결과와 결제 실패·취소 이유도 같은 주문에 기록해요.
같은 주문으로 다시 승인을 요청하면(성공 페이지 새로고침) 토스페이먼츠를 다시 부르지 않고 저장된 결과를 돌려줘요.

- 본인 상점 키를 쓰려면 Vercel 프로젝트 **Settings → Environment Variables**에 `TOSS_SECRET_KEY`를 추가하고 다시 배포하세요.
- 주문 저장에는 환경변수 두 개가 필요해요. 없으면 결제는 되지만 저장은 건너뛰어요.
  - `SUPABASE_URL` = `https://bxtfhadwhteljgzmuecy.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY` = Supabase 대시보드 **Project Settings → API Keys**의 `service_role`(secret) 키. 서버 전용이에요.

## Supabase `orders` 테이블

| 컬럼 | 내용 |
|---|---|
| `order_id` (PK) | 주문번호 |
| `order_name` | 주문 상품명 |
| `amount` | 주문 금액 (서버가 계산) |
| `items` | `[{ id, size, qty }]` |
| `status` | `PENDING`(결제 대기), `FAILED`(결제 실패), `USER_CANCELED`(손님이 결제창을 닫음), 승인 뒤에는 토스페이먼츠 결제 상태(`DONE` 등) |
| `payment_key` (unique) | 토스페이먼츠 paymentKey (승인 전에는 비어 있음) |
| `customer_name` / `customer_phone` / `customer_email` / `address` | 받는 분 이름·휴대폰·이메일·배송 주소 |
| `fail_code` / `fail_message` | 결제가 안 된 이유 |
| `method` | 결제 수단 |
| `approved_at` | 승인 시각 |
| `payment` | 승인 API 응답 전체 (JSON) |
| `created_at` / `updated_at` | 처음 저장한 시각 / 마지막으로 바뀐 시각 |

RLS가 켜져 있고 정책이 없어서 공개(anon) 키로는 읽거나 쓸 수 없어요. 서버만 서비스 롤 키로 접근해요.
- `serve.ps1`, `.claude`, `.mcp.json`은 `.vercelignore`로 배포에서 제외돼요.

## 키

기본값은 토스페이먼츠 문서에 공개된 테스트 키라 실제로 청구되지 않아요.

- 클라이언트 키: `js/checkout.js`의 `TOSS_CLIENT_KEY`
- 시크릿 키: 환경변수 `TOSS_SECRET_KEY` (서버에만 둬요. 테스트 서버는 `test_` 키로만 실행돼요.)
