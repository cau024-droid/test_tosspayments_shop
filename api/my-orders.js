// GET /api/my-orders — 로그인한 회원의 주문을 최근 순서로 돌려줘요. 다른 회원의 주문은 보이지 않아요.
const { sendError, hasSupabase, getUser, listMyOrders } = require("../lib/shop");

module.exports = async (req, res) => {
  if (req.method !== "GET") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use GET");
  if (!hasSupabase()) return sendError(res, 503, "NOT_CONFIGURED", "Supabase is not configured");

  let user;
  try {
    user = await getUser(req);
  } catch (err) {
    return sendError(res, err.status || 401, "UNAUTHORIZED", err.message);
  }
  if (!user) return sendError(res, 401, "UNAUTHORIZED", "Login required");

  try {
    res.status(200).json({ orders: await listMyOrders(user.id) });
  } catch (err) {
    console.error("[my-orders] lookup failed:", err.message);
    sendError(res, 502, "ORDER_LOOKUP_FAILED", "Could not load orders");
  }
};
