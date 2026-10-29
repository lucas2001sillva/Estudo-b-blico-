import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight,
  CircleHelp, FileText, Headphones, RotateCcw, Route, Search, Sparkles,
  Trophy, Volume2,
} from 'lucide-react';
import type { Difficulty, Lesson, ProgressState, Question, Quiz, QuizAttempt, StatePatch, Studies, StudySection } from '../types';
import { StudyVisual } from './StudyVisual';
import '../styles/studies.css';
import '../styles/quiz-catalog.css';

interface SharedProps {
  studies: Studies;
  progress: ProgressState;
  onPatch: (patch: StatePatch) => void;
  onSpeak: (text: string) => void;
  canSave?: boolean;
}

interface StudiesProps extends SharedProps {
  onStartQuiz: (quizId: string) => void;
}

interface QuizProps extends SharedProps {
  bibleQuizzes?: Quiz[];
  selectedQuizId: string | null;
  onSelectQuiz: (id: string) => void;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const sourceUrl = (id: string, page: number) => `/api/sources/${encodeURIComponent(id)}#page=${page}`;
const createAttemptId = () => globalThis.crypto?.randomUUID?.() ?? `quiz-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const difficultyLabels: Record<Difficulty, string> = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' };

function revealContent(focusTarget: () => HTMLElement | null, scrollTarget = focusTarget) {
  // Wait for the selected collection to render before moving focus. Typing in
  // search never calls this helper; navigation happens only on an explicit choice.
  window.requestAnimationFrame(() => {
    const target = focusTarget();
    const scroll = scrollTarget();
    if (!target || !scroll) return;
    target.focus({ preventScroll: true });
    scroll.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

function quizForAttempt(quiz: Quiz, attempt: QuizAttempt): Quiz | null {
  const candidates = [quiz, ...(quiz.previousVersions ?? []).map(version => ({ ...quiz, questions: version.questions, revision: version.revision, previousVersions: undefined }))]
    .filter(version => version.questions.length === attempt.total && (attempt.quizRevision === undefined || (version.revision ?? 1) === attempt.quizRevision));
  return candidates.length === 1 ? candidates[0] : null;
}

function currentQuizAttempt(quiz: Quiz, attempt: QuizAttempt) {
  const version = quizForAttempt(quiz, attempt);
  return version !== null && (version.revision ?? 1) === (quiz.revision ?? 1);
}

function bibleQuestionReference(question: Question) {
  const { bookId, bookName, chapter, verseStart, verseEnd } = question.source;
  return bookId && bookName && chapter && verseStart ? `${bookName} ${chapter}:${verseStart}${verseEnd && verseEnd !== verseStart ? `–${verseEnd}` : ''}` : '';
}

function questionSourceTitle(question: Question, studies: Studies) {
  if (question.source.sourceId === 'at') return 'Bíblia NVI — Antigo Testamento';
  if (question.source.sourceId === 'nt') return 'Bíblia NVI — Novo Testamento';
  return studies.sources.find(source => source.id === question.source.sourceId)?.title ?? 'PDF de estudo';
}

function questionExplanationSpeech(question: Question, studies: Studies) {
  const reference = bibleQuestionReference(question);
  const pages = question.source.pages ?? [question.source.page];
  return `Resposta correta: ${question.choices[question.answerIndex]}. ${question.explanation} ${reference ? `Passagem: ${reference}. ` : ''}Fonte: ${questionSourceTitle(question, studies)}, ${pages.length > 1 ? `páginas ${pages.join(' e ')}` : `página ${pages[0]}`}.`;
}

function ProgressBar({ value, total, label }: { value: number; total: number; label: string }) {
  const percentage = total ? Math.round(value / total * 100) : 0;
  return (
    <div className="study-progress">
      <div className="study-progress-label"><span>{label}</span><strong>{percentage}%</strong></div>
      <div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function SourceLink({ id, page, pages = [page], title, compact = false }: { id: string; page: number; pages?: number[]; title?: string; compact?: boolean }) {
  return (<>
    <a className="study-source-link" href={sourceUrl(id, page)} target="_blank" rel="noopener noreferrer">
      <FileText size={15} aria-hidden="true" />
      {!compact && (title ? `${title} · ` : 'PDF de consulta · ')}{pages.length > 1 ? 'pp.' : 'p.'} {pages.join(', ')}
      <span className="study-sr-only"> — abre o PDF em outra aba</span>
    </a>
    {pages.length > 1 && <span className="quiz-source-pages">{pages.slice(1).map(number => <a className="quiz-source-page-link" key={number} href={sourceUrl(id, number)} target="_blank" rel="noopener noreferrer">Ir à página {number}<span className="study-sr-only"> do PDF — abre em outra aba</span></a>)}</span>}
  </>);
}

function sectionReadingText(section: StudySection) {
  if (section.reviewStatus === 'needs-review') return '';
  // A supplied reading is complete and already includes any verified figure descriptions.
  // Never append extracted body text to it, especially when an empty reading was deliberate.
  if (section.readingText !== undefined) return section.readingText.trim();
  if (section.blocks !== undefined) {
    return section.blocks.map(block => block.kind === 'text' ? block.text : section.visuals?.find(visual => visual.id === block.visualId)?.accessibleText ?? '').filter(Boolean).join('\n\n');
  }
  if (section.visuals?.length) {
    return [section.displayBody ?? '', ...section.visuals.map(visual => visual.accessibleText ?? ''), section.bodyAfterVisuals ?? ''].filter(Boolean).join('\n\n');
  }
  return section.displayBody ?? section.body;
}

function lessonSpeech(lesson: Lesson) {
  const description = lesson.summary && normalize(lesson.description) === normalize(lesson.summary) ? '' : lesson.description;
  return [lesson.title, description, ...(lesson.summary ? [`Em palavras simples. ${lesson.summary}`, 'Texto do material.'] : []), ...lesson.sections.map(section => {
    const text = sectionReadingText(section);
    return text ? `${section.title}. ${text}` : '';
  })].filter(Boolean).join('\n\n');
}

function QuizExplanation({ question, studies }: { question: Question; studies: Studies }) {
  const reference = bibleQuestionReference(question);
  return <>
    <p className="quiz-explanation"><strong>{reference ? 'Resumo da passagem:' : 'Resumo do material:'}</strong> {question.explanation}</p>
    {reference && <a className="quiz-bible-reference" href={`#biblia?livro=${encodeURIComponent(question.source.bookId!)}&capitulo=${question.source.chapter}&versiculo=${question.source.verseStart}`} target="_blank" rel="noopener noreferrer"><BookOpen size={16} aria-hidden="true" />Ler {reference} na Bíblia<span className="study-sr-only"> — abre a Bíblia em outra aba</span></a>}
    <SourceLink id={question.source.sourceId} page={question.source.page} pages={question.source.pages} title={questionSourceTitle(question, studies)} />
  </>;
}

