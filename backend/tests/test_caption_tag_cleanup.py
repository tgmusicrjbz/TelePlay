from app.caption_metadata import remove_tags_from_caption


def test_removes_exact_hashtag_without_removing_normal_text():
    assert remove_tags_from_caption("عکس سفر #تهران و تهران زیبا", {"تهران"}) == "عکس سفر و تهران زیبا"


def test_removes_deleted_value_from_tag_list():
    assert remove_tags_from_caption("تگ‌ها: سفر، تهران، شب\nتوضیح فایل", {"تهران"}) == "تگ‌ها: سفر، شب\nتوضیح فایل"


def test_removes_empty_tag_line():
    assert remove_tags_from_caption("برچسب: حذف‌شونده\nمتن", {"حذف‌شونده"}) == "متن"
