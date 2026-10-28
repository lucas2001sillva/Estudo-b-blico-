#!/usr/bin/env python3
"""Import the supplied study PDFs without adding material from other sources.

The application ships the generated JSON and original PDFs. Rebuilding requires
Python with PyMuPDF, curl and Tesseract. OCR drafts are explicitly marked for
review; the original page remains the authoritative source.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

import fitz
from pypdf.generic import ContentStream, DecodedStreamObject


ROOT = Path(__file__).resolve().parents[1]
MODEL_URL = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/por.traineddata"
MODEL_SHA256 = "c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb"
OCR_SCALE = 3.0
SOURCES = [
    {"id": "study-1", "title": "Jornada da Bíblia — Parte 1", "file": "study-1.pdf", "pattern": "*Parte 01*.pdf", "totalPages": 15},
    {"id": "study-2", "title": "Jornada da Bíblia — Parte 2", "file": "study-2.pdf", "pattern": "*Parte 02*.pdf", "totalPages": 89},
    {"id": "study-3", "title": "Jornada da Bíblia — Parte 3", "file": "study-3.pdf", "pattern": "*Parte 03*.pdf", "totalPages": 68},
    {"id": "study-4", "title": "Jornada da Bíblia — Parte 4", "file": "study-4.pdf", "pattern": "*Parte 04*.pdf", "totalPages": 75},
    {"id": "gospels", "title": "Os 4 Evangelhos", "file": "gospels.pdf", "pattern": "OS 4 EVANGELHOS*.pdf", "totalPages": 4},
]

# Page ranges were checked against the supplied PDFs, not inferred from an
# external Bible outline. All page numbers refer to the PDF file.
GROUPS = [
    ("intro-biblia", "Conhecendo a Bíblia", "primeiros-passos", "study-1", 2, 4, "Uma introdução aos autores e à unidade da Bíblia."),
    ("organizacao-biblia", "Como a Bíblia está organizada", "primeiros-passos", "study-1", 5, 8, "Livros, grupos e línguas apresentados no material."),
    ("curiosidades-biblia", "Curiosidades da Bíblia", "primeiros-passos", "study-1", 9, 11, "Explore as curiosidades reunidas nesta parte do estudo."),
    ("panorama-biblia", "Um panorama dos livros", "primeiros-passos", "study-1", 12, 15, "Uma visão geral dos livros para orientar sua leitura."),
    ("genesis", "Gênesis: o começo da jornada", "antigo-testamento", "study-2", 2, 13, "A apresentação do Antigo Testamento e o panorama de Gênesis."),
    ("exodo", "Êxodo", "antigo-testamento", "study-2", 14, 28, "Acompanhe as explicações e os esquemas dedicados a Êxodo."),
    ("levitico", "Levítico", "antigo-testamento", "study-2", 29, 35, "Conheça o panorama de Levítico apresentado nos arquivos."),
    ("numeros", "Números", "antigo-testamento", "study-2", 36, 42, "Leia os assuntos e os esquemas sobre Números."),
    ("deuteronomio", "Deuteronômio", "antigo-testamento", "study-2", 43, 49, "Explore o panorama de Deuteronômio."),
    ("josue", "Josué", "antigo-testamento", "study-2", 50, 56, "Acompanhe o estudo e as imagens dedicadas a Josué."),
    ("juizes", "O período dos juízes", "antigo-testamento", "study-2", 57, 62, "Consulte o material sobre os juízes, incluindo uma observação de revisão na página inicial."),
    ("rute", "Rute", "antigo-testamento", "study-2", 63, 66, "O panorama de Rute conforme o material enviado."),
    ("primeiro-samuel", "1 Samuel", "antigo-testamento", "study-2", 67, 72, "Acompanhe o panorama de 1 Samuel."),
    ("segundo-samuel", "2 Samuel", "antigo-testamento", "study-2", 73, 79, "Acompanhe o panorama de 2 Samuel."),
    ("primeiro-reis", "1 Reis", "antigo-testamento", "study-2", 80, 83, "Conheça os assuntos dedicados a 1 Reis."),
    ("cronologia-reis", "Cronologia e panorama histórico", "antigo-testamento", "study-2", 84, 89, "Consulte os quadros e as imagens que encerram a Parte 2."),
    ("identidade-hebreus", "Hebreus, israelitas e judeus", "contextos", "study-3", 1, 2, "Entenda como esses nomes são apresentados no estudo."),
    ("historicos-at", "Dos reis a Ester", "antigo-testamento", "study-3", 3, 15, "Panoramas dos livros de 2 Reis a Ester."),
    ("poeticos", "Os livros poéticos", "antigo-testamento", "study-3", 16, 25, "Explore a apresentação dos livros poéticos."),
    ("profetas-maiores", "Os profetas maiores", "antigo-testamento", "study-3", 26, 39, "Conheça os panoramas reunidos sobre os profetas maiores."),
    ("profetas-menores", "Os profetas menores", "antigo-testamento", "study-3", 40, 64, "Explore os assuntos dedicados aos profetas menores."),
    ("periodo-interbiblico", "O período interbíblico", "contextos", "study-3", 65, 66, "Leia o contexto histórico apresentado entre os Testamentos."),
    ("canon", "Cânon e apócrifos", "contextos", "study-3", 67, 68, "Conheça a explicação desses termos no material."),
    ("evangelhos", "Um olhar sobre os Evangelhos", "evangelhos", "study-4", 2, 14, "Explore os panoramas dos Evangelhos apresentados na Parte 4."),
    ("vida-jesus", "Parábolas, milagres e contexto", "evangelhos", "study-4", 15, 22, "Parábolas, milagres, última semana de Jesus, apóstolos e moedas."),
    ("atos", "Atos dos Apóstolos", "novo-testamento", "study-4", 23, 25, "Acompanhe o panorama de Atos no estudo."),
    ("cartas-paulinas", "As cartas paulinas", "novo-testamento", "study-4", 26, 53, "Conheça os panoramas das cartas paulinas."),
    ("cartas-gerais", "As cartas gerais", "novo-testamento", "study-4", 54, 70, "Explore os panoramas das cartas gerais."),
    ("apocalipse", "Apocalipse", "novo-testamento", "study-4", 71, 75, "Acompanhe os assuntos apresentados sobre Apocalipse."),
    ("quadro-mateus", "Mateus em um quadro", "evangelhos", "gospels", 1, 1, "Consulte o quadro visual de Mateus e a transcrição em revisão."),
    ("quadro-marcos", "Marcos em um quadro", "evangelhos", "gospels", 2, 2, "Consulte o quadro visual de Marcos e a transcrição em revisão."),
    ("quadro-lucas", "Lucas em um quadro", "evangelhos", "gospels", 3, 3, "Consulte o quadro visual de Lucas e a transcrição em revisão."),
    ("quadro-joao", "João em um quadro", "evangelhos", "gospels", 4, 4, "Consulte o quadro visual de João e a transcrição em revisão."),
]

TRAILS = [
    {"id": "primeiros-passos", "title": "Primeiros passos", "description": "Comece pela apresentação, pela organização e pelo panorama da Bíblia.", "recommended": True},
    {"id": "antigo-testamento", "title": "Pelos caminhos do Antigo Testamento", "description": "Escolha um livro ou acompanhe os panoramas históricos, poéticos e proféticos.", "recommended": False},
    {"id": "evangelhos", "title": "Conhecendo os Evangelhos", "description": "Explore os Evangelhos, os quadros comparativos e os assuntos sobre a vida de Jesus.", "recommended": False},
    {"id": "novo-testamento", "title": "Atos, cartas e Apocalipse", "description": "Siga pelos panoramas de Atos, das cartas e de Apocalipse.", "recommended": False},
    {"id": "contextos", "title": "Contextos da Bíblia", "description": "Explore os nomes dos povos, o período interbíblico e a formação do cânon.", "recommended": False},
]

# Curated only from clear textual pages. Filled with source-checked questions.
CURATED_QUIZZES = [{'lessonId': 'intro-biblia',
  'title': 'Conhecendo a Bíblia',
  'questions': [{'id': 'intro-01',
                 'prompt': 'Qual é o objetivo apresentado na introdução da Jornada Bíblica?',
                 'choices': ['Apresentar apenas as línguas antigas',
                             'Oferecer uma visão geral das Escrituras',
                             'Reunir somente biografias dos reis',
                             'Tratar exclusivamente das cartas apostólicas'],
                 'answerIndex': 1,
                 'explanation': 'A introdução propõe uma visão panorâmica das Escrituras para ajudar o leitor a '
                                'compreender sua narrativa.',
                 'source': {'sourceId': 'study-1', 'page': 2}},
                {'id': 'intro-02',
                 'prompt': 'Segundo o material, o que significa a palavra grega que deu origem ao nome “Bíblia”?',
                 'choices': ['Templo', 'Caminho', 'Livros', 'Cidade'],
                 'answerIndex': 2,
                 'explanation': 'O material explica que “Bíblia” vem do grego bíblos, com o significado de '
                                '“livros”.',
                 'source': {'sourceId': 'study-1', 'page': 3}}]},
 {'lessonId': 'organizacao-biblia',
  'title': 'Organização e línguas da Bíblia',
  'questions': [{'id': 'organizacao-01',
                 'prompt': 'Em qual língua foi escrita originalmente a maior parte do Antigo Testamento?',
                 'choices': ['Hebraico', 'Latim', 'Português', 'Grego koiné'],
                 'answerIndex': 0,
                 'explanation': 'A seção sobre línguas informa que a maior parte do Antigo Testamento foi escrita '
                                'em hebraico; também há trechos em aramaico.',
                 'source': {'sourceId': 'study-1', 'page': 7}},
                {'id': 'organizacao-02',
                 'prompt': 'Qual língua o material apresenta como a língua original do Novo Testamento?',
                 'choices': ['Latim', 'Hebraico', 'Português', 'Grego koiné'],
                 'answerIndex': 3,
                 'explanation': 'O texto identifica o grego koiné como a forma comum do grego usada na escrita do '
                                'Novo Testamento.',
                 'source': {'sourceId': 'study-1', 'page': 7}}]},
 {'lessonId': 'panorama-biblia',
  'title': 'Um passeio pelos livros bíblicos',
  'questions': [{'id': 'panorama-01',
                 'prompt': 'Qual livro é apresentado como o relato da libertação do povo hebreu da escravidão no '
                           'Egito?',
                 'choices': ['Rute', 'Êxodo', 'Provérbios', 'Apocalipse'],
                 'answerIndex': 1,
                 'explanation': 'No panorama do Pentateuco, Êxodo é associado à libertação do povo hebreu do '
                                'Egito e à formação de Israel como nação.',
                 'source': {'sourceId': 'study-1', 'page': 12}},
                {'id': 'panorama-02',
                 'prompt': 'No panorama do Novo Testamento, qual livro mostra a expansão da igreja e a ação do '
                           'Espírito Santo?',
                 'choices': ['Cantares', 'Números', 'Atos dos Apóstolos', 'Ester'],
                 'answerIndex': 2,
                 'explanation': 'O panorama distingue os Evangelhos, que relatam a vida e o ministério de Jesus, '
                                'de Atos, que mostra a expansão da igreja.',
                 'source': {'sourceId': 'study-1', 'page': 15}}]},
 {'lessonId': 'identidade-hebreus',
  'title': 'Hebreus e israelitas',
  'questions': [{'id': 'hebreus-01',
                 'prompt': 'Segundo o estudo, de quem descendem os israelitas?',
                 'choices': ['Jacó, também chamado Israel',
                             'Ciro, rei da Pérsia',
                             'Eliseu, sucessor de Elias',
                             'Lucas, autor de Atos'],
                 'answerIndex': 0,
                 'explanation': 'O material explica que os israelitas são descendentes de Jacó, que recebeu o '
                                'nome Israel.',
                 'source': {'sourceId': 'study-3', 'page': 1}},
                {'id': 'hebreus-02',
                 'prompt': 'Quais três nomes são apresentados juntos como patriarcas dos israelitas?',
                 'choices': ['Moisés, Josué e Ciro',
                             'Abraão, Isaque e Jacó',
                             'Davi, Salomão e Roboão',
                             'Mateus, Marcos e Lucas'],
                 'answerIndex': 1,
                 'explanation': 'O texto chama Abraão, seu filho Isaque e seu neto Jacó de patriarcas dos filhos '
                                'de Israel.',
                 'source': {'sourceId': 'study-3', 'page': 2}}]},
 {'lessonId': 'historicos-at',
  'title': 'História, retorno e reconstrução',
  'questions': [{'id': 'historicos-01',
                 'prompt': 'Quem é apresentado em 2 Reis como sucessor de Elias, realizando vários milagres?',
                 'choices': ['Ciro', 'Zorobabel', 'Eliseu', 'Esdras'],
                 'answerIndex': 2,
                 'explanation': 'Na apresentação de 2 Reis, o material descreve Eliseu como sucessor de Elias e '
                                'cita milagres de seu ministério.',
                 'source': {'sourceId': 'study-3', 'page': 3}},
                {'id': 'historicos-02',
                 'prompt': 'O que o decreto de Ciro permitiu aos exilados judeus, segundo o resumo de Esdras?',
                 'choices': ['Voltar a Jerusalém e reconstruir o Templo',
                             'Permanecer no deserto por mais quarenta anos',
                             'Construir uma torre em Babel',
                             'Interromper toda a leitura da Lei'],
                 'answerIndex': 0,
                 'explanation': 'A seção sobre Esdras informa que Ciro permitiu o retorno a Jerusalém e a '
                                'reconstrução do Templo.',
                 'source': {'sourceId': 'study-3', 'page': 11}}]},
 {'lessonId': 'poeticos',
  'title': 'Poesia e sabedoria para a vida',
  'questions': [{'id': 'poeticos-01',
                 'prompt': 'Qual livro é descrito como uma coleção de cânticos e poemas de louvor, gratidão e '
                           'oração?',
                 'choices': ['Josué', 'Levítico', 'Atos', 'Salmos'],
                 'answerIndex': 3,
                 'explanation': 'O material apresenta Salmos como uma coleção de cânticos e poemas que expressam '
                                'muitas emoções diante de Deus.',
                 'source': {'sourceId': 'study-3', 'page': 16}},
                {'id': 'poeticos-02',
                 'prompt': 'Qual livro reúne ditos sábios e orientação prática para a vida diária?',
                 'choices': ['Esdras', 'Provérbios', 'Obadias', 'Marcos'],
                 'answerIndex': 1,
                 'explanation': 'A apresentação de Provérbios destaca conselhos sobre sabedoria, justiça, '
                                'relacionamentos, trabalho e integridade.',
                 'source': {'sourceId': 'study-3', 'page': 16}}]},
 {'lessonId': 'profetas-menores',
  'title': 'Descobrindo os profetas menores',
  'questions': [{'id': 'menores-01',
                 'prompt': 'Por que esse grupo recebe o nome de “profetas menores”?',
                 'choices': ['Porque suas mensagens são menos importantes',
                             'Porque escreveram somente para crianças',
                             'Porque seus livros são mais curtos',
                             'Porque todos tinham pouca idade'],
                 'answerIndex': 2,
                 'explanation': 'O estudo explica que “menores” se refere ao tamanho dos escritos, sem diminuir a '
                                'importância das mensagens.',
                 'source': {'sourceId': 'study-3', 'page': 40}},
                {'id': 'menores-02',
                 'prompt': 'Qual profeta foi enviado para anunciar uma mensagem de arrependimento à cidade de '
                           'Nínive?',
                 'choices': ['Jonas', 'Ageu', 'Malaquias', 'Zacarias'],
                 'answerIndex': 0,
                 'explanation': 'Na lista dos profetas menores, Jonas é identificado como o profeta enviado a '
                                'Nínive.',
                 'source': {'sourceId': 'study-3', 'page': 40}}]},
 {'lessonId': 'periodo-interbiblico',
  'title': 'O mundo entre os Testamentos',
  'questions': [{'id': 'interbiblico-01',
                 'prompt': 'O que é a Septuaginta, conforme o material?',
                 'choices': ['Uma cidade da Galileia',
                             'Uma coleção de cartas de Paulo',
                             'Uma estrada construída pelos romanos',
                             'Uma tradução do Antigo Testamento para o grego'],
                 'answerIndex': 3,
                 'explanation': 'O estudo apresenta a Septuaginta como a tradução grega do Antigo Testamento, '
                                'importante para leitores que não conheciam hebraico.',
                 'source': {'sourceId': 'study-3', 'page': 65}},
                {'id': 'interbiblico-02',
                 'prompt': 'Qual obra dos romanos é citada como uma ajuda para as viagens e a expansão da '
                           'mensagem cristã?',
                 'choices': ['A construção da arca',
                             'A construção de estradas ligando cidades',
                             'A criação dos quatro Evangelhos',
                             'A reconstrução da Torre de Babel'],
                 'answerIndex': 1,
                 'explanation': 'O material relaciona as estradas romanas à ligação entre cidades e à maior '
                                'facilidade de viagem.',
                 'source': {'sourceId': 'study-3', 'page': 66}}]},
 {'lessonId': 'evangelhos',
  'title': 'Quatro olhares sobre Jesus',
  'questions': [{'id': 'evangelhos-01',
                 'prompt': 'Quais são os quatro Evangelhos apresentados no estudo?',
                 'choices': ['Mateus, Marcos, Lucas e João',
                             'Gênesis, Êxodo, Levítico e Números',
                             'Romanos, Gálatas, Efésios e Filipenses',
                             'Jó, Salmos, Provérbios e Eclesiastes'],
                 'answerIndex': 0,
                 'explanation': 'A abertura da seção dos Evangelhos apresenta Mateus, Marcos, Lucas e João como '
                                'relatos da vida e da mensagem de Jesus.',
                 'source': {'sourceId': 'study-4', 'page': 2}},
                {'id': 'evangelhos-02',
                 'prompt': 'Qual Evangelho é descrito nessa introdução como aquele que destaca a ação e o poder '
                           'de Jesus?',
                 'choices': ['Mateus', 'Lucas', 'Marcos', 'João'],
                 'answerIndex': 2,
                 'explanation': 'Ao comparar as ênfases dos Evangelhos, o texto associa Marcos à ação e ao poder '
                                'de Jesus.',
                 'source': {'sourceId': 'study-4', 'page': 2}}]},
 {'lessonId': 'vida-jesus',
  'title': 'Parábolas e milagres de Jesus',
  'questions': [{'id': 'vida-01',
                 'prompt': 'Segundo o estudo, por que Jesus usava histórias com situações da vida cotidiana em '
                           'suas parábolas?',
                 'choices': ['Para registrar uma lista de reis e suas datas',
                             'Para tornar os ensinamentos acessíveis às pessoas',
                             'Para reunir regras dos sacrifícios sacerdotais',
                             'Para descrever as viagens missionárias de Paulo'],
                 'answerIndex': 1,
                 'explanation': 'O material explica que as parábolas usavam histórias simples e familiares para '
                                'comunicar ensinamentos espirituais e morais.',
                 'source': {'sourceId': 'study-4', 'page': 15}},
                {'id': 'vida-02',
                 'prompt': 'Em qual passagem o material localiza o milagre da transformação de água em vinho?',
                 'choices': ['Lucas 15:11-32', 'Mateus 5–7', 'Atos 2:1-4', 'João 2:1-11'],
                 'answerIndex': 3,
                 'explanation': 'Na lista dos milagres, a transformação de água em vinho aparece com a referência '
                                'João 2:1-11.',
                 'source': {'sourceId': 'study-4', 'page': 16}}]},
 {'lessonId': 'atos',
  'title': 'O início e a expansão da igreja',
  'questions': [{'id': 'atos-01',
                 'prompt': 'Qual tema o material destaca no livro de Atos dos Apóstolos?',
                 'choices': ['A construção da arca de Noé',
                             'As regras dos sacrifícios no deserto',
                             'O nascimento e a expansão da igreja cristã',
                             'Somente a genealogia dos reis de Judá'],
                 'answerIndex': 2,
                 'explanation': 'O estudo apresenta Atos como o registro do nascimento e da expansão da igreja '
                                'após a ressurreição e a ascensão de Jesus.',
                 'source': {'sourceId': 'study-4', 'page': 23}},
                {'id': 'atos-02',
                 'prompt': 'O que o estudo destaca no Pentecostes, em Atos 2?',
                 'choices': ['O Espírito Santo é derramado sobre os discípulos',
                             'Ciro autoriza o retorno a Jerusalém',
                             'Moisés entrega a Lei no Sinai',
                             'Salomão começa a construir o Templo'],
                 'answerIndex': 0,
                 'explanation': 'A apresentação de Atos relaciona o Pentecostes ao derramamento do Espírito Santo '
                                'sobre os discípulos.',
                 'source': {'sourceId': 'study-4', 'page': 23}}]},
 {'lessonId': 'cartas-paulinas',
  'title': 'Aprendendo com as cartas de Paulo',
  'questions': [{'id': 'paulinas-01',
                 'prompt': 'A quem as cartas de Paulo eram dirigidas, segundo o estudo?',
                 'choices': ['Apenas aos reis de Israel',
                             'Somente a pessoas que nunca haviam ouvido sobre Jesus',
                             'Exclusivamente aos soldados romanos',
                             'A igrejas e a pessoas específicas'],
                 'answerIndex': 3,
                 'explanation': 'O material informa que Paulo escreveu para igrejas e indivíduos, oferecendo '
                                'ensinamentos e orientações.',
                 'source': {'sourceId': 'study-4', 'page': 26}},
                {'id': 'paulinas-02',
                 'prompt': 'Além de ensinar sobre a fé, que tipo de orientação aparece nas cartas de Paulo?',
                 'choices': ['Como construir o templo e separar os materiais',
                             'Conselhos para a vida diária e os relacionamentos',
                             'Como organizar a monarquia de Israel',
                             'Como classificar as genealogias dos patriarcas'],
                 'answerIndex': 1,
                 'explanation': 'A seção descreve conselhos práticos sobre ética, relacionamentos, serviço '
                                'cristão e adoração.',
                 'source': {'sourceId': 'study-4', 'page': 26}}]},
 {'lessonId': 'cartas-gerais',
  'title': 'Fé, amor e perseverança',
  'questions': [{'id': 'gerais-01',
                 'prompt': 'Qual carta é destacada por tratar da prática da fé e de uma vida coerente com ela?',
                 'choices': ['Tiago', 'Filemom', 'Gálatas', 'Romanos'],
                 'answerIndex': 0,
                 'explanation': 'A apresentação das cartas gerais afirma que Tiago trata da prática da fé, '
                                'inclusive combatendo o favoritismo.',
                 'source': {'sourceId': 'study-4', 'page': 54}},
                {'id': 'gerais-02',
                 'prompt': 'Quais valores o material destaca nas cartas de 1, 2 e 3 João?',
                 'choices': ['Riqueza e prestígio',
                             'Força militar e conquistas',
                             'Amor e verdade na comunidade cristã',
                             'Comércio e impostos'],
                 'answerIndex': 2,
                 'explanation': 'A seção das cartas gerais associa 1, 2 e 3 João à importância do amor e da '
                                'verdade na comunidade cristã.',
                 'source': {'sourceId': 'study-4', 'page': 54}}]},
 {'lessonId': 'apocalipse',
  'title': 'Símbolos e esperança em Apocalipse',
  'questions': [{'id': 'apocalipse-01',
                 'prompt': 'Qual recurso de linguagem é especialmente importante em Apocalipse, segundo o estudo?',
                 'choices': ['Uma sequência de genealogias sem imagens',
                             'Imagens, símbolos e metáforas',
                             'Conselhos cotidianos reunidos em provérbios',
                             'Uma lista de regras para sacrifícios'],
                 'answerIndex': 1,
                 'explanation': 'O estudo destaca o uso de imagens, símbolos e metáforas para transmitir a '
                                'mensagem de Apocalipse.',
                 'source': {'sourceId': 'study-4', 'page': 71}},
                {'id': 'apocalipse-02',
                 'prompt': 'Que mensagem de esperança o estudo destaca em Apocalipse?',
                 'choices': ['Uma história centrada somente nos reis de Israel',
                             'Um manual para reconstruir o templo de Jerusalém',
                             'Uma coleção de viagens pelo Império Romano',
                             'A vitória final de Cristo sobre o mal'],
                 'answerIndex': 3,
                 'explanation': 'A seção apresenta a vitória final de Cristo, a justiça divina e a esperança da '
                                'vida eterna como temas do livro.',
                 'source': {'sourceId': 'study-4', 'page': 71}}]}]


SIMPLIFIED_SUMMARIES = {'intro-biblia': {'body': 'A Bíblia reúne livros escritos em épocas e contextos diferentes. O material apresenta '
                          'suas histórias como uma narrativa da relação entre Deus e os seres humanos. A Jornada '
                          'Bíblica oferece uma visão geral para ajudar na compreensão da leitura. Jesus Cristo é '
                          'apresentado como o centro dessa jornada.',
                  'sourcePages': [2, 3, 4]},
 'organizacao-biblia': {'body': 'A Bíblia apresentada no material tem 39 livros no Antigo Testamento e 27 no Novo '
                                'Testamento. Os livros são organizados em grupos, como históricos, poéticos, '
                                'Evangelhos e cartas. A maior parte do Antigo Testamento foi escrita em hebraico, '
                                'com alguns trechos em aramaico. O Novo Testamento foi escrito em grego koiné, '
                                'uma forma comum do grego.',
                        'sourcePages': [5, 6, 7]},
 'curiosidades-biblia': {'body': 'O material reúne curiosidades sobre a organização e a tradução da Bíblia. '
                                 'Destaca os Salmos 117 e 119 pelo tamanho de seus capítulos. Também mostra que '
                                 'as traduções permitem que pessoas de diferentes línguas tenham acesso às '
                                 'Escrituras.',
                         'sourcePages': [9, 11]},
 'panorama-biblia': {'body': 'O panorama apresenta os temas e as mensagens dos livros bíblicos. Gênesis trata das '
                             'origens do mundo e do início da história de Israel. Êxodo mostra a libertação do '
                             'povo hebreu do Egito. No Novo Testamento, os Evangelhos relatam a vida de Jesus e '
                             'Atos apresenta a expansão da igreja.',
                     'sourcePages': [12, 15]},
 'identidade-hebreus': {'body': 'O estudo explica os nomes hebreu, israelita e judeu. Os israelitas são '
                                'apresentados como descendentes de Jacó, que passou a se chamar Israel. Os filhos '
                                'de Jacó deram origem às doze tribos de Israel. A divisão do reino ajuda a '
                                'entender a história do nome judeu.',
                        'sourcePages': [1, 2]},
 'historicos-at': {'body': 'Esses relatos acompanham reis de Israel e Judá, o exílio e o retorno a Jerusalém. O '
                           'material mostra como as escolhas dos reis e do povo afetaram a história da nação. Em '
                           '2 Reis, apresenta o ministério do profeta Eliseu. Em Esdras, destaca o retorno dos '
                           'exilados e a reconstrução do Templo.',
                   'sourcePages': [3, 11]},
 'poeticos': {'body': 'Os livros poéticos expressam experiências humanas diante de Deus. Jó convida a refletir '
                      'sobre o sofrimento e a fé. Salmos reúne cânticos e orações de louvor, gratidão e lamento. '
                      'Provérbios oferece conselhos sobre sabedoria, justiça e a vida diária.',
              'sourcePages': [16, 17]},
 'profetas-maiores': {'body': 'Os profetas falavam em nome de Deus e chamavam o povo a mudar de caminho. Os '
                              'livros dessa seção tratam de injustiça, juízo e esperança de restauração. O '
                              'material também mostra a fidelidade de Daniel e seus amigos durante o exílio. As '
                              'mensagens apresentam promessas de Deus e a esperança da vinda do Messias.',
                      'sourcePages': [26, 27, 38]},
 'profetas-menores': {'body': 'Os profetas menores recebem esse nome porque seus livros são mais curtos, não '
                              'porque suas mensagens sejam menos importantes. Eles chamam o povo ao '
                              'arrependimento e à fidelidade a Deus. Suas mensagens tratam de justiça, '
                              'restauração e esperança. O estudo apresenta os temas dos doze livros, de Oséias a '
                              'Malaquias.',
                      'sourcePages': [40]},
 'periodo-interbiblico': {'body': 'O período interbíblico fica entre os relatos do Antigo e do Novo Testamento. O '
                                  'estudo explica como a expansão da língua grega facilitou a comunicação entre '
                                  'povos. Apresenta a Septuaginta, uma tradução do Antigo Testamento para o '
                                  'grego. Também mostra como as estradas e a organização romana ajudaram nas '
                                  'viagens dos primeiros cristãos.',
                          'sourcePages': [65, 66]},
 'canon': {'body': 'As tradições cristãs não usam todas a mesma lista de livros na Bíblia. O material compara a '
                   'Bíblia protestante e a católica e mostra que a diferença está no Antigo Testamento. Também '
                   'apresenta livros que algumas tradições aceitam e outras não. A escolha dos livros é descrita '
                   'como um processo que ocorreu ao longo de séculos.',
           'sourcePages': [67, 68]},
 'evangelhos': {'body': 'Mateus, Marcos, Lucas e João relatam a vida, o ministério, a morte e a ressurreição de '
                        'Jesus. Cada Evangelho apresenta uma ênfase própria. Os textos reúnem ensinamentos, '
                        'diálogos, milagres e parábolas. Juntos, ajudam o leitor a conhecer a vida e a mensagem '
                        'de Jesus.',
                'sourcePages': [2]},
 'vida-jesus': {'body': 'Jesus usava parábolas, histórias simples ligadas à vida cotidiana. Elas comunicavam '
                        'ensinamentos espirituais e morais. O material também reúne milagres narrados nos '
                        'Evangelhos. As listas indicam as passagens bíblicas em que esses relatos podem ser '
                        'encontrados.',
                'sourcePages': [15, 16]},
 'atos': {'body': 'Atos continua o relato do Evangelho de Lucas. Acompanha o nascimento e a expansão da igreja '
                  'depois da ressurreição e da ascensão de Jesus. O Espírito Santo fortalece os discípulos para '
                  'levarem a mensagem a outras regiões. O estudo destaca o Pentecostes e o início da vida da '
                  'comunidade cristã.',
          'sourcePages': [23]},
 'cartas-paulinas': {'body': 'Paulo escreveu cartas para igrejas e pessoas específicas. Elas trazem ensinamentos '
                             'sobre a fé e orientações para a vida cristã. Falam de graça, amor, santidade, '
                             'relacionamentos e serviço. Também oferecem encorajamento, orações e conselhos aos '
                             'leitores.',
                     'sourcePages': [26]},
 'cartas-gerais': {'body': 'As cartas gerais oferecem conselhos e encorajamento para a vida cristã. Tiago destaca '
                           'a prática da fé e uma vida coerente com ela. As cartas de João destacam o amor e a '
                           'verdade na comunidade. O material também trata de sofrimento, perseverança e cuidado '
                           'com falsos ensinamentos.',
                   'sourcePages': [54]},
 'apocalipse': {'body': 'Apocalipse usa imagens, símbolos e metáforas para transmitir sua mensagem. O livro '
                        'apresenta visões sobre juízo, restauração e o futuro. O estudo destaca a esperança e a '
                        'vitória final de Cristo sobre o mal. A mensagem encoraja a fidelidade e a perseverança '
                        'mesmo em tempos difíceis.',
                'sourcePages': [71, 72]}}

CURATED_QUIZ_EVIDENCE = [{'id': 'intro-01', 'sourceId': 'study-1', 'page': 2, 'evidence': 'oferecer uma visão panorâmica das Escrituras'},
 {'id': 'intro-02',
  'sourceId': 'study-1',
  'page': 3,
  'evidence': 'A palavra “Bíblia” vem do grego bíblos, que significa “livros”.'},
 {'id': 'organizacao-01',
  'sourceId': 'study-1',
  'page': 7,
  'evidence': 'A maior parte do Antigo Testamento foi originalmente escrita em hebraico'},
 {'id': 'organizacao-02',
  'sourceId': 'study-1',
  'page': 7,
  'evidence': 'O Novo Testamento foi originalmente escrito em grego koiné'},
 {'id': 'panorama-01',
  'sourceId': 'study-1',
  'page': 12,
  'evidence': 'Êxodo – Mostra a libertação do povo hebreu da escravidão no Egito'},
 {'id': 'panorama-02',
  'sourceId': 'study-1',
  'page': 15,
  'evidence': 'Atos dos Apóstolos mostra a expansão da igreja e a ação do Espírito Santo.'},
 {'id': 'hebreus-01',
  'sourceId': 'study-3',
  'page': 1,
  'evidence': 'Eles são os descendentes de Israel, que anteriormente era chamado de Jacó.'},
 {'id': 'hebreus-02',
  'sourceId': 'study-3',
  'page': 2,
  'evidence': 'Jacó, juntamente com seu pai (Isaque) e avô (Abraão), são considerados os patriarcas'},
 {'id': 'historicos-01',
  'sourceId': 'study-3',
  'page': 3,
  'evidence': 'o ministério do profeta Eliseu, sucessor de Elias.'},
 {'id': 'historicos-02',
  'sourceId': 'study-3',
  'page': 11,
  'evidence': 'voltassem a Jerusalém e reconstruíssem o Templo.'},
 {'id': 'poeticos-01',
  'sourceId': 'study-3',
  'page': 16,
  'evidence': 'Salmos: É uma coleção de 150 cânticos e poemas de adoração, louvor, lamentação, gratidão e '
              'reflexão.'},
 {'id': 'poeticos-02',
  'sourceId': 'study-3',
  'page': 16,
  'evidence': 'oferecem orientação prática para a vida diária.'},
 {'id': 'menores-01',
  'sourceId': 'study-3',
  'page': 40,
  'evidence': 'Os profetas menores são chamados assim devido ao tamanho mais curto de seus livros'},
 {'id': 'menores-02',
  'sourceId': 'study-3',
  'page': 40,
  'evidence': 'Jonas: Relata a história de Jonas, enviado por Deus para pregar a mensagem de arrependimento à '
              'cidade de Nínive.'},
 {'id': 'interbiblico-01', 'sourceId': 'study-3', 'page': 65, 'evidence': 'a tradução grega do Antigo Testamento'},
 {'id': 'interbiblico-02',
  'sourceId': 'study-3',
  'page': 66,
  'evidence': 'Construíram estradas para ligar cidades e países.'},
 {'id': 'evangelhos-01', 'sourceId': 'study-4', 'page': 2, 'evidence': 'MATEUS MARCOS LUCAS JOÃO'},
 {'id': 'evangelhos-02', 'sourceId': 'study-4', 'page': 2, 'evidence': 'Marcos destaca a ação e o poder de Jesus'},
 {'id': 'vida-01',
  'sourceId': 'study-4',
  'page': 15,
  'evidence': 'tornando os ensinamentos de Jesus acessíveis a um público diversificado.'},
 {'id': 'vida-02', 'sourceId': 'study-4', 'page': 16, 'evidence': 'Transformando a água em vinho (João 2:1-11)'},
 {'id': 'atos-01', 'sourceId': 'study-4', 'page': 23, 'evidence': 'nascimento e da expansão da igreja cristã.'},
 {'id': 'atos-02',
  'sourceId': 'study-4',
  'page': 23,
  'evidence': 'O capítulo 2 marca o Pentecostes, quando o Espírito Santo é derramado sobre os discípulos'},
 {'id': 'paulinas-01', 'sourceId': 'study-4', 'page': 26, 'evidence': 'para igrejas e indivíduos específicos'},
 {'id': 'paulinas-02',
  'sourceId': 'study-4',
  'page': 26,
  'evidence': 'Ele aborda questões éticas, relacionamentos interpessoais, serviço cristão e adoração apropriada.'},
 {'id': 'gerais-01', 'sourceId': 'study-4', 'page': 54, 'evidence': 'vivendo uma vida coerente com a fé cristã.'},
 {'id': 'gerais-02',
  'sourceId': 'study-4',
  'page': 54,
  'evidence': '1, 2 e 3 João abordam a importância do amor e da verdade na comunidade cristã.'},
 {'id': 'apocalipse-01',
  'sourceId': 'study-4',
  'page': 71,
  'evidence': 'O Apocalipse faz uso extensivo de imagens, símbolos e metáforas'},
 {'id': 'apocalipse-02', 'sourceId': 'study-4', 'page': 71, 'evidence': 'o triunfo final de Cristo sobre o mal'}]

# Layout regions checked visually in the supplied page images. Reading one
# column at a time prevents sentences from separate columns being interleaved.
COLUMN_REGIONS = {
    3: [(45, 125, 295, 270, 6), (305, 125, 555, 270, 6), (45, 270, 555, 810, 3)],
    14: [(45, 125, 555, 800, 3)],
    29: [(45, 120, 550, 365, 3), (45, 365, 295, 525, 6), (305, 365, 550, 525, 6), (45, 525, 550, 810, 3)],
    36: [(45, 120, 550, 345, 3), (45, 345, 295, 525, 6), (305, 345, 550, 525, 6), (45, 525, 550, 810, 3)],
    43: [(55, 125, 550, 810, 3)],
    50: [(55, 125, 550, 585, 3)],
    63: [(65, 125, 540, 175, 3), (65, 175, 290, 480, 6), (300, 175, 540, 480, 6), (65, 485, 540, 825, 3)],
    67: [(45, 125, 295, 470, 6), (305, 125, 550, 470, 6), (45, 480, 550, 810, 3)],
    68: [(45, 125, 295, 470, 6), (305, 125, 550, 470, 6), (45, 480, 550, 810, 3)],
    73: [(65, 125, 540, 175, 3), (65, 175, 295, 400, 6), (305, 175, 540, 400, 6), (65, 410, 540, 580, 3)],
    80: [(40, 150, 245, 650, 6), (250, 150, 555, 650, 6)],
}

MANUAL_TRANSCRIPTIONS = {
    ("study-1", 5): """Gêneros literários

