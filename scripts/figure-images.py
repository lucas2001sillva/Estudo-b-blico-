#!/usr/bin/env python3
"""Draw region-only study figures without incorporating screenshots of pages.

Structured tables are rebuilt as new SVG cards. Native diagrams retain their
checked geometry and Unicode labels, with the site's typography and palette.
Raster-only diagrams without reviewed data intentionally return None.
"""
from __future__ import annotations

import colorsys
from html import escape
from pathlib import Path
import re
import textwrap
import unicodedata
import xml.etree.ElementTree as ET

import fitz
from PIL import Image

SVG = 'http://www.w3.org/2000/svg'
XLINK = 'http://www.w3.org/1999/xlink'
ET.register_namespace('', SVG)
ET.register_namespace('xlink', XLINK)
FONT = 'Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif'
PALETTES = {
    'light': {'surface': '#ffffff', 'paper': '#f6f5f0', 'ink': '#29332d', 'muted': '#69736b',
              'line': '#e5e7df', 'primary': '#245341', 'onPrimary': '#ffffff', 'soft': '#eaf1e9', 'accent': '#775a29'},
    'dark': {'surface': '#1e2520', 'paper': '#151a17', 'ink': '#edf1e9', 'muted': '#b4bdb3',
             'line': '#364138', 'primary': '#bad6b8', 'onPrimary': '#151a17', 'soft': '#293f30', 'accent': '#e0b46a'},
}
SOURCE_NAMES = {'study-1': 'Jornada da Bíblia — Parte 1', 'study-2': 'Jornada da Bíblia — Parte 2',
                'study-3': 'Jornada da Bíblia — Parte 3', 'study-4': 'Jornada da Bíblia — Parte 4',
                'gospels': 'Os 4 Evangelhos'}


def _slug(value: str) -> str:
    value = unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', value).strip('-')[:70] or 'figura'


def _text(x, y, value, color, size=21, weight=400, serif=False):
    family = 'Georgia,serif' if serif else FONT
    return (f'<text x="{x:g}" y="{y:g}" font-family="{family}" font-size="{size:g}" '
            f'font-weight="{weight}" fill="{color}">{escape(str(value))}</text>')


def _wrap(value, width, size=21):
    # Generous width allocation leaves room for the system-font fallback.
    limit = max(8, int(width / (size * .59)))
    parts = str(value).splitlines() or ['']
    return [line for part in parts for line in (textwrap.wrap(part, limit, break_long_words=True,
            break_on_hyphens=False) or [''])]


def _shell(width, height, title, description, source_id, page_no, palette, pieces):
    return '\n'.join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="{SVG}" xmlns:xlink="{XLINK}" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="figure-title figure-description">',
        f'<title id="figure-title">{escape(title)}</title>',
        f'<desc id="figure-description">{escape(description)}</desc>',
        f'<metadata>Fonte: {escape(SOURCE_NAMES.get(source_id, source_id))}, página {page_no}. '
        'Figura vetorial recriada; não contém captura de página.</metadata>',
        f'<rect width="{width}" height="{height}" rx="20" fill="{palette["surface"]}"/>',
        *pieces,
        '</svg>', '',
    ])


def _heading(title, source_id, palette, width=1000):
    lines = _wrap(title, width - 80, 30)
    pieces = [_text(40, 34, SOURCE_NAMES.get(source_id, source_id).upper(), palette['muted'], 11, 650)]
    for index, line in enumerate(lines):
        pieces.append(_text(40, 78 + index * 38, line, palette['ink'], 30, serif=True))
    return pieces, 106 + (len(lines) - 1) * 38


def _source_notes(figure):
    """Only literal source notes belong to the figure, not audit instructions."""
    values = [figure.get('caption'), figure.get('note')]
    annotations = figure.get('annotations', [])
    if isinstance(annotations, str):
        values.append(annotations)
    elif isinstance(annotations, list):
        values.extend(annotations)
    result = []
    for value in values:
        if isinstance(value, str) and value.strip() and value.strip() not in result:
            result.append(value.strip())
    return result


