#!/usr/bin/env python3
"""Importa os PDFs bíblicos fornecidos, preservando a redação dos versículos.

Requer Python 3.10+ e PyMuPDF (import fitz). Uso, a partir da raiz:
    python3 scripts/import-bible.py
    python3 scripts/import-bible.py --at arquivo.pdf --nt arquivo.pdf --output content

Os estilos tipográficos do próprio PDF identificam os números dos versículos.
Coordenadas de linha corrigem a ordem interna de blocos de algumas páginas.
Notas de rodapé e títulos ficam separados do corpo dos versículos. Nenhum texto
bíblico é obtido da rede, completado ou reescrito por este importador.
"""
from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import re
import shutil
import unicodedata
from pathlib import Path

import fitz


BOOKS = [
    ('GÊNESIS', 'Gênesis', 'Gn', 50), ('ÊXODO', 'Êxodo', 'Êx', 40),
    ('LEVÍTICO', 'Levítico', 'Lv', 27), ('NÚMEROS', 'Números', 'Nm', 36),
    ('DEUTERONÔMIO', 'Deuteronômio', 'Dt', 34), ('JOSUÉ', 'Josué', 'Js', 24),
    ('JUÍZES', 'Juízes', 'Jz', 21), ('RUTE', 'Rute', 'Rt', 4),
    ('1 SAMUEL', '1 Samuel', '1Sm', 31), ('2 SAMUEL', '2 Samuel', '2Sm', 24),
    ('1 REIS', '1 Reis', '1Rs', 22), ('2 REIS', '2 Reis', '2Rs', 25),
    ('1 CRÔNICAS', '1 Crônicas', '1Cr', 29), ('2 CRÔNICAS', '2 Crônicas', '2Cr', 36),
    ('ESDRAS', 'Esdras', 'Ed', 10), ('NEEMIAS', 'Neemias', 'Ne', 13),
    ('ESTER', 'Ester', 'Et', 10), ('JÓ', 'Jó', 'Jó', 42),
    ('SALMOS', 'Salmos', 'Sl', 150), ('PROVÉRBIOS', 'Provérbios', 'Pv', 31),
    ('ECLESIASTES', 'Eclesiastes', 'Ec', 12),
    ('CÂNTICO DOS CÂNTICOS', 'Cântico dos Cânticos', 'Ct', 8),
    ('ISAÍAS', 'Isaías', 'Is', 66), ('JEREMIAS', 'Jeremias', 'Jr', 52),
    ('LAMENTAÇÕES', 'Lamentações', 'Lm', 5), ('EZEQUIEL', 'Ezequiel', 'Ez', 48),
    ('DANIEL', 'Daniel', 'Dn', 12), ('OSÉIAS', 'Oséias', 'Os', 14),
    ('JOEL', 'Joel', 'Jl', 3), ('AMÓS', 'Amós', 'Am', 9),
    ('OBADIAS', 'Obadias', 'Ob', 1), ('JONAS', 'Jonas', 'Jn', 4),
    ('MIQUÉIAS', 'Miquéias', 'Mq', 7), ('NAUM', 'Naum', 'Na', 3),
    ('HABACUQUE', 'Habacuque', 'Hc', 3), ('SOFONIAS', 'Sofonias', 'Sf', 3),
    ('AGEU', 'Ageu', 'Ag', 2), ('ZACARIAS', 'Zacarias', 'Zc', 14),
    ('MALAQUIAS', 'Malaquias', 'Ml', 4),
    ('MATEUS', 'Mateus', 'Mt', 28), ('MARCOS', 'Marcos', 'Mc', 16),
    ('LUCAS', 'Lucas', 'Lc', 24), ('JOÃO', 'João', 'Jo', 21),
    ('ATOS DOS APÓSTOLOS', 'Atos dos Apóstolos', 'At', 28),
    ('ROMANOS', 'Romanos', 'Rm', 16), ('1 CORÍNTIOS', '1 Coríntios', '1Co', 16),
    ('2 CORÍNTIOS', '2 Coríntios', '2Co', 13), ('GÁLATAS', 'Gálatas', 'Gl', 6),
    ('EFÉSIOS', 'Efésios', 'Ef', 6), ('FILIPENSES', 'Filipenses', 'Fp', 4),
    ('COLOSSENSES', 'Colossenses', 'Cl', 4),
    ('1 TESSALONICENSES', '1 Tessalonicenses', '1Ts', 5),
    ('2 TESSALONICENSES', '2 Tessalonicenses', '2Ts', 3),
    ('1 TIMÓTEO', '1 Timóteo', '1Tm', 6), ('2 TIMÓTEO', '2 Timóteo', '2Tm', 4),
    ('TITO', 'Tito', 'Tt', 3), ('FILEMOM', 'Filemom', 'Fm', 1),
    ('HEBREUS', 'Hebreus', 'Hb', 13), ('TIAGO', 'Tiago', 'Tg', 5),
    ('1 PEDRO', '1 Pedro', '1Pe', 5), ('2 PEDRO', '2 Pedro', '2Pe', 3),
    ('1 JOÃO', '1 João', '1Jo', 5), ('2 JOÃO', '2 João', '2Jo', 1),
    ('3 JOÃO', '3 João', '3Jo', 1), ('JUDAS', 'Judas', 'Jd', 1),
    ('APOCALIPSE', 'Apocalipse', 'Ap', 22),
]
BOOK_MAP = {row[0]: row for row in BOOKS}
UPLOAD_SHA256 = {
    'AT': '57fb5954825baaea789c2e31417d050114fe73c9c88832166f29823a81ebe990',
    'NT': '5542cfaf98265dfa536806152c7fdbf0d59012fc6f1259ab24984e3cb71d519b',
}

