import { useEffect, useRef, useState } from 'react';
import { BookOpen, Eye, EyeOff, X } from 'lucide-react';

export function AuthDialog({ onClose, authenticate, hasGuestProgress }: { onClose: () => void; hasGuestProgress: boolean; authenticate: (mode: 'login' | 'register', values: { name?: string; email: string; password: string }, importGuest?: boolean) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importGuest, setImportGuest] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="auth-dialog" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} onClick={event => { if (!busy && event.target === dialog.current) onClose(); }} aria-labelledby="auth-title">
    <button className="icon-button close-dialog" disabled={busy} onClick={onClose} aria-label="Fechar acesso à conta"><X size={20} /></button><div className="brand-symbol"><BookOpen size={25} /></div>
    <h2 id="auth-title">{mode === 'login' ? 'Seu caminho continua aqui' : 'Comece a sua jornada'}</h2><p className="muted">Sua conta guarda o progresso e as preferências para continuar em outro dispositivo.</p>
    <div className="segmented auth-tabs"><button disabled={busy} aria-pressed={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setImportGuest(false); }}>Entrar</button><button disabled={busy} aria-pressed={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); setImportGuest(false); }}>Criar conta</button></div>
    <form key={mode} onSubmit={async event => {
      event.preventDefault(); setError(''); setBusy(true);
      const values = new FormData(event.currentTarget);
      try { await authenticate(mode, { name: String(values.get('name') || ''), email: String(values.get('email')), password: String(values.get('password')) }, importGuest); onClose(); }
      catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível acessar a conta.'); }
      finally { setBusy(false); }
    }}>
      {mode === 'register' && <label>Nome<input name="name" autoComplete="name" required readOnly={busy} minLength={2} maxLength={60} placeholder="Como podemos chamar você?" /></label>}
      <label>E-mail<input name="email" type="email" autoComplete="email" required readOnly={busy} maxLength={254} placeholder="voce@exemplo.com" onChange={() => setImportGuest(false)} /></label>
      <label>Senha<div className="password-input"><input name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required readOnly={busy} minLength={mode === 'register' ? 15 : 1} maxLength={128} aria-describedby={mode === 'register' ? 'password-help' : undefined} /><button type="button" className="icon-button" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
      {mode === 'register' && <small className="muted" id="password-help">Use pelo menos 15 caracteres. Você pode usar uma frase longa e fácil de lembrar.</small>}
      {hasGuestProgress && <div className="guest-import-choice"><label><input type="checkbox" checked={importGuest} disabled={busy} onChange={event => setImportGuest(event.target.checked)} /> <span>Adicionar minhas leituras deste navegador à conta</span></label><p className="muted">Marque apenas se estas leituras forem suas. Sem essa escolha, elas continuam separadas da conta.</p></div>}
      {error && <p className="error-box" role="alert">{error}</p>}
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar na minha conta' : 'Criar minha conta'}</button>
    </form><p className="auth-footnote muted">A leitura é aberta a todos. As leituras sem conta ficam neste navegador e podem ser vistas por outras pessoas que usam este aparelho.</p>
  </dialog>;
}
