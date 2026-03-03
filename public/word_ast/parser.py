"""
parser.py — 解析 .docx 文件，返回 full_ast 字典
"""
import json
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

def _rgb_to_hex(color):
    """将 RGBColor 转为 #RRGGBB 字符串"""
    if color is None:
        return None
    try:
        return '#{:02X}{:02X}{:02X}'.format(color.rgb[0], color.rgb[1], color.rgb[2])
    except Exception:
        return None

def _get_alignment(para):
    align_map = {
        WD_ALIGN_PARAGRAPH.LEFT: 'left',
        WD_ALIGN_PARAGRAPH.CENTER: 'center',
        WD_ALIGN_PARAGRAPH.RIGHT: 'right',
        WD_ALIGN_PARAGRAPH.JUSTIFY: 'justify',
    }
    return align_map.get(para.alignment, 'left')

def _parse_run(run, run_index):
    """解析单个 run，返回 run 字典"""
    font = run.font
    size = None
    if font.size:
        try:
            size = int(font.size.pt)
        except Exception:
            size = None

    color = None
    try:
        if font.color and font.color.type is not None:
            color = _rgb_to_hex(font.color.rgb) if font.color.rgb else None
    except Exception:
        color = None

    return {
        'id': f'run_{run_index}',
        'text': run.text,
        'bold': bool(run.bold),
        'italic': bool(run.italic),
        'underline': bool(run.underline),
        'font_name': font.name,
        'font_size': size,
        'color': color,
    }

def _parse_paragraph(para, para_index):
    """解析单个段落，返回段落字典"""
    runs = []
    for ri, run in enumerate(para.runs):
        runs.append(_parse_run(run, para_index * 1000 + ri))

    style_name = para.style.name if para.style else 'Normal'

    para_font_size = None
    try:
        if para.style and para.style.font and para.style.font.size:
            para_font_size = int(para.style.font.size.pt)
    except Exception:
        pass

    return {
        'id': f'para_{para_index}',
        'style': style_name,
        'alignment': _get_alignment(para),
        'font_size': para_font_size,
        'runs': runs,
    }

def parse_docx(file_path: str) -> dict:
    """解析 .docx 文件，返回 full_ast 字典。

    Args:
        file_path: Pyodide 虚拟文件系统中的文件路径

    Returns:
        {
          "paragraphs": [ { id, style, alignment, font_size, runs: [...] }, ... ]
        }
    """
    doc = Document(file_path)
    paragraphs = []
    for i, para in enumerate(doc.paragraphs):
        paragraphs.append(_parse_paragraph(para, i))

    return {'paragraphs': paragraphs}

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        result = parse_docx(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False, indent=2))
