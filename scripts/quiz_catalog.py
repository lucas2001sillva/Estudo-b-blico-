"""Assemble reviewed quiz banks without rewriting study text or old attempts."""
import json


def read(content, filename):
    return json.loads((content / filename).read_text(encoding='utf-8'))


def study_quizzes(content):
    previous = {quiz['id']: quiz for quiz in read(content, 'quiz-study-legacy.json')}
    quizzes = read(content, 'quiz-study-first.json') + read(content, 'quiz-study-second.json')
    assert {quiz['id'] for quiz in quizzes} == set(previous), 'Keep every existing study quiz and identifier.'
    for quiz in quizzes:
        old = previous[quiz['id']]
        assert len(quiz['questions']) >= 8
        by_id = {question['id']: question for question in quiz['questions']}
        for question in old['questions']:
            current = by_id[question['id']]
            for field in ['choices', 'answerIndex', 'source']:
                assert question[field] == current[field], f'Existing answer/source changed: {question["id"]}'
        quiz.update(category='study', revision=2, previousVersions=[{'revision': 1, 'questions': old['questions']}])
    return quizzes


def bible_quizzes(content):
    titles = {
        'at': {'easy': ['Primeiros encontros', 'Histórias que você conhece'],
               'medium': ['Promessas e escolhas', 'Pelos caminhos de Israel'],
               'hard': ['Atenção aos detalhes', 'Leituras que surpreendem']},
        'nt': {'easy': ['Começos e descobertas', 'Passos da fé'],
               'medium': ['Palavras que transformam', 'Fé em movimento'],
               'hard': ['Além da primeira leitura', 'Entre cartas e visões']},
    }
    names = {'at': 'Antigo Testamento', 'nt': 'Novo Testamento'}
    result = []
    for source in ['at', 'nt']:
        questions = read(content, f'quiz-bible-{source}.json')
        assert len(questions) == 60
        for difficulty in ['easy', 'medium', 'hard']:
            selected = [question for question in questions if question['difficulty'] == difficulty]
            assert len(selected) == 20, f'{source}: need twenty questions at {difficulty}.'
            for index in range(2):
                result.append({'id': f'quiz-biblia-{source}-{difficulty}-{index + 1}', 'revision': 1,
                               'category': 'bible', 'difficulty': difficulty,
                               'title': f'{titles[source][difficulty][index]} · {names[source]}',
                               'description': f'Dez perguntas sobre o {names[source]}, com explicações e referências para continuar a leitura.',
                               'questions': selected[index * 10:(index + 1) * 10]})
    assert sum(len(quiz['questions']) for quiz in result) == 120
    return result
