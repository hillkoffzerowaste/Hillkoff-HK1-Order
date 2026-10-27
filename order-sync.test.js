import test from "node:test";
import assert from "node:assert/strict";
import { shouldIgnoreRemoteOrder } from "./order-sync.js";

test("accepts a status update for an order created by this client", () => {
  const order = { id: "order-1", sourceClientId: "storefront", status: "grinding" };

  assert.equal(shouldIgnoreRemoteOrder(order, "storefront", "UPDATE"), false);
});

test("ignores the realtime insert echo for an order created by this client", () => {
  const order = { id: "order-1", sourceClientId: "storefront", status: "waiting" };

  assert.equal(shouldIgnoreRemoteOrder(order, "storefront", "INSERT"), true);
});

test("accepts a realtime insert from another client", () => {
  const order = { id: "order-2", sourceClientId: "packing-room", status: "waiting" };

  assert.equal(shouldIgnoreRemoteOrder(order, "storefront", "INSERT"), false);
});

test("accepts a realtime update from another client", () => {
  const order = { id: "order-2", sourceClientId: "packing-room", status: "done" };

  assert.equal(shouldIgnoreRemoteOrder(order, "storefront", "UPDATE"), false);
});

test("ignores malformed realtime orders without an id", () => {
  assert.equal(shouldIgnoreRemoteOrder({ sourceClientId: "packing-room" }, "storefront", "UPDATE"), true);
});

test("accepts unknown event types so future status events are not dropped", () => {
  const order = { id: "order-3", sourceClientId: "storefront", status: "done" };

  assert.equal(shouldIgnoreRemoteOrder(order, "storefront", "DELETE"), false);
});
