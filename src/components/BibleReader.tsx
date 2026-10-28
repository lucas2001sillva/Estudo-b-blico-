import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, ExternalLink, Search, Volume2 } from 'lucide-react';
import type { Book, Chapter, ProgressState, ReadingPosition, StatePatch } from '../types';
import { request } from '../lib/store';

export function BibleReader({ books, progress, target, onNavigate, onPatch, onSpeak }: {
  books: Book[]; progress: ProgressState; target: ReadingPosition | null;
  onNavigate: (bookId: string, chapter: number, verse?: number) => void;
  onPatch: (patch: StatePatch) => void; onSpeak: (text: string) => void;
}) {
  const position = target || progress.lastReading || { bookId: books[0]?.id, chapter: 1 };
  const book = books.find(item => item.id === position.bookId) || books[0];
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [error, setError] = useState('');
  const [testament, setTestament] = useState<'all' | 'AT' | 'NT'>('all');
  const [filter, setFilter] = useState('');
  const [mobileBooks, setMobileBooks] = useState(false);
  const savedPosition = useRef('');
  const chapterNumber = Math.min(Math.max(1, position.chapter || 1), book?.chapterCount || 1);
  useEffect(() => {
    if (!book) return;
    let active = true;
    setError(''); setChapter(null);
    request<{ chapter: Chapter }>(`/bible/${book.id}/${chapterNumber}`).then(data => {
      if (!active) return;
      setChapter(data.chapter);
      const id = `${book.id}:${chapterNumber}`;
      if (savedPosition.current !== id) {
        savedPosition.current = id;
        onPatch({ lastReading: { bookId: book.id, chapter: chapterNumber } });
      }
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [book?.id, chapterNumber, onPatch]);
  useEffect(() => {
    if (chapter && position.verse) document.getElementById(`verse-${position.verse}`)?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [chapter, position.verse]);
  if (!book) return <div className="empty-state">A biblioteca ainda não está disponível.</div>;
  const key = `${book.id}:${chapterNumber}`;
  const completed = Boolean(progress.completedChapters[key]);
  const bookRead = Object.entries(progress.completedChapters).filter(([id, done]) => done && id.startsWith(`${book.id}:`)).length;
  const allRead = Object.values(progress.completedChapters).filter(Boolean).length;
  const total = books.reduce((sum, item) => sum + item.chapterCount, 0);
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const visibleBooks = books.filter(item => (testament === 'all' || item.testament === testament) && normalize(item.name).includes(normalize(filter)));
  const navigate = (id: string, number: number) => { setMobileBooks(false); onNavigate(id, number); };
  return <>
    <div className="page-header"><div><span className="eyebrow">A PALAVRA, NO SEU RITMO</span><h1>Leia a Bíblia</h1><p className="muted">Escolha um livro e encontre o seu próximo capítulo.</p></div><div className="compact-progress"><span>Bíblia completa <strong>{Math.round(allRead / total * 100)}%</strong></span><div className="progress-track" role="progressbar" aria-label="Progresso geral da Bíblia" aria-valuenow={allRead} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${allRead / total * 100}%` }} /></div><small>{allRead} de {total.toLocaleString('pt-BR')} capítulos</small></div></div>
    <button className="button button-secondary mobile-book-toggle" onClick={() => setMobileBooks(value => !value)} aria-expanded={mobileBooks}><BookOpen size={18} />Escolher livro<ChevronDown size={16} /></button>
    <div className="bible-layout">
      <aside className={`book-panel card ${mobileBooks ? 'is-open' : ''}`} aria-label="Livros da Bíblia">
        <h2>Os livros da Bíblia</h2><label className="field-search"><Search size={17} /><input aria-label="Filtrar livros" placeholder="Encontrar livro…" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        <div className="segmented" role="group" aria-label="Testamento">{(['all', 'AT', 'NT'] as const).map(value => <button key={value} className={testament === value ? 'active' : ''} aria-pressed={testament === value} onClick={() => setTestament(value)}>{value === 'all' ? 'Todos' : value}</button>)}</div>
        <div className="book-list">{visibleBooks.map(item => {
          const done = Object.entries(progress.completedChapters).filter(([id, read]) => read && id.startsWith(`${item.id}:`)).length;
          return <button key={item.id} className={`book-item ${item.id === book.id ? 'active' : ''}`} aria-current={item.id === book.id ? 'true' : undefined} onClick={() => navigate(item.id, 1)}><span>{item.name}</span>{done === item.chapterCount ? <CheckCircle2 size={15} aria-label="Livro concluído" /> : <small>{item.chapterCount}</small>}</button>;
        })}{!visibleBooks.length && <p className="muted">Nenhum livro encontrado.</p>}</div>
      </aside>
      <div className="reader-column">
        <section className="chapter-toolbar card" aria-label="Escolher capítulo">
          <div><span className="eyebrow">{book.testament === 'AT' ? 'ANTIGO TESTAMENTO' : 'NOVO TESTAMENTO'}</span><h2>{book.name}</h2></div>
          <label className="chapter-select">Capítulo<select aria-label="Capítulo" value={chapterNumber} onChange={event => navigate(book.id, Number(event.target.value))}>{Array.from({ length: book.chapterCount }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
          <div className="book-progress"><span>{bookRead} / {book.chapterCount} capítulos <strong>{Math.round(bookRead / book.chapterCount * 100)}%</strong></span><div className="progress-track" role="progressbar" aria-label={`Progresso de ${book.name}`} aria-valuenow={bookRead} aria-valuemin={0} aria-valuemax={book.chapterCount}><span style={{ width: `${bookRead / book.chapterCount * 100}%` }} /></div></div>
        </section>
        <article className="scripture card" aria-busy={!chapter && !error}>
          <div className="reader-heading"><span className="badge">NVI · TEXTO DOS ARQUIVOS ENVIADOS</span><button className="button button-ghost" disabled={!chapter} onClick={() => onSpeak(`${book.name}, capítulo ${chapterNumber}. ${chapter?.verses.map(verse => verse.text).join(' ')}`)}><Volume2 size={17} />Ouvir capítulo</button></div>
          <div data-readable><h2>{book.name} <span>{chapterNumber}</span></h2>{error ? <div className="error-box" role="alert">{error}<button className="button button-secondary" onClick={() => window.location.reload()}>Tentar novamente</button></div> : !chapter ? <p className="muted" role="status">Carregando capítulo…</p> : <div className="verses">{chapter.verses.map(verse => <p key={verse.number} id={`verse-${verse.number}`} className={position.verse === verse.number ? 'highlighted-verse' : ''}><sup aria-label={`Versículo ${verse.number}`}>{verse.number}</sup>{verse.text}</p>)}</div>}</div>
          {chapter && <a className="source-link" href={`/api/sources/${book.testament === 'AT' ? 'at' : 'nt'}#page=${chapter.sourcePages[0] || 1}`} target="_blank" rel="noreferrer"><ExternalLink size={14} />Consultar o PDF original</a>}
          <div className="chapter-completion"><button className={`button ${completed ? 'button-complete' : 'button-primary'}`} disabled={!chapter} onClick={() => onPatch({ completedChapters: { [key]: !completed } })}><Check size={18} />{completed ? 'Desfazer leitura do capítulo' : 'Marcar capítulo como lido'}</button><span className="muted" aria-live="polite">{completed ? 'Capítulo concluído. Seu progresso foi atualizado.' : 'Terminou? Marque a leitura para acompanhar seu caminho.'}</span></div>
        </article>
        <div className="chapter-navigation"><button className="button button-secondary" disabled={chapterNumber <= 1} onClick={() => navigate(book.id, chapterNumber - 1)}><ArrowLeft size={17} />Capítulo anterior</button><span className="muted">{chapterNumber} de {book.chapterCount}</span><button className="button button-primary" disabled={chapterNumber >= book.chapterCount} onClick={() => navigate(book.id, chapterNumber + 1)}>Próximo capítulo<ArrowRight size={17} /></button></div>
      </div>
    </div>
  </>;
}
