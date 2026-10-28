import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Expand, Minus, Plus, RotateCcw, Volume2, X } from 'lucide-react';
import type { StudyVisual as StudyVisualData } from '../types';
import '../styles/study-visuals.css';

const kindLabels: Record<StudyVisualData['kind'], string> = {
  chart: 'Gráfico', table: 'Quadro', diagram: 'Diagrama', illustration: 'Imagem', page: 'Página ilustrada',
};

export function StudyVisual({ visual, theme, onSpeak }: {
  visual: StudyVisualData;
  theme: 'light' | 'dark';
  onSpeak: (text: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const id = useId();
  const source = theme === 'dark' && visual.darkSrc ? visual.darkSrc : visual.lightSrc;
  const accessibleText = visual.accessibleText?.trim();

  useEffect(() => { setFailed(false); }, [source]);
  useEffect(() => {
    if (!isOpen) return;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      trigger.current?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const close = () => setIsOpen(false);
  const resetZoom = () => {
    setZoom(1);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  };

  return <figure className={`study-visual study-visual-${visual.kind}`} aria-labelledby={`${id}-caption`}>
    <figcaption className="study-visual-caption" id={`${id}-caption`}>
      <span className="study-visual-kind">{kindLabels[visual.kind]}</span>
      <h3>{visual.title}</h3>
    </figcaption>
    <div className="study-visual-preview">
      {failed ? <p className="study-visual-load-error" role="status">Não foi possível carregar esta imagem. Consulte o PDF da página abaixo.</p> : <img
        src={source}
        alt={visual.description}
        width={visual.width}
        height={visual.height}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />}
    </div>
    <div className="study-visual-actions">
      <span className="muted">{visual.redrawn ? 'Dados e relações preservados do material.' : 'Confira os detalhes no tamanho ampliado.'}</span>
      <button ref={trigger} type="button" className="button button-secondary" disabled={failed} onClick={() => { setZoom(1); setIsOpen(true); }} aria-label={`Ampliar imagem: ${visual.title}`}>
        <Expand size={16} aria-hidden="true" /> Ampliar imagem
      </button>
    </div>
    {accessibleText && <details className="study-visual-description">
      <summary>Ler descrição da imagem</summary>
      <div className="study-visual-description-body">
        {accessibleText.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        <button type="button" className="button button-ghost" onClick={() => onSpeak(accessibleText)} aria-label={`Ouvir descrição: ${visual.title}`}>
          <Volume2 size={16} aria-hidden="true" /> Ouvir descrição
        </button>
      </div>
    </details>}
    {isOpen && <dialog
      ref={dialog}
      className="study-visual-dialog"
      aria-labelledby={`${id}-zoom-title`}
      aria-describedby={`${id}-zoom-help`}
      onCancel={close}
      onClose={close}
      onClick={event => { if (event.target === dialog.current) close(); }}
    >
      <div className="study-visual-dialog-content">
        <header className="study-visual-dialog-header">
          <div><span className="eyebrow">Leitura ampliada</span><h2 id={`${id}-zoom-title`}>{visual.title}</h2></div>
          <button type="button" className="icon-button" onClick={close} aria-label="Fechar imagem ampliada" autoFocus><X size={21} /></button>
        </header>
        <div className="study-visual-zoom-toolbar" role="group" aria-label="Ampliação da imagem">
          <button type="button" className="button button-secondary" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))} aria-label="Diminuir ampliação"><Minus size={17} aria-hidden="true" /></button>
          <output aria-live="polite" aria-label="Nível de ampliação">{Math.round(zoom * 100)}%</output>
          <button type="button" className="button button-secondary" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .5))} aria-label="Aumentar ampliação"><Plus size={17} aria-hidden="true" /></button>
          <button type="button" className="button button-ghost" onClick={resetZoom}><RotateCcw size={15} aria-hidden="true" /> Ajustar à tela</button>
          <a className="button button-ghost study-visual-open-original" href={source} target="_blank" rel="noopener noreferrer">Abrir imagem <ArrowUpRight size={16} aria-hidden="true" /><span className="study-sr-only"> em outra aba</span></a>
        </div>
        <p className="study-visual-zoom-help muted" id={`${id}-zoom-help`}>Use os botões para ampliar e role dentro da imagem para ver os detalhes. Pressione Esc para fechar.</p>
        <div className="study-visual-zoom-viewport" ref={viewport} tabIndex={0} aria-label="Imagem ampliada; use as setas para percorrer">
          <img src={source} alt={visual.description} width={visual.width} height={visual.height} style={{ width: `${zoom * 100}%` }} />
        </div>
      </div>
    </dialog>}
  </figure>;
}
