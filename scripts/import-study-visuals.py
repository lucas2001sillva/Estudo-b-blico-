#!/usr/bin/env python3
"""Preserve study figures from the sanitized PDFs; never infer diagrams from OCR.

Run after import-studies.py, or independently against the retained PDFs.
The two reviewed introductory figures are deterministic SVGs. Complex composite
pages retain their original composition. Book-header vectors receive the site's
palette without changing coordinates, labels, timelines, or category relations.
"""
from __future__ import annotations

import argparse
import colorsys
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

import fitz

ROOT = Path(__file__).resolve().parents[1]
SVG = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG)
ET.register_namespace('xlink', 'http://www.w3.org/1999/xlink')
HEADERS = {
    'study-3': [3, 6, 8, 10, 12, 14, 17, 19, 21, 23, 25, 28, 31, 33, 35, 37, 41, 43, 45, 47, 49, 51, 53, 55, 57, 59, 61, 63],
    'study-4': [3, 7, 9, 12, 23, 27, 29, 31, 33, 35, 38, 40, 42, 44, 46, 48, 50, 52, 55, 57, 59, 61, 63, 65, 67, 69, 72],
}
VISUAL_PAGES = {
    'study-1': [3, 4, 5, 6, 7, 8, 11],
    'study-2': list(range(2, 90)),
    'study-3': sorted(set(HEADERS['study-3'] + [16, 26, 30, 39, 40, 50, 67])),
    'study-4': sorted(set(HEADERS['study-4'] + [2, 4, 5, 10, 22, 26, 36, 54, 62, 74])),
    'gospels': [1, 2, 3, 4],
}
PALETTES = {
    'light': {'surface': '#ffffff', 'ink': '#29332d', 'muted': '#69736b', 'line': '#e5e7df', 'primary': '#245341', 'accent': '#b88a43'},
    'dark': {'surface': '#1e2520', 'ink': '#edf1e9', 'muted': '#b4bdb3', 'line': '#364138', 'primary': '#bad6b8', 'accent': '#e0b46a'},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def native_outside(page: fitz.Page, crop: fitz.Rect, part: str) -> str:
    """Read ordinary prose outside a checked figure, not the figure's labels."""
    paragraphs = []
    for block in page.get_text('dict', sort=True)['blocks']:
        lines = []
        for line in block.get('lines', []):
            parts = []
            for span in line['spans']:
                text = span['text'].strip()
                box = fitz.Rect(span['bbox'])
                if not text or box.intersects(crop):
                    continue
                if part == 'before' and box.y0 >= crop.y1:
                    continue
                if part == 'after' and box.y1 <= crop.y0:
                    continue
                if text.isdecimal() and box.y0 > page.rect.height - 65:
                    continue
                if text == 'Teste' and span['font'] == 'Helvetica-Bold':
                    continue
                parts.append(text)
            if parts:
                lines.append(' '.join(parts))
        if lines:
            paragraphs.append(' '.join(lines))
    return '\n\n'.join(paragraphs)


def themed_color(value: str, palette: dict) -> str:
    if not re.fullmatch(r'#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?', value):
        return value
    h = value.lstrip('#')
    if len(h) == 3:
        h = ''.join(char * 2 for char in h)
    rgb = tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hue, lightness, saturation = colorsys.rgb_to_hls(*rgb)
    # Almost-white PDF text such as #fffefe has HLS saturation 1 despite
    # looking white. Classify luminance extremes before hue, otherwise the
    # card headings become the same accent color as their red source banner.
    if min(rgb) >= .92:
        return palette['surface']
    if max(rgb) <= .12:
        return palette['ink']
    if saturation < .16:
        return palette['surface'] if lightness > .92 else palette['ink'] if lightness < .35 else palette['muted']
    # These are the two distinct heading colors. Preserve other category hues.
    if .53 < hue < .87:
        return palette['primary']
    if hue < .06 or hue > .95:
        # White small labels need a darker gold banner in the light theme.
        # This is the site's warm-ink color; dark mode uses its bright accent
        # with the mapped dark text, preserving the two heading categories.
        return '#775a29' if palette['surface'] == '#ffffff' else palette['accent']
    return value


def header_svg(page: fitz.Page, crop: fitz.Rect, target: Path, theme: str) -> None:
    # A viewBox alone keeps every hidden prose glyph in the download. Remove
    # content outside the crop from an in-memory copy before vector export.
    # The sanitized source PDF is never modified.
    with fitz.open() as temporary:
        temporary.insert_pdf(page.parent, from_page=page.number, to_page=page.number)
        clipped = temporary[0]
        clipped.add_redact_annot(fitz.Rect(0, crop.y1, clipped.rect.width, clipped.rect.height), fill=False)
        clipped.apply_redactions(images=2, graphics=1, text=0)
        root = ET.fromstring(clipped.get_svg_image(text_as_path=True))
    root.set('viewBox', f'{crop.x0:g} {crop.y0:g} {crop.width:g} {crop.height:g}')
    root.set('width', f'{crop.width:g}')
    root.set('height', f'{crop.height:g}')
    palette = PALETTES[theme]
    # SVG's default fill is black. MuPDF omits it on many timeline glyphs;
    # an inherited theme-aware fill keeps those labels visible in dark mode.
    root.set('fill', palette['ink'])
    for element in root.iter():
        for attribute in ('fill', 'stroke'):
            if element.get(attribute):
                element.set(attribute, themed_color(element.get(attribute), palette))
    root.insert(0, ET.Element(f'{{{SVG}}}rect', {'x': str(crop.x0), 'y': str(crop.y0), 'width': str(crop.width), 'height': str(crop.height), 'fill': palette['surface']}))
    target.write_bytes(ET.tostring(root, encoding='utf-8', xml_declaration=True))


def render_crop(page: fitz.Page, crop: fitz.Rect, target: Path) -> tuple[int, int]:
    # Render through the PDF engine: raw extract_image can expose hidden objects
    # outside their clip, notably the coins page in Part 4.
    scale = 1800 / crop.width
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=crop, alpha=False)
    pixmap.pil_save(str(target), format='WEBP', quality=93, method=4)
    return pixmap.width, pixmap.height


