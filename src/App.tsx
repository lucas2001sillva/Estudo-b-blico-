import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, AudioLines, BookOpen, CheckCircle2, ChevronRight, CircleHelp, Compass, Home as HomeIcon, LogIn, LogOut, Moon, Search, Settings2, ShieldCheck, Sun, TrendingUp, Volume2, X, Pause, Play, Square } from 'lucide-react';
import { AuthDialog } from './components/AuthDialog';
import { BibleReader } from './components/BibleReader';
import { Home, ProgressPage } from './components/Home';
import { StudiesPage, QuizPage } from './components/StudyViews';
import { request, useProgressStore } from './lib/store';
import { useSpeech } from './lib/speech';
import type { Catalog, Page, ReadingPosition } from './types';
import './styles/app.css';
import './styles/privacy.css';

const navigation = [
  { id: 'home' as Page, hash: 'inicio', label: 'Início', icon: HomeIcon },
  { id: 'bible' as Page, hash: 'biblia', label: 'Bíblia', icon: BookOpen },
  { id: 'studies' as Page, hash: 'estudos', label: 'Estudos', icon: Compass },
  { id: 'quiz' as Page, hash: 'quiz', label: 'Quiz', icon: CircleHelp },
  { id: 'progress' as Page, hash: 'progresso', label: 'Meu progresso', icon: TrendingUp },
];
function routeFromHash() {
  const [path, query] = window.location.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  const page = navigation.find(item => item.hash === path)?.id || 'home';
  const target: ReadingPosition | null = params.get('livro') ? { bookId: params.get('livro')!, chapter: Number(params.get('capitulo')) || 1, verse: params.get('versiculo') ? Number(params.get('versiculo')) : undefined } : null;
  return { page, target };
}
type SearchResult = { bookId: string; bookName: string; chapter: number; verse: number; text: string };

