import unittest

from fastapi import HTTPException

from app.dependencies import get_role, require_writer


class DemoRoleTests(unittest.TestCase):
    def test_all_demo_roles_are_accepted(self):
        for role in ("creator", "reviewer", "brand_manager", "admin"):
            with self.subTest(role=role):
                self.assertEqual(get_role(x_role=role), role)

    def test_role_is_normalized(self):
        self.assertEqual(get_role(x_role=" Brand_Manager "), "brand_manager")

    def test_missing_or_invalid_role_is_rejected(self):
        for role in (None, "visitor"):
            with self.subTest(role=role):
                with self.assertRaises(HTTPException) as raised:
                    get_role(x_role=role)
                self.assertEqual(raised.exception.status_code, 403)
                self.assertEqual(raised.exception.detail["error"], "forbidden")

    def test_knowledge_writes_remain_limited_to_managers(self):
        self.assertEqual(require_writer("brand_manager"), "brand_manager")
        self.assertEqual(require_writer("admin"), "admin")
        for role in ("creator", "reviewer"):
            with self.subTest(role=role):
                with self.assertRaises(HTTPException) as raised:
                    require_writer(role)
                self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