def _notes_and_footer(figure, palette, source_id, page_no, y, width=1000):
    pieces = []
    available = width - 80
    notes = _source_notes(figure)
    if notes:
        y += 12
        lines = [_wrap(note, available - 36, 19) for note in notes]
        note_height = sum(len(paragraph) * 27 + 12 for paragraph in lines) + 20
        pieces.append(f'<rect x="40" y="{y:g}" width="{available:g}" height="{note_height:g}" rx="10" fill="{palette["soft"]}"/>')
        baseline = y + 31
        for paragraph in lines:
            for line in paragraph:
                pieces.append(_text(58, baseline, line, palette['ink'], 19))
                baseline += 27
            baseline += 12
        y += note_height + 12
    pieces.append(f'<line x1="40" x2="{width - 40}" y1="{y + 8:g}" y2="{y + 8:g}" stroke="{palette["line"]}"/>')
    pieces.append(_text(40, y + 35, f'Fonte: {SOURCE_NAMES.get(source_id, source_id)} · p. {page_no}', palette['muted'], 13))
    return pieces, int(y + 58)


def _table_svg(figure, source_id, page_no, palette):
    width = 1000
    rows = [[str(cell) for cell in row] for row in figure['rows']]
    columns = [str(cell) for cell in figure.get('columns', [])]
    count = max([len(columns), *map(len, rows)])
    if count < 1 or count > 8:
        return None
    available = width - 80
    # Name/description pairs receive a narrow label column; balanced tables
    # keep equal widths so dates and references remain under their headings.
    if count == 2 and max((len(row[0]) for row in rows if row), default=0) <= 28:
        widths = [250, available - 250]
    else:
        widths = [available / count] * count
    pieces, y = _heading(figure['title'], source_id, palette)
    line_height = 28
    if columns:
        cells = [_wrap(columns[i] if i < len(columns) else '', widths[i] - 32, 19) for i in range(count)]
        height = max(map(len, cells)) * 26 + 28
        pieces.append(f'<rect x="40" y="{y}" width="{available}" height="{height}" rx="10" fill="{palette["primary"]}"/>')
        x = 40
        for index, lines in enumerate(cells):
            for number, line in enumerate(lines):
                pieces.append(_text(x + 16, y + 29 + number * 26, line, palette['onPrimary'], 19, 650))
            x += widths[index]
        y += height + 10
    for row_index, row in enumerate(rows):
        cells = [_wrap(row[i] if i < len(row) else '', widths[i] - 32) for i in range(count)]
        height = max(map(len, cells)) * line_height + 30
        fill = palette['soft'] if row_index % 2 == 0 else palette['surface']
        pieces.append(f'<g data-row="{row_index}"><rect x="40" y="{y}" width="{available}" height="{height}" rx="10" '
                      f'fill="{fill}" stroke="{palette["line"]}"/>')
        x = 40
        for index, lines in enumerate(cells):
            for number, line in enumerate(lines):
                pieces.append(_text(x + 16, y + 31 + number * line_height, line,
                                    palette['primary'] if index == 0 else palette['ink'], 21, 600 if index == 0 else 400))
            x += widths[index]
        pieces.append('</g>')
        y += height + 10
    tail, height = _notes_and_footer(figure, palette, source_id, page_no, y, width)
    return width, height, pieces + tail


