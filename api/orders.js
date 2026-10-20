// POST /api/orders — 주문 금액을 서버에서 계산해서 돌려줘요.
// Vercel 서버 함수는 상태를 저장하지 않아서, 승인 때 상품 목록으로 금액을 다시 계산해 비교해요.
const { calcAmount, isValidOrderId, sendError } = require("../lib/shop");

module.exports = (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST");

  const { orderId, items } = req.body || {};
  if (!isValidOrderId(orderId)) {
    return sendError(res, 400, "INVALID_ORDER_ID", "orderId must be 6-64 chars of letters, digits, - or _");
  }

  try {
    res.status(200).json({ orderId, amount: calcAmount(items) });
  } catch (err) {
    sendError(res, 400, "INVALID_ITEMS", err.message);
  }
};
