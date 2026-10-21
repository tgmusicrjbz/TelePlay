from app.link_captions import render_link_caption


def test_renders_persian_and_english_aliases():
    result = render_link_caption(
        "📝 [تیتر]\n🔥 [channel]\n🔗 [لینک]\n🎞 [نوع] · [کیفیت]",
        title="نمونه", author="سازنده", url="https://example.test", media_type="ویدیو", quality="480p",
    )
    assert result == "📝 نمونه\n🔥 سازنده\n🔗 https://example.test\n🎞 ویدیو · 480p"


def test_removes_a_row_when_its_dynamic_value_is_empty():
    result = render_link_caption("📝 [عنوان]\n📺 سازنده: [سازنده]\n🔗 [لینک]", title="نمونه", author=None, url="https://example.test")
    assert result == "📝 نمونه\n🔗 https://example.test"


def test_keeps_unknown_placeholders_literal():
    assert render_link_caption("[دلخواه] [عنوان]", title="نمونه") == "[دلخواه] نمونه"
