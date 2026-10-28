#!/usr/bin/env python3
"""Build native reading blocks interleaved with independently recreated figures."""
from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import fitz
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parent / '.cache' / 'vereda-layout-v2'
ANNOTATIONS = ['visual-regions-native.json', 'visual-regions-study2a.json', 'visual-regions-study2b.json']
MODEL_SHA = 'c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb'
GENERATED = {
    'light': '/workspace/generated_images/exec-d1ef16a6-66a5-40a7-b0b5-c4e95dbc395e.png',
    'dark': '/workspace/generated_images/exec-f0ec30ad-c7f3-43fe-b7b8-33817575c3ef.png',
}


def load_module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _clean(text):
    return re.sub(r'[ \t]+', ' ', text.replace('\x00', '').replace('\u00ad', '')).strip()


def native_paragraphs(page, excluded):
    paragraphs = []
    for block in page.get_text('dict', sort=True)['blocks']:
        lines, boxes = [], []
        def flush():
            if lines:
                paragraphs.append({'text': ' '.join(lines), 'rect': list(fitz.Rect(min(b.x0 for b in boxes), min(b.y0 for b in boxes), max(b.x1 for b in boxes), max(b.y1 for b in boxes)))})
                lines.clear(); boxes.clear()
        for line in block.get('lines', []):
            parts, line_boxes = [], []
            for span in line['spans']:
                text = _clean(span['text'])
                box = fitz.Rect(span['bbox'])
                if not text or any(box.intersects(rect) for rect in excluded):
                    continue
                if text.isdecimal() and box.y0 > page.rect.height * .93:
                    continue
                if span['font'] == 'Helvetica-Bold' and abs(span['size'] - 9) < .1 and span['color'] == 8421504:
                    if re.fullmatch(r'Teste|[^\s@]+@[^\s@]+\.[^\s@]+|\d{11}|HP\d+', text):
                        continue
                parts.append(text); line_boxes.append(box)
            if parts:
                if boxes and line_boxes[0].y0 - boxes[-1].y1 > 18:
                    flush()
                lines.append(' '.join(parts)); boxes.extend(line_boxes)
            else:
                flush()
        flush()
    return paragraphs


def _ocr_tsv(job):
    image_path, cache_path, scale, page_height, tessdata, offset, psm = job
    env = os.environ.copy()
    env['OMP_THREAD_LIMIT'] = '1'
    run = subprocess.run(['tesseract', str(image_path), 'stdout', '--tessdata-dir', str(tessdata), '-l', 'por', '--psm', str(psm), '-c', 'tessedit_create_tsv=1', '-c', 'tessedit_create_txt=0'], capture_output=True, text=True, check=True, timeout=150, env=env)
    if not run.stdout.startswith('level\tpage_num\t'):
        raise RuntimeError('OCR did not return a TSV layout; do not treat plain text as an empty page.')
    groups = defaultdict(list)
    for row in csv.DictReader(io.StringIO(run.stdout), delimiter='\t', quoting=csv.QUOTE_NONE):
        text = _clean(row.get('text') or '')
        if not text or int(row['level']) != 5 or float(row['conf']) < 20:
            continue
        left, top, width, height = [float(row[k]) / scale for k in ['left', 'top', 'width', 'height']]
        left += offset[0]
        top += offset[1]
        if text.isdecimal() and top > page_height * .93:
            continue
        groups[(row['block_num'], row['par_num'])].append((int(row['line_num']), left, top, width, height, text))
    paragraphs = []
    for words in groups.values():
        if not any(re.search(r'[A-Za-zÀ-ÿ]{2}', word[5]) for word in words):
            continue
        lines = defaultdict(list)
        for word in words:
            lines[word[0]].append(word)
        text = ' '.join(' '.join(w[5] for w in sorted(line, key=lambda w: w[1])) for _, line in sorted(lines.items()))
        paragraphs.append({'text': text, 'rect': [min(w[1] for w in words), min(w[2] for w in words), max(w[1] + w[3] for w in words), max(w[2] + w[4] for w in words)]})
    paragraphs.sort(key=lambda p: (p['rect'][1], p['rect'][0]))
    cache_path.write_text(json.dumps(paragraphs, ensure_ascii=False), encoding='utf-8')
    return paragraphs