export default function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchMessage, setSearchMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState('');
  const main = useRef<HTMLElement>(null);
  const store = useProgressStore();
  const speech = useSpeech(store.progress.preferences.speechRate);
  const { theme, fontSize, speechRate } = store.progress.preferences;
  const loadCatalog = useCallback(() => {
    setLoadError('');
    request<Catalog>('/catalog').then(setCatalog).catch(err => setLoadError(err.message));
  }, []);
  useEffect(loadCatalog, [loadCatalog]);
  useEffect(() => { const update = () => setRoute(routeFromHash()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--reader-size', `${fontSize}px`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151a17' : '#f6f5f0');
  }, [theme, fontSize]);
  useEffect(() => { speech.stop(); setSettingsOpen(false); setSearchResults(null); setSearchMessage(''); main.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [route.page]);
  useEffect(() => { document.title = `${navigation.find(item => item.id === route.page)?.label} · Vereda Bíblica`; }, [route.page]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 7000); return () => window.clearTimeout(timer); }, [notice]);
  const navigate = (page: Page) => { window.location.hash = navigation.find(item => item.id === page)!.hash; };
  const openBible = (bookId: string, chapter: number, verse?: number) => {
    speech.stop();
    window.location.hash = `biblia?livro=${encodeURIComponent(bookId)}&capitulo=${chapter}${verse ? `&versiculo=${verse}` : ''}`;
    setSearchResults(null); setSearchMessage('');
  };
  const onTrail = (id: string) => { store.patch({ selectedTrailId: id }); navigate('studies'); };
  const startQuiz = (id: string) => { setQuizId(id); navigate('quiz'); };
  const searchBible = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!search.trim() || !catalog) return;
    setSearching(true); setSearchMessage(''); setSearchResults(null);
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const book = catalog.books.find(item => normalize(item.name) === normalize(search) || normalize(item.abbreviation) === normalize(search));
    if (book) { openBible(book.id, 1); setSearching(false); return; }
    try {
      const result = await request<{ results: SearchResult[]; kind: string; truncated?: boolean }>(`/search?q=${encodeURIComponent(search.trim())}`);
      if (result.kind === 'reference' && result.results.length === 1) { const item = result.results[0]; openBible(item.bookId, item.chapter, item.verse); }
      else { setSearchResults(result.results); setSearchMessage(result.results.length ? `${result.results.length} resultados${result.truncated ? ' (mostrando os primeiros)' : ''}` : 'Nenhum resultado. Experimente João 3:16, Salmos 23 ou uma palavra.'); }
    } catch (err) { setSearchMessage(err instanceof Error ? err.message : 'Não foi possível buscar.'); }
    finally { setSearching(false); }
  };
  const syncText = store.status === 'checking' ? 'Conferindo progresso…' : store.status === 'syncing' ? 'Sincronizando…' : store.status === 'offline' ? 'Aguardando conexão' : store.user ? 'Sincronizado com sua conta' : 'Salvo neste navegador';
  return <div className="app-shell">
    <a href="#main-content" className="skip-link" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Pular para o conteúdo</a>
    <aside className="sidebar"><a className="brand" href="#inicio" aria-label="Vereda Bíblica, início"><span className="brand-symbol"><BookOpen size={27} /></span><span>vereda<span>bíblica<span className="brand-dot">.</span></span></span></a><span className="sidebar-label">SEU CAMINHO DE APRENDIZADO</span><nav aria-label="Navegação principal">{navigation.map(item => <a key={item.id} href={`#${item.hash}`} className={`nav-link ${route.page === item.id ? 'active' : ''}`} aria-current={route.page === item.id ? 'page' : undefined}><item.icon size={20} /><span>{item.label}</span>{route.page === item.id && <span className="nav-dot" />}</a>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="little-leaf">✧</span><p>O aprendizado floresce<br />um passo de cada vez.</p><span>No seu tempo. No seu caminho.</span></div><div className="sidebar-sync"><ShieldCheck size={15} /><span>{syncText}</span></div>{store.user ? <div className="account-chip"><span className="avatar">{store.user.name.slice(0, 1).toUpperCase()}</span><div><strong>{store.user.name}</strong><span>Minha jornada</span></div><button className="icon-button" aria-label="Sair da conta" onClick={() => { void store.logout().catch(err => setNotice(err.message)); }}><LogOut size={17} /></button></div> : <button className="button button-secondary sidebar-login" onClick={() => setAuthOpen(true)}><LogIn size={17} />Entrar ou criar conta</button>}</div></aside>
    <div className="workspace"><header className="topbar"><a className="mobile-brand" href="#inicio"><BookOpen size={25} /><span>vereda bíblica.</span></a><div className="global-search"><form onSubmit={searchBible}><Search size={18} aria-hidden="true"/><input value={search} onChange={event => setSearch(event.target.value)} aria-label="Buscar na Bíblia" placeholder="Busque uma passagem, livro ou palavra…" maxLength={120} onKeyDown={event => { if (event.key === 'Escape') { setSearchResults(null); setSearchMessage(''); } }} /><button type="submit" className="search-submit" aria-label="Pesquisar" disabled={searching}>{searching ? '…' : <ArrowRight size={17} />}</button></form>{(searchResults !== null || searchMessage) && <section className="search-popover card" aria-label="Resultados da busca"><div className="search-results-heading"><span role="status">{searchMessage}</span><button className="icon-button" aria-label="Fechar busca" onClick={() => { setSearchResults(null); setSearchMessage(''); }}><X size={18} /></button></div><div className="search-result-list">{searchResults?.map(item => <button key={`${item.bookId}:${item.chapter}:${item.verse}`} onClick={() => openBible(item.bookId, item.chapter, item.verse)}><strong>{item.bookName} {item.chapter}:{item.verse}<ChevronRight size={14} /></strong><span>{item.text}</span></button>)}</div></section>}</div><div className="topbar-actions"><button className="button button-ghost listen-screen" onClick={() => speech.speak(Array.from(main.current?.querySelectorAll('[data-readable]') || []).map(element => (element as HTMLElement).innerText).join('\n') || main.current?.innerText || '')}><Volume2 size={18} /><span>Ouvir tela</span></button><span className="toolbar-divider" /><button className="icon-button" aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'} title={theme === 'light' ? 'Tema escuro' : 'Tema claro'} onClick={() => store.patch({ preferences: { theme: theme === 'light' ? 'dark' : 'light' } })}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}</button><div className="settings-anchor"><button className={`icon-button ${settingsOpen ? 'selected' : ''}`} aria-label="Acessibilidade" aria-expanded={settingsOpen} aria-controls="accessibility-settings" onClick={() => setSettingsOpen(value => !value)}><Settings2 size={20} /></button>{settingsOpen && <section id="accessibility-settings" className="settings-popover card" aria-label="Preferências de leitura"><div className="settings-title"><strong>Conforto na leitura</strong><button className="icon-button" aria-label="Fechar preferências" onClick={() => setSettingsOpen(false)}><X size={17} /></button></div><div className="font-setting"><span>Tamanho da letra</span><div><button className="button button-secondary" aria-label="Diminuir letra" disabled={fontSize <= 16} onClick={() => store.patch({ preferences: { fontSize: Math.max(16, fontSize - 2) } })}>A−</button><output aria-live="polite">{fontSize}px</output><button className="button button-secondary" aria-label="Aumentar letra" disabled={fontSize >= 28} onClick={() => store.patch({ preferences: { fontSize: Math.min(28, fontSize + 2) } })}>A+</button></div></div><label className="speed-setting">Velocidade da voz <output>{speechRate.toFixed(1)}×</output><input aria-label="Velocidade da voz" type="range" min="0.6" max="1.6" step="0.1" value={speechRate} onChange={event => { speech.stop(); store.patch({ preferences: { speechRate: Number(event.target.value) } }); }} /></label><p className="muted">A disponibilidade da voz em português depende do navegador e das vozes instaladas no aparelho.</p></section>}</div><button className="account-top icon-button" aria-label={store.user ? 'Ver meu progresso' : 'Entrar na conta'} onClick={() => store.user ? navigate('progress') : setAuthOpen(true)}>{store.user ? <span className="avatar">{store.user.name[0]}</span> : <LogIn size={20} />}</button></div></header>
    {speech.speaking && <div className="speech-bar" role="status"><AudioLines size={18} /><span>{speech.paused ? 'Leitura pausada' : 'Ouvindo o conteúdo'}</span><button className="button button-ghost" onClick={speech.togglePause}>{speech.paused ? <Play size={16} /> : <Pause size={16} />}{speech.paused ? 'Retomar' : 'Pausar'}</button><button className="icon-button" aria-label="Parar leitura" onClick={speech.stop}><Square size={15} /></button></div>}
    {(notice || speech.error || store.accountNotice || store.storageWarning) && <div className="app-notice" role="status">{notice || speech.error || store.accountNotice || 'O navegador não permite salvar os dados. Entre em uma conta e confira a sincronização antes de sair.'}{(notice || store.accountNotice) && <button className="icon-button" aria-label="Fechar aviso" onClick={() => { setNotice(''); store.clearAccountNotice(); }}><X size={16} /></button>}</div>}
    {store.user && store.status === 'offline' && <div className="app-notice" role="status">A sincronização está indisponível. Mantenha esta aba aberta até aparecer “Sincronizado com sua conta”.</div>}
    <main className="main-content" id="main-content" tabIndex={-1} ref={main}>{loadError ? <section className="empty-state card"><BookOpen size={32} /><h1>Vamos retomar o caminho</h1><p>{loadError}</p><button className="button button-primary" onClick={loadCatalog}>Tentar novamente</button></section> : !catalog ? <div className="loading-screen" role="status"><BookOpen size={32} /><p>Preparando sua leitura…</p></div> : route.page === 'home' ? <Home catalog={catalog} progress={store.progress} user={store.user} onPage={navigate} onRead={openBible} onTrail={onTrail} onSpeak={speech.speak} onStopSpeech={speech.stop} /> : route.page === 'bible' ? <BibleReader books={catalog.books} progress={store.progress} target={route.target} onNavigate={openBible} onPatch={store.patch} onSpeak={speech.speak} /> : route.page === 'studies' ? <StudiesPage studies={catalog.studies} progress={store.progress} onPatch={store.patch} onStartQuiz={startQuiz} onSpeak={speech.speak} /> : route.page === 'quiz' ? <QuizPage studies={catalog.studies} progress={store.progress} selectedQuizId={quizId} onSelectQuiz={id => setQuizId(id || null)} onPatch={store.patch} onSpeak={speech.speak} /> : <ProgressPage catalog={catalog} progress={store.progress} user={store.user} onPage={navigate} onRead={openBible} onLogin={() => setAuthOpen(true)} />}</main>
    <footer className="site-footer"><span><BookOpen size={14} />Vereda Bíblica</span><span>Aprender. Um capítulo de cada vez.</span><span className="footer-sync"><CheckCircle2 size={13} />{syncText}</span></footer></div>
    <nav className="mobile-navigation" aria-label="Navegação para celular">{navigation.map(item => <a key={item.id} href={`#${item.hash}`} aria-current={route.page === item.id ? 'page' : undefined} className={route.page === item.id ? 'active' : ''}><item.icon size={20} /><span>{item.label === 'Meu progresso' ? 'Progresso' : item.label}</span></a>)}</nav>
    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} authenticate={store.authenticate} hasGuestProgress={store.hasGuestProgress} />}
  </div>;
}
