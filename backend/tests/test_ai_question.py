"""Tests for grounded file question helpers."""
import unittest

from app.ai_question import build_question_context, clean_grounded_answer, question_instruction


class AIQuestionTests(unittest.TestCase):
    def test_long_context_keeps_question_relevant_section(self):
        content = ("مقدمه عمومی " * 5000) + "\n\nبودجه پروژه آلفا صد میلیون تومان است.\n\n" + ("پایان عمومی " * 5000)
        context = build_question_context(file_name="گزارش.md", description="", tags=[], content=content, question="بودجه پروژه آلفا چقدر است؟")
        self.assertIn("صد میلیون تومان", context)
        self.assertLessEqual(len(context), 40_000)

    def test_instruction_marks_file_as_untrusted(self):
        instruction = question_instruction("نتیجه چیست؟", [{"role": "user", "content": "سؤال قبلی"}])
        self.assertIn("غیرقابل‌اعتماد", instruction)
        self.assertIn("سؤال قبلی", instruction)

    def test_markdown_fence_is_removed(self):
        self.assertEqual(clean_grounded_answer("```markdown\n**پاسخ**\n```"), "**پاسخ**")
