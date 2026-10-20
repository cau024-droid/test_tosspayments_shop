// POST /api/confirm — 금액을 다시 계산해 비교한 뒤 시크릿 키로 토스페이먼츠 결제를 승인하고, 주문을 Supabase에 저장해요.
const { calcAmount, isValidOrderId, sendError, confirmToss, findOrder, saveOrder } = require("../lib/shop");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST");

  const { paymentKey, orderId, amount, items } = req.body || {};
  if (!paymentKey || !isValidOrderId(orderId) || !amount) {
    return sendError(res, 400, "INVALID_REQUEST", "paymentKey, orderId and amount are required");
  }

  // 이미 승인돼 저장된 주문이면 승인을 다시 요청하지 않고 저장된 결과를 돌려줘요.
  try {
    const saved = await findOrder(orderId);
    if (saved) {
      if (saved.payment_key === paymentKey && saved.payment) return res.status(200).json(saved.payment);
      return sendError(res, 409, "DUPLICATED_ORDER", "This order has already been paid");
    }
  } catch (err) {
    console.error("[confirm] order lookup failed:", err.message);
  }

  let expected;
  try {
    expected = calcAmount(items);
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
  if (result.status === 200) {
    try {
      await saveOrder({ items, payment: result.body });
    } catch (err) {
      console.error(`[confirm] ${orderId} approved but not saved:`, err.message);
    }
  }
  res.status(result.status).json(result.body);
};
