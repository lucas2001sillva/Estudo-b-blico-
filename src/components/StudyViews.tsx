import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight,
  CircleHelp, FileText, Headphones, RotateCcw, Route, Search, Sparkles,
  Trophy, Volume2,
} from 'lucide-react';
import type { Lesson, ProgressState, Quiz, QuizAttempt, StatePatch, Studies, StudySection } from '../types';
import { StudyVisual } from './StudyVisual';
import '../styles/studies.css';

interface SharedProps {
  studies: Studies;
  progress: ProgressState;
  onPatch: (patch: StatePatch) => void;
  onSpeak: (text: string) => void;
}

interface StudiesProps extends SharedProps {
  onStartQuiz: (quizId: string) => void;
}

interface QuizProps extends SharedProps {
  selectedQuizId: string | null;
  onSelectQuiz: (id: string) => void;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const sourceUrl = (id: string, page: number) => `/api/sources/${encodeURIComponent(id)}#page=${page}`;
const createAttemptId = () => globalThis.crypto?.randomUUID?.() ?? `quiz-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

function SourceLink({ id, page, title, compact = false }: { id: string; page: number; title?: string; compact?: boolean }) {
  return (
    <a className="study-source-link" href={sourceUrl(id, page)} target="_blank" rel="noopener noreferrer">
      <FileText size={15} aria-hidden="true" />
      {!compact && (title ? `${title} · ` : 'PDF de consulta · ')}p. {page}
      <span className="study-sr-only"> — abre o PDF em outra aba</span>
    </a>
  );
}

function sectionReadingText(section: StudySection) {
  // A supplied reading is complete and already includes any verified figure descriptions.
  // Never append extracted body text to it, especially when an empty reading was deliberate.
  if (section.readingText !== undefined) return section.readingText.trim();
  if (section.reviewStatus === 'needs-review') return '';
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

function AnswerReview({ quiz, answers }: { quiz: Quiz; answers: number[] }) {
  return <>{quiz.questions.map((item, index) => <section className={`quiz-review-item ${answers[index] === item.answerIndex ? 'is-correct' : ''}`} key={item.id}>
    <h3><span>{index + 1}.</span> {item.prompt}</h3>
    <p><strong>Sua resposta:</strong> {item.choices[answers[index]] ?? 'Não respondida'} {answers[index] === item.answerIndex && <Check size={16} aria-label="Correta" />}</p>
    {answers[index] !== item.answerIndex && <p><strong>Resposta correta:</strong> {item.choices[item.answerIndex]}</p>}
    <p className="muted">{item.explanation}</p><SourceLink id={item.source.sourceId} page={item.source.page} />
  </section>)}</>;
}

function QuizHistory({ quiz, attempts }: { quiz: Quiz; attempts: QuizAttempt[] }) {
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
      {sorted.slice(0, limit).map(attempt => <details className="quiz-history-attempt" key={attempt.id}>
        <summary><strong>{attempt.score} de {attempt.total}</strong><time dateTime={attempt.createdAt}>{displayDate(attempt.createdAt)}</time><ChevronRight size={15} aria-hidden="true" /></summary>
        <div className="quiz-history-answers">{attempt.answers?.length === quiz.questions.length ? <AnswerReview quiz={quiz} answers={attempt.answers} /> : <p className="muted">Esta tentativa registra apenas a pontuação.</p>}</div>
      </details>)}
      {sorted.length > limit && <button className="button button-ghost quiz-show-history" onClick={() => setLimit(value => value + 5)}>Mostrar mais tentativas <span>({sorted.length - limit})</span></button>}
    </div>}
  </details>;
}

export function StudiesPage({ studies, progress, onPatch, onStartQuiz, onSpeak }: StudiesProps) {
  const [query, setQuery] = useState('');
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousLessonIdRef = useRef<string | null>(null);
  const searchId = useId();
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
    if (selectedLessonId) headingRef.current?.focus();
    else if (previousLessonIdRef.current) libraryHeadingRef.current?.focus();
    previousLessonIdRef.current = selectedLessonId;
  }, [selectedLessonId]);

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
      <div className="study-reader-page">
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
              <p>Conteúdo organizado a partir dos arquivos enviados, com os quadros e diagramas preservados em imagens. Amplie para ver os detalhes e consulte o PDF para conferir a fonte.</p>
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
                      <p>A transcrição desta página ainda precisa de conferência. {section.visuals?.length ? 'A imagem preserva a organização do material original; amplie para consultar os detalhes.' : 'Consulte a página no PDF para conferir as informações.'}</p>
                    </div>
                  ) : (
                    <>
                      {(section.reviewStatus === 'ocr-reviewed' || section.reviewStatus === 'ocr-extracted') && <p className="study-transcription-note">Texto convertido de imagem; consulte a fonte em caso de dúvida. Esta conversão não substitui o PDF de consulta.</p>}
                      {body.trim() && <div className="study-section-body">
                        {body.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                      </div>}
                    </>
                  )}
                  {section.visuals?.map(visual => <StudyVisual key={visual.id} visual={visual} theme={progress.preferences.theme} onSpeak={onSpeak} />)}
                  {section.reviewStatus !== 'needs-review' && section.bodyAfterVisuals?.trim() && <div className="study-section-body">
                    {section.bodyAfterVisuals.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                  </div>}
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
              <button className={`button ${isComplete ? 'button-secondary' : 'button-primary'}`} onClick={() => onPatch({ completedLessons: { [selectedLesson.id]: !isComplete } })} aria-pressed={isComplete}>
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
        <div className="study-section-heading"><div><h2 id="study-trails-heading">Escolha sua trilha</h2><p className="muted">Uma sugestão para começar. Liberdade para seguir por onde quiser.</p></div><button className="button button-ghost" onClick={() => onPatch({ selectedTrailId: null })} aria-pressed={!selectedTrail}>Ver todas <ArrowRight size={16} aria-hidden="true" /></button></div>
        <div className="study-trail-grid">
          {studies.trails.map((trail, index) => {
            const count = trail.lessonIds.filter(id => progress.completedLessons[id]).length;
            const active = selectedTrail?.id === trail.id;
            return <button key={trail.id} className={`card study-trail-card ${trail.recommended ? 'is-recommended' : ''} ${active ? 'is-selected' : ''}`} onClick={() => onPatch({ selectedTrailId: active ? null : trail.id })} aria-pressed={active}>
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
          <div><span className="eyebrow">Biblioteca de estudos</span><h2 id="study-library-heading">{selectedTrail ? selectedTrail.title : 'Encontre seu próximo assunto'}</h2></div>
          <div className="study-search"><Search size={18} aria-hidden="true" /><label htmlFor={searchId} className="study-sr-only">Buscar assunto nos estudos</label><input id={searchId} type="search" placeholder="Buscar um assunto…" value={query} onChange={event => setQuery(event.target.value)} /></div>
        </div>
        <p className="study-result-count muted" role="status">{visibleLessons.length} {visibleLessons.length === 1 ? 'estudo disponível' : 'estudos disponíveis'}{query.trim() ? ` para “${query.trim()}”` : ''}</p>
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
        {visibleLessons.length === 0 && <div className="empty-state"><Search size={30} aria-hidden="true" /><h3>Nenhum estudo encontrado</h3><p className="muted">Tente outro assunto ou veja todas as trilhas.</p><button className="button button-secondary" onClick={() => { setQuery(''); onPatch({ selectedTrailId: null }); }}>Limpar filtros</button></div>}
      </section>
      <div className="study-library-note"><FileText size={19} aria-hidden="true" /><p>Todos os estudos partem dos PDFs enviados. Cada assunto traz a referência das páginas para você consultar a fonte.</p></div>
    </div>
  );
}

export function QuizPage({ studies, progress, selectedQuizId, onSelectQuiz, onPatch, onSpeak }: QuizProps) {
  const [query, setQuery] = useState('');
  const [trailFilter, setTrailFilter] = useState('');
  const catalogHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousQuizIdRef = useRef<string | null>(null);
  const searchId = useId();
  const selectedQuiz = studies.quizzes.find(quiz => quiz.id === selectedQuizId);
  useEffect(() => {
    if (previousQuizIdRef.current && !selectedQuiz) catalogHeadingRef.current?.focus();
    previousQuizIdRef.current = selectedQuiz?.id ?? null;
  }, [selectedQuiz?.id]);

  const filteredQuizzes = useMemo(() => {
    const search = normalize(query.trim());
    return studies.quizzes.filter(quiz => {
      const lesson = studies.lessons.find(item => item.id === quiz.lessonId);
      return quiz.questions.length > 0 && (!trailFilter || lesson?.trailId === trailFilter) && (!search || normalize(`${quiz.title} ${lesson?.title ?? ''}`).includes(search));
    });
  }, [studies, query, trailFilter]);

  if (!selectedQuiz || selectedQuiz.questions.length === 0) {
    const attemptedQuizIds = new Set(progress.quizAttempts.filter(attempt => studies.quizzes.some(quiz => quiz.id === attempt.quizId && quiz.questions.length > 0)).map(attempt => attempt.quizId));
    return (
      <div className="quizzes-page">
        <header className="page-header study-page-header"><div><span className="eyebrow">Praticar para aprender</span><h1 ref={catalogHeadingRef} tabIndex={-1}>O que você descobriu?</h1><p className="muted">Perguntas por assunto, respostas explicadas e quantas tentativas você quiser.</p></div><div className="study-total-counter"><Trophy size={24} aria-hidden="true" /><div><strong>{attemptedQuizIds.size}<span> / {studies.quizzes.filter(quiz => quiz.questions.length > 0).length}</span></strong><small>quizzes experimentados</small></div></div></header>
        <div className="quiz-welcome card"><span className="study-icon"><CircleHelp size={26} aria-hidden="true" /></span><div><h2>Aqui, errar também faz parte.</h2><p className="muted">Sem cronômetro. Cada resposta é uma oportunidade de voltar ao material e entender um pouco mais.</p></div><span className="badge">No seu ritmo</span></div>
        <div className="quiz-library-controls"><div className="study-search"><Search size={18} aria-hidden="true" /><label className="study-sr-only" htmlFor={searchId}>Buscar quiz por assunto</label><input id={searchId} type="search" placeholder="Buscar um quiz…" value={query} onChange={event => setQuery(event.target.value)} /></div><label className="quiz-trail-filter">Trilha<select value={trailFilter} onChange={event => setTrailFilter(event.target.value)}><option value="">Todas as trilhas</option>{studies.trails.map(trail => <option key={trail.id} value={trail.id}>{trail.title}</option>)}</select></label></div>
        <p className="study-result-count muted" role="status">{filteredQuizzes.length} {filteredQuizzes.length === 1 ? 'quiz disponível' : 'quizzes disponíveis'}</p>
        <div className="study-lesson-grid quiz-catalog-grid">
          {filteredQuizzes.map(quiz => {
            const lesson = studies.lessons.find(item => item.id === quiz.lessonId);
            const trail = studies.trails.find(item => item.id === lesson?.trailId);
            const attempts = progress.quizAttempts.filter(attempt => attempt.quizId === quiz.id);
            const best = attempts.length ? attempts.reduce((previous, current) => current.score / current.total > previous.score / previous.total ? current : previous) : null;
            return <article className={`quiz-catalog-item ${attempts.length ? 'has-history' : ''}`} key={quiz.id}><button className="card study-lesson-card quiz-catalog-card" onClick={() => onSelectQuiz(quiz.id)}><div className="study-lesson-card-top"><span className="study-card-trail">{trail?.title ?? 'Quiz por assunto'}</span><CircleHelp size={21} aria-hidden="true" /></div><h2>{quiz.title}</h2><p className="muted">{quiz.questions.length} {quiz.questions.length === 1 ? 'pergunta' : 'perguntas'} · sem cronômetro</p><div className="quiz-best-score">{best ? <><Trophy size={16} aria-hidden="true" /><span>Melhor resultado: {best.score} de {best.total}</span></> : <><BookOpen size={16} aria-hidden="true" /><span>Baseado no material de estudo</span></>}</div><div className="study-lesson-card-footer"><span>{attempts.length ? 'Tentar novamente' : 'Começar quiz'}</span><ArrowRight size={18} aria-hidden="true" /></div></button>{attempts.length > 0 && <QuizHistory quiz={quiz} attempts={attempts} />}</article>;
          })}
        </div>
        {filteredQuizzes.length === 0 && <div className="empty-state"><CircleHelp size={30} aria-hidden="true" /><h2>Nenhum quiz encontrado</h2><p className="muted">Tente outro assunto ou selecione todas as trilhas.</p><button className="button button-secondary" onClick={() => { setQuery(''); setTrailFilter(''); }}>Limpar filtros</button></div>}
      </div>
    );
  }

  return <QuizSession key={selectedQuiz.id} selectedQuiz={selectedQuiz} studies={studies} onSelectQuiz={onSelectQuiz} onPatch={onPatch} onSpeak={onSpeak} />;
}

function QuizSession({ selectedQuiz, studies, onSelectQuiz, onPatch, onSpeak }: { selectedQuiz: Quiz; studies: Studies; onSelectQuiz: (id: string) => void; onPatch: (patch: StatePatch) => void; onSpeak: (text: string) => void }) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [showResult, setShowResult] = useState(false);
  const submittedRef = useRef(false);
  const attemptIdRef = useRef(createAttemptId());
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const questionId = useId();

  function resetQuiz() {
    setQuestionIndex(0); setSelectedChoice(null); setConfirmed(false); setAnswers([]); setShowResult(false);
    submittedRef.current = false; attemptIdRef.current = createAttemptId();
  }

  useEffect(() => { questionHeading.current?.focus(); }, [questionIndex, showResult]);

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
    if (!submittedRef.current) {
      submittedRef.current = true;
      onPatch({ quizAttempts: [{ id: attemptIdRef.current, quizId: selectedQuiz.id, score, total, answers: [...answers], createdAt: new Date().toISOString() }] });
    }
    setShowResult(true);
  };

  return (
    <div className="quiz-play-page">
      <button className="button button-ghost study-back" onClick={() => onSelectQuiz('')}><ArrowLeft size={17} aria-hidden="true" /> Todos os quizzes</button>
      <div className="quiz-play-layout">
        <article className="card quiz-play-card">
          <div className="quiz-play-header"><div><span className="eyebrow">Quiz · {lesson?.title ?? 'Estudo bíblico'}</span><p>{selectedQuiz.title}</p></div><span className="badge"><Headphones size={13} aria-hidden="true" /> Sem pressa</span></div>
          {showResult ? (
            <div className="quiz-result">
              <span className="quiz-result-icon"><Trophy size={38} aria-hidden="true" /></span>
              <span className="eyebrow">Uma nova descoberta</span>
              <h1 ref={questionHeading} tabIndex={-1}>{score === total ? 'Você se saiu muito bem!' : 'Continue aprendendo.'}</h1>
              <p className="quiz-score"><strong>{score}</strong><span> / {total}</span></p>
              <p className="muted">{score === total ? 'Você acertou todas as perguntas deste assunto.' : `Você acertou ${score} de ${total} ${total === 1 ? 'pergunta' : 'perguntas'}. Revise as explicações e tente novamente quando quiser.`}</p>
              <div className="quiz-result-actions"><button className="button button-primary" onClick={resetQuiz}><RotateCcw size={17} aria-hidden="true" /> Tentar novamente</button><button className="button button-secondary" onClick={() => onSelectQuiz('')}>Explorar outros quizzes <ArrowRight size={17} aria-hidden="true" /></button></div>
              <div className="quiz-result-review"><h2>Vamos revisar?</h2><AnswerReview quiz={selectedQuiz} answers={answers} /></div>
            </div>
          ) : (
            <>
              <div className="quiz-question-progress"><span>Pergunta {questionIndex + 1} de {total}</span><ProgressBar value={questionIndex + (confirmed ? 1 : 0)} total={total} label="Progresso deste quiz" /></div>
              <div className="quiz-question-title"><h1 id={questionId} ref={questionHeading} tabIndex={-1}>{question.prompt}</h1><button className="button button-ghost quiz-listen" aria-label="Ouvir pergunta e alternativas" onClick={() => onSpeak([question.prompt, ...question.choices.map((choice, index) => `${String.fromCharCode(65 + index)}. ${choice}`), ...(confirmed ? [question.explanation] : [])].join('\n'))}><Volume2 size={21} aria-hidden="true" /></button></div>
              <fieldset className="quiz-options" aria-labelledby={questionId}><legend className="study-sr-only">Escolha uma resposta</legend>{question.choices.map((choice, index) => {
                const isSelected = selectedChoice === index;
                const isCorrect = confirmed && index === question.answerIndex;
                const isIncorrect = confirmed && isSelected && index !== question.answerIndex;
                return <label className={`quiz-choice ${isSelected ? 'is-selected' : ''} ${isCorrect ? 'is-correct' : ''} ${isIncorrect ? 'is-incorrect' : ''} ${confirmed ? 'is-locked' : ''}`} key={index}><input type="radio" name={`${questionId}-choice`} value={index} checked={isSelected} disabled={confirmed} onChange={() => setSelectedChoice(index)} /><span className="quiz-choice-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span><span className="quiz-choice-text">{choice}</span>{isCorrect && <CheckCircle2 size={19} aria-label="Resposta correta" />}{isIncorrect && <span className="quiz-answer-label">Sua resposta</span>}</label>;
              })}</fieldset>
              <div className="quiz-feedback-slot" aria-live="polite" aria-atomic="true">{confirmed && <section className={`quiz-feedback ${selectedChoice === question.answerIndex ? 'is-correct' : 'is-incorrect'}`}><h2>{selectedChoice === question.answerIndex ? <><CheckCircle2 size={19} aria-hidden="true" /> Isso mesmo!</> : <><CircleHelp size={19} aria-hidden="true" /> Vamos entender juntos</>}</h2>{selectedChoice !== question.answerIndex && <p><strong>Resposta correta:</strong> {question.choices[question.answerIndex]}</p>}<p>{question.explanation}</p><SourceLink id={question.source.sourceId} page={question.source.page} /></section>}</div>
              <div className="quiz-action-row"><span className="muted">{confirmed ? 'Leia a explicação antes de continuar.' : 'Escolha uma alternativa para continuar.'}</span>{confirmed ? <button className="button button-primary" onClick={advance}>{questionIndex === total - 1 ? 'Ver resultado' : 'Próxima pergunta'} <ArrowRight size={17} aria-hidden="true" /></button> : <button className="button button-primary" onClick={confirmAnswer} disabled={selectedChoice === null}>Confirmar resposta <Check size={17} aria-hidden="true" /></button>}</div>
            </>
          )}
        </article>
        <aside className="quiz-help-sidebar"><div className="card study-side-card"><span className="study-icon"><BookOpen size={23} aria-hidden="true" /></span><h2>Aprender leva tempo.</h2><p className="muted">Leia com calma. Você pode ouvir a pergunta, consultar a fonte depois de responder e repetir o quiz.</p><ul><li>Sem limite de tempo</li><li>Explicação em cada resposta</li><li>Progresso salvo ao concluir</li></ul></div></aside>
      </div>
    </div>
  );
}
