// Vercel 서버 함수 공통 로직 (serve.ps1 과 같은 규칙)
const fs = require("fs");
const path = require("path");

const FREE_SHIPPING_MIN = 30000;
const SHIPPING_FEE = 3000;

// 시크릿 키는 Vercel 환경변수 TOSS_SECRET_KEY 로 넣어요.
// 기본값은 js/checkout.js 의 문서용 클라이언트 키와 짝인 공개 테스트 시크릿 키예요.
const SECRET_KEY = process.env.TOSS_SECRET_KEY || "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6";

// 가격은 js/products.js 에서 읽어요 (상품 한 줄에 하나). 브라우저가 보낸 가격은 믿지 않아요.
function loadProducts() {
  const src = fs.readFileSync(path.join(process.cwd(), "js", "products.js"), "utf8");
  const re = /id:\s*"([^"]+)".*?sale:\s*(\d+).*?free:\s*(true|false)/g;
  const map = {};
  let m;
  while ((m = re.exec(src))) map[m[1]] = { sale: Number(m[2]), free: m[3] === "true" };
  return map;
}

function calcAmount(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Order has no items");
  const products = loadProducts();
  let subtotal = 0;
  let allFree = true;
  for (const item of items) {
    const p = products[String(item && item.id)];
    if (!p) throw new Error(`Unknown product: ${item && item.id}`);
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new Error(`Invalid quantity for ${item.id}`);
    subtotal += p.sale * qty;
    if (!p.free) allFree = false;
  }
  const shipping = allFree || subtotal >= FREE_SHIPPING_MIN ? 0 : SHIPPING_FEE;
  return subtotal + shipping;
}

const isValidOrderId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(id);

// 받는 분 정보를 검사하고 다듬어요. (checkout.js 의 입력 검사와 같은 규칙)
function parseCustomer(c) {
  c = c || {};
  const name = String(c.name || "").trim();
  const phone = String(c.phone || "").replace(/\D/g, "");
  const email = String(c.email || "").trim();
  const addr = String(c.addr || "").trim();
  if (!name || name.length > 50) throw new Error("Invalid customer name");
  if (!/^01\d{8,9}$/.test(phone)) throw new Error("Invalid customer phone");
  if (email && (email.length > 100 || !/^[^\s@]+@[^\s@]+$/.test(email))) throw new Error("Invalid customer email");
  if (!addr || addr.length > 200) throw new Error("Invalid customer address");
  return { name, phone, email, addr };
}

// 결제창을 닫은 경우의 에러 코드 (위젯: USER_CANCEL, failUrl: PAY_PROCESS_CANCELED)
const CANCEL_CODES = ["USER_CANCEL", "PAY_PROCESS_CANCELED"];

const cleanItems = (items) =>
  items.map((i) => ({ id: String(i.id), size: i.size == null ? null : String(i.size), qty: Number(i.qty) }));

function sendError(res, status, code, message) {
  res.status(status).json({ code, message });
}

async function confirmToss({ paymentKey, orderId, amount }) {
  const auth = Buffer.from(SECRET_KEY + ":").toString("base64");
  const r = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });
  return { status: r.status, body: await r.json() };
}

// 주문 저장은 Supabase(orders 테이블)에 해요. Vercel 환경변수 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 가 필요해요.
// 서비스 롤 키는 RLS를 우회하니 서버에만 두세요. 둘 중 하나라도 없으면 저장을 건너뛰어요.
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const hasSupabase = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

async function supabase(pathAndQuery, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`Supabase ${r.status}: ${text}`);
    err.status = r.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

const orderPath = (orderId) => `orders?order_id=eq.${encodeURIComponent(orderId)}`;

async function findOrder(orderId) {
  if (!hasSupabase()) return null;
  const rows = await supabase(`${orderPath(orderId)}&select=*`);
  return rows[0] || null;
}

// 결제 버튼을 누르면 주문을 "결제 대기"(PENDING)로 먼저 저장해요. 같은 주문번호가 있으면 Supabase가 409를 돌려줘요.
async function createOrder({ orderId, orderName, amount, items, customer }) {
  if (!hasSupabase()) return;
  await supabase("orders", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      order_id: orderId,
      order_name: String(orderName || "").slice(0, 200),
      amount,
      items: cleanItems(items),
      status: "PENDING",
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email || null,
      address: customer.addr,
    }),
  });
}

// 승인된 결제 결과를 저장해요. 결제 대기 주문이 없어도(예: 저장 전 배포) 새로 만들어요.
async function savePaidOrder({ items, payment }) {
  if (!hasSupabase()) return;
  const row = {
    order_id: payment.orderId,
    order_name: payment.orderName,
    amount: payment.totalAmount,
    items: cleanItems(items),
    status: payment.status,
    payment_key: payment.paymentKey,
    method: payment.method,
    approved_at: payment.approvedAt,
    payment,
    fail_code: null,
    fail_message: null,
    updated_at: new Date().toISOString(),
  };
  await supabase("orders?on_conflict=order_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
}

// 결제가 안 된 이유를 남겨요. 이미 결제된 주문은 건드리지 않아요. 바뀐 주문이 있으면 true.
async function markOrderFailed({ orderId, status, code, message }) {
  if (!hasSupabase()) return false;
  const rows = await supabase(`${orderPath(orderId)}&status=in.(PENDING,FAILED,USER_CANCELED)`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status,
      fail_code: String(code || "UNKNOWN_ERROR").slice(0, 100),
      fail_message: message ? String(message).slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    }),
  });
  return rows.length > 0;
}

module.exports = {
  calcAmount, isValidOrderId, parseCustomer, CANCEL_CODES, sendError, confirmToss,
  hasSupabase, findOrder, createOrder, savePaidOrder, markOrderFailed,
};