def generate(content_dir: Path = ROOT / 'content', output_dir: Path = ROOT / 'public' / 'study-visuals') -> dict:
    data_path = content_dir / 'studies.json'
    studies = json.loads(data_path.read_text(encoding='utf-8'))
    spec = importlib.util.spec_from_file_location('intro_figures', ROOT / 'scripts' / 'intro-figures.py')
    intro = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(intro)
    output_dir.mkdir(parents=True, exist_ok=True)
    reviewed = intro.generate_intro_figures(output_dir)
    sources = {source['id']: source for source in studies['sources']}
    documents = {key: fitz.open(content_dir / 'source-pdfs' / value['file']) for key, value in sources.items()}
    entries = []
    old_audit_path = content_dir / 'study-visual-audit.json'
    old = json.loads(old_audit_path.read_text()) if old_audit_path.is_file() else {}
    source_hashes = {key: sha256(content_dir / 'source-pdfs' / value['file']) for key, value in sources.items()}
    matching_sources = {source['id'] for source in old.get('sources', []) if source_hashes.get(source['id']) == source['sha256']}
    cached = {(entry['sourceId'], entry['sourcePage']): entry for entry in old.get('entries', []) if entry['sourceId'] in matching_sources}
    try:
        for lesson in studies['lessons']:
            source_id = lesson['sourceId']
            for section in lesson['sections']:
                number = section['sourcePage']
                # Reimporting must not retain stale presentation metadata.
                for key in ('visuals', 'displayBody', 'bodyAfterVisuals', 'readingText', 'sourceTranscript'):
                    section.pop(key, None)
                if number not in VISUAL_PAGES[source_id]:
                    continue
                page = documents[source_id][number - 1]
                crop = fitz.Rect(page.rect)
                display_body = ''
                body_after = ''
                mode = 'faithful-composite'
                if source_id == 'study-1' and number in reviewed:
                    visual = reviewed[number]
                    crop = fitz.Rect((132, 640, 456, 780) if number == 3 else (58, 205, 536, 633))
                    display_body = native_outside(page, crop, 'before')
                    body_after = native_outside(page, crop, 'after')
                    mode = 'reviewed-redrawing'
                else:
                    folder = output_dir / source_id
                    folder.mkdir(parents=True, exist_ok=True)
                    prefix = f'/study-visuals/{source_id}/p{number:03d}'
                    visual = {'id': f'{source_id}-p{number:03d}', 'title': f'{lesson["title"]} · página {number}',
                              'kind': 'page', 'redrawn': False,
                              'description': f'Composição visual de {lesson["title"]}, preservada do PDF {sources[source_id]["title"]}, página {number}. Amplie a imagem para conferir os detalhes.'}
                    if number in HEADERS.get(source_id, []):
                        author_blocks = [block for block in page.get_text('blocks') if block[1] > 115 and block[4].lstrip().startswith('Autor:')]
                        assert author_blocks, f'No prose boundary for {source_id}:{number}'
                        crop.y1 = min(block[1] for block in author_blocks) - 5
                        # Existing imported prose has already had private overlays
                        # removed. Do not reintroduce raw extraction artifacts.
                        marker = section['body'].find('\n\nAutor:')
                        assert marker >= 0, f'No author paragraph in {source_id}:{number}'
                        body_after = section['body'][marker:].strip()
                        for theme in PALETTES:
                            header_svg(page, crop, folder / f'p{number:03d}-{theme}.svg', theme)
                        visual.update(lightSrc=prefix + '-light.svg', darkSrc=prefix + '-dark.svg',
                                      width=round(crop.width), height=round(crop.height), kind='diagram',
                                      title=f'Informações e cronologia · página {number}')
                        mode = 'faithful-themed-header'
                    else:
                        if source_id == 'study-1' and number in (7, 11):
                            crop = fitz.Rect(190, 94, 405, 183) if number == 7 else fitz.Rect(0, 0, page.rect.width, 632)
                            display_body = native_outside(page, crop, 'before')
                            body_after = native_outside(page, crop, 'after')
                            visual['kind'] = 'illustration'
                            mode = 'faithful-illustration'
                        target = folder / f'p{number:03d}.webp'
                        previous = cached.get((source_id, number))
                        reuse = previous and previous['crop'] == list(crop) and any(asset['url'] == prefix + '.webp' and target.is_file() and sha256(target) == asset['sha256'] for asset in previous['assets'])
                        if reuse:
                            from PIL import Image
                            with Image.open(target) as existing:
                                width, height = existing.size
                        else:
                            width, height = render_crop(page, crop, target)
                        visual.update(lightSrc=prefix + '.webp', width=width, height=height)
                    if (source_id, number) in {('study-1', 5), ('study-1', 6), ('study-2', 20)}:
                        # Explicitly source-checked transcriptions from the original
                        # importer, not inferred column or timeline relationships.
                        visual['accessibleText'] = section['body']
                section['visuals'] = [visual]
                section['displayBody'] = display_body
                section['bodyAfterVisuals'] = body_after
                section['readingText'] = '\n\n'.join(part for part in (display_body, visual.get('accessibleText', ''), body_after) if part)
                if not section['readingText']:
                    section['sourceTranscript'] = section['body']
                assets = []
                for key in ('lightSrc', 'darkSrc'):
                    if visual.get(key):
                        path = output_dir / visual[key].removeprefix('/study-visuals/')
                        assets.append({'url': visual[key], 'sha256': sha256(path), 'bytes': path.stat().st_size})
                entries.append({'sourceId': source_id, 'sourcePage': number, 'mode': mode, 'crop': list(crop),
                                'bodySha256': hashlib.sha256(section['body'].encode()).hexdigest(), 'assets': assets})
    finally:
        for document in documents.values():
            document.close()
    audit = {'version': 1, 'method': 'Visual audit of all 251 supplied study pages; preserve compositions instead of interpreting linear OCR.',
             'scope': VISUAL_PAGES, 'sources': [{'id': key, 'sha256': sha256(content_dir / 'source-pdfs' / source['file'])} for key, source in sources.items()],
             'visualSections': len(entries), 'reviewedRedrawings': 2, 'entries': entries,
             'limits': ['Complex composites remain faithful images, not fully redrawn illustrations.',
                        'Unconfirmed transcriptions are kept separately and are not narrated as verified relations.',
                        'Source numbers and source editorial claims have not been corrected from external information.']}
    data_path.write_text(json.dumps(studies, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (content_dir / 'study-visual-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return audit


def verify(content_dir: Path, output_dir: Path) -> dict:
    data = json.loads((content_dir / 'studies.json').read_text())
    audit = json.loads((content_dir / 'study-visual-audit.json').read_text())
    for source in audit['sources']:
        meta = next(item for item in data['sources'] if item['id'] == source['id'])
        assert sha256(content_dir / 'source-pdfs' / meta['file']) == source['sha256']
    sections = {(lesson['sourceId'], section['sourcePage']): section for lesson in data['lessons'] for section in lesson['sections']}
    expected = {(source, page) for source, pages in VISUAL_PAGES.items() for page in pages}
    assert {(entry['sourceId'], entry['sourcePage']) for entry in audit['entries']} == expected
    for entry in audit['entries']:
        section = sections[(entry['sourceId'], entry['sourcePage'])]
        assert hashlib.sha256(section['body'].encode()).hexdigest() == entry['bodySha256']
        assert section.get('visuals') and 'displayBody' in section and 'readingText' in section
        for asset in entry['assets']:
            path = output_dir / asset['url'].removeprefix('/study-visuals/')
            assert sha256(path) == asset['sha256'], str(path)
    return {'verified': True, 'visualSections': len(expected), 'assets': sum(len(entry['assets']) for entry in audit['entries'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    if not args.verify_only:
        generate()
    print(json.dumps(verify(ROOT / 'content', ROOT / 'public' / 'study-visuals'), ensure_ascii=False))
