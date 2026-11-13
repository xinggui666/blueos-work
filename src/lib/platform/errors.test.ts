import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, forbidden, notFound, statusOf } from "./errors.ts";

test("错误映射到 HTTP 状态码", () => {
  assert.equal(statusOf(forbidden()), 403);
  assert.equal(statusOf(notFound("x")), 404);
  assert.equal(statusOf(new ApiError(413, "x")), 413);
  assert.equal(statusOf(new Error("Unauthorized")), 401);
  assert.equal(statusOf(Object.assign(new Error("x"), { status: 401 })), 401);
  assert.equal(statusOf(new Error("参数不正确")), 400);
  assert.equal(statusOf("boom"), 400);
});
