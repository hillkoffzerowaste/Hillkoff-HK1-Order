export function shouldIgnoreRemoteOrder(order, clientId, eventType) {
  return !order?.id || (eventType === "INSERT" && order.sourceClientId === clientId);
}
