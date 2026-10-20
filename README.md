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

- `POST /api/orders` — 주문 저장. 금액은 서버가 `js/products.js`의 가격으로 다시 계산해요.
- `POST /api/confirm` — 저장된 금액과 비교한 뒤 시크릿 키로 토스페이먼츠 결제 승인 API를 호출해요.
- `GET /api/orders` — 저장된 주문 목록 (테스트용)

## 키

기본값은 토스페이먼츠 문서에 공개된 테스트 키라 실제로 청구되지 않아요.

- 클라이언트 키: `js/checkout.js`의 `TOSS_CLIENT_KEY`
- 시크릿 키: 환경변수 `TOSS_SECRET_KEY` (서버에만 둬요. 테스트 서버는 `test_` 키로만 실행돼요.)