def _cards_svg(figure, source_id, page_no, palette):
    """Draw reviewed steps/lines; connect them only when explicitly specified."""
    width = 1000
    pieces, y = _heading(figure['title'], source_id, palette, width)
    rows = figure.get('rows') or [[line] for line in figure.get('lines', [])]
    if not rows:
        return None
    connected = bool(figure.get('sequence') or figure.get('cycle'))
    cycle = bool(figure.get('cycle'))
    left = 96 if cycle else 40
    card_width = width - 40 - left
    columns = figure.get('columns') or []
    centers = []
    if connected:
        pieces.append(f'<defs><marker id="sequence-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="{palette["primary"]}"/></marker></defs>')
    for index, row in enumerate(rows):
        texts = [str(cell) for cell in row]
        if len(texts) == 1:
            main = texts[0]
            remaining = []
        elif len(texts) == 2:
            main, *remaining = texts
        else:
            first_label = f'{columns[0]}: ' if columns else ''
            second_label = f'{columns[1]}: ' if len(columns) > 1 else ''
            main = f'{first_label}{texts[0]} · {second_label}{texts[1]}'
            remaining = [f'{columns[i]}: {texts[i]}' if i < len(columns) else texts[i] for i in range(2, len(texts))]
        headline = _wrap(main, card_width - 44, 23)
        body = [_wrap(value, card_width - 44, 21) for value in remaining]
        height = 28 + len(headline) * 30 + sum(len(paragraph) * 28 + 8 for paragraph in body)
        height = max(80, height)
        pieces.append(f'<g data-step="{index}"><rect x="{left:g}" y="{y:g}" width="{card_width:g}" height="{height:g}" rx="13" fill="{palette["soft"] if index % 2 == 0 else palette["surface"]}" stroke="{palette["line"]}" stroke-width="1.5"/>')
        baseline = y + 34
        for line in headline:
            pieces.append(_text(left + 22, baseline, line, palette['primary'], 23, 650))
            baseline += 30
        for paragraph in body:
            for line in paragraph:
                pieces.append(_text(left + 22, baseline + 2, line, palette['ink'], 21))
                baseline += 28
            baseline += 8
        pieces.append('</g>')
        centers.append(y + height / 2)
        bottom = y + height
        if connected and index < len(rows) - 1:
            center = left + card_width / 2
            pieces.append(f'<path d="M{center:g} {bottom + 4:g}V{bottom + 29:g}" fill="none" stroke="{palette["primary"]}" stroke-width="2.5" marker-end="url(#sequence-arrow)" data-link="next"/>')
            y = bottom + 42
        else:
            y = bottom + 14
    if cycle:
        # The return edge expresses the supplied cycle flag, never a new stage.
        pieces.append(f'<path d="M{left - 4:g} {centers[-1]:g}H62Q50 {centers[-1]:g} 50 {centers[-1] - 12:g}V{centers[0] + 12:g}Q50 {centers[0]:g} 62 {centers[0]:g}H{left - 6:g}" '
                      f'fill="none" stroke="{palette["primary"]}" stroke-width="2.5" marker-end="url(#sequence-arrow)" data-link="return"/>')
    tail, height = _notes_and_footer(figure, palette, source_id, page_no, y, width)
    return width, height, pieces + tail


def _color(value, palette):
    if not re.fullmatch(r'#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?', value):
        return value
    value = value[1:]
    if len(value) == 3:
        value = ''.join(char * 2 for char in value)
    rgb = tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))
    if min(rgb) >= .92:
        return palette['surface']
    if max(rgb) <= .12:
        return palette['ink']
    hue, lightness, saturation = colorsys.rgb_to_hls(*rgb)
    if saturation < .16:
        return palette['muted'] if lightness < .9 else palette['surface']
    if .53 < hue < .87:
        return palette['primary']
    if hue < .06 or hue > .95:
        return palette['accent']
    # Other hues may distinguish categories. Preserve them with their legend.
    return '#' + value


