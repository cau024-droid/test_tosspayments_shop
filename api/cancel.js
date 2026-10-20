// POST /api/cancel — 회원이 자기 주문을 전체 취소해요. 시크릿 키로 토스페이먼츠 취소 API를 호출하고 결과를 저장해요.
const {
  isValidOrderId, sendError, hasSupabase, getUser, findOrder,
  CANCEL_REASONS, isCancelable, toMyOrder, cancelToss, saveCanceledOrder,
} = require("../lib/shop");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST");
  if (!hasSupabase()) return sendError(res, 503, "NOT_CONFIGURED", "Supabase is not configured");

  let user;
  try {
    user = await getUser(req);
  } catch (err) {
    return sendError(res, err.status || 401, "UNAUTHORIZED", err.message);
  }
  if (!user) return sendError(res, 401, "UNAUTHORIZED", "Login required");

  const { orderId, reason } = req.body || {};
  if (!isValidOrderId(orderId)) return sendError(res, 400, "INVALID_ORDER_ID", "Invalid orderId");
  if (!CANCEL_REASONS.includes(reason)) return sendError(res, 400, "INVALID_REASON", "Choose a cancel reason");

  let order;
  try {
    order = await findOrder(orderId);
  } catch (err) {
    console.error("[cancel] order lookup failed:", err.message);
    return sendError(res, 502, "ORDER_LOOKUP_FAILED", "Could not load the order");
  }
  // 다른 회원의 주문은 있는지조차 알려주지 않아요.
  if (!order || order.user_id !== user.id) return sendError(res, 404, "ORDER_NOT_FOUND", "Order not found");
  if (order.status === "CANCELED" || order.status === "PARTIAL_CANCELED") {
    return sendError(res, 409, "ALREADY_CANCELED", "This order is already canceled");
  }
  if (!order.payment_key || !isCancelable(order.status, order.approved_at)) {
    return sendError(res, 400, "NOT_CANCELABLE", "This order can no longer be canceled");
  }

  let result;
  try {
    result = await cancelToss({ paymentKey: order.payment_key, orderId, reason });
  } catch (err) {
    return sendError(res, 502, "TOSS_API_ERROR", err.message);
  }
  if (result.status !== 200) return res.status(result.status).json(result.body);

  // 환불은 이미 끝났으니 저장이 실패해도 결과는 돌려줘요. (로그로 확인)
  try {
    const saved = await saveCanceledOrder({ orderId, reason, payment: result.body });
    if (saved) return res.status(200).json(saved);
  } catch (err) {
    console.error(`[cancel] ${orderId} canceled but not saved:`, err.message);
  }
  const cancels = result.body.cancels || [];
  res.status(200).json({
    ...toMyOrder({ ...order, status: result.body.status, payment: result.body, cancel_reason: reason }),
    canceledAt: (cancels[cancels.length - 1] || {}).canceledAt || null,
    canceledAmount: cancels.reduce((s, c) => s + (c.cancelAmount || 0), 0),
  });
};
