// POST /api/fail — 결제창을 닫았거나 결제에 실패한 이유를 주문에 남겨요. 이미 결제된 주문은 바꾸지 않아요.
const { isValidOrderId, CANCEL_CODES, sendError, markOrderFailed } = require("../lib/shop");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST");

  const { orderId, code, message } = req.body || {};
  if (!isValidOrderId(orderId)) {
    return sendError(res, 400, "INVALID_ORDER_ID", "orderId must be 6-64 chars of letters, digits, - or _");
  }

  const status = CANCEL_CODES.includes(code) ? "USER_CANCELED" : "FAILED";
  try {
    const updated = await markOrderFailed({ orderId, status, code, message });
    res.status(200).json({ orderId, status, updated });
  } catch (err) {
    console.error(`[fail] ${orderId} not saved:`, err.message);
    sendError(res, 502, "ORDER_SAVE_FAILED", "Could not save the failure");
  }
};