def raster_prose(document, plans, source_sha):
    """OCR only ordinary text after masking chart/table regions, never the diagram."""
    source_import = load_module('study_source_import', 'import-studies.py')
    tessdata = source_import.prepare_model(ROOT.parent / '.cache' / 'vereda-ocr')
    assert digest(tessdata / 'por.traineddata') == MODEL_SHA, 'Portuguese OCR model checksum mismatch'
    CACHE.mkdir(parents=True, exist_ok=True)
    column_regions = source_import.COLUMN_REGIONS
    results, futures = defaultdict(list), []
    with tempfile.TemporaryDirectory(prefix='vereda-prose-') as temp, ThreadPoolExecutor(max_workers=4) as pool:
        for number, plan in sorted(plans.items()):
            page = document[number - 1]
            regions = column_regions.get(number, [(0, 0, page.rect.width, page.rect.height, 3)])
            key = hashlib.sha256(json.dumps({'source': source_sha, 'page': number, 'figures': plan['figures'], 'textOverrides': plan.get('textOverrides', []), 'regions': regions, 'version': 4}, sort_keys=True).encode()).hexdigest()
            cached_regions = [(index, region, CACHE / f'{key}-{index}.json') for index, region in enumerate(regions)]
            if all(cached.is_file() for _, _, cached in cached_regions):
                for index, region, cached in cached_regions:
                    paragraphs = json.loads(cached.read_text())
                    if region[2] - region[0] < page.rect.width * .75:
                        for order, paragraph in enumerate(paragraphs):
                            paragraph['orderY'] = region[1] + index * .01 + order * .00001
                    results[number].extend(paragraphs)
                continue
            scale = 3
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            image = Image.frombytes('RGB', [pixmap.width, pixmap.height], pixmap.samples)
            draw = ImageDraw.Draw(image)
            excluded = [f['rect'] for f in plan['figures']] + [override['rect'] for override in plan.get('textOverrides', [])]
            for rect in excluded:
                draw.rectangle(tuple(value * scale for value in rect), fill='white')
            draw.rectangle((0, page.rect.height * .94 * scale, image.width, image.height), fill='white')
            for index, region, cached in cached_regions:
                if cached.is_file():
                    paragraphs = json.loads(cached.read_text())
                    if region[2] - region[0] < page.rect.width * .75:
                        for order, paragraph in enumerate(paragraphs):
                            paragraph['orderY'] = region[1] + index * .01 + order * .00001
                    results[number].extend(paragraphs)
                    continue
                x0, y0, x1, y1, psm = region
                path = Path(temp) / f'p{number}-{index}.png'
                image.crop((int(x0 * scale), int(y0 * scale), int(x1 * scale), int(y1 * scale))).save(path)
                future = pool.submit(_ocr_tsv, (path, cached, scale, page.rect.height, tessdata, (x0, y0), psm))
                futures.append((number, index, region, future))
        for number, index, region, future in futures:
            paragraphs = future.result()
            if region[2] - region[0] < document[number - 1].rect.width * .75:
                for order, paragraph in enumerate(paragraphs):
                    paragraph['orderY'] = region[1] + index * .01 + order * .00001
            results[number].extend(paragraphs)
    for number, plan in plans.items():
        results[number].extend({'text': item['text'], 'rect': item['rect']} for item in plan.get('textOverrides', []))
    return results


def generated_tabernacle(output, figure):
    folder = output / 'study-2'
    folder.mkdir(parents=True, exist_ok=True)
    meta = {'id': 'study-2-p020-tabernacle', 'title': 'Planta do Tabernáculo', 'kind': 'diagram', 'redrawn': True,
            'description': 'Planta do tabernáculo recriada nas cores do site, com os objetos e as medidas indicados no PDF da Parte 2, página 20.'}
    for theme, source in GENERATED.items():
        target = folder / f'p020-tabernacle-{theme}.png'
        if Path(source).is_file():
            shutil.copyfile(source, target)
        assert target.is_file(), 'Retain the reviewed generated tabernacle images before rebuilding.'
        with Image.open(target) as image:
            meta['width'], meta['height'] = image.size
        meta[theme + 'Src'] = f'/study-visuals/study-2/{target.name}'
    meta['accessibleText'] = '\n\n'.join(': '.join(row) for row in figure.get('rows', []))
    return meta


