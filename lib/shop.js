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

module.exports = { calcAmount, isValidOrderId, sendError, confirmToss };
