import { useCallback, useEffect, useRef, useState } from 'react';

export function useSpeech(rate: number) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current += 1;
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false); setPaused(false);
  }, [supported]);
  const speak = useCallback((text: string) => {
    stop(); setError('');
    if (!supported) { setError('Este navegador não oferece leitura em voz alta. Experimente outro navegador ou o leitor de tela do aparelho.'); return; }
    const clean = text.trim();
    if (!clean) return;
    const id = generation.current;
    const chunks = clean.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) || [clean];
    // Short utterances keep long chapters working in browsers that limit speech length.
    const pieces = chunks.flatMap(chunk => chunk.match(/[\s\S]{1,230}(?:\s|$)|[\s\S]{1,230}/g) || [chunk]);
    let index = 0;
    const next = () => {
      if (generation.current !== id) return;
      if (index >= pieces.length) { setSpeaking(false); setPaused(false); return; }
      const utterance = new SpeechSynthesisUtterance(pieces[index++]);
      utterance.lang = 'pt-BR'; utterance.rate = rate;
      const voices = window.speechSynthesis.getVoices();
      const portuguese = voices.find(voice => voice.lang.toLowerCase() === 'pt-br') || voices.find(voice => voice.lang.toLowerCase().startsWith('pt'));
      if (portuguese) utterance.voice = portuguese;
      utterance.onend = next;
      utterance.onerror = event => {
        if (generation.current !== id || event.error === 'canceled' || event.error === 'interrupted') return;
        setSpeaking(false); setError('Não foi possível iniciar a voz neste aparelho. Confira as vozes em português instaladas nas configurações do dispositivo.');
      };
      window.speechSynthesis.speak(utterance);
    };
    setSpeaking(true); next();
  }, [rate, stop, supported]);
  const togglePause = useCallback(() => {
    if (!supported) return;
    if (window.speechSynthesis.paused) { window.speechSynthesis.resume(); setPaused(false); }
    else { window.speechSynthesis.pause(); setPaused(true); }
  }, [supported]);
  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);
  return { supported, speaking, paused, error, speak, stop, togglePause };
}
