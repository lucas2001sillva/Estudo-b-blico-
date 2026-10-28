#!/usr/bin/env python3
"""Recreate only study charts/tables/diagrams; keep prose as ordered native text."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def _layout():
    spec = importlib.util.spec_from_file_location('study_layout', ROOT / 'scripts' / 'study-layout.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def generate(content_dir=ROOT / 'content', output_dir=ROOT / 'public' / 'study-visuals'):
    return _layout().build(content_dir, output_dir)

def verify(content_dir, output_dir):
    return _layout().verify(content_dir, output_dir)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    if not args.verify_only:
        generate()
    print(json.dumps(verify(ROOT / 'content', ROOT / 'public' / 'study-visuals'), ensure_ascii=False))
