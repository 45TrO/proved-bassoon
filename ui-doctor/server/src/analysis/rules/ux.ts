import type { Evidence, Issue } from '../../domain/types.js';
import { evidenceFrom, isInline, issue, plural, primary, textElements, visible, type Rule } from './helpers.js';

const GENERIC_LINK = /^(clique aqui|clique|aqui|saiba mais|leia mais|veja mais|ver mais|mais|click here|here|read more|learn more|more|link|acesse|confira)\.?$/i;

const navigationRule: Rule = {
  id: 'ux.navigation',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const issues: Issue[] = [];
    const links = visible(snap).filter((e) => e.kind === 'link').length;
    if (snap.landmarks.nav === 0 && links >= 3) {
      issues.push(
        issue({
          ruleId: 'ux.nav-landmark',
          category: 'ux',
          severity: 'medium',
          title: 'Navegação principal não identificável',
          description: `A página tem ${links} links, mas nenhum está agrupado em <nav>. Usuários de tecnologias assistivas não encontram o menu e a estrutura fica implícita.`,
          recommendation: 'Agrupe os links principais em <nav aria-label="Principal"> dentro do <header>.',
          evidence: [{ viewport: vp, measured: { navLandmarks: 0, links } }],
        }),
      );
    }
    if (vp === 'desktop' && snap.navLinksVisible > 9) {
      issues.push(
        issue({
          ruleId: 'ux.nav-overload',
          category: 'ux',
          severity: snap.navLinksVisible > 14 ? 'medium' : 'low',
          title: 'Menu com opções demais',
          description: `A navegação exibe ${snap.navLinksVisible} itens visíveis. Cada opção extra aumenta o tempo de decisão (lei de Hick).`,
          recommendation: 'Mantenha de 5 a 7 itens de primeiro nível; agrupe o restante em submenus ou mova para o rodapé.',
          evidence: [{ viewport: vp, selector: 'nav', measured: { visibleItems: snap.navLinksVisible } }],
        }),
      );
    }
    if (snap.landmarks.main === 0) {
      issues.push(
        issue({
          ruleId: 'ux.main-landmark',
          category: 'accessibility',
          severity: 'low',
          title: 'Conteúdo principal sem <main>',
          description: 'Não há elemento <main>. Leitores de tela e atalhos de navegação não conseguem pular direto para o conteúdo.',
          recommendation: 'Envolva o conteúdo principal em um único <main>.',
          evidence: [{ viewport: vp, measured: { mainLandmarks: 0 } }],
        }),
      );
    }
    return issues;
  },
};

const linkTextRule: Rule = {
  id: 'ux.link-text',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const generic = visible(snap).filter((e) => (e.kind === 'link' || e.kind === 'button') && GENERIC_LINK.test(e.name.trim()));
    if (generic.length < 2) return [];
    return [
      issue({
        ruleId: 'ux.link-text',
        category: 'ux',
        severity: 'low',
        title: 'Rótulos de ação genéricos',
        description: `${plural(generic.length, 'link ou botão usa', 'links ou botões usam')} textos como "Saiba mais" ou "Clique aqui", que não dizem o que vai acontecer.`,
        recommendation: 'Escreva rótulos que descrevam o destino ou a ação: "Ver planos e preços", "Baixar relatório (PDF)".',
        evidence: generic.map((e) => evidenceFrom(vp, e, { label: e.name })),
      }),
    ];
  },
};

const affordanceRule: Rule = {
  id: 'ux.affordance',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const els = visible(snap);
    const weak = els.filter((e) => {
      if (e.kind !== 'button' || e.tag === 'input') return false;
      const transparent = !e.ownBg || /rgba\([^)]*,\s*0\)$/.test(e.ownBg);
      if (!transparent || e.borderWidth > 0) return false;
      // Botões só de ícone costumam ser reconhecíveis; foco em botões com texto que parecem texto comum.
      if (e.w < 48 && e.h < 48) return false;
      const parent = els.find((x) => x.i === e.parent);
      const sameColorAsText = parent ? parent.color === e.color : true;
      return e.name.length > 0 && sameColorAsText;
    });
    if (weak.length === 0) return [];
    return [
      issue({
        ruleId: 'ux.affordance',
        category: 'ux',
        severity: weak.length > 3 ? 'medium' : 'low',
        title: 'Botões que não parecem clicáveis',
        description: `${plural(weak.length, 'botão não tem', 'botões não têm')} fundo, borda nem cor diferente do texto ao redor. O usuário não percebe que é uma ação.`,
        recommendation: 'Dê a cada botão um sinal visual de interação: fundo, borda ou cor de destaque, além de estado de hover e foco.',
        evidence: weak.map((e) => evidenceFrom(vp, e, { background: 'transparente', border: 'nenhuma', label: e.name })),
      }),
    ];
  },
};