def build(content_dir, output_dir):
    data_path = content_dir / 'studies.json'
    data = json.loads(data_path.read_text())
    before_audit = json.loads((content_dir / 'study-visual-audit.json').read_text()) if (content_dir / 'study-visual-audit.json').is_file() else {}
    annotations = [entry for name in ANNOTATIONS for entry in json.loads((content_dir / name).read_text())]
    plans = {(entry['sourceId'], entry['sourcePage']): entry for entry in annotations}
    sections = {(lesson['sourceId'], section['sourcePage']): (lesson, section) for lesson in data['lessons'] for section in lesson['sections']}
    assert len(plans) == len(annotations) and set(plans) == set(sections), 'Every study page must have an explicit figure-only plan.'
    sources = {source['id']: source for source in data['sources']}
    source_hashes = {key: digest(content_dir / 'source-pdfs' / source['file']) for key, source in sources.items()}
    renderer = load_module('figure_images', 'figure-images.py')
    intro = load_module('intro_figures', 'intro-figures.py').generate_intro_figures(output_dir)
    documents = {key: fitz.open(content_dir / 'source-pdfs' / source['file']) for key, source in sources.items()}
    # Build all raster prose in parallel; PDF rendering itself remains serial.
    try:
        prose = raster_prose(documents['study-2'], {page: plan for (source, page), plan in plans.items() if source == 'study-2'}, source_hashes['study-2'])
        entries, referenced = [], set()
        for key, (lesson, section) in sections.items():
            source_id, number = key
            plan, page = plans[key], documents[source_id][number - 1]
            for field in ['visuals', 'blocks', 'displayBody', 'bodyAfterVisuals', 'readingText', 'sourceTranscript']:
                section.pop(field, None)
            figures, pending, positioned, audits = [], [], [], []
            excluded = [fitz.Rect(figure['rect']) for figure in plan['figures']]
            if source_id == 'study-2':
                paragraphs = prose[number]
            elif not plan['figures']:
                paragraphs = [{'text': section['body'], 'rect': [0, 0, page.rect.width, 1]}]
            else:
                paragraphs = native_paragraphs(page, excluded)
            for paragraph in paragraphs:
                if paragraph['text'].strip():
                    positioned.append((paragraph.get('orderY', paragraph['rect'][1]), paragraph['rect'][0], {'kind': 'text', 'text': paragraph['text'].strip()}))
            for figure in plan['figures']:
                if source_id == 'study-1' and number in (3, 4):
                    visual = intro[number]
                elif source_id == 'study-2' and number == 20 and figure['id'] == 'tabernacle-plan':
                    visual = generated_tabernacle(output_dir, figure)
                elif figure.get('redrawReviewRequired'):
                    visual = None
                else:
                    visual = renderer.render_figure(page, figure, output_dir, source_id, number)
                record = {'id': figure['id'], 'rect': figure['rect'], 'kind': figure['kind'], 'title': figure['title'], 'assets': []}
                if visual is None:
                    pending.append({'id': figure['id'], 'title': figure['title'], 'reason': figure.get('notes', 'A figura exige conferência de dados antes de ser recriada.')})
                    positioned.append((figure['rect'][1], figure['rect'][0], {'kind': 'text', 'text': f'Figura em conferência: {figure["title"]}. Consulte o PDF desta página para conferir o original.'}))
                    record['status'] = 'needs-review'
                else:
                    figures.append(visual)
                    positioned.append((figure['rect'][1], figure['rect'][0], {'kind': 'visual', 'visualId': visual['id']}))
                    record['status'] = 'redrawn'
                    for field in ['lightSrc', 'darkSrc']:
                        if visual.get(field):
                            url = visual[field]
                            path = output_dir / url.removeprefix('/study-visuals/')
                            referenced.add(url)
                            record['assets'].append({'url': url, 'sha256': digest(path), 'bytes': path.stat().st_size})
                audits.append(record)
            positioned.sort(key=lambda item: (item[0], item[1]))
            section['blocks'] = [item[2] for item in positioned]
            if figures:
                section['visuals'] = figures
            by_id = {figure['id']: figure for figure in figures}
            reading = [block['text'] if block['kind'] == 'text' else by_id[block['visualId']].get('accessibleText', '') for block in section['blocks']]
            section['readingText'] = '' if section['reviewStatus'] == 'needs-review' else '\n\n'.join(text for text in reading if text)
            entry = {'sourceId': source_id, 'sourcePage': number, 'bodySha256': hashlib.sha256(section['body'].encode()).hexdigest(),
                     'nativeTextBlocks': sum(block['kind'] == 'text' for block in section['blocks']), 'figures': audits, 'pendingFigures': pending}
            entries.append(entry)
        # Remove only previously audited, managed outputs that are no longer
        # referenced. This deletes obsolete whole-page screenshots, not PDFs.
        for entry in before_audit.get('entries', []):
            previous_assets = entry.get('assets', []) + [asset for figure in entry.get('figures', []) for asset in figure.get('assets', [])]
            for asset in previous_assets:
                if asset['url'] not in referenced:
                    relative = asset['url'].removeprefix('/study-visuals/')
                    path = output_dir / relative
                    if path.resolve().is_relative_to(output_dir.resolve()) and path.is_file():
                        path.unlink()
        audit = {'version': 2, 'method': 'Native prose interleaved with region-only, recreated diagrams and tables; no whole-page screenshot fallback.',
                 'sources': [{'id': key, 'sha256': value} for key, value in source_hashes.items()], 'sections': len(entries),
                 'visualSections': sum(any(figure['status'] == 'redrawn' for figure in entry['figures']) for entry in entries),
                 'figures': sum(figure['status'] == 'redrawn' for entry in entries for figure in entry['figures']),
                 'pendingFigures': sum(len(entry['pendingFigures']) for entry in entries), 'fullPageImages': 0, 'assets': len(referenced),
                 'entries': entries, 'limits': ['Source-unreadable labels are not invented or silently corrected.', 'OCR prose retains its conversion/review notice.', 'Generated diagram labels were checked against the supplied PDF.']}
        data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        (content_dir / 'study-visual-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
        return audit
    finally:
        for document in documents.values():
            document.close()


def verify(content_dir, output_dir):
    data = json.loads((content_dir / 'studies.json').read_text())
    audit = json.loads((content_dir / 'study-visual-audit.json').read_text())
    assert audit['version'] == 2 and audit['fullPageImages'] == 0
    sections = {(lesson['sourceId'], section['sourcePage']): section for lesson in data['lessons'] for section in lesson['sections']}
    assert len(sections) == audit['sections'] == len(audit['entries'])
    for source in audit['sources']:
        meta = next(item for item in data['sources'] if item['id'] == source['id'])
        assert digest(content_dir / 'source-pdfs' / meta['file']) == source['sha256']
    for entry in audit['entries']:
        section = sections[(entry['sourceId'], entry['sourcePage'])]
        assert hashlib.sha256(section['body'].encode()).hexdigest() == entry['bodySha256']
        assert 'blocks' in section
        ids = {visual['id'] for visual in section.get('visuals', [])}
        assert all(block['kind'] == 'text' or block['visualId'] in ids for block in section['blocks'])
        assert all(visual['kind'] != 'page' and visual['redrawn'] for visual in section.get('visuals', []))
        for figure in entry['figures']:
            for asset in figure['assets']:
                path = output_dir / asset['url'].removeprefix('/study-visuals/')
                assert digest(path) == asset['sha256'], str(path)
                if path.suffix == '.svg':
                    assert not re.search(r'<(?:\w+:)?image\b|<script\b|<foreignObject\b', path.read_text()), str(path)
    return {key: audit[key] for key in ['sections', 'visualSections', 'figures', 'pendingFigures', 'fullPageImages', 'assets']}