# Referências selecionadas; o texto é sempre obtido dos PDFs importados abaixo.
PASSAGE_REFS = [
    ('genesis', 1, 1, 1), ('genesis', 1, 27, 27), ('exodo', 14, 14, 14),
    ('numeros', 6, 24, 26), ('deuteronomio', 6, 5, 5), ('deuteronomio', 31, 8, 8),
    ('josue', 1, 9, 9), ('rute', 1, 16, 16), ('1-samuel', 16, 7, 7),
    ('1-cronicas', 16, 34, 34), ('salmos', 1, 1, 3), ('salmos', 19, 1, 1),
    ('salmos', 23, 1, 3), ('salmos', 27, 1, 1), ('salmos', 34, 8, 8),
    ('salmos', 46, 1, 1), ('salmos', 46, 10, 10), ('salmos', 91, 1, 2),
    ('salmos', 100, 5, 5), ('salmos', 119, 105, 105), ('salmos', 121, 1, 2),
    ('salmos', 133, 1, 1), ('salmos', 139, 23, 24), ('proverbios', 3, 5, 6),
    ('proverbios', 4, 23, 23), ('proverbios', 16, 3, 3),
    ('eclesiastes', 3, 1, 1), ('isaias', 40, 31, 31), ('isaias', 41, 10, 10),
    ('jeremias', 29, 11, 11), ('lamentacoes', 3, 22, 23), ('miqueias', 6, 8, 8),
    ('mateus', 5, 14, 16), ('mateus', 6, 33, 33), ('mateus', 11, 28, 30),
    ('mateus', 22, 37, 39), ('marcos', 10, 45, 45), ('lucas', 6, 31, 31),
    ('joao', 3, 16, 16), ('joao', 8, 12, 12), ('joao', 13, 34, 35),
    ('joao', 14, 27, 27), ('romanos', 8, 38, 39), ('romanos', 12, 2, 2),
    ('1-corintios', 13, 4, 7), ('galatas', 5, 22, 23), ('efesios', 4, 32, 32),
    ('filipenses', 4, 6, 7), ('1-pedro', 5, 7, 7), ('1-joao', 4, 19, 19),
]