function AnswerReview({ quiz, answers, studies }: { quiz: Quiz; answers: number[]; studies: Studies }) {
  return <>{quiz.questions.map((item, index) => <section className={`quiz-review-item ${answers[index] === item.answerIndex ? 'is-correct' : ''}`} key={item.id}>
    <h3><span>{index + 1}.</span> {item.prompt}</h3>
    <p><strong>Sua resposta:</strong> {item.choices[answers[index]] ?? 'Não respondida'} {answers[index] === item.answerIndex && <Check size={16} aria-label="Correta" />}</p>
    {answers[index] !== item.answerIndex && <p><strong>Resposta correta:</strong> {item.choices[item.answerIndex]}</p>}
    <QuizExplanation question={item} studies={studies} />
  </section>)}</>;
}

function QuizHistory({ quiz, attempts, studies }: { quiz: Quiz; attempts: QuizAttempt[]; studies: Studies }) {
  const [isOpen, setIsOpen] = useState(false);
  const [limit, setLimit] = useState(5);
  const sorted = [...attempts].sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
  const displayDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  };
  return <details className="quiz-attempt-history" onToggle={event => setIsOpen(event.currentTarget.open)}>
    <summary><span>Suas tentativas <span className="quiz-history-count">{attempts.length}</span></span><ChevronRight size={17} aria-hidden="true" /></summary>
    {isOpen && <div className="quiz-history-list">
      <p className="quiz-history-intro muted">Abra uma tentativa para rever suas respostas e as referências do material.</p>
      {sorted.slice(0, limit).map(attempt => {
        const version = quizForAttempt(quiz, attempt);
        const previous = version && (version.revision ?? 1) !== (quiz.revision ?? 1);
        return <details className="quiz-history-attempt" key={attempt.id}>
        <summary><strong>{attempt.score} de {attempt.total}</strong><time dateTime={attempt.createdAt}>{displayDate(attempt.createdAt)}</time><ChevronRight size={15} aria-hidden="true" /></summary>
        <div className="quiz-history-answers">{previous && <p className="quiz-version-note">Versão anterior: esta tentativa conserva as perguntas respondidas na época.</p>}{version && attempt.answers?.length === version.questions.length ? <AnswerReview quiz={version} answers={attempt.answers} studies={studies} /> : <p className="muted">Esta tentativa registra apenas a pontuação.</p>}</div>
      </details>;
      })}
      {sorted.length > limit && <button className="button button-ghost quiz-show-history" onClick={() => setLimit(value => value + 5)}>Mostrar mais tentativas <span>({sorted.length - limit})</span></button>}
    </div>}
  </details>;
}