def _native_svg(page, figure, crop, palette, source_id, page_no):
    native = page.get_text('text', clip=crop).strip()
    drawings = [drawing for drawing in page.get_drawings() if fitz.Rect(drawing['rect']).intersects(crop)]
    if len(native) < 6 or not drawings:
        return None
    images = [item for item in page.get_image_info() if fitz.Rect(item['bbox']).intersects(crop)]
    # Numeric headers have native labels/geometry above a raster body; discard
    # that body, never package it into a new diagram. For other figures a
    # raster overlap may contain essential relations, so do not guess them.
    if images and not figure.get('header'):
        return None
    with fitz.open() as temporary:
        temporary.insert_pdf(page.parent, from_page=page.number, to_page=page.number)
        clipped = temporary[0]
        outside = [fitz.Rect(0, 0, clipped.rect.width, crop.y0),
                   fitz.Rect(0, crop.y1, clipped.rect.width, clipped.rect.height),
                   fitz.Rect(0, crop.y0, crop.x0, crop.y1),
                   fitz.Rect(crop.x1, crop.y0, clipped.rect.width, crop.y1)]
        for rect in outside:
            if not rect.is_empty:
                clipped.add_redact_annot(rect, fill=False)
        clipped.apply_redactions(images=2, graphics=1, text=0)
        diagram = ET.fromstring(clipped.get_svg_image(text_as_path=False))
    # Only vector text and shapes are allowed. Images and active content are
    # not retained even when located in a source pattern or a definition.
    for parent in diagram.iter():
        for child in list(parent):
            if child.tag.rsplit('}', 1)[-1] in {'image', 'script', 'foreignObject'}:
                parent.remove(child)
    for element in diagram.iter():
        for attribute in ('fill', 'stroke', 'stop-color'):
            if element.get(attribute):
                element.set(attribute, _color(element.get(attribute), palette))
        if element.tag.rsplit('}', 1)[-1] in {'text', 'tspan'}:
            element.set('font-family', FONT)
    diagram.set('fill', palette['ink'])
    diagram.set('viewBox', f'{crop.x0:g} {crop.y0:g} {crop.width:g} {crop.height:g}')
    width = 1000
    pieces, top = _heading(figure['title'], source_id, palette, width)
    inner_width = width - 80
    scale = inner_width / crop.width
    inner_height = crop.height * scale
    diagram.set('x', '40')
    diagram.set('y', str(top))
    diagram.set('width', str(inner_width))
    diagram.set('height', str(inner_height))
    pieces.append(f'<rect x="40" y="{top:g}" width="{inner_width:g}" height="{inner_height:g}" rx="10" '
                  f'fill="{palette["surface"]}" stroke="{palette["line"]}"/>')
    pieces.append(ET.tostring(diagram, encoding='unicode'))
    bottom = top + inner_height
    tail, height = _notes_and_footer(figure, palette, source_id, page_no, bottom, width)
    return width, height, pieces + tail


def render_original_figure(page: fitz.Page, figure: dict, output_dir: Path,
                           source_id: str, page_no: int) -> dict:
    """Export only an explicitly reviewed region, preserving its original pixels.

    This exception is for the source-unreadable figures the reader requested
    to see as originals. It never turns an unreviewed OCR reading into audio
    and never applies theme recoloring to the source image.
    """
    if not figure.get('redrawReviewRequired'):
        raise ValueError('Original exports are limited to figures awaiting faithful transcription.')
    crop = fitz.Rect(figure['rect']) & page.rect
    if crop.is_empty or crop == page.rect:
        raise ValueError('An original figure must have a nonempty, region-only crop.')
    identifier = _slug(figure.get('id', figure['title']))
    folder = Path(output_dir) / source_id
    folder.mkdir(parents=True, exist_ok=True)
    filename = f'p{page_no:03d}-{identifier}-original.png'
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), clip=crop, alpha=False)
    # Lossless PNG encoding keeps every rendered RGB value and strips metadata.
    # It is materially smaller than the PDF library's default PNG encoder.
    with Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples) as image:
        image.save(folder / filename, optimize=True)
    source = f'/study-visuals/{source_id}/{filename}'
    return {
        'id': f'{source_id}-p{page_no:03d}-{identifier}',
        'title': figure['title'],
        'description': f'Imagem original do PDF: {figure["title"]}. '
                       f'Fonte: {SOURCE_NAMES.get(source_id, source_id)}, página {page_no}. '
                       'Somente o recorte da figura; os rótulos ainda não têm transcrição conferida. '
                       'Amplie a imagem para consultar o original.',
        'kind': figure.get('kind', 'diagram'),
        'redrawn': False,
        'lightSrc': source,
        'darkSrc': source,
        'width': pixmap.width,
        'height': pixmap.height,
    }


