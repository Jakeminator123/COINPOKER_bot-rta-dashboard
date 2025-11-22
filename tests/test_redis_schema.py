import unittest

from core.redis_schema import redis_keys


class RedisSchemaTest(unittest.TestCase):
    def test_device_hash(self):
        self.assertEqual(redis_keys.device_hash("abc"), "device:abc")

    def test_device_detections(self):
        key = redis_keys.device_detections("xyz", "CRITICAL")
        self.assertEqual(key, "device:xyz:detections:CRITICAL")

    def test_batch_record(self):
        key = redis_keys.batch_record("xyz", 1234567890)
        self.assertEqual(key, "batch:xyz:1234567890")

    def test_session_keys(self):
        self.assertEqual(redis_keys.session_index("foo"), "sessions:foo")
        self.assertEqual(redis_keys.session_pattern("foo"), "session:foo:*")


if __name__ == "__main__":
    unittest.main()