def slug(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def prepare_public_pdf(source, destination):
    """Copia a fonte sem alterar uploads e remove apenas metadados de edição.

    O texto e os avisos eventualmente presentes nas páginas não são redigidos.
    Se a cópia já está sem metadados, não a regrava (inclusive seu checksum).
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() != destination.resolve():
        shutil.copyfile(source, destination)
    doc = fitz.open(destination)
    if any(v for k, v in doc.metadata.items() if k != 'format') or doc.xref_xml_metadata():
        doc.set_metadata({})
        if doc.xref_xml_metadata():
            doc.del_xml_metadata()
        temporary = destination.with_suffix('.sanitized.pdf')
        doc.save(temporary, garbage=4, deflate=True)
        doc.close()
        temporary.replace(destination)
    else:
        doc.close()
    return destination


def verse_marker(span):
    return (abs(span['size'] - 6.5) < .15 and 'Bold' in span['font']
            and bool(re.fullmatch(r'\d+', span['text'].strip())))


def page_rows(page):
    """Ordena spans por linhas visuais; ignora a ordem defeituosa dos objetos PDF."""
    spans = []
    for block in page.get_text('rawdict')['blocks']:
        for line in block.get('lines', []):
            for original in line['spans']:
                s = dict(original)
                s['text'] = ''.join(c['c'] for c in s['chars'])
                if s['text'].strip():
                    spans.append(s)
    # Referências em negrito de 8pt assinalam o começo das notas, inclusive nos
    # livros de capítulo único, em que a referência tem apenas o número do verso.
    footnotes = [s['bbox'][1] for s in spans if abs(s['size'] - 8) < .15
                 and 'Bold' in s['font'] and re.match(r'^\d', s['text'].strip())]
    separators = [drawing['rect'].y0 for drawing in page.get_drawings()
                  if drawing['rect'].width >= 100 and drawing['rect'].height < 2
                  and drawing['rect'].y0 > page.rect.height * .4]
    # Algumas notas usam texto de 10pt cuja ascendente fica acima da referência
    # de 8pt. O traço separador do próprio PDF evita que esse texto vaze ao verso.
    cutoff = min(separators or [min(footnotes, default=page.rect.height + 4) - 3])
    candidates = []
    for s in spans:
        if s['bbox'][1] >= cutoff:
            continue
        s = dict(s)
        s['_y'] = s['origin'][1] + (4.5 if verse_marker(s) else 0)
        candidates.append(s)
    rows = []
    for s in sorted(candidates, key=lambda x: (x['_y'], x['bbox'][0])):
        if rows and abs(rows[-1][0] - s['_y']) < 2.0:
            rows[-1][1].append(s)
        else:
            rows.append((s['_y'], [s]))
    for y, spans in rows:
        # Há números desenhados separadamente no meio de um span contínuo
        # (por exemplo, Is 39:2,6,7). Divide-se o span pelas coordenadas reais de
        # cada caractere para o marcador preceder somente o texto do seu verso.
        marker_x = sorted(s['bbox'][0] for s in spans if verse_marker(s))
        split_spans = []
        for s in spans:
            inside = [x for x in marker_x if s['bbox'][0] < x < s['bbox'][2]]
            if not inside or verse_marker(s):
                split_spans.append(s)
                continue
            groups = {}
            for char in s['chars']:
                group = bisect.bisect_right(inside, char['bbox'][0])
                groups.setdefault(group, []).append(char)
            for chars in groups.values():
                part = dict(s)
                part['chars'] = chars
                part['text'] = ''.join(c['c'] for c in chars)
                part['bbox'] = (chars[0]['bbox'][0], s['bbox'][1], chars[-1]['bbox'][2], s['bbox'][3])
                if part['text'].strip():
                    split_spans.append(part)
        spans = split_spans
        spans.sort(key=lambda x: x['bbox'][0])
        if (y > page.rect.height - 60 and len(spans) == 1
                and re.fullmatch(r'\d+', spans[0]['text'].strip())):
            continue  # número impresso da página
        yield spans


def parse_pdf(path, testament, audit):
    doc = fitz.open(path)
    books = []
    book = chapter = verse = None

    def get_chapter(number, page):
        nonlocal chapter, verse
        if number not in book['_chapters']:
            book['_chapters'][number] = {'number': number, 'verses': [], 'sourcePages': [], 'headings': []}
        chapter = book['_chapters'][number]
        verse = None
        if page not in chapter['sourcePages']:
            chapter['sourcePages'].append(page)

    def start_verse(number, page):
        nonlocal verse
        verse = {'number': number, '_text': [], 'sourcePages': [page]}
        chapter['verses'].append(verse)

    for page_index, page in enumerate(doc):
        page_number = page_index + 1
        for row in page_rows(page):
            # Alguns títulos de 9pt incluem a palavra SENHOR em pequenos
            # capitais de 10/8pt. A linha inteira é título; suas letras não
            # podem vazar para o versículo anterior ou ficar sem atribuição.
            is_heading_row = (any(abs(s['size'] - 9) < .15 and 'Bold' in s['font'] for s in row)
                              and not any(verse_marker(s) for s in row))
            if is_heading_row and chapter is not None:
                heading = re.sub(r'\s+', ' ', ''.join(s['text'] for s in row)).strip()
                chapter['headings'].append({'text': heading, 'sourcePage': page_number,
                                            'beforeVerse': (verse['number'] + 1) if verse else 1})
                continue
            for s in row:
                text = s['text']
                clean = text.strip()
                size = s['size']
                if size >= 19:
                    if clean not in BOOK_MAP:
                        raise ValueError(f'Livro desconhecido: {clean} em {path.name}:{page_number}')
                    _, name, abbreviation, _ = BOOK_MAP[clean]
                    book = {'id': slug(name), 'name': name, 'abbreviation': abbreviation,
                            'testament': testament, '_chapters': {}}
                    books.append(book)
                    # Obadias, Filemom, 2/3 João e Judas não têm cabeçalho de capítulo.
                    get_chapter(1, page_number)
                    continue
                if book is None:
                    continue
                if abs(size - 11) < .15:
                    match = re.fullmatch(r'(?:Capítulo|Salmo)\s+(\d+)', clean)
                    if match:
                        get_chapter(int(match[1]), page_number)
                        continue
                if verse_marker(s):
                    start_verse(int(clean), page_number)
                    continue
                if abs(size - 9) < .15 and 'Bold' in s['font']:
                    if chapter is not None:
                        chapter['headings'].append({'text': clean, 'sourcePage': page_number,
                                                    'beforeVerse': (verse['number'] + 1) if verse else 1})
                    continue
                # O v.16 de Is 38 aparece no próprio PDF em texto de 10pt,
                # sem o estilo sobrescrito usado pelos demais números.
                if (book['id'] == 'isaias' and chapter['number'] == 38
                        and clean.startswith('16 Senhor, por tais coisas')):
                    start_verse(16, page_number)
                    text = re.sub(r'^16\s+', '', text)
                    audit['layoutCorrections'].append({'bookId': 'isaias', 'chapter': 38,
                        'verse': 16, 'sourcePage': page_number,
                        'reason': 'Número 16 impresso junto ao corpo do texto, sem estilo sobrescrito.'})
                is_body = 9.9 <= size <= 10.2 or 11.9 <= size <= 12.2
                # Pequenas capitais: o PDF divide “SENHOR” em S(10pt)+ENHOR(8pt).
                is_smallcaps = 7.8 <= size <= 8.2 and clean in {'ENHOR', 'SENHOR'}
                if (is_body or is_smallcaps) and verse is not None:
                    verse['_text'].append(text)
                    if page_number not in verse['sourcePages']:
                        verse['sourcePages'].append(page_number)
                    if page_number not in chapter['sourcePages']:
                        chapter['sourcePages'].append(page_number)
                elif (is_body or is_smallcaps) and clean:
                    audit['unassignedBodyText'].append({'bookId': book['id'], 'chapter': chapter['number'],
                                                       'sourcePage': page_number, 'text': clean})
            if verse is not None:
                verse['_text'].append(' ')
    for b in books:
        b['chapters'] = list(b.pop('_chapters').values())
        for c in b['chapters']:
            for v in c['verses']:
                text = re.sub(r'\s+', ' ', ''.join(v.pop('_text'))).strip()
                v['text'] = re.sub(r'\s+([,.;:!?])', r'\1', text)
    return books, len(doc)


def validate(books, audit):
    errors = []
    if len(books) != 66:
        errors.append(f'Esperados 66 livros, recebidos {len(books)}')
    for b, expected in zip(books, BOOKS):
        if b['name'] != expected[1]:
            errors.append(f'Ordem de livros incorreta: {b["name"]}, esperado {expected[1]}')
        numbers = [c['number'] for c in b['chapters']]
        if numbers != list(range(1, expected[3] + 1)):
            errors.append(f'{b["name"]}: capítulos {numbers}')
        for c in b['chapters']:
            numbers = [v['number'] for v in c['verses']]
            if not numbers or numbers[0] != 1:
                errors.append(f'{b["name"]} {c["number"]}: primeiro versículo não é 1 ({numbers[:3]})')
            if numbers != sorted(set(numbers)):
                errors.append(f'{b["name"]} {c["number"]}: versos fora de ordem ou duplicados: {numbers}')
            gaps = sorted(set(range(1, max(numbers, default=0) + 1)) - set(numbers))
            if gaps:
                audit['numberingGaps'].append({'bookId': b['id'], 'chapter': c['number'], 'missing': gaps,
                    'sourcePages': c['sourcePages']})
            for v in c['verses']:
                if not v['text']:
                    errors.append(f'{b["name"]} {c["number"]}:{v["number"]}: texto vazio')
    chapters = sum(len(b['chapters']) for b in books)
    if chapters != 1189:
        errors.append(f'Esperados 1189 capítulos, recebidos {chapters}')
    audit['validationErrors'] = errors
    # Regressões conferidas nas páginas originais; detectam perda de pequenos
    # capitais, inversão de objetos, vazamento de notas e divisão errada de spans.
    by_id = {b['id']: b for b in books}
    regressions = [
        ('genesis', 1, 1, 'No princípio Deus criou os céus e a terra.', 'exact'),
        ('salmos', 23, 1, 'O SENHOR é o meu pastor; de nada terei falta.', 'exact'),
        ('salmos', 72, 9, 'Inclinem-se diante dele as tribos do deserto, e os seus inimigos lambam o pó.', 'exact'),
        ('salmos', 101, 3, 'Repudiarei todo mal. Odeio a conduta dos infiéis; jamais me dominará!', 'exact'),
        ('salmos', 133, 1, 'Como é bom e agradável quando os irmãos convivem em união!', 'exact'),
        ('1-cronicas', 4, 13, 'Estes foram os filhos de Quenaz: Otoniel e Seraías. Estes foram os filhos de Otoniel: Hatate e Meonotai.', 'exact'),
        ('isaias', 38, 16, 'Senhor, por tais coisas os homens vivem, e por elas também vive o meu espírito. Tu me restauraste a saúde e deixaste-me viver.', 'exact'),
        ('isaias', 39, 2, 'Ezequias recebeu com alegria os enviados e mostrou-lhes o que havia em seus depósitos:', 'prefix'),
        ('isaias', 39, 6, '‘Um dia, tudo o que há em seu palácio,', 'prefix'),
        ('isaias', 39, 7, '‘E alguns de seus próprios descendentes serão levados,', 'prefix'),
        ('joao', 3, 16, '“Porque Deus tanto amou o mundo que deu o seu Filho Unigênito, para que todo o que nele crer não pereça, mas tenha a vida eterna.', 'exact'),
        ('apocalipse', 22, 21, 'A graça do Senhor Jesus seja com todos. Amém.', 'exact'),
    ]
    checked = 0
    for bid, cn, vn, expected, mode in regressions:
        try:
            actual = next(v['text'] for c in by_id[bid]['chapters'] if c['number'] == cn
                          for v in c['verses'] if v['number'] == vn)
            passed = actual == expected if mode == 'exact' else actual.startswith(expected)
        except (KeyError, StopIteration):
            passed = False
        if not passed:
            errors.append(f'Regressão de extração: {bid} {cn}:{vn}')
        checked += 1
    for b in books:
        for c in b['chapters']:
            for v in c['verses']:
                if re.search(r'Hebraico:|Texto Massorético|Septuaginta|\bENHOR\b', v['text']):
                    errors.append(f'Possível nota ou pequeno capital incompleto: {b["id"]} {c["number"]}:{v["number"]}')
    audit['regressionChecks'] = checked
    audit['validationErrors'] = errors
    return errors


def passages(books):
    by_id = {b['id']: b for b in books}
    result = []
    for i, (book_id, chapter, start, end) in enumerate(PASSAGE_REFS, 1):
        book = by_id[book_id]
        chapter_data = next(c for c in book['chapters'] if c['number'] == chapter)
        verses = {v['number']: v for v in chapter_data['verses']}
        selected = [verses[n] for n in range(start, end + 1)]
        result.append({'id': f'passagem-{i:02}', 'bookId': book_id, 'bookName': book['name'],
                       'chapter': chapter, 'verseStart': start, 'verseEnd': end,
                       'text': ' '.join(v['text'] for v in selected)})
    assert len(result) == 50 and len({(x['bookId'], x['chapter'], x['verseStart'], x['verseEnd']) for x in result}) == 50
    return result


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--at', type=Path, default=root / 'content/source-pdfs/at.pdf')
    parser.add_argument('--nt', type=Path, default=root / 'content/source-pdfs/nt.pdf')
    parser.add_argument('--output', type=Path, default=root / 'content')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    audit = {'sources': [], 'layoutCorrections': [], 'numberingGaps': [], 'unassignedBodyText': [],
             'method': 'Estilos tipográficos e coordenadas das linhas, com separação de notas de rodapé.',
             'status': 'machine-validated',
             'limitations': ['A conferência editorial integral, versículo a versículo, ainda não foi realizada.',
                            'Notas de rodapé e referências paralelas podem ser consultadas nos PDFs originais; não integram o texto dos versículos.']}
    books = []
    for input_path, testament in [(args.at, 'AT'), (args.nt, 'NT')]:
        path = prepare_public_pdf(input_path, args.output / 'source-pdfs' / f'{testament.lower()}.pdf')
        parsed, page_count = parse_pdf(path, testament, audit)
        books.extend(parsed)
        audit['sources'].append({'file': path.name, 'testament': testament, 'pages': page_count,
                                 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                 'uploadedFileSha256': UPLOAD_SHA256[testament],
                                 'publicCopyPolicy': 'Metadados de autoria de edição removidos das cópias de consulta; conteúdo das páginas preservado.'})
    errors = validate(books, audit)
    audit['counts'] = {'books': len(books), 'chapters': sum(len(b['chapters']) for b in books),
                       'verses': sum(len(c['verses']) for b in books for c in b['chapters'])}
    audit['bookCounts'] = [{'id': b['id'], 'chapters': len(b['chapters']),
                            'verses': sum(len(c['verses']) for c in b['chapters'])} for b in books]
    (args.output / 'bible-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
    if errors:
        raise SystemExit('\n'.join(errors))
    (args.output / 'bible.json').write_text(json.dumps({'version': 'NVI — arquivos fornecidos', 'books': books}, ensure_ascii=False, indent=2) + '\n')
    (args.output / 'passages.json').write_text(json.dumps(passages(books), ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'counts': audit['counts'], 'passages': 50, 'numberingGaps': audit['numberingGaps'],
                      'validationErrors': errors}, ensure_ascii=False))


if __name__ == '__main__':
    main()
