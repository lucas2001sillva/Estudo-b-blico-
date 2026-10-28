#!/usr/bin/env python3
"""Draw the two source-checked introductory figures as standalone SVG images.

All statements, labels and values below come from the sanitized consultation
copy of Jornada da Bíblia — Parte 1, PDF pages 3 and 4. This is a presentation
change, not a new interpretation of the material. No OCR or external source is
used to associate the authors with their descriptions.
"""

from __future__ import annotations

import argparse
from html import escape
import json
from pathlib import Path
import textwrap


ROOT = Path(__file__).resolve().parents[1]
SOURCE = "Jornada da Bíblia — Parte 1"
AUTHOR_ROWS = [
    ("Moisés", "Legislador e libertador do povo hebreu."),
    ("Davi", "Poeta e rei de Israel, autor de diversos salmos."),
    ("Isaías", "Profeta que anunciou a vinda do Messias."),
    ("Mateus", "Cobrador de impostos transformado em discípulo."),
    ("Lucas", "Médico e historiador detalhista."),
    ("Paulo", "Apóstolo e missionário, autor de grande parte das cartas cristãs."),
    ("João", "Discípulo amado de Cristo, escreveu sobre o amor e a esperança eterna."),
]
AUTHOR_NOTE = (
    "Cada um, em seu contexto, foi movido pelo Espírito Santo para registrar "
    "verdades espirituais que continuam relevantes até hoje."
)
CHART_TITLE = "Total de livros por testamento"
CHART_TEXT = (
    "Total de livros por testamento. Antigo Testamento: 39 livros. "
    "Novo Testamento: 27 livros. O eixo do gráfico vai de zero a 40 livros, "
    "com marcações em zero, 10, 20, 30 e 40."
)
AUTHORS_TITLE = "Destaques sobre os autores da Bíblia"
AUTHORS_TEXT = (
    AUTHORS_TITLE + ". Autores e contextos da inspiração divina. "
    + " ".join(f"{name}: {description}" for name, description in AUTHOR_ROWS)
    + " " + AUTHOR_NOTE
)
PALETTES = {
    "light": {
        "paper": "#f6f5f0", "surface": "#ffffff", "ink": "#29332d",
        "primary": "#245341", "soft": "#eaf1e9", "accent": "#b88a43",
        "muted": "#69736b", "line": "#e5e7df", "onPrimary": "#ffffff",
    },
    "dark": {
        "paper": "#151a17", "surface": "#1e2520", "ink": "#edf1e9",
        "primary": "#bad6b8", "soft": "#293f30", "accent": "#e0b46a",
        "muted": "#b4bdb3", "line": "#364138", "onPrimary": "#151a17",
    },
}


def text(x: float, y: float, value: str, *, size: float = 22,
         fill: str, weight: int = 400, anchor: str = "start",
         serif: bool = False) -> str:
    family = "Georgia,serif" if serif else "Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"
    return (
        f'<text x="{x:g}" y="{y:g}" font-family="{family}" font-size="{size:g}" '
        f'font-weight="{weight}" text-anchor="{anchor}" fill="{fill}">'
        f'{escape(value)}</text>'
    )


def document(width: int, height: int, title: str, description: str,
             page: int, palette: dict[str, str], contents: list[str]) -> str:
    return "\n".join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="title description">',
        f'<title id="title">{escape(title)}</title>',
        f'<desc id="description">{escape(description)}</desc>',
        f'<metadata>Fonte: {SOURCE}, arquivo study-1.pdf, página {page}. '
        'Redesenho vetorial; dados e relações preservados.</metadata>',
        f'<rect width="{width}" height="{height}" rx="20" fill="{palette["surface"]}"/>',
        *contents,
        '</svg>',
        '',
    ])


def chart(palette: dict[str, str]) -> str:
    width, height = 700, 460
    p = palette
    plot_x, plot_width, maximum = 38, 624, 40
    pieces = [
        text(38, 37, "JORNADA DA BÍBLIA · PARTE 1", size=11, fill=p["muted"], weight=600),
        text(38, 82, CHART_TITLE, size=29, fill=p["ink"], serif=True),
    ]
    for tick in (0, 10, 20, 30, 40):
        x = plot_x + plot_width * tick / maximum
        pieces.append(f'<line x1="{x:g}" y1="153" x2="{x:g}" y2="354" '
                      f'stroke="{p["line"]}" stroke-width="1.5"/>')
        pieces.append(text(x, 387, str(tick), size=17, fill=p["muted"], anchor="middle"))
    for name, value, y in (("Antigo Testamento", 39, 156), ("Novo Testamento", 27, 284)):
        bar_width = plot_width * value / maximum
        pieces.extend([
            text(plot_x, y - 18, name, size=22, fill=p["ink"], weight=600),
            f'<rect x="{plot_x}" y="{y}" width="{bar_width:g}" height="62" '
            f'rx="8" fill="{p["primary"]}" data-category="{name}" data-value="{value}"/>',
            text(plot_x + bar_width - 17, y + 41, str(value), size=28,
                 fill=p["onPrimary"], weight=650, anchor="end"),
        ])
    pieces.extend([
        f'<line x1="38" y1="413" x2="662" y2="413" stroke="{p["line"]}"/>',
        text(38, 437, f"Fonte: {SOURCE} · p. 3", size=12, fill=p["muted"]),
    ])
    return document(width, height, CHART_TITLE, CHART_TEXT, 3, p, pieces)