const touchTargetRule: Rule = {
  id: 'ux.touch-target',
  run(snapshots) {
    const snap = snapshots.mobile;
    if (!snap) return [];
    const els = visible(snap);
    const small = els.filter((e) => {
      if (!['button', 'link', 'input', 'select'].includes(e.kind)) return false;
      if (e.inputType === 'hidden') return false;
      if (e.kind === 'link' && isInline(e)) {
        // Links dentro de frases são exceção no WCAG 2.5.8.
        const parent = els.find((x) => x.i === e.parent);
        if (parent && parent.words > e.words + 3) return false;
      }
      return Math.min(e.w, e.h) < 32;
    });
    if (small.length === 0) return [];
    // WCAG 2.5.8: alvo < 24 px só falha se o círculo de 24 px centrado nele
    // alcançar outro alvo interativo (exceção de espaçamento).
    const targets = els.filter((e) => e.interactive);
    const center = (e: (typeof els)[number]) => ({ cx: e.x + e.w / 2, cy: e.y + e.h / 2 });
    const critical = small.filter((e) => {
      if (Math.min(e.w, e.h) >= 24) return false;
      const c = center(e);
      return targets.some((o) => {
        if (o.i === e.i) return false;
        const dx = Math.max(o.x - c.cx, 0, c.cx - (o.x + o.w));
        const dy = Math.max(o.y - c.cy, 0, c.cy - (o.y + o.h));
        return Math.hypot(dx, dy) < 12;
      });
    });
    const evidence: Evidence[] = small
      .sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))
      .map((e) => evidenceFrom('mobile', e, { size: `${e.w}×${e.h}`, minimum: '44×44 recomendado / 24×24 WCAG', label: e.name || e.kind }));
    return [
      issue({
        ruleId: 'ux.touch-target',
        category: 'ux',
        severity: critical.length > 0 ? 'high' : 'medium',
        title: 'Alvos de toque pequenos no mobile',
        description: `${plural(small.length, 'elemento interativo tem', 'elementos interativos têm')} menos de 32 px na menor dimensão em 390 px de largura` +
          (critical.length ? `, ${critical.length} abaixo do mínimo WCAG de 24 px.` : '.'),
        recommendation: 'Garanta área de toque de pelo menos 44×44 px (padding ou min-height) e 8 px de espaço entre alvos vizinhos.',
        evidence,
        occurrences: small.length,
        fixable: true,
      }),
    ];
  },
};

const formsRule: Rule = {
  id: 'ux.forms',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const issues: Issue[] = [];
    const long = snap.forms.filter((f) => f.fields > 7);
    if (long.length) {
      issues.push(
        issue({
          ruleId: 'ux.form-length',
          category: 'ux',
          severity: long.some((f) => f.fields > 12) ? 'high' : 'medium',
          title: 'Formulário longo demais',
          description: `${plural(long.length, 'formulário pede', 'formulários pedem')} mais de 7 campos de uma vez (${long.map((f) => f.fields).join(', ')} campos). Cada campo extra reduz a taxa de conclusão.`,
          recommendation: 'Peça apenas o essencial, divida em etapas com indicador de progresso e preencha automaticamente o que for possível (CEP → endereço).',
          evidence: long.map((f) => ({
            viewport: vp,
            selector: f.selector,
            rect: { x: f.x, y: f.y, width: f.w, height: f.h },
            measured: { fields: f.fields, required: f.required },
          })),
        }),
      );
    }
    const noSubmit = snap.forms.filter((f) => !f.hasSubmit && f.fields > 0);
    if (noSubmit.length) {
      issues.push(
        issue({
          ruleId: 'ux.form-submit',
          category: 'ux',
          severity: 'medium',
          title: 'Formulário sem botão de envio',
          description: `${plural(noSubmit.length, 'formulário não possui', 'formulários não possuem')} botão de envio explícito. O usuário não sabe como concluir.`,
          recommendation: 'Adicione um botão do tipo submit com rótulo que descreva o resultado ("Criar conta", "Enviar mensagem").',
          evidence: noSubmit.map((f) => ({ viewport: vp, selector: f.selector, rect: { x: f.x, y: f.y, width: f.w, height: f.h }, measured: { fields: f.fields, submit: false } })),
        }),
      );
    }
    const autocompleteMissing = visible(snap).filter(
      (e) => e.kind === 'input' && ['email', 'tel', 'password'].includes(e.inputType ?? '') && !e.autocomplete,
    );
    if (autocompleteMissing.length) {
      issues.push(
        issue({
          ruleId: 'ux.autocomplete',
          category: 'ux',
          severity: 'low',
          title: 'Campos sem preenchimento automático',
          description: `${plural(autocompleteMissing.length, 'campo de e-mail, telefone ou senha não declara', 'campos de e-mail, telefone ou senha não declaram')} autocomplete. O navegador e gerenciadores de senha não conseguem ajudar o usuário.`,
          recommendation: 'Use autocomplete="email", "tel", "current-password" ou "new-password" conforme o caso.',
          evidence: autocompleteMissing.map((e) => evidenceFrom(vp, e, { type: e.inputType ?? '', autocomplete: 'ausente' })),
        }),
      );
    }
    return issues;
  },
};