export function StudiesPage({ studies, progress, onPatch, onStartQuiz, onSpeak, canSave = true }: StudiesProps) {
  const [query, setQuery] = useState('');
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const trailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const readerStartRef = useRef<HTMLDivElement>(null);
  const previousLessonIdRef = useRef<string | null>(null);
  const searchId = useId();
  const resultCountId = useId();
  const selectedLesson = studies.lessons.find(lesson => lesson.id === selectedLessonId);
  const selectedTrail = studies.trails.find(trail => trail.id === progress.selectedTrailId);
  const completedCount = studies.lessons.filter(lesson => progress.completedLessons[lesson.id]).length;
  const visibleLessons = useMemo(() => {
    const search = normalize(query.trim());
    return studies.lessons.filter(lesson =>
      (!selectedTrail || selectedTrail.lessonIds.includes(lesson.id))
      && (!search || normalize(`${lesson.title} ${lesson.description}`).includes(search)),
    );
  }, [studies.lessons, selectedTrail, query]);

  useEffect(() => {
    if (selectedLessonId) revealContent(() => headingRef.current, () => readerStartRef.current);
    else if (previousLessonIdRef.current || selectedTrail) revealContent(() => resultsHeadingRef.current);
    previousLessonIdRef.current = selectedLessonId;
  }, [selectedLessonId]);

  const selectTrail = (id: string | null) => {
    if (!canSave) return;
    onPatch({ selectedTrailId: id });
    revealContent(() => resultsHeadingRef.current);
  };

  const openLesson = (id: string) => {
    setSelectedLessonId(id);
  };

  if (selectedLesson) {
    const trail = studies.trails.find(item => item.id === selectedLesson.trailId);
    const source = studies.sources.find(item => item.id === selectedLesson.sourceId);
    const quiz = studies.quizzes.find(item => item.lessonId === selectedLesson.id && item.questions.length > 0);
    const isComplete = !!progress.completedLessons[selectedLesson.id];
    const orderedIds = trail?.lessonIds ?? studies.lessons.map(lesson => lesson.id);
    const position = orderedIds.indexOf(selectedLesson.id);
    const hasReviewNotice = selectedLesson.sections.some(section => section.reviewStatus === 'needs-review');

    return (
      <div className="study-reader-page" ref={readerStartRef}>
        <button className="button button-ghost study-back" onClick={() => setSelectedLessonId(null)}>
          <ArrowLeft size={17} aria-hidden="true" /> Voltar aos estudos
        </button>
        <div className="study-reader-layout">
          <article className="card study-article">
            <header className="study-article-header">
              <span className="eyebrow">{trail?.title ?? 'Estudo bíblico'}</span>
              <h1 ref={headingRef} tabIndex={-1} data-readable>{selectedLesson.title}</h1>
              {(!selectedLesson.summary || normalize(selectedLesson.description) !== normalize(selectedLesson.summary)) && <p className="muted study-lesson-description" data-readable>{selectedLesson.description}</p>}
              <div className="study-article-actions">
                <button className="button button-secondary" onClick={() => onSpeak(lessonSpeech(selectedLesson))}>
                  <Volume2 size={17} aria-hidden="true" /> Ouvir este estudo
                </button>
                <SourceLink id={selectedLesson.sourceId} page={selectedLesson.startPage} title="Consultar o PDF" />
              </div>
            </header>

            <div className="study-reader-note">
              <BookOpen size={18} aria-hidden="true" />
              <p>Texto para leitura, com gráficos, quadros e diagramas do material. Os trechos ainda em conferência usam a imagem original do PDF. Amplie as figuras para consultar os detalhes.</p>
            </div>

            {hasReviewNotice && <div className="study-review-notice" role="note">
              Algumas páginas deste assunto precisam de conferência. Os trechos duvidosos estão sinalizados; você pode consultar o material em PDF.
            </div>}

            {selectedLesson.summary && <section className="study-summary" aria-labelledby="study-summary-heading">
              <span className="eyebrow">Em palavras simples</span>
              <h2 id="study-summary-heading">Para entender este assunto</h2>
              <div className="study-summary-body" data-readable>{selectedLesson.summary.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
              <div className="study-summary-citations"><p>Baseado em {source?.title ?? 'material enviado'}:</p><div>{[...new Set(selectedLesson.summarySourcePages?.length ? selectedLesson.summarySourcePages : [selectedLesson.startPage])].map(page => <SourceLink key={page} id={selectedLesson.sourceId} page={page} compact />)}</div></div>
            </section>}

            <div className="study-reading-content">
              {selectedLesson.summary && <div className="study-transcription-heading"><span className="eyebrow">Para aprofundar</span><h2>Texto e imagens do material</h2><p className="muted">Acompanhe a leitura e amplie os gráficos, quadros e diagramas para ver as relações do material.</p></div>}
              {selectedLesson.sections.length === 0 && <p className="muted">O texto acessível deste assunto ainda não está disponível. Consulte o PDF acima.</p>}
              {selectedLesson.sections.map((section, index) => {
                const reading = sectionReadingText(section);
                const body = section.displayBody ?? (section.visuals?.length ? '' : section.body);
                return (
                <section className="study-text-section" key={`${section.sourcePage}-${index}`} aria-labelledby={`study-section-${index}`}>
                  <div className="study-section-topline"><span>Página {section.sourcePage}</span></div>
                  <h2 id={`study-section-${index}`}>{section.reviewStatus === 'needs-review' ? 'Página em conferência' : section.title}</h2>
                  {reading && <span hidden aria-hidden="true" data-readable>{section.title}. {reading}</span>}
                  {section.reviewStatus === 'needs-review' ? (
                    <div className="study-review-notice">
                      <p>A transcrição desta página ainda precisa de conferência. {section.visuals?.length ? 'Amplie as figuras e consulte o PDF para conferir as informações.' : 'Consulte a página no PDF para conferir as informações.'}</p>
                    </div>
                  ) : (
                    <>
                      {(section.reviewStatus === 'ocr-reviewed' || section.reviewStatus === 'ocr-extracted') && <p className="study-transcription-note">Texto convertido de imagem; consulte a fonte em caso de dúvida. Esta conversão não substitui o PDF de consulta.</p>}
                      {section.blocks === undefined && body.trim() && <div className="study-section-body">
                        {body.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                      </div>}
                    </>
                  )}
                  {section.blocks !== undefined ? section.blocks.map((block, blockIndex) => {
                    if (block.kind === 'text') return block.text.trim() ? <div className="study-section-body" key={`text-${blockIndex}`}>
                      {block.text.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                    </div> : null;
                    const visual = section.visuals?.find(item => item.id === block.visualId);
                    return visual ? <StudyVisual key={`visual-${block.visualId}-${blockIndex}`} visual={visual} theme={progress.preferences.theme} onSpeak={onSpeak} /> : <p className="muted" role="status" key={`missing-${blockIndex}`}>Esta figura não está disponível. Consulte o PDF da página.</p>;
                  }) : <>
                    {section.visuals?.map(visual => <StudyVisual key={visual.id} visual={visual} theme={progress.preferences.theme} onSpeak={onSpeak} />)}
                    {section.reviewStatus !== 'needs-review' && section.bodyAfterVisuals?.trim() && <div className="study-section-body">
                      {section.bodyAfterVisuals.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                    </div>}
                  </>}
                  {section.sourceTranscript !== undefined && <details className="study-source-transcript">
                    <summary>Texto extraído — em conferência</summary>
                    <div className="study-source-transcript-body">
                      <p className="study-source-transcript-warning">A ordem das frases pode não preservar as relações da imagem. Consulte a figura para conferir.</p>
                      {section.sourceTranscript.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                    </div>
                  </details>}
                  <div className="study-page-actions">
                    <SourceLink id={selectedLesson.sourceId} page={section.sourcePage} />
                    {reading && <button className="button button-ghost" onClick={() => onSpeak(`${section.title}. ${reading}`)} aria-label={`Ouvir texto da página ${section.sourcePage}`}><Volume2 size={15} aria-hidden="true" /> Ouvir página</button>}
                  </div>
                </section>
              ); })}
            </div>

            <footer className="study-article-footer">
              <div>
                <h2>{isComplete ? 'Mais um passo na sua jornada' : 'Terminou este assunto?'}</h2>
                <p className="muted">Você decide quando marcar a leitura como concluída e pode desfazer depois.</p>
              </div>
              <button className={`button ${isComplete ? 'button-secondary' : 'button-primary'}`} disabled={!canSave} onClick={() => onPatch({ completedLessons: { [selectedLesson.id]: !isComplete } })} aria-pressed={isComplete}>
                <CheckCircle2 size={18} aria-hidden="true" /> {isComplete ? 'Leitura concluída · desfazer' : 'Concluir leitura'}
              </button>
            </footer>
          </article>

          <aside className="study-reader-sidebar" aria-label="Sobre este estudo">
            <div className="card study-side-card">
              <span className="study-icon"><Route size={23} aria-hidden="true" /></span>
              <h2>Siga no seu ritmo</h2>
              <p className="muted">Não existe uma ordem obrigatória. Você pode visitar outros assuntos a qualquer momento.</p>
              {trail && <ProgressBar value={trail.lessonIds.filter(id => progress.completedLessons[id]).length} total={trail.lessonIds.length} label="Progresso da trilha" />}
              <div className="study-side-source"><span className="eyebrow">Material de origem</span><p>{source?.title ?? 'PDF enviado'}</p><small className="muted">Páginas {selectedLesson.startPage}{selectedLesson.endPage !== selectedLesson.startPage ? `–${selectedLesson.endPage}` : ''}</small></div>
            </div>
            {quiz && <div className="card study-side-card study-quiz-invite">
              <CircleHelp size={25} aria-hidden="true" />
              <h2>Que tal praticar?</h2>
              <p className="muted">Relembre este assunto com {quiz.questions.length} {quiz.questions.length === 1 ? 'pergunta' : 'perguntas'}. Sem cronômetro, com explicações para aprender.</p>
              <button className="button button-primary" onClick={() => onStartQuiz(quiz.id)}>Abrir quiz <ArrowRight size={16} aria-hidden="true" /></button>
            </div>}
          </aside>
        </div>
        <nav className="study-lesson-navigation" aria-label="Navegar entre estudos da trilha">
          {position > 0 ? <button className="button button-secondary" onClick={() => openLesson(orderedIds[position - 1])}><ArrowLeft size={17} aria-hidden="true" /> Estudo anterior</button> : <span />}
          {position >= 0 && position < orderedIds.length - 1 && <button className="button button-secondary" onClick={() => openLesson(orderedIds[position + 1])}>Próximo estudo <ArrowRight size={17} aria-hidden="true" /></button>}
        </nav>
      </div>
    );
  }

  return (
    <div className="studies-page">
      <header className="page-header study-page-header">
        <div><span className="eyebrow">Descobrir e compreender</span><h1 ref={libraryHeadingRef} tabIndex={-1}>Um assunto de cada vez.</h1><p className="muted">Explore os estudos, escolha seu caminho e aprenda no seu ritmo.</p></div>
        <div className="study-total-counter"><BookOpen size={23} aria-hidden="true" /><div><strong>{completedCount}<span> / {studies.lessons.length}</span></strong><small>estudos concluídos</small></div></div>
      </header>

      <section aria-labelledby="study-trails-heading" className="study-trails-section">
        <div className="study-section-heading"><div><h2 id="study-trails-heading" ref={trailsHeadingRef} tabIndex={-1}>Escolha sua trilha</h2><p className="muted">Uma sugestão para começar. Liberdade para seguir por onde quiser.</p></div><button className="button button-ghost" disabled={!canSave} onClick={() => selectTrail(null)} aria-pressed={!selectedTrail}>Ver todas <ArrowRight size={16} aria-hidden="true" /></button></div>
        <div className="study-trail-grid">
          {studies.trails.map((trail, index) => {
            const count = trail.lessonIds.filter(id => progress.completedLessons[id]).length;
            const active = selectedTrail?.id === trail.id;
            return <button key={trail.id} className={`card study-trail-card ${trail.recommended ? 'is-recommended' : ''} ${active ? 'is-selected' : ''}`} disabled={!canSave} onClick={() => selectTrail(active ? null : trail.id)} aria-pressed={active}>
              <div className="study-trail-card-top"><span className="study-icon">{trail.recommended ? <Sparkles size={23} aria-hidden="true" /> : index % 2 ? <BookOpen size={23} aria-hidden="true" /> : <Route size={23} aria-hidden="true" />}</span>{trail.recommended && <span className="badge">Comece por aqui</span>}{active && <Check size={19} aria-label="Trilha selecionada" />}</div>
              <h3>{trail.title}</h3><p className="muted">{trail.description}</p>
              <div className="study-trail-count">{trail.lessonIds.length} {trail.lessonIds.length === 1 ? 'estudo' : 'estudos'}<span>{count} {count === 1 ? 'concluído' : 'concluídos'}</span></div>
              <ProgressBar value={count} total={trail.lessonIds.length} label={`Progresso: ${trail.title}`} />
            </button>;
          })}
        </div>
      </section>

      <section className="study-library" aria-labelledby="study-library-heading">
        <div className="study-library-toolbar">
          <div><span className="eyebrow">Biblioteca de estudos</span><h2 id="study-library-heading" ref={resultsHeadingRef} tabIndex={-1} aria-describedby={resultCountId}>{selectedTrail ? selectedTrail.title : 'Encontre seu próximo assunto'}</h2></div>
          <button className="button button-secondary study-change-trail" onClick={() => revealContent(() => trailsHeadingRef.current)}><Route size={16} aria-hidden="true" /> Trocar trilha</button>
          <div className="study-search"><Search size={18} aria-hidden="true" /><label htmlFor={searchId} className="study-sr-only">Buscar assunto nos estudos</label><input id={searchId} type="search" placeholder="Buscar um assunto…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); revealContent(() => resultsHeadingRef.current); } }} /></div>
        </div>
        <p className="study-result-count muted" role="status" id={resultCountId}>{visibleLessons.length} {visibleLessons.length === 1 ? 'estudo disponível' : 'estudos disponíveis'}{query.trim() ? ` para “${query.trim()}”` : ''}</p>
        <div className="study-lesson-grid">
          {visibleLessons.map(lesson => {
            const complete = !!progress.completedLessons[lesson.id];
            const trail = studies.trails.find(item => item.id === lesson.trailId);
            const source = studies.sources.find(item => item.id === lesson.sourceId);
            return <button key={lesson.id} className={`card study-lesson-card ${complete ? 'is-complete' : ''}`} onClick={() => openLesson(lesson.id)}>
              <div className="study-lesson-card-top"><span className="study-card-trail">{trail?.title ?? 'Estudo'}</span>{complete ? <CheckCircle2 size={20} aria-label="Leitura concluída" /> : <BookOpen size={20} aria-hidden="true" />}</div>
              <h3>{lesson.title}</h3><p className="muted">{lesson.description}</p>
              <div className="study-lesson-card-source"><FileText size={14} aria-hidden="true" /><span>{source?.title ?? 'Material enviado'} · p. {lesson.startPage}{lesson.startPage !== lesson.endPage ? `–${lesson.endPage}` : ''}</span></div>
              <div className="study-lesson-card-footer"><span>{complete ? 'Ler novamente' : 'Explorar estudo'}</span><ChevronRight size={18} aria-hidden="true" /></div>
            </button>;
          })}
        </div>
        {visibleLessons.length === 0 && <div className="empty-state"><Search size={30} aria-hidden="true" /><h3>Nenhum estudo encontrado</h3><p className="muted">Tente outro assunto ou veja todas as trilhas.</p><button className="button button-secondary" onClick={() => { setQuery(''); selectTrail(null); }}>Limpar filtros</button></div>}
      </section>
      <div className="study-library-note"><FileText size={19} aria-hidden="true" /><p>Todos os estudos partem dos PDFs enviados. Cada assunto traz a referência das páginas para você consultar a fonte.</p></div>
    </div>
  );
}

export function QuizPage({ studies, bibleQuizzes = [], progress, selectedQuizId, onSelectQuiz, onPatch, onSpeak, canSave = true }: QuizProps) {
  const [query, setQuery] = useState('');
  const [trailFilter, setTrailFilter] = useState('');
  const [category, setCategory] = useState<'bible' | 'study'>('study');
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | ''>('');
  const catalogHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const filterStartRef = useRef<HTMLDivElement>(null);
  const previousQuizIdRef = useRef<string | null>(null);
  const previousCategoryRef = useRef<'bible' | 'study'>('study');
  const searchId = useId();
  const resultsHeadingId = useId();
  const resultCountId = useId();
  const allQuizzes = useMemo(() => [...studies.quizzes, ...bibleQuizzes], [studies.quizzes, bibleQuizzes]);
  const selectedQuiz = allQuizzes.find(quiz => quiz.id === selectedQuizId);
  useEffect(() => {
    if (selectedQuiz) previousCategoryRef.current = selectedQuiz.category === 'bible' || bibleQuizzes.some(quiz => quiz.id === selectedQuiz.id) ? 'bible' : 'study';
    if (previousQuizIdRef.current && !selectedQuiz) {
      setCategory(previousCategoryRef.current);
      revealContent(() => resultsHeadingRef.current);
    }
    previousQuizIdRef.current = selectedQuiz?.id ?? null;
  }, [selectedQuiz?.id, bibleQuizzes]);

  const filteredQuizzes = useMemo(() => {
    const search = normalize(query.trim());
    const items = category === 'bible' ? bibleQuizzes : studies.quizzes;
    return items.filter(quiz => {
      const lesson = studies.lessons.find(item => item.id === quiz.lessonId);
      return quiz.questions.length > 0
        && (category !== 'study' || !trailFilter || lesson?.trailId === trailFilter)
        && (category !== 'bible' || !difficultyFilter || quiz.difficulty === difficultyFilter)
        && (!search || normalize(`${quiz.title} ${quiz.description ?? ''} ${lesson?.title ?? ''} ${quiz.questions.map(question => question.source.bookName ?? '').join(' ')}`).includes(search));
    });
  }, [studies, bibleQuizzes, query, trailFilter, category, difficultyFilter]);

  const selectCategory = (next: 'bible' | 'study') => {
    setCategory(next); setQuery(''); setTrailFilter(''); setDifficultyFilter('');
    revealContent(() => resultsHeadingRef.current);
  };
  const resultsTitle = category === 'bible'
    ? `Bíblia · ${difficultyFilter ? difficultyLabels[difficultyFilter] : 'Todos os níveis'}`
    : trailFilter ? studies.trails.find(trail => trail.id === trailFilter)?.title ?? 'Estudos dos PDFs' : 'Estudos dos PDFs · Todas as trilhas';

  if (!selectedQuiz || selectedQuiz.questions.length === 0) {
    const attemptedQuizIds = new Set(progress.quizAttempts.filter(attempt => allQuizzes.some(quiz => quiz.id === attempt.quizId)).map(attempt => attempt.quizId));
    const bibleCount = bibleQuizzes.reduce((total, quiz) => total + quiz.questions.length, 0);
    const studyCount = studies.quizzes.reduce((total, quiz) => total + quiz.questions.length, 0);
    return (
      <div className="quizzes-page">
        <header className="page-header study-page-header"><div><span className="eyebrow">Praticar para aprender</span><h1 ref={catalogHeadingRef} tabIndex={-1}>O que você descobriu?</h1><p className="muted">Escolha perguntas da Bíblia ou dos estudos, com respostas explicadas e fontes para conferir.</p></div><div className="study-total-counter"><Trophy size={24} aria-hidden="true" /><div><strong>{attemptedQuizIds.size}<span> / {allQuizzes.filter(quiz => quiz.questions.length > 0).length}</span></strong><small>quizzes experimentados</small></div></div></header>
        <div className="quiz-category-choices" ref={filterStartRef} role="group" aria-label="Escolher conteúdo do quiz">
          <button type="button" className={`quiz-category-choice ${category === 'bible' ? 'is-active' : ''}`} aria-pressed={category === 'bible'} onClick={() => selectCategory('bible')}><BookOpen size={25} aria-hidden="true" /><span><strong>Bíblia</strong><small>{bibleCount} perguntas · fácil, médio e difícil</small></span><ChevronRight size={19} aria-hidden="true" /></button>
          <button type="button" className={`quiz-category-choice ${category === 'study' ? 'is-active' : ''}`} aria-pressed={category === 'study'} onClick={() => selectCategory('study')}><FileText size={25} aria-hidden="true" /><span><strong>Estudos dos PDFs</strong><small>{studyCount} perguntas · por assunto</small></span><ChevronRight size={19} aria-hidden="true" /></button>
        </div>
        <div className="quiz-welcome card"><span className="study-icon"><CircleHelp size={26} aria-hidden="true" /></span><div><h2>{category === 'bible' ? 'O que você lembra da Bíblia?' : 'Aqui, errar também faz parte.'}</h2><p className="muted">{category === 'bible' ? 'Comece no nível que preferir. Cada resposta mostra o trecho bíblico e a página do PDF para você conferir.' : 'Sem cronômetro. Cada resposta é uma oportunidade de voltar ao material e entender um pouco mais.'}</p></div><span className="badge">No seu ritmo</span></div>
        <div className="quiz-library-controls" ref={filtersRef} role="group" aria-label="Filtros do quiz" tabIndex={-1}><div className="study-search"><Search size={18} aria-hidden="true" /><label className="study-sr-only" htmlFor={searchId}>Buscar quiz por assunto</label><input id={searchId} type="search" placeholder={category === 'bible' ? 'Buscar um tema ou livro…' : 'Buscar um quiz…'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); revealContent(() => resultsHeadingRef.current); } }} /></div>{category === 'bible' ? <label className="quiz-trail-filter">Nível de dificuldade<select value={difficultyFilter} onChange={event => { setDifficultyFilter(event.target.value as Difficulty | ''); revealContent(() => resultsHeadingRef.current); }}><option value="">Todos os níveis</option><option value="easy">Fácil</option><option value="medium">Médio</option><option value="hard">Difícil</option></select></label> : <label className="quiz-trail-filter">Trilha<select value={trailFilter} onChange={event => { setTrailFilter(event.target.value); revealContent(() => resultsHeadingRef.current); }}><option value="">Todas as trilhas</option>{studies.trails.map(trail => <option key={trail.id} value={trail.id}>{trail.title}</option>)}</select></label>}</div>
        <section className="quiz-results" aria-labelledby={resultsHeadingId}>
        <div className="quiz-results-header"><div><span className="eyebrow">Escolha uma rodada</span><h2 id={resultsHeadingId} className="quiz-results-heading" ref={resultsHeadingRef} tabIndex={-1} aria-describedby={resultCountId}>{resultsTitle}</h2></div><button type="button" className="button button-secondary quiz-show-filters" onClick={() => revealContent(() => filtersRef.current?.querySelector<HTMLSelectElement>('select') ?? filtersRef.current, () => filterStartRef.current ?? filtersRef.current)}><Search size={16} aria-hidden="true" /> Ver filtros</button></div>
        <p className="study-result-count muted" role="status" id={resultCountId}>{filteredQuizzes.length} {filteredQuizzes.length === 1 ? 'quiz disponível' : 'quizzes disponíveis'} · {filteredQuizzes.reduce((total, quiz) => total + quiz.questions.length, 0)} perguntas</p>
        <div className="study-lesson-grid quiz-catalog-grid">
          {filteredQuizzes.map(quiz => {
            const lesson = studies.lessons.find(item => item.id === quiz.lessonId);
            const trail = studies.trails.find(item => item.id === lesson?.trailId);
            const attempts = progress.quizAttempts.filter(attempt => attempt.quizId === quiz.id);
            const currentAttempts = attempts.filter(attempt => currentQuizAttempt(quiz, attempt));
            const best = currentAttempts.length ? currentAttempts.reduce((previous, current) => current.score / current.total > previous.score / previous.total ? current : previous) : null;
            return <article className={`quiz-catalog-item ${attempts.length ? 'has-history' : ''}`} key={quiz.id}>
              <button className="card study-lesson-card quiz-catalog-card" onClick={() => onSelectQuiz(quiz.id)}>
                <div className="study-lesson-card-top"><span className="study-card-trail">{category === 'bible' ? 'Bíblia NVI' : trail?.title ?? 'Quiz por assunto'}</span><CircleHelp size={21} aria-hidden="true" /></div>
                <h2>{quiz.title}</h2>
                <div className="quiz-card-difficulty">{quiz.difficulty && <span className={`quiz-difficulty quiz-difficulty-${quiz.difficulty}`}>{difficultyLabels[quiz.difficulty]}</span>}<span className="muted">{quiz.questions.length} perguntas · sem cronômetro</span></div>
                {quiz.description && <p className="muted quiz-card-description">{quiz.description}</p>}
                <div className="quiz-best-score">{best ? <><Trophy size={16} aria-hidden="true" /><span>Melhor resultado: {best.score} de {best.total}</span></> : <><BookOpen size={16} aria-hidden="true" /><span>{category === 'bible' ? 'Resposta com referência bíblica' : 'Baseado no material de estudo'}</span></>}</div>
                <div className="study-lesson-card-footer"><span>{currentAttempts.length ? 'Tentar novamente' : 'Começar quiz'}</span><ArrowRight size={18} aria-hidden="true" /></div>
              </button>
              {attempts.length > 0 && <QuizHistory quiz={quiz} attempts={attempts} studies={studies} />}
            </article>;
          })}
        </div>
        {filteredQuizzes.length === 0 && <div className="empty-state"><CircleHelp size={30} aria-hidden="true" /><h2>Nenhum quiz encontrado</h2><p className="muted">Tente outro assunto ou veja todos os níveis.</p><button className="button button-secondary" onClick={() => { setQuery(''); setTrailFilter(''); setDifficultyFilter(''); revealContent(() => resultsHeadingRef.current); }}>Limpar filtros</button></div>}
        </section>
      </div>
    );
  }

  return <QuizSession key={selectedQuiz.id} selectedQuiz={selectedQuiz} studies={studies} onSelectQuiz={onSelectQuiz} onPatch={onPatch} onSpeak={onSpeak} canSave={canSave} />;
}

function QuizSession({ selectedQuiz, studies, onSelectQuiz, onPatch, onSpeak, canSave = true }: { selectedQuiz: Quiz; studies: Studies; onSelectQuiz: (id: string) => void; onPatch: (patch: StatePatch) => void; onSpeak: (text: string) => void; canSave?: boolean }) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [showResult, setShowResult] = useState(false);
  const submittedRef = useRef(false);
  const attemptIdRef = useRef(createAttemptId());
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const sessionStartRef = useRef<HTMLDivElement>(null);
  const questionId = useId();

  function resetQuiz() {
    setQuestionIndex(0); setSelectedChoice(null); setConfirmed(false); setAnswers([]); setShowResult(false);
    submittedRef.current = false; attemptIdRef.current = createAttemptId();
  }

  useEffect(() => { revealContent(() => questionHeading.current, () => sessionStartRef.current); }, [questionIndex, showResult]);

  const lesson = studies.lessons.find(item => item.id === selectedQuiz.lessonId);
  const question = selectedQuiz.questions[questionIndex];
  const total = selectedQuiz.questions.length;
  const score = selectedQuiz.questions.reduce((value, item, index) => value + (answers[index] === item.answerIndex ? 1 : 0), 0);

  const confirmAnswer = () => {
    if (selectedChoice === null || confirmed) return;
    setAnswers(previous => { const next = [...previous]; next[questionIndex] = selectedChoice; return next; });
    setConfirmed(true);
  };
  const advance = () => {
    if (!confirmed) return;
    if (questionIndex < total - 1) {
      setQuestionIndex(index => index + 1); setSelectedChoice(null); setConfirmed(false);
      return;
    }
    if (!canSave) return;
    if (!submittedRef.current) {
      submittedRef.current = true;
      onPatch({ quizAttempts: [{ id: attemptIdRef.current, quizId: selectedQuiz.id, quizRevision: selectedQuiz.revision ?? 1, score, total, answers: [...answers], createdAt: new Date().toISOString() }] });
    }
    setShowResult(true);
  };

  return (
    <div className="quiz-play-page" ref={sessionStartRef}>
      <button className="button button-ghost study-back" onClick={() => onSelectQuiz('')}><ArrowLeft size={17} aria-hidden="true" /> Todos os quizzes</button>
      <div className="quiz-play-layout">
        <article className="card quiz-play-card">
          <div className="quiz-play-header"><div><span className="eyebrow">Quiz · {selectedQuiz.category === 'bible' ? 'Bíblia NVI' : lesson?.title ?? 'Estudo bíblico'}</span><p>{selectedQuiz.title}</p></div><span className="badge"><Headphones size={13} aria-hidden="true" /> Sem pressa</span></div>
          {showResult ? (
            <div className="quiz-result">
              <span className="quiz-result-icon"><Trophy size={38} aria-hidden="true" /></span>
              <span className="eyebrow">Uma nova descoberta</span>
              <h1 ref={questionHeading} tabIndex={-1}>{score === total ? 'Você se saiu muito bem!' : 'Continue aprendendo.'}</h1>
              <p className="quiz-score"><strong>{score}</strong><span> / {total}</span></p>
              <p className="muted">{score === total ? 'Você acertou todas as perguntas deste assunto.' : `Você acertou ${score} de ${total} ${total === 1 ? 'pergunta' : 'perguntas'}. Revise as explicações e tente novamente quando quiser.`}</p>
              <div className="quiz-result-actions"><button className="button button-primary" onClick={resetQuiz}><RotateCcw size={17} aria-hidden="true" /> Tentar novamente</button><button className="button button-secondary" onClick={() => onSelectQuiz('')}>Explorar outros quizzes <ArrowRight size={17} aria-hidden="true" /></button></div>
              <div className="quiz-result-review"><h2>Vamos revisar?</h2><AnswerReview quiz={selectedQuiz} answers={answers} studies={studies} /></div>
            </div>
          ) : (
            <>
              {question.difficulty && <span className={`quiz-difficulty quiz-difficulty-${question.difficulty}`}>{difficultyLabels[question.difficulty]}</span>}
              <div className="quiz-question-progress"><span>Pergunta {questionIndex + 1} de {total}</span><ProgressBar value={questionIndex + (confirmed ? 1 : 0)} total={total} label="Progresso deste quiz" /></div>
              <div className="quiz-question-title"><h1 id={questionId} ref={questionHeading} tabIndex={-1}>{question.prompt}</h1><button className="button button-ghost quiz-listen" aria-label="Ouvir pergunta e alternativas" onClick={() => onSpeak([question.prompt, ...question.choices.map((choice, index) => `${String.fromCharCode(65 + index)}. ${choice}`), ...(confirmed ? [questionExplanationSpeech(question, studies)] : [])].join('\n'))}><Volume2 size={21} aria-hidden="true" /></button></div>
              <fieldset className="quiz-options" aria-labelledby={questionId}><legend className="study-sr-only">Escolha uma resposta</legend>{question.choices.map((choice, index) => {
                const isSelected = selectedChoice === index;
                const isCorrect = confirmed && index === question.answerIndex;
                const isIncorrect = confirmed && isSelected && index !== question.answerIndex;
                return <label className={`quiz-choice ${isSelected ? 'is-selected' : ''} ${isCorrect ? 'is-correct' : ''} ${isIncorrect ? 'is-incorrect' : ''} ${confirmed ? 'is-locked' : ''}`} key={index}><input type="radio" name={`${questionId}-choice`} value={index} checked={isSelected} disabled={confirmed} onChange={() => setSelectedChoice(index)} /><span className="quiz-choice-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span><span className="quiz-choice-text">{choice}</span>{isCorrect && <CheckCircle2 size={19} aria-label="Resposta correta" />}{isIncorrect && <span className="quiz-answer-label">Sua resposta</span>}</label>;
              })}</fieldset>
              <div className="quiz-feedback-slot" aria-live="polite" aria-atomic="true">{confirmed && <section className={`quiz-feedback ${selectedChoice === question.answerIndex ? 'is-correct' : 'is-incorrect'}`}><h2>{selectedChoice === question.answerIndex ? <><CheckCircle2 size={19} aria-hidden="true" /> Isso mesmo!</> : <><CircleHelp size={19} aria-hidden="true" /> Vamos entender juntos</>}</h2><p><strong>Resposta correta:</strong> {question.choices[question.answerIndex]}</p><QuizExplanation question={question} studies={studies} /><button className="button button-ghost" onClick={() => onSpeak(questionExplanationSpeech(question, studies))}><Volume2 size={17} aria-hidden="true" /> Ouvir explicação da resposta</button></section>}</div>
              <div className="quiz-action-row"><span className="muted">{!canSave && confirmed && questionIndex === total - 1 ? 'Conferindo sua sessão antes de salvar o resultado…' : confirmed ? 'Leia a explicação antes de continuar.' : 'Escolha uma alternativa para continuar.'}</span>{confirmed ? <button className="button button-primary" disabled={!canSave && questionIndex === total - 1} onClick={advance}>{questionIndex === total - 1 ? 'Ver resultado' : 'Próxima pergunta'} <ArrowRight size={17} aria-hidden="true" /></button> : <button className="button button-primary" onClick={confirmAnswer} disabled={selectedChoice === null}>Confirmar resposta <Check size={17} aria-hidden="true" /></button>}</div>
            </>
          )}
        </article>
        <aside className="quiz-help-sidebar"><div className="card study-side-card"><span className="study-icon"><BookOpen size={23} aria-hidden="true" /></span><h2>Aprender leva tempo.</h2><p className="muted">Leia com calma. Você pode ouvir a pergunta, consultar a fonte depois de responder e repetir o quiz.</p><ul><li>Sem limite de tempo</li><li>Explicação em cada resposta</li><li>Progresso salvo ao concluir</li></ul></div></aside>
      </div>
    </div>
  );
}
