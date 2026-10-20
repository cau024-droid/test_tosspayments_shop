// POST /api/confirm — 금액을 다시 계산해 비교한 뒤 시크릿 키로 토스페이먼츠 결제를 승인해요.
const { calcAmount, isValidOrderId, sendError, confirmToss } = require("../lib/shop");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST");

  const { paymentKey, orderId, amount, items } = req.body || {};
  if (!paymentKey || !isValidOrderId(orderId) || !amount) {
    return sendError(res, 400, "INVALID_REQUEST", "paymentKey, orderId and amount are required");
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

  try {
    const result = await confirmToss({ paymentKey, orderId, amount: expected });
    res.status(result.status).json(result.body);
  } catch (err) {
    sendError(res, 502, "TOSS_API_ERROR", err.message);
  }
};
