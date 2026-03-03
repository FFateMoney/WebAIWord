import base64
import copy

from docx.enum.dml import MSO_COLOR_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.text.run import Run
from lxml import etree

from word_ast.utils.units import pt_to_half_points

_WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_EMU_PER_TWIP = 635


def _color_to_hex(color, *, skip_theme: bool = False) -> str | None:
    if color is None:
        return None
    if skip_theme and getattr(color, "type", None) == MSO_COLOR_TYPE.THEME:
        return None
    rgb = color.rgb
    if rgb is None:
        return None
    return f"#{rgb}"


def _read_east_asia_font(font) -> str | None:
    try:
        rPr = font._element.rPr
        if rPr is None:
            return None
        rFonts = rPr.find(qn('w:rFonts'))
        if rFonts is None:
            return None
        return rFonts.get(qn('w:eastAsia'))
    except (AttributeError, TypeError):
        return None


_INHERITABLE_RPR_TAGS = {
    qn("w:rFonts"),
    qn("w:sz"),
    qn("w:szCs"),
    qn("w:color"),
    qn("w:lang"),
    qn("w:kern"),
    qn("w:spacing"),
}


def _inherit_style_rPr(rPr_el, paragraph) -> None:
    present_tags = {child.tag for child in rPr_el}
    style = paragraph.style
    while style is not None:
        try:
            style_el = style.element
            style_rPr = style_el.rPr if style_el is not None else None
        except AttributeError:
            style_rPr = None
        if style_rPr is not None:
            for child in style_rPr:
                if child.tag in _INHERITABLE_RPR_TAGS and child.tag not in present_tags:
                    if child.tag == qn("w:color") and child.get(qn("w:themeColor")):
                        continue
                    rPr_el.append(copy.deepcopy(child))
                    present_tags.add(child.tag)
        try:
            style = style.base_style
        except AttributeError:
            break


def _font_to_overrides(font, *, skip_theme_color: bool = False, paragraph=None) -> dict:
    overrides = {}
    if font is None:
        return overrides

    if font.bold is not None:
        overrides["bold"] = font.bold
    if font.italic is not None:
        overrides["italic"] = font.italic
    if font.underline is not None:
        overrides["underline"] = bool(font.underline)

    color = _color_to_hex(font.color, skip_theme=skip_theme_color)
    if color:
        overrides["color"] = color

    size = pt_to_half_points(font.size.pt if font.size else None)
    if size is not None:
        overrides["size"] = size

    ascii_font = font.name
    ea_font = _read_east_asia_font(font)
    if ascii_font:
        overrides["font_ascii"] = ascii_font
    if ea_font:
        overrides["font_east_asia"] = ea_font

    try:
        rPr_el = font._element.rPr
        if rPr_el is None:
            if paragraph is not None:
                rPr_el = OxmlElement("w:rPr")
                _inherit_style_rPr(rPr_el, paragraph)
                if len(rPr_el):
                    overrides["_raw_rPr"] = etree.tostring(rPr_el, encoding="unicode")
        else:
            if paragraph is not None:
                _inherit_style_rPr(rPr_el, paragraph)
            overrides["_raw_rPr"] = etree.tostring(rPr_el, encoding="unicode")
    except (AttributeError, TypeError):
        pass

    return overrides


def _parse_inline_image(run: Run) -> dict | None:
    try:
        drawing_el = run._element.find(qn("w:drawing"))
        if drawing_el is None:
            return None
        inline_el = drawing_el.find(f"{{{_WP_NS}}}inline")
        if inline_el is None:
            inline_el = drawing_el.find(f"{{{_WP_NS}}}anchor")
        if inline_el is None:
            return None

        extent = inline_el.find(f"{{{_WP_NS}}}extent")
        width_emu = int(extent.get("cx", 0)) if extent is not None else 0
        height_emu = int(extent.get("cy", 0)) if extent is not None else 0
        width_twips = width_emu // _EMU_PER_TWIP
        height_twips = height_emu // _EMU_PER_TWIP

        graphic = inline_el.find(f"{{{_A_NS}}}graphic")
        if graphic is None:
            return None
        graphic_data = graphic.find(f"{{{_A_NS}}}graphicData")
        if graphic_data is None:
            return None
        blipFill = graphic_data.find(f"{{{_A_NS}}}blipFill")
        if blipFill is None:
            pic_ns = "http://schemas.openxmlformats.org/drawingml/2006/picture"
            pic = graphic_data.find(f"{{{pic_ns}}}pic")
            if pic is not None:
                blipFill = pic.find(f"{{{pic_ns}}}blipFill")
        if blipFill is None:
            return None
        blip = blipFill.find(f"{{{_A_NS}}}blip")
        if blip is None:
            return None

        r_embed = blip.get(f"{{{_R_NS}}}embed")
        if not r_embed:
            return None

        part = run.part
        image_part = part.related_parts.get(r_embed)
        if image_part is None:
            return None

        content_type = image_part.content_type
        image_bytes = image_part.blob
        b64 = base64.b64encode(image_bytes).decode("ascii")

        return {
            "type": "InlineImage",
            "data": b64,
            "content_type": content_type,
            "width": width_twips,
            "height": height_twips,
        }
    except Exception:
        return None