ANTIGO TESTAMENTO
Pentateuco: Gênesis, Êxodo, Levítico, Números e Deuteronômio.
Históricos: Josué, Juízes, Rute, 1 Samuel, 2 Samuel, 1 Reis, 2 Reis, 1 Crônicas, 2 Crônicas, Esdras, Neemias e Ester.
Poéticos: Jó, Salmos, Provérbios, Eclesiastes e Cantares.
Profetas Maiores: Isaías, Jeremias, Lamentações de Jeremias, Ezequiel e Daniel.
Profetas Menores: Oséias, Joel, Amós, Obadias, Jonas, Miquéias, Naum, Habacuque, Sofonias, Ageu, Zacarias e Malaquias.

NOVO TESTAMENTO
Evangelhos: Mateus, Marcos, Lucas e João.
Histórico: Atos.
Cartas de Paulo: Romanos, 1 Coríntios, 2 Coríntios, Gálatas, Efésios, Filipenses, Colossenses, 1 Tessalonicenses, 2 Tessalonicenses, 1 Timóteo, 2 Timóteo, Tito e Filemom.
Cartas Gerais: Hebreus, Tiago, 1 Pedro, 2 Pedro, 1 João, 2 João, 3 João e Judas.
Revelações: Apocalipse.""",
    ("study-1", 6): """Estrutura bíblica