def authors(palette: dict[str, str]) -> str:
    width, height = 760, 1136
    p = palette
    pieces = [
        text(38, 37, "JORNADA DA BÍBLIA · PARTE 1", size=11, fill=p["muted"], weight=600),
        text(38, 83, AUTHORS_TITLE, size=31, fill=p["ink"], serif=True),
        text(54, 128, "Autores", size=18, fill=p["muted"], weight=600),
        text(210, 128, "Contextos da Inspiração Divina", size=18,
             fill=p["muted"], weight=600),
    ]
    for index, (name, description) in enumerate(AUTHOR_ROWS):
        y = 154 + index * 108
        lines = textwrap.wrap(description, width=44, break_long_words=False, break_on_hyphens=False)
        pieces.extend([
            f'<g data-author="{escape(name)}">',
            f'<rect x="38" y="{y}" width="684" height="96" rx="12" '
            f'fill="{p["surface"]}" stroke="{p["line"]}" stroke-width="1.5"/>',
            f'<rect x="38" y="{y}" width="147" height="96" rx="12" fill="{p["primary"]}"/>',
            text(111.5, y + 57, name, size=25, fill=p["onPrimary"], weight=650, anchor="middle"),
        ])
        first_baseline = y + 57 if len(lines) == 1 else y + 40
        for line_index, line in enumerate(lines):
            pieces.append(text(208, first_baseline + line_index * 29, line,
                               size=21, fill=p["ink"]))
        pieces.append('</g>')
    note_lines = textwrap.wrap(AUTHOR_NOTE, width=58, break_long_words=False, break_on_hyphens=False)
    pieces.append(f'<rect x="38" y="926" width="684" height="140" rx="12" fill="{p["soft"]}"/>')
    for index, line in enumerate(note_lines):
        pieces.append(text(58, 963 + index * 29, line, size=21, fill=p["ink"]))
    pieces.extend([
        f'<line x1="38" y1="1085" x2="722" y2="1085" stroke="{p["line"]}"/>',
        text(38, 1111, f"Fonte: {SOURCE} · p. 4", size=12, fill=p["muted"]),
    ])
    return document(width, height, AUTHORS_TITLE, AUTHORS_TEXT, 4, p, pieces)


def generate_intro_figures(output_dir: Path) -> dict[int, dict]:
    """Write below the study-visuals root and return section-compatible figures."""
    directory = Path(output_dir) / "study-1"
    directory.mkdir(parents=True, exist_ok=True)
    for theme, palette in PALETTES.items():
        (directory / f"p003-books-{theme}.svg").write_text(chart(palette), encoding="utf-8")
        (directory / f"p004-authors-{theme}.svg").write_text(authors(palette), encoding="utf-8")
    return {
        3: {
            "id": "study-1-p003-books", "title": CHART_TITLE,
            "lightSrc": "/study-visuals/study-1/p003-books-light.svg",
            "darkSrc": "/study-visuals/study-1/p003-books-dark.svg",
            "width": 700, "height": 460,
            "description": "Gráfico de barras: Antigo Testamento, 39 livros; Novo Testamento, 27 livros. Escala de 0 a 40.",
            "accessibleText": CHART_TEXT, "kind": "chart", "redrawn": True,
        },
        4: {
            "id": "study-1-p004-authors", "title": AUTHORS_TITLE,
            "lightSrc": "/study-visuals/study-1/p004-authors-light.svg",
            "darkSrc": "/study-visuals/study-1/p004-authors-dark.svg",
            "width": 760, "height": 1136,
            "description": "Quadro com sete autores da Bíblia e seus contextos, mantendo cada nome ao lado da descrição correspondente.",
            "accessibleText": AUTHORS_TEXT, "kind": "table", "redrawn": True,
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public" / "study-visuals")
    args = parser.parse_args()
    print(json.dumps(generate_intro_figures(args.output_dir), ensure_ascii=False, indent=2))