def _merge_runs(content: list) -> list:
    merged = []
    for item in content:
        if (
            merged
            and item.get("type") == "Text"
            and merged[-1].get("type") == "Text"
            and item.get("overrides") == merged[-1].get("overrides")
        ):
            merged[-1]["text"] += item["text"]
        else:
            merged.append(item)
    return merged


_ALIGNMENT_MAP = {
    0: "left",
    1: "center",
    2: "right",
    3: "justify",
}

_INHERITABLE_PPR_TAGS = frozenset({
    qn("w:jc"),
    qn("w:ind"),
    qn("w:spacing"),
    qn("w:numPr"),
    qn("w:outlineLvl"),
    qn("w:contextualSpacing"),
    qn("w:keepNext"),
    qn("w:keepLines"),
    qn("w:pageBreakBefore"),
    qn("w:suppressLineNumbers"),
    qn("w:suppressAutoHyphens"),
})


def _inherit_style_pPr(pPr_el, paragraph) -> None:
    present_tags = {child.tag for child in pPr_el}
    style = paragraph.style
    while style is not None:
        try:
            style_pPr = style.element.pPr if style.element is not None else None
        except AttributeError:
            style_pPr = None
        if style_pPr is not None:
            for child in style_pPr:
                if child.tag in _INHERITABLE_PPR_TAGS and child.tag not in present_tags:
                    pPr_el.append(copy.deepcopy(child))
                    present_tags.add(child.tag)
        try:
            style = style.base_style
        except AttributeError:
            break


def _parse_paragraph_format(paragraph: Paragraph) -> dict:
    fmt: dict = {}
    pf = paragraph.paragraph_format

    if pf.alignment is not None:
        fmt["alignment"] = _ALIGNMENT_MAP.get(int(pf.alignment), "left")

    if pf.left_indent is not None:
        fmt["indent_left"] = pf.left_indent.twips
    if pf.right_indent is not None:
        fmt["indent_right"] = pf.right_indent.twips
    if pf.first_line_indent is not None:
        fmt["indent_first_line"] = pf.first_line_indent.twips

    if pf.space_before is not None:
        fmt["space_before"] = pf.space_before.twips
    if pf.space_after is not None:
        fmt["space_after"] = pf.space_after.twips

    try:
        pPr_el = paragraph._element.pPr
        if pPr_el is not None:
            _inherit_style_pPr(pPr_el, paragraph)
            fmt["_raw_pPr"] = etree.tostring(pPr_el, encoding="unicode")
        else:
            pPr_el = OxmlElement("w:pPr")
            _inherit_style_pPr(pPr_el, paragraph)
            if len(pPr_el):
                fmt["_raw_pPr"] = etree.tostring(pPr_el, encoding="unicode")
    except (AttributeError, TypeError):
        pass

    return fmt


def _iter_runs(paragraph: Paragraph):
    _tag_r = qn("w:r")
    _wrapper_tags = frozenset({
        qn("w:hyperlink"),
        qn("w:ins"),
        qn("w:del"),
        qn("w:smartTag"),
        qn("w:fldSimple"),
        qn("w:customXml"),
    })
    _tag_sdt = qn("w:sdt")
    _tag_sdt_content = qn("w:sdtContent")
    for child in paragraph._element:
        if child.tag == _tag_r:
            yield Run(child, paragraph)
        elif child.tag in _wrapper_tags:
            for r_el in child.findall(_tag_r):
                yield Run(r_el, paragraph)
        elif child.tag == _tag_sdt:
            sdt_content = child.find(_tag_sdt_content)
            if sdt_content is not None:
                for r_el in sdt_content.findall(_tag_r):
                    yield Run(r_el, paragraph)


def parse_paragraph_block(paragraph: Paragraph, block_id: str) -> dict:
    content = []
    for run in _iter_runs(paragraph):
        image_node = _parse_inline_image(run)
        if image_node is not None:
            content.append(image_node)
            continue
        item: dict = {"type": "Text", "text": run.text}
        overrides = _font_to_overrides(run.font, paragraph=paragraph)
        if overrides:
            item["overrides"] = overrides
        content.append(item)
    content = _merge_runs(content)

    default_run = _font_to_overrides(
        getattr(paragraph.style, "font", None), skip_theme_color=True
    )
    default_run.pop("_raw_rPr", None)

    para_fmt = _parse_paragraph_format(paragraph)

    block = {
        "id": block_id,
        "type": "Paragraph",
        "style": paragraph.style.style_id if paragraph.style else None,
        "content": content,
    }
    if para_fmt:
        block["paragraph_format"] = para_fmt
    if default_run:
        block["default_run"] = default_run

    return block
