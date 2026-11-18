import { clsx } from 'clsx';
import { Globe, ImageUp, Upload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { validateUrlInput } from '../../lib/format';
import { Button } from '../ui/Button';

const MAX_IMAGE = 10 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return 'Formato não suportado. Envie PNG, JPEG ou WebP.';
  if (file.size > MAX_IMAGE) return 'A imagem passa de 10 MB. Exporte em resolução menor.';
  if (file.size === 0) return 'O arquivo está vazio.';
  return null;
}

export function AnalyzeForm() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'url' | 'image'>('url');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const errId = useId();

  const clientError = touched ? validateUrlInput(url) : null;
  const shownError = error ?? clientError;

  async function submitUrl(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    const v = validateUrlInput(url);
    if (v) return;
    setSubmitting(true);
    setError(null);
    try {
      const { id } = await api.analyzeUrl(url.trim());
      navigate(`/analises/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível iniciar a análise.');
      setSubmitting(false);
    }
  }

  async function submitFile(file: File) {
    const v = validateImageFile(file);
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { id } = await api.analyzeImage(file);
      navigate(`/analises/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar a imagem.');
      setSubmitting(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void submitFile(file);
  };

  return (
    <div className="w-full">
      <div className="mb-3 flex justify-center gap-1" role="radiogroup" aria-label="Origem da análise">
        {(
          [
            ['url', 'Endereço do site', Globe],
            ['image', 'Captura de tela', ImageUp],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="radio"
            aria-checked={mode === key}
            onClick={() => {
              setMode(key);
              setError(null);
            }}
            className={clsx(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
              mode === key ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-muted hover:text-ink',
            )}
          >
            <Icon size={14} strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      {mode === 'url' ? (
        <form onSubmit={submitUrl} noValidate>
          <div
            className={clsx(
              'flex flex-col gap-2 rounded-2xl border bg-surface p-2 shadow-pop transition-[border-color,box-shadow] sm:flex-row sm:items-center',
              shownError ? 'border-critical/50' : 'border-line focus-within:border-inspect focus-within:shadow-[0_0_0_4px_var(--inspect-soft)]',
            )}
          >
            <label htmlFor="url" className="sr-only">
              Endereço da página
            </label>
            <div className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5">
              <Globe size={18} className="shrink-0 text-faint" strokeWidth={1.75} />
              <input
                id="url"
                name="url"
                type="text"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="seusite.com.br/pagina"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                onBlur={() => url && setTouched(true)}
                aria-invalid={Boolean(shownError)}
                aria-describedby={shownError ? errId : undefined}
                className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
              />
            </div>
            <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full sm:w-auto">
              Analisar interface
            </Button>
          </div>
        </form>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={clsx(
            'flex flex-col items-center rounded-2xl border border-dashed bg-surface px-6 py-10 text-center transition-colors',
            dragging ? 'border-inspect bg-inspect-soft' : shownError ? 'border-critical/50' : 'border-line-strong',
          )}
        >
          <Upload size={22} className="text-muted" strokeWidth={1.75} />
          <p className="mt-3 text-sm font-medium">Arraste uma captura de tela da interface</p>
          <p className="mt-1 text-xs text-muted">PNG, JPEG ou WebP, até 10 MB</p>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED.join(',')}
            className="sr-only"
            aria-describedby={shownError ? errId : undefined}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void submitFile(f);
              e.target.value = '';
            }}
          />
          <Button className="mt-4" loading={submitting} onClick={() => fileRef.current?.click()}>
            Escolher arquivo
          </Button>
        </div>
      )}

      <p id={errId} role={shownError ? 'alert' : undefined} className={clsx('mt-2.5 min-h-5 px-1 text-center text-sm', shownError ? 'text-critical' : 'text-faint')}>
        {shownError ??
          (mode === 'url'
            ? 'A página é aberta em um navegador isolado e capturada em 1440, 834 e 390 px de largura.'
            : 'A captura é lida por OCR e processamento de imagem: contraste, texto, botões, menu e paleta.')}
      </p>
    </div>
  );
}
