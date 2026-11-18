import type { ProgressStep } from '../domain/types.js';

export class Progress {
  readonly steps: ProgressStep[];

  constructor(steps: { key: string; label: string }[]) {
    this.steps = steps.map((s) => ({ ...s, state: 'pending' }));
  }

  private find(key: string) {
    const step = this.steps.find((s) => s.key === key);
    if (!step) throw new Error(`etapa desconhecida: ${key}`);
    return step;
  }

  start(key: string, detail?: string) {
    const s = this.find(key);
    s.state = 'active';
    s.detail = detail;
    return this;
  }

  detail(key: string, detail: string) {
    this.find(key).detail = detail;
    return this;
  }

  done(key: string, detail?: string) {
    const s = this.find(key);
    s.state = 'done';
    if (detail !== undefined) s.detail = detail;
    return this;
  }

  skip(key: string, detail?: string) {
    const s = this.find(key);
    s.state = 'skipped';
    s.detail = detail;
    return this;
  }

  fail(detail: string) {
    const active = this.steps.find((s) => s.state === 'active');
    if (active) {
      active.state = 'error';
      active.detail = detail;
    }
    return this;
  }

  snapshot(): ProgressStep[] {
    return this.steps.map((s) => ({ ...s }));
  }
}

export const URL_STEPS = [
  { key: 'validate', label: 'Validando endereço e rede' },
  { key: 'capture', label: 'Capturando desktop, tablet e mobile' },
  { key: 'rules', label: 'Analisando layout, cores, tipografia e acessibilidade' },
  { key: 'vision', label: 'Visão computacional: OCR, imagem, padrões e DOM' },
  { key: 'score', label: 'Calculando pontuação e relatório' },
];

export const IMAGE_STEPS = [
  { key: 'validate', label: 'Validando imagem' },
  { key: 'pixels', label: 'Extraindo paleta e dimensões' },
  { key: 'vision', label: 'Visão computacional: OCR, imagem, padrões e DOM' },
  { key: 'score', label: 'Calculando pontuação e relatório' },
];
