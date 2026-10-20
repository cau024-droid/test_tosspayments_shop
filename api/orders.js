// POST /api/orders — 주문 금액을 서버에서 계산하고, 주문을 "결제 대기"(PENDING)로 Supabase에 저장해요.
const { calcAmount, isValidOrderId, parseCustomer, sendError, createOrder } = require("../lib/shop");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST");

  const { orderId, orderName, items } = req.body || {};
  if (!isValidOrderId(orderId)) {
    return sendError(res, 400, "INVALID_ORDER_ID", "orderId must be 6-64 chars of letters, digits, - or _");
  }

  let amount, customer;
  try {
    amount = calcAmount(items);
  } catch (err) {
    return sendError(res, 400, "INVALID_ITEMS", err.message);
  }
  try {
    customer = parseCustomer(req.body.customer);
  } catch (err) {
    return sendError(res, 400, "INVALID_CUSTOMER", err.message);
  }

  // 주문 기록 없이 결제되지 않도록, 저장에 실패하면 결제를 막아요.
  try {
    await createOrder({ orderId, orderName, amount, items, customer });
  } catch (err) {
    if (err.status === 409) return sendError(res, 409, "DUPLICATED_ORDER_ID", "orderId already exists");
    console.error(`[orders] ${orderId} not saved:`, err.message);
    return sendError(res, 502, "ORDER_SAVE_FAILED", "Could not save the order");
  }

  res.status(200).json({ orderId, amount });
};