O quadro do material apresenta 66 livros, 1.189 capítulos e 31.105 versículos.

ANTIGO TESTAMENTO
39 livros e 929 capítulos. O material indica 75% do volume da Bíblia.
Gênesis, Êxodo, Levítico, Números, Deuteronômio, Josué, Juízes, Rute, 1 Samuel, 2 Samuel, 1 Reis, 2 Reis, 1 Crônicas, 2 Crônicas, Esdras, Neemias, Ester, Jó, Salmos, Provérbios, Eclesiastes, Cantares, Isaías, Jeremias, Lamentações de Jeremias, Ezequiel, Daniel, Oséias, Joel, Amós, Obadias, Jonas, Miquéias, Naum, Habacuque, Sofonias, Ageu, Zacarias e Malaquias.

NOVO TESTAMENTO
27 livros e 260 capítulos. O material indica 25% do volume da Bíblia.
Mateus, Marcos, Lucas, João, Atos, Romanos, 1 Coríntios, 2 Coríntios, Gálatas, Efésios, Filipenses, Colossenses, 1 Tessalonicenses, 2 Tessalonicenses, 1 Timóteo, 2 Timóteo, Tito, Filemom, Hebreus, Tiago, 1 Pedro, 2 Pedro, 1 João, 2 João, 3 João, Judas e Apocalipse.""",
    ("study-2", 20): """Esquema visual do tabernáculo

