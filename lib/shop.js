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
async function createOrder({ orderId, orderName, amount, items, customer, userId }) {
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
      user_id: userId || null,
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

// ---- 회원 ----
// 브라우저가 보낸 로그인 토큰(Authorization: Bearer ...)을 Supabase Auth에 물어 회원을 확인해요.
// 토큰이 없으면 null(비회원), 토큰이 틀리거나 만료됐으면 401 에러를 던져요.
async function getUser(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  if (!hasSupabase()) {
    const err = new Error("Supabase is not configured");
    err.status = 503;
    throw err;
  }
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: header },
  });
  if (!r.ok) {
    const err = new Error("Invalid or expired login");
    err.status = 401;
    throw err;
  }
  const user = await r.json();
  return { id: user.id, email: user.email };
}

// ---- 주문 취소 ----
const CANCEL_DAYS = 7;
const CANCEL_REASONS = ["단순 변심", "사이즈를 잘못 골랐어요", "다른 상품으로 다시 살게요", "기타"];

// 결제 완료 후 7일 이내만 손님이 직접 취소할 수 있어요. (배송 단계가 생기면 배송 시작 전 조건도 더해요)
function isCancelable(status, approvedAt) {
  if (status !== "DONE" || !approvedAt) return false;
  return Date.now() - new Date(approvedAt).getTime() <= CANCEL_DAYS * 24 * 60 * 60 * 1000;
}

// 주문을 화면에 보낼 모양으로 바꿔요. (serve.ps1 의 ConvertTo-MyOrder 와 같은 모양)
function toMyOrder(row) {
  const payment = row.payment || {};
  return {
    orderId: row.order_id,
    orderName: row.order_name,
    amount: row.amount,
    items: row.items || [],
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    method: row.method,
    card: payment.card ? payment.card.number : null,
    receiptUrl: payment.receipt ? payment.receipt.url : null,
    customer: { name: row.customer_name, phone: row.customer_phone, email: row.customer_email, addr: row.address },
    failCode: row.fail_code,
    failMessage: row.fail_message,
    cancelReason: row.cancel_reason,
    canceledAt: row.canceled_at,
    canceledAmount: row.canceled_amount,
    cancelable: isCancelable(row.status, row.approved_at),
  };
}

const MY_ORDER_COLUMNS =
  "order_id,order_name,amount,items,status,created_at,approved_at,method,payment,customer_name,customer_phone,customer_email,address,fail_code,fail_message,cancel_reason,canceled_at,canceled_amount";

async function listMyOrders(userId) {
  const rows = await supabase(
    `orders?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=100&select=${MY_ORDER_COLUMNS}`
  );
  return rows.map(toMyOrder);
}

async function cancelToss({ paymentKey, orderId, reason }) {
  const auth = Buffer.from(SECRET_KEY + ":").toString("base64");
  const r = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + auth,
      "Content-Type": "application/json",
      // 같은 주문의 취소를 두 번 보내도 한 번만 처리돼요.
      "Idempotency-Key": `cancel-${orderId}`,
    },
    body: JSON.stringify({ cancelReason: reason }),
  });
  return { status: r.status, body: await r.json() };
}

// 취소 결과를 저장해요. 결제 완료 상태인 주문만 바꿔요.
async function saveCanceledOrder({ orderId, reason, payment }) {
  const cancels = payment.cancels || [];
  const last = cancels[cancels.length - 1] || {};
  const rows = await supabase(`${orderPath(orderId)}&status=eq.DONE`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: payment.status,
      payment,
      cancel_reason: reason,
      canceled_at: last.canceledAt || new Date().toISOString(),
      canceled_amount: cancels.reduce((s, c) => s + (c.cancelAmount || 0), 0),
      updated_at: new Date().toISOString(),
    }),
  });
  return rows[0] ? toMyOrder(rows[0]) : null;
}

module.exports = {
  calcAmount, isValidOrderId, parseCustomer, CANCEL_CODES, sendError, confirmToss,
  hasSupabase, findOrder, createOrder, savePaidOrder, markOrderFailed,
  getUser, CANCEL_REASONS, isCancelable, toMyOrder, listMyOrders, cancelToss, saveCanceledOrder,
};