def render_figure(page: fitz.Page, figure: dict, output_dir: Path,
                  source_id: str, page_no: int) -> dict | None:
    """Return a safe StudyVisual metadata record, or None for unreviewed data."""
    crop = fitz.Rect(figure['rect']) & page.rect
    if crop.is_empty or figure.get('redrawReviewRequired'):
        return None
    figure = dict(figure)
    figure.setdefault('title', 'Quadro do material')
    figure.setdefault('description', f'{figure["title"]}, conforme o material, página {page_no}.')
    identifier = _slug(figure.get('id', figure['title']))
    rows = figure.get('rows')
    reviewed_rows = isinstance(rows, list) and bool(rows) and all(isinstance(row, (list, tuple)) and row for row in rows)
    lines = figure.get('lines')
    reviewed_lines = isinstance(lines, list) and bool(lines) and all(isinstance(line, str) and line.strip() for line in lines)
    result = {}
    for theme, palette in PALETTES.items():
        if not figure.get('header') and ((reviewed_rows and (figure.get('sequence') or figure.get('cycle'))) or reviewed_lines):
            drawing = _cards_svg(figure, source_id, page_no, palette)
        elif reviewed_rows and not figure.get('header'):
            drawing = _table_svg(figure, source_id, page_no, palette)
        else:
            drawing = _native_svg(page, figure, crop, palette, source_id, page_no)
        if drawing is None:
            return None
        width, height, pieces = drawing
        svg = _shell(width, height, figure['title'], figure['description'], source_id, page_no, palette, pieces)
        # Keep outputs self-contained and static. Unicode text is deliberate;
        # no glyph outlined from a bitmap or whole-page image is included.
        parsed = ET.fromstring(svg)
        if any(element.tag.rsplit('}', 1)[-1] in {'image', 'script', 'foreignObject'} for element in parsed.iter()):
            raise ValueError('A recreated figure cannot contain page images or active content.')
        filename = f'p{page_no:03d}-{identifier}-{theme}.svg'
        folder = Path(output_dir) / source_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / filename).write_text(svg, encoding='utf-8')
        result[f'{theme}Src'] = f'/study-visuals/{source_id}/{filename}'
        result['width'], result['height'] = width, height
    result.update(id=f'{source_id}-p{page_no:03d}-{identifier}', title=figure['title'],
                  description=figure['description'], kind=figure.get('kind', 'diagram'), redrawn=True)
    if reviewed_rows:
        columns = figure.get('columns') or []
        descriptions = []
        for row in rows:
            if not columns and len(row) == 2:
                descriptions.append(f'{row[0]}: {row[1]}')
            else:
                descriptions.append('; '.join(f'{columns[index]}: {value}' if index < len(columns) else str(value)
                                             for index, value in enumerate(row)))
        result['accessibleText'] = f'{figure["title"]}.\n\n' + '\n\n'.join(descriptions)
        if figure.get('header'):
            result['accessibleText'] += '\n\nA cronologia visual preserva os rótulos e a disposição da fonte.'
    elif reviewed_lines:
        result['accessibleText'] = f'{figure["title"]}.\n\n' + '\n\n'.join(lines)
    if figure.get('cycle') and result.get('accessibleText'):
        result['accessibleText'] += '\n\nOs quadros formam um ciclo e a seta retorna ao início.'
    notes = _source_notes(figure)
    if notes:
        result['accessibleText'] = '\n\n'.join([result.get('accessibleText', figure['title']), *notes])
    return result
