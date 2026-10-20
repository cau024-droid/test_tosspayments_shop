// POST /api/confirm — 저장된 주문 금액과 비교한 뒤 시크릿 키로 토스페이먼츠 결제를 승인하고, 결과를 Supabase에 저장해요.
const {
  calcAmount, isValidOrderId, sendError, confirmToss,
  hasSupabase, findOrder, savePaidOrder, markOrderFailed,
} = require("../lib/shop");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST");

  const { paymentKey, orderId, amount, items } = req.body || {};
  if (!paymentKey || !isValidOrderId(orderId) || !amount) {
    return sendError(res, 400, "INVALID_REQUEST", "paymentKey, orderId and amount are required");
  }

  // 주문을 찾지 못하면(조회 실패 포함) 브라우저가 보낸 items 로 금액을 다시 계산해요.
  let saved = null;
  let lookedUp = false;
  try {
    saved = await findOrder(orderId);
    lookedUp = hasSupabase();
  } catch (err) {
    console.error("[confirm] order lookup failed:", err.message);
  }

  // 이미 승인된 주문이면 승인을 다시 요청하지 않고 저장된 결과를 돌려줘요.
  if (saved && saved.payment_key) {
    if (saved.payment_key === paymentKey && saved.payment) return res.status(200).json(saved.payment);
    return sendError(res, 409, "DUPLICATED_ORDER", "This order has already been paid");
  }
  if (lookedUp && !saved) return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found");

  const orderItems = saved ? saved.items : items;
  let expected;
  try {
    expected = saved ? saved.amount : calcAmount(items);
  } catch (err) {
    return sendError(res, 400, "INVALID_ITEMS", err.message);
  }
  if (Number(amount) !== expected) {
    return sendError(res, 400, "AMOUNT_MISMATCH", `Amount does not match the order (${expected})`);
  }

  let result;
  try {
    result = await confirmToss({ paymentKey, orderId, amount: expected });
  } catch (err) {
    return sendError(res, 502, "TOSS_API_ERROR", err.message);
  }

  // 결제는 이미 승인됐으니 저장이 실패해도 결제 결과는 그대로 돌려줘요. (로그로 확인)
  try {
    if (result.status === 200) {
      await savePaidOrder({ items: orderItems, payment: result.body });
    } else {
      await markOrderFailed({ orderId, status: "FAILED", code: result.body.code, message: result.body.message });
    }
  } catch (err) {
    console.error(`[confirm] ${orderId} -> ${result.status}, not saved:`, err.message);
  }
  res.status(result.status).json(result.body);
};