const readabilityRule: Rule = {
  id: 'ux.readability',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const issues: Issue[] = [];
    const paragraphs = textElements(snap).filter((t) => t.kind === 'text' && t.words >= 25);
    const wide = paragraphs.filter((t) => t.w / (t.fontSize * 0.5) > 100 && t.h > t.lineHeight * 1.5);
    if (wide.length) {
      issues.push(
        issue({
          ruleId: 'ux.line-length',
          category: 'ux',
          severity: wide.length > 3 ? 'medium' : 'low',
          title: 'Linhas de texto longas demais',
          description: `${plural(wide.length, 'bloco de texto tem', 'blocos de texto têm')} cerca de ${Math.round(wide[0]!.w / (wide[0]!.fontSize * 0.5))} caracteres por linha. Acima de ~80 caracteres o olho perde a próxima linha.`,
          recommendation: 'Limite a largura de parágrafos a 60–75 caracteres (max-width: 70ch).',
          evidence: wide.map((t) => evidenceFrom(vp, t, { width: `${t.w}px`, approxCharsPerLine: Math.round(t.w / (t.fontSize * 0.5)) })),
          fixable: true,
        }),
      );
    }
    const tight = paragraphs.filter((t) => t.lineHeight / t.fontSize < 1.3);
    if (tight.length) {
      issues.push(
        issue({
          ruleId: 'ux.line-height',
          category: 'ux',
          severity: 'low',
          title: 'Entrelinha apertada',
          description: `${plural(tight.length, 'parágrafo usa', 'parágrafos usam')} altura de linha menor que 1.3× o tamanho da fonte, o que dificulta a leitura de textos longos.`,
          recommendation: 'Use line-height entre 1.45 e 1.65 para texto corrido.',
          evidence: tight.map((t) => evidenceFrom(vp, t, { lineHeight: `${t.lineHeight}px`, fontSize: `${t.fontSize}px`, ratio: (t.lineHeight / t.fontSize).toFixed(2) })),
          fixable: true,
        }),
      );
    }
    const walls = paragraphs.filter((t) => t.words > 130);
    if (walls.length) {
      issues.push(
        issue({
          ruleId: 'ux.text-walls',
          category: 'ux',
          severity: 'low',
          title: 'Blocos de texto extensos',
          description: `${plural(walls.length, 'parágrafo tem', 'parágrafos têm')} mais de 130 palavras sem quebra. Usuários escaneiam, não leem palavra por palavra.`,
          recommendation: 'Divida em parágrafos curtos, use intertítulos, listas e destaque as informações-chave.',
          evidence: walls.map((t) => evidenceFrom(vp, t, { words: t.words })),
        }),
      );
    }
    return issues;
  },
};

const ctaRule: Rule = {
  id: 'ux.primary-action',
  run(snapshots) {
    const p = primary(snapshots);
    if (!p) return [];
    const [vp, snap] = p;
    const fold = snap.viewport.height;
    const actions = visible(snap).filter((e) => (e.kind === 'button' || e.kind === 'link') && e.y < fold && e.y >= 0);
    const prominent = actions.filter((e) => {
      const painted = e.ownBg && !/rgba\([^)]*,\s*0\)$/.test(e.ownBg);
      return painted && e.w >= 80 && e.h >= 32;
    });
    if (actions.length === 0 || prominent.length > 0) return [];
    return [
      issue({
        ruleId: 'ux.primary-action',
        category: 'ux',
        severity: 'medium',
        title: 'Sem ação principal em destaque',
        description: `Há ${actions.length} links e botões acima da dobra, mas nenhum se destaca visualmente como ação principal.`,
        recommendation: 'Defina uma ação primária por tela, com cor de destaque, tamanho confortável e rótulo orientado a resultado.',
        evidence: [{ viewport: vp, rect: { x: 0, y: 0, width: snap.viewport.width, height: fold }, measured: { actionsAboveFold: actions.length, prominent: 0 } }],
      }),
    ];
  },
};

export const uxRules: Rule[] = [navigationRule, linkTextRule, affordanceRule, touchTargetRule, formsRule, readabilityRule, ctaRule];