Rótulos apresentados na planta: Santo dos Santos; a arca da aliança; o véu; o altar do incenso; a mesa dos pães; o candelabro de ouro; o lugar Santo; o lavatório; o altar do holocausto; porta.

A planta indica 45,72 m de comprimento e 22,86 m de largura. As demais medidas e as ilustrações podem ser consultadas na página da fonte.""",
}

KNOWN_REVIEW = {("study-1", 8), ("study-2", 57), ("study-2", 84)} | {("gospels", p) for p in range(1, 5)}


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def clean_text(text: str) -> str:
    text = text.replace("\x00", "").replace("\u00ad", "")
    text = re.sub(r"(?m)^\s*\.{3,}", "", text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def native_text(page: fitz.Page) -> str:
    blocks = []
    for block in page.get_text("dict", sort=True)["blocks"]:
        if block["type"] != 0:
            continue
        lines = []
        for line in block.get("lines", []):
            spans = []
            for span in line["spans"]:
                # The supplied PDFs have personal-license watermarks on top
                # of prose. Remove their separate grey Helvetica spans before
                # joining text, rather than modifying words in the content.
                watermark_pattern = re.fullmatch(r"Teste|[^\s@]+@[^\s@]+\.[^\s@]+|\d{11}|HP\d+", span["text"])
                watermark = (span["font"] == "Helvetica-Bold" and abs(span["size"] - 9) < 0.1
                             and span["color"] == 8421504 and watermark_pattern)
                if not watermark:
                    spans.append(span["text"])
            if spans:
                lines.append("".join(spans))
        text = clean_text("\n".join(lines))
        if not text:
            continue
        if block["bbox"][1] > page.rect.height * 0.94 and re.fullmatch(r"\d{1,3}", text):
            continue
        blocks.append(text)
    return "\n\n".join(blocks)


def prepare_model(cache: Path) -> Path:
    tessdata = cache / "tessdata"
    tessdata.mkdir(parents=True, exist_ok=True)
    model = tessdata / "por.traineddata"
    if not model.exists():
        subprocess.run(["curl", "--fail", "--location", "--proto", "=https", "--tlsv1.2", MODEL_URL, "--output", str(model)], check=True)
    actual = sha256(model)
    if actual != MODEL_SHA256:
        raise RuntimeError(f"Portuguese OCR model checksum mismatch: {actual}")
    return tessdata


def ocr_page(job: tuple[str, str, int, str, str, str]) -> tuple[str, int, dict]:
    source_id, pdf_path, page_number, pdf_hash, cache_path, tessdata_path = job
    cache = Path(cache_path) / "pages" / pdf_hash
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / f"{page_number}-por-{OCR_SCALE}-v4.json"
    if target.exists():
        result = json.loads(target.read_text(encoding="utf-8"))
        return source_id, page_number, result
    previous = cache / f"{page_number}-por-{OCR_SCALE}-v2.json"
    primary = json.loads(previous.read_text(encoding="utf-8")) if previous.exists() else None
    regions = COLUMN_REGIONS.get(page_number) if source_id == "study-2" else None
    if primary and not regions and primary["words"] >= 40 and primary["meanConfidence"] >= 78:
        primary["segmentation"] = "whole-page"
        target.write_text(json.dumps(primary, ensure_ascii=False), encoding="utf-8")
        return source_id, page_number, primary
    with tempfile.TemporaryDirectory(prefix="vereda-ocr-") as tmp:
        tmp_path = Path(tmp)
        env = os.environ.copy()
        env["OMP_THREAD_LIMIT"] = "1"

        def run_ocr(image: Path, label: str, psm: int) -> dict:
            output = tmp_path / label
            run = subprocess.run(
                ["tesseract", str(image), str(output), "--tessdata-dir", tessdata_path,
                 "-l", "por", "--psm", str(psm), "-c", "tessedit_create_txt=1", "-c", "tessedit_create_tsv=1"],
                check=True, capture_output=True, text=True, env=env, timeout=150,
            )
            text = clean_text(output.with_suffix(".txt").read_text(encoding="utf-8"))
            words = []
            for row in csv.DictReader(io.StringIO(output.with_suffix(".tsv").read_text(encoding="utf-8")), delimiter="\t"):
                if row.get("text", "").strip():
                    words.append({"word": row["text"], "confidence": float(row["conf"])})
            confidence = round(sum(w["confidence"] for w in words) / len(words), 2) if words else 0
            return {"text": text, "meanConfidence": confidence, "words": len(words),
                    "lowConfidenceWords": [w for w in words if w["confidence"] < 55], "engineWarning": run.stderr.strip()}

        with fitz.open(pdf_path) as doc:
            page = doc[page_number - 1]
            if regions:
                pieces = []
                # Native timeline headers are much more faithful than OCR of
                # their small white-on-blue lettering.
                header = clean_text(page.get_text("text", clip=fitz.Rect(0, 0, page.rect.width, 120), sort=False))
                for index, (x0, y0, x1, y1, psm) in enumerate(regions):
                    image = tmp_path / f"region-{index}.png"
                    page.get_pixmap(matrix=fitz.Matrix(OCR_SCALE, OCR_SCALE), clip=fitz.Rect(x0, y0, x1, y1)).save(image)
                    pieces.append(run_ocr(image, f"region-{index}", psm))
                words = sum(piece["words"] for piece in pieces)
                result = {"text": "\n\n".join([header] + [p["text"] for p in pieces if p["text"]]), "words": words,
                          "meanConfidence": round(sum(p["meanConfidence"] * p["words"] for p in pieces) / words, 2) if words else 0,
                          "lowConfidenceWords": [word for p in pieces for word in p["lowConfidenceWords"]],
                          "engineWarning": "\n".join(p["engineWarning"] for p in pieces if p["engineWarning"]),
                          "segmentation": "visually-checked-column-regions"}
            else:
                image = tmp_path / "page.png"
                page.get_pixmap(matrix=fitz.Matrix(OCR_SCALE, OCR_SCALE)).save(image)
                if primary is None:
                    primary = run_ocr(image, "primary", 3)
                sparse = run_ocr(image, "sparse", 11)
                # Sparse text mode recovers labels missed on diagrams; keep
                # ordinary paragraph ordering unless it recovers substantially
                # more confident text.
                result = sparse if sparse["words"] * sparse["meanConfidence"] > primary["words"] * primary["meanConfidence"] * 1.15 else primary
                result["segmentation"] = "sparse-fallback" if result is sparse else "whole-page"
        target.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return source_id, page_number, result


def personal_watermark(span: dict) -> bool:
    return (span["font"] == "Helvetica-Bold" and abs(span["size"] - 9) < 0.1
            and span["color"] == 8421504
            and bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+|\d{11}|HP\d+", span["text"])))


def consultation_copy(original: Path, target: Path) -> dict:
    """Remove only identified personal overlay text, preserving source content.

    Redaction rectangles are deliberately not used: they could erase genuine
    educational text below the overlay. Only matching, separate BT/ET text
    objects are removed. The supplied original is never overwritten.
    """
    doc = fitz.open(original)
    sensitive = set()
    removed = 0
    for page in doc:
        page_values = {s["text"] for block in page.get_text("dict")["blocks"]
                       for line in block.get("lines", []) for s in line["spans"] if personal_watermark(s)}
        sensitive.update(page_values)
        if not page_values:
            continue
        for xref in page.get_contents():
            raw = doc.xref_stream(xref)

            def redact_object(match: re.Match) -> bytes:
                nonlocal removed
                stream = DecodedStreamObject()
                stream.set_data(match.group(0))
                try:
                    operators = ContentStream(stream, None).operations
                except Exception:
                    return match.group(0)
                texts = []
                for operands, operator in operators:
                    if operator == b"Tj":
                        texts.append(str(operands[0]))
                    elif operator == b"TJ":
                        texts.extend(str(item) for item in operands[0] if isinstance(item, str))
                if "".join(texts) in page_values:
                    removed += 1
                    return b"BT\nET"
                return match.group(0)

            updated = re.sub(rb"\bBT\b.*?\bET\b", redact_object, raw, flags=re.S)
            if updated != raw:
                doc.update_stream(xref, updated)
    expected = sum(1 for page in fitz.open(original) for block in page.get_text("dict")["blocks"]
                   for line in block.get("lines", []) for span in line["spans"] if personal_watermark(span))
    assert removed == expected, f"Only removed {removed}/{expected} personal overlays from {original.name}"
    metadata = doc.metadata
    for key, value in metadata.items():
        if not isinstance(value, str):
            continue
        for personal in sensitive:
            value = value.replace(personal, "[dado pessoal omitido]")
        metadata[key] = value
    doc.set_metadata(metadata)
    xml = doc.get_xml_metadata()
    if xml:
        for personal in sensitive:
            xml = xml.replace(personal, "[dado pessoal omitido]")
        doc.set_xml_metadata(xml)
    target.parent.mkdir(parents=True, exist_ok=True)
    if sensitive:
        with tempfile.TemporaryDirectory(prefix="vereda-source-") as tmp:
            sanitized = Path(tmp) / target.name
            doc.save(sanitized, garbage=4, deflate=True)
            doc.close()
            shutil.copyfile(sanitized, target)
    else:
        doc.close()
        if original.resolve() != target.resolve():
            shutil.copyfile(original, target)
    with fitz.open(target) as checked:
        assert not any(personal_watermark(span) for page in checked for block in page.get_text("dict")["blocks"]
                       for line in block.get("lines", []) for span in line["spans"])
        # Every surviving non-personal span must remain byte-for-byte equal as
        # text. This detects accidental deletion of educational content.
        with fitz.open(original) as before:
            old = [[span["text"] for b in p.get_text("dict")["blocks"] for l in b.get("lines", [])
                    for span in l["spans"] if not personal_watermark(span)] for p in before]
        new = [[span["text"] for b in p.get_text("dict")["blocks"] for l in b.get("lines", [])
                for span in l["spans"]] for p in checked]
        assert old == new, f"Educational text changed while removing personal fields from {original.name}"
    return {"removedPersonalOverlays": removed, "consultationCopy": bool(sensitive),
            "originalSha256": sha256(original), "consultationSha256": sha256(target),
            "preserved": "Educational text, attribution and editorial rights notices; original attachment unchanged."}


def find_source(source: dict, source_dir: Path, attachments: Path) -> tuple[Path, dict]:
    retained = source_dir / source["file"]
    matches = sorted(attachments.glob("*/" + source["pattern"]))
    if not matches and retained.is_file():
        return retained, {"consultationCopy": True, "originalSha256": None,
                          "consultationSha256": sha256(retained), "source": "retained consultation copy"}
    if len(matches) != 1:
        raise RuntimeError(f"Expected one supplied PDF for {source['id']}, found {len(matches)}")
    redaction = consultation_copy(matches[0], retained)
    return retained, redaction


def validate(data: dict) -> None:
    sources = {source["id"]: source for source in data["sources"]}
    lessons = {lesson["id"]: lesson for lesson in data["lessons"]}
    assert len(lessons) == len(data["lessons"]), "Duplicate lesson identifiers"
    covered = {source_id: set() for source_id in sources}
    for lesson in lessons.values():
        assert lesson["sourceId"] in sources
        assert lesson["sections"], f"Empty lesson: {lesson['id']}"
        assert 1 <= lesson["startPage"] <= lesson["endPage"] <= sources[lesson["sourceId"]]["totalPages"]
        assert all(lesson["startPage"] <= page <= lesson["endPage"] for page in lesson.get("summarySourcePages", []))
        for section in lesson["sections"]:
            assert section["body"].strip(), f"Empty section: {lesson['id']}"
            assert lesson["startPage"] <= section["sourcePage"] <= lesson["endPage"]
            covered[lesson["sourceId"]].add(section["sourcePage"])
    excluded_covers = {"study-1": {1}, "study-2": {1}, "study-3": set(), "study-4": {1}, "gospels": set()}
    for source_id, source in sources.items():
        expected = set(range(1, source["totalPages"] + 1)) - excluded_covers[source_id]
        assert covered[source_id] == expected, f"Uncovered source pages in {source_id}: {expected - covered[source_id]}"
    for trail in data["trails"]:
        assert trail["lessonIds"], f"Empty trail: {trail['id']}"
        assert all(lesson_id in lessons and lessons[lesson_id]["trailId"] == trail["id"] for lesson_id in trail["lessonIds"])
    question_ids = set()
    for quiz in data["quizzes"]:
        assert quiz["lessonId"] in lessons
        for question in quiz["questions"]:
            assert question["id"] not in question_ids
            question_ids.add(question["id"])
            assert len(question["choices"]) == 4 and len(set(question["choices"])) == 4
            assert 0 <= question["answerIndex"] < 4
            source_id = question["source"]["sourceId"]
            page = question["source"]["page"]
            lesson = lessons[quiz["lessonId"]]
            assert source_id == lesson["sourceId"] and lesson["startPage"] <= page <= lesson["endPage"]
            assert any(s["sourcePage"] == page and s["reviewStatus"] == "extracted" for s in lesson["sections"]), "Quiz must use a textual source page"
    assert len(question_ids) >= 24, f"Only {len(question_ids)} curated questions; expected at least 24"


def validate_quiz_evidence(native: dict) -> None:
    for evidence in CURATED_QUIZ_EVIDENCE:
        text = native[(evidence["sourceId"], evidence["page"])]
        normalize = lambda value: re.sub(r"\s+", " ", value).strip()
        assert normalize(evidence["evidence"]) in normalize(text), f"Quiz source evidence missing: {evidence['id']}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--attachments", type=Path, default=Path("/workspace/attachments"))
    parser.add_argument("--cache", type=Path, default=Path("/workspace/.cache/vereda-ocr"))
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--quiz-file", type=Path, help="Optional source-checked quiz definitions for initial import")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    content = args.root / "content"
    if args.validate_only:
        data = json.loads((content / "studies.json").read_text(encoding="utf-8"))
        validate(data)
        audit = json.loads((content / "study-audit.json").read_text(encoding="utf-8"))
        for source in audit["sources"]:
            assert sha256(content / "source-pdfs" / source["file"]) == source["sha256"], f"Source checksum mismatch: {source['id']}"
        texts = {}
        for evidence in CURATED_QUIZ_EVIDENCE:
            key = (evidence["sourceId"], evidence["page"])
            if key not in texts:
                source = next(source for source in data["sources"] if source["id"] == key[0])
                with fitz.open(content / "source-pdfs" / source["file"]) as doc:
                    texts[key] = native_text(doc[key[1] - 1])
        validate_quiz_evidence(texts)
        print(json.dumps({"validated": True, "sources": len(data["sources"]), "trails": len(data["trails"]), "lessons": len(data["lessons"]), "questions": sum(len(q["questions"]) for q in data["quizzes"])}))
        return
    started = time.monotonic()
    source_dir = content / "source-pdfs"
    previous_audit = json.loads((content / "study-audit.json").read_text(encoding="utf-8")) if (content / "study-audit.json").exists() else {}
    resolved = {source["id"]: find_source(source, source_dir, args.attachments) for source in SOURCES}
    for source_id, (path, privacy) in resolved.items():
        if privacy.get("originalSha256") is None:
            previous_source = next((s for s in previous_audit.get("sources", []) if s["id"] == source_id), None)
            if previous_source and previous_source.get("privacy", {}).get("consultationSha256") == sha256(path):
                privacy.update({**previous_source["privacy"], "source": "retained consultation copy; original provenance retained from prior audit"})
    source_paths = {source_id: result[0] for source_id, result in resolved.items()}
    source_hashes = {source_id: sha256(path) for source_id, path in source_paths.items()}
    tessdata = prepare_model(args.cache)
    native = {}
    jobs = []
    source_audit = []
    for source in SOURCES:
        path = source_paths[source["id"]]
        with fitz.open(path) as doc:
            assert len(doc) == source["totalPages"], f"Page count mismatch: {source['id']}"
            for index, page in enumerate(doc):
                page_no = index + 1
                native[(source["id"], page_no)] = native_text(page)
                # Part 2 puts explanatory paragraphs inside images even when
                # the timeline header has a native text layer.
                requires_ocr = source["id"] in {"study-2", "gospels"} or (source["id"] == "study-1" and page_no == 8)
                if requires_ocr:
                    jobs.append((source["id"], str(path), page_no, source_hashes[source["id"]], str(args.cache), str(tessdata)))
        source_audit.append({"id": source["id"], "file": source["file"], "sha256": source_hashes[source["id"]],
                             "pages": source["totalPages"], "privacy": resolved[source["id"]][1]})
    validate_quiz_evidence(native)
    ocr = {}
    # PyMuPDF does not support concurrent rendering from Python threads.
    # Separate processes isolate renderer state; subprocess OCR uses one CPU.
    with concurrent.futures.ProcessPoolExecutor(max_workers=max(1, min(args.workers, 4))) as executor:
        for source_id, page_no, result in executor.map(ocr_page, jobs):
            ocr[(source_id, page_no)] = result
            print(f"OCR {source_id} p.{page_no}: {result['words']} words, confidence {result['meanConfidence']}", flush=True)
    lessons = []
    for lesson_id, title, trail_id, source_id, start, end, description in GROUPS:
        sections = []
        for page_no in range(start, end + 1):
            result = ocr.get((source_id, page_no))
            body = result["text"] if result else native[(source_id, page_no)]
            manual = MANUAL_TRANSCRIPTIONS.get((source_id, page_no))
            if manual:
                body = manual
            if not body.strip():
                body = "Esta página contém conteúdo visual sem transcrição confiável. Consulte a página original."
            if manual:
                status = "ocr-reviewed" if result else "extracted"
            elif (source_id, page_no) in KNOWN_REVIEW:
                status = "needs-review"
            elif result:
                status = "ocr-extracted" if result["words"] >= 25 and result["meanConfidence"] >= 75 and len(body) >= 100 else "needs-review"
            else:
                status = "extracted"
            sections.append({"title": f"Página {page_no}", "body": body, "sourcePage": page_no,
                             "reviewStatus": status})
        lesson = {"id": lesson_id, "title": title, "trailId": trail_id, "description": description,
                  "sourceId": source_id, "startPage": start, "endPage": end, "sections": sections}
        summary = SIMPLIFIED_SUMMARIES.get(lesson_id)
        if summary:
            lesson["summary"] = summary["body"]
            lesson["summarySourcePages"] = summary["sourcePages"]
        lessons.append(lesson)
    trails = [{**trail, "lessonIds": [lesson["id"] for lesson in lessons if lesson["trailId"] == trail["id"]]} for trail in TRAILS]
    quizzes = json.loads(args.quiz_file.read_text(encoding="utf-8")) if args.quiz_file else CURATED_QUIZZES
    if not quizzes and (content / "studies.json").exists():
        quizzes = json.loads((content / "studies.json").read_text(encoding="utf-8"))["quizzes"]
    quizzes = [{"id": f"quiz-{quiz['lessonId']}", **quiz} for quiz in quizzes]
    data = {"sources": [{k: v for k, v in source.items() if k != "pattern"} for source in SOURCES],
            "trails": trails, "lessons": lessons, "quizzes": quizzes}
    audit = {"sources": source_audit, "ocr": {"engine": "tesseract", "language": "por", "modelUrl": MODEL_URL,
             "modelSha256": MODEL_SHA256, "scale": OCR_SCALE,
             "pages": [{"sourceId": source_id, "page": page_no, "meanConfidence": result["meanConfidence"],
                        "words": result["words"], "segmentation": result.get("segmentation"),
                        "lowConfidenceWords": result["lowConfidenceWords"]} for (source_id, page_no), result in sorted(ocr.items())]},
             "review": {"status": "partial", "textualPages": "Extraídas da camada textual; a revisão editorial integral ainda não foi concluída.",
                        "ocrPages": "ocr-extracted identifica transcrição automática legível por verificações de comprimento/confiança e amostragem visual; pode conter erros residuais. Não equivale a revisão editorial integral. needs-review reserva páginas de baixa qualidade ou defeito original. ocr-reviewed identifica transcrição manual conferida na imagem.",
                        "visualSamplesStudy2": [3, 14, 29, 36, 43, 50, 63, 67, 73, 80, 84],
                        "columnLayoutFixesStudy2": sorted(COLUMN_REGIONS),
                        "manualTranscriptions": [{"sourceId": source_id, "page": page} for source_id, page in MANUAL_TRANSCRIPTIONS],
                        "simplifiedSummaries": "17 aberturas de lições, em linguagem simples, verificadas em páginas textuais citadas. Não substituem a transcrição integral.",
                        "quizSources": "Somente páginas com camada textual clara; cada pergunta tem arquivo e página de origem.",
                        "excludedPages": [{"sourceId": "study-1", "page": 1, "reason": "capa"}, {"sourceId": "study-2", "page": 1, "reason": "capa"}, {"sourceId": "study-4", "page": 1, "reason": "capa"}],
                        "knownSourceIssues": [{"sourceId": "study-2", "page": 57, "detail": "Título Samuel em quadro com características de Juízes; não corrigido com fontes externas."},
                                              {"sourceId": "study-2", "page": 63, "detail": "A linha temporal nomeia Abimeleque; o corpo da página nomeia Elimeleque. A divergência pertence ao original e não foi corrigida com fontes externas."},
                                              {"sourceId": "study-2", "page": 73, "detail": "Cabeçalho e texto apresentam datas diferentes. Preservado como fonte, sem completar por memória."},
                                              {"sourceId": "study-2", "page": 84, "detail": "A tabela tem nomes/datas que o OCR não reconhece com confiabilidade; exige revisão manual antes de ensino ou áudio."},
                                              {"sourceId": "gospels", "page": 1, "detail": "Trechos deformados ou truncados no próprio original."},
                                              {"sourceId": "gospels", "page": 2, "detail": "Trechos deformados e numeração de livro inconsistente no original."},
                                              {"sourceId": "gospels", "page": 4, "detail": "Linhas repetidas e palavras deformadas no original."}]},
             "quizEvidence": CURATED_QUIZ_EVIDENCE,
             "counts": {"sources": len(SOURCES), "sourcePages": sum(s["totalPages"] for s in SOURCES), "totalSections": sum(len(l["sections"]) for l in lessons),
                        "accessibleSections": sum(s["reviewStatus"] != "needs-review" for l in lessons for s in l["sections"]),
                        "pendingReviewSections": sum(s["reviewStatus"] == "needs-review" for l in lessons for s in l["sections"]),
                        "lessons": len(lessons), "trails": len(trails), "quizzes": len(quizzes), "questions": sum(len(q["questions"]) for q in quizzes)},
             "elapsedSeconds": round(time.monotonic() - started, 2)}
    content.mkdir(parents=True, exist_ok=True)
    (content / "studies.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (content / "study-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    validate(data)
    print(json.dumps(audit["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
