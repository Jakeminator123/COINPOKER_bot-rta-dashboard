import test from "node:test";
import assert from "node:assert/strict";

import { redisKeys } from "@/lib/redis/schema";

test("redisKeys.deviceHash returns canonical hash key", () => {
  assert.equal(
    redisKeys.deviceHash("abc123"),
    "device:abc123",
    "Device hash key should include prefix",
  );
});

test("redisKeys.deviceDetections includes severity suffix", () => {
  assert.equal(
    redisKeys.deviceDetections("zxy", "CRITICAL"),
    "device:zxy:detections:CRITICAL",
  );
});

test("redisKeys.batchRecord encodes timestamp", () => {
  assert.equal(
    redisKeys.batchRecord("xyz", 123),
    "batch:xyz:123",
  );
});

test("redisKeys.session helpers share prefix", () => {
  assert.equal(
    redisKeys.sessionIndex("xyz"),
    "sessions:xyz",
  );
  assert.equal(
    redisKeys.sessionPattern("xyz"),
    "session:xyz:*",
  );
});

