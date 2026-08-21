(function () {
  const app = firebase.initializeApp(window.ALUNOS_FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.database();
  const root = document.getElementById('root');

  const state = {
    user: null, profile: null, data: null,
    authResolved: false, setupComplete: null, authErrorMsg: '',
    view: 'ead',
    turmaId: '', search: '', sortCol: 'nome', sortAsc: true, somenteReprovados: false,
    eadUnidade: '', eadPeriodo: '',
    ctcGrupo: '', ctcPeriodo: '',
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function showError(message) {
    const node = document.getElementById('auth-error');
    if (node) node.textContent = message || '';
  }

  // Painel de acesso restrito, incorporado dentro da casca comum (nav + header)
  // em vez de tomar a tela inteira — assim quem so quer ver a oferta EAD
  // nunca precisa passar por aqui.
  function authMode() {
    if (!state.authResolved) return 'loading';
    if (!state.user) return state.setupComplete === false ? 'setup' : 'login';
    if (state.profile && state.profile.active) return 'ready';
    return state.setupComplete === false ? 'setup' : 'pending';
  }

  function renderAuthGatePanel(mode) {
    if (mode === 'loading') {
      return '<div class="panel-card"><div class="empty-state">Carregando…</div></div>';
    }
    const titles = {
      login: ['Acesso restrito', 'Entrar com e-mail e senha para consultar os alunos por turma.'],
      setup: ['Configuração inicial', 'Nenhum administrador cadastrado ainda. Crie o primeiro acesso (o seu).'],
      pending: ['Acesso pendente', 'Sua conta ainda não foi liberada. Peça para um administrador liberar seu acesso.'],
    };
    const [title, subtitle] = titles[mode] || titles.login;
    return `
      <div class="panel-card auth-panel">
        <span class="eyebrow">CTSED &middot; acesso restrito</span>
        <h1>${title}</h1>
        <p class="auth-subtitle">${subtitle}</p>
        ${mode === 'pending' ? `
          <button id="logout-btn-gate" class="clear-btn" type="button">Sair</button>
        ` : `
          <form id="auth-form" class="auth-form">
            ${mode === 'setup' ? '<label class="field"><span>Nome completo</span><input name="name" required autocomplete="name"></label>' : ''}
            <label class="field"><span>E-mail</span><input name="email" type="email" required autocomplete="username"></label>
            <label class="field"><span>Senha</span><input name="password" type="password" minlength="6" required autocomplete="${mode === 'setup' ? 'new-password' : 'current-password'}"></label>
            <button type="submit" class="clear-btn">${mode === 'setup' ? 'Criar administrador' : 'Entrar'}</button>
            <div id="auth-error" class="form-error"></div>
          </form>
        `}
      </div>`;
  }

  function wireAuthGate(mode) {
    if (mode === 'loading') return;
    if (mode === 'pending') {
      const btn = document.getElementById('logout-btn-gate');
      if (btn) btn.addEventListener('click', () => auth.signOut());
      return;
    }
    const form = document.getElementById('auth-form');
    if (!form) return;
    if (state.authErrorMsg) {
      showError(state.authErrorMsg);
      state.authErrorMsg = '';
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showError('');
      const formData = new FormData(event.currentTarget);
      const email = formData.get('email').trim();
      const password = formData.get('password');
      try {
        if (mode === 'setup') {
          const credential = await auth.createUserWithEmailAndPassword(email, password);
          await db.ref('users/' + credential.user.uid).set({
            display_name: formData.get('name').trim(),
            role: 'admin',
            active: true,
          });
          await db.ref('public/setupComplete').set(true);
          state.setupComplete = true;
        } else {
          await auth.signInWithEmailAndPassword(email, password);
        }
      } catch (err) {
        showError(traduzErro(err));
      }
    });
  }

  function traduzErro(err) {
    const code = err && err.code;
    const map = {
      'auth/invalid-email': 'E-mail inválido.',
      'auth/user-not-found': 'Usuário não encontrado.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/invalid-credential': 'E-mail ou senha incorretos.',
      'auth/email-already-in-use': 'Já existe uma conta com esse e-mail.',
      'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    };
    return map[code] || (err && err.message) || 'Não foi possível concluir a operação.';
  }

  function turmaOptions(turmas) {
    return Object.values(turmas).sort((a, b) => (a.curso + a.nome).localeCompare(b.curso + b.nome, 'pt-BR'));
  }

  function studentMatches(aluno, term) {
    if (!term) return true;
    const haystack = [aluno.nome, aluno.matricula, ...(aluno.ucsReprovadas || []), ...(aluno.ucsCursando || [])]
      .join(' ').toLocaleLowerCase('pt-BR');
    return haystack.includes(term);
  }

  function normalizarTexto(texto) {
    return String(texto || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function ordenarAlunos(alunos, sortCol, sortAsc) {
    const valor = (aluno) => {
      if (sortCol === 'reprovadas') return (aluno.ucsReprovadas || []).length;
      if (sortCol === 'cursando') return (aluno.ucsCursando || []).length;
      if (sortCol === 'status') return normalizarTexto(aluno.status);
      if (sortCol === 'contato') return normalizarTexto(aluno.email);
      return normalizarTexto(aluno.nome);
    };
    return [...alunos].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return normalizarTexto(a.nome).localeCompare(normalizarTexto(b.nome));
    });
  }

  function formatarData(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  function parseDataISO(str) {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function fimDoSemestreVigente(hoje) {
    const ano = hoje.getFullYear();
    // Semestre 1: jan-jun · Semestre 2: jul-dez
    return hoje.getMonth() < 6 ? new Date(ano, 5, 30) : new Date(ano, 11, 31);
  }

  function statusOfertaUC(uc) {
    const inicio = parseDataISO(uc.inicio);
    const fim = parseDataISO(uc.fim);
    if (!inicio || !fim) return { key: 'sem-diario', label: 'Sem diário' };
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (fim < hoje) return { key: 'concluida', label: 'Concluída' };
    if (inicio > hoje) {
      // Só conta como "entrando" se o início cair dentro do semestre vigente;
      // ofertas planejadas para semestres futuros ficam de fora deste painel.
      if (inicio > fimDoSemestreVigente(hoje)) return { key: 'futuro-semestre', label: 'Semestre futuro' };
      return { key: 'futura', label: 'Entrando' };
    }
    return { key: 'andamento', label: 'Em andamento' };
  }

  const LABEL_PERIODO = { M: 'Matutino', V: 'Vespertino', N: 'Noturno' };
  const ORDEM_PERIODO = ['M', 'V', 'N', 'outro'];

  function periodoDaTurma(nomeTurma) {
    // O nome da turma termina com a letra do turno + numero da turma,
    // ex.: "T TSEG 2026/1 N1" -> N (Noturno), "T DESI 2026/1 V1" -> V (Vespertino).
    const partes = String(nomeTurma || '').trim().split(/\s+/);
    const ultimo = partes[partes.length - 1] || '';
    const m = ultimo.match(/^([MVN])\d+$/i);
    if (!m) return { key: 'outro', label: 'Outro turno' };
    const letra = m[1].toUpperCase();
    return { key: letra, label: LABEL_PERIODO[letra] };
  }

  function formatarTelefone(digitos) {
    const semDDI = digitos.startsWith('55') && digitos.length > 11 ? digitos.slice(2) : digitos;
    if (semDDI.length === 11) return `(${semDDI.slice(0, 2)}) ${semDDI.slice(2, 7)}-${semDDI.slice(7)}`;
    if (semDDI.length === 10) return `(${semDDI.slice(0, 2)}) ${semDDI.slice(2, 6)}-${semDDI.slice(6)}`;
    return digitos;
  }

  // ---------- Aba "Alunos por turma" ----------

  function ucChips(lista, tipo) {
    if (!lista || !lista.length) return '<span class="empty-cell">—</span>';
    const n = lista.length;
    const label = tipo === 'reprovada'
      ? `${n} UC${n > 1 ? 's' : ''} reprovada${n > 1 ? 's' : ''}`
      : `${n} UC${n > 1 ? 's' : ''} cursando`;
    return `<details class="uc-collapse"><summary class="uc-collapse-summary ${tipo}">${label}</summary><div class="uc-chip-stack">${lista.map((uc) => `<span class="uc-chip-linha ${tipo}">${escapeHtml(uc)}</span>`).join('')}</div></details>`;
  }

  function contatoCell(aluno) {
    const emailHtml = aluno.email
      ? `<a class="contact-link" href="mailto:${escapeHtml(aluno.email)}">${escapeHtml(aluno.email)}</a>`
      : '<span class="empty-cell">—</span>';
    const telefonesHtml = (aluno.telefones && aluno.telefones.length)
      ? '<br>' + aluno.telefones.map((tel) => `<a class="contact-link" href="tel:+${escapeHtml(tel)}">${escapeHtml(formatarTelefone(tel))}</a>`).join(', ')
      : '';
    return emailHtml + telefonesHtml;
  }

  function sortHeader(label, col) {
    const active = state.sortCol === col;
    const arrow = active ? (state.sortAsc ? ' ▲' : ' ▼') : '';
    return `<th class="alunos-sortable${active ? ' active' : ''}" data-col="${col}">${label}${arrow}</th>`;
  }

  function renderResumoTurma(turma) {
    const total = turma.alunos.length;
    const comPendencia = turma.alunos.filter((a) => a.ucsReprovadas && a.ucsReprovadas.length).length;
    return `<p class="ead-panel-note">${total} estudante${total === 1 ? '' : 's'} regular${total === 1 ? '' : 'es'} nesta turma · ${comPendencia} com UC reprovada pendente</p>`;
  }

  function renderTurmaTable(turma, alunos) {
    return `
      <div class="ead-turma-head">
        <strong>${escapeHtml(turma.nome)} — ${escapeHtml(turma.curso)}</strong>
        ${turma.link ? `<a class="turma-link" href="${escapeHtml(turma.link)}" target="_blank" rel="noreferrer">Abrir no SGN</a>` : ''}
      </div>
      ${renderResumoTurma(turma)}
      <div class="table-shell">
        <div class="table-scroll">
          <table>
            <thead><tr>
              ${sortHeader('Estudante', 'nome')}
              ${sortHeader('Status', 'status')}
              ${sortHeader('UCs reprovadas', 'reprovadas')}
              ${sortHeader('UCs cursando', 'cursando')}
              ${sortHeader('Contato', 'contato')}
            </tr></thead>
            <tbody>
              ${alunos.map((aluno) => {
                const temReprovada = aluno.ucsReprovadas && aluno.ucsReprovadas.length;
                return `
                <tr class="${temReprovada ? 'row-alerta' : ''}">
                  <td><strong>${escapeHtml(aluno.nome)}</strong><br><small>Matrícula ${escapeHtml(aluno.matricula)}</small></td>
                  <td>${escapeHtml(aluno.status)}</td>
                  <td>${ucChips(aluno.ucsReprovadas, 'reprovada')}</td>
                  <td>${ucChips(aluno.ucsCursando, 'cursando')}</td>
                  <td>${contatoCell(aluno)}</td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${alunos.length === 0 ? '<div class="empty-state">Nenhum aluno encontrado com esse filtro.</div>' : ''}
      </div>
      <p class="result-count">${alunos.length} aluno${alunos.length === 1 ? '' : 's'}</p>`;
  }

  function renderAlunosView() {
    const turmas = (state.data && state.data.turmas) || {};
    const options = turmaOptions(turmas);
    const turma = state.turmaId ? turmas[state.turmaId] : null;
    const term = state.search.toLocaleLowerCase('pt-BR').trim();
    const alunos = turma
      ? ordenarAlunos(
          turma.alunos.filter((aluno) => studentMatches(aluno, term) && (!state.somenteReprovados || (aluno.ucsReprovadas && aluno.ucsReprovadas.length))),
          state.sortCol, state.sortAsc,
        )
      : [];

    return {
      html: `
        <div class="panel-card">
          <div class="panel-title">
            <span class="eyebrow">Turmas ETG</span>
            <h2>Consulta por turma</h2>
          </div>
          <div class="alunos-toolbar">
            <label class="field">
              <span>Turma</span>
              <select id="turma-select">
                <option value="">Selecione uma turma</option>
                ${options.map((t) => `<option value="${t.id}" ${String(t.id) === state.turmaId ? 'selected' : ''}>${escapeHtml(t.nome)} — ${escapeHtml(t.curso)} (${t.alunos.length} alunos)</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span>Buscar</span>
              <input id="busca-aluno" placeholder="Nome, matrícula ou UC" value="${escapeHtml(state.search)}" ${turma ? '' : 'disabled'}>
            </label>
            <label class="field checkbox-field">
              <span>&nbsp;</span>
              <label class="checkbox-inline"><input type="checkbox" id="somente-reprovados" ${state.somenteReprovados ? 'checked' : ''} ${turma ? '' : 'disabled'}> Só com reprovação</label>
            </label>
            <div class="alunos-toolbar-actions">
              <button id="export-btn" class="clear-btn" type="button" ${turma ? '' : 'disabled'}>Exportar PDF</button>
            </div>
          </div>
          ${turma ? renderTurmaTable(turma, alunos) : '<div class="empty-state">Selecione uma turma para ver os alunos.</div>'}
        </div>`,
      turma, alunos,
    };
  }

  function exportTurmaToPdf(turma, alunos) {
    if (!window.jspdf) { alert('Biblioteca de PDF não carregada. Recarregue a página.'); return; }
    if (!alunos.length) { alert('Nenhum aluno para exportar com esse filtro.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    doc.setFontSize(13);
    doc.setTextColor(16, 20, 77);
    doc.text(`${turma.nome} — ${turma.curso}`, 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Unidade: ${turma.unidade}  ·  Gerado em ${new Date().toLocaleDateString('pt-BR')}  ·  ${alunos.length} aluno${alunos.length === 1 ? '' : 's'}`, 14, 21);

    doc.autoTable({
      head: [['Aluno', 'Matrícula', 'Status', 'UCs reprovadas', 'UCs cursando']],
      body: alunos.map((aluno) => [
        aluno.nome,
        aluno.matricula,
        aluno.status,
        (aluno.ucsReprovadas && aluno.ucsReprovadas.length) ? aluno.ucsReprovadas.join('\n') : '—',
        (aluno.ucsCursando && aluno.ucsCursando.length) ? aluno.ucsCursando.join('\n') : '—',
      ]),
      startY: 26,
      styles: { fontSize: 7.5, cellPadding: 2, valign: 'top', lineColor: [220, 229, 255], lineWidth: 0.1 },
      headStyles: { fillColor: [16, 20, 77], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 251, 255] },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 18 },
        2: { cellWidth: 26 },
        3: { cellWidth: 45 },
        4: { cellWidth: 45 },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 3 && data.cell.raw !== '—') {
          data.cell.styles.textColor = [159, 18, 57];
          data.cell.styles.fillColor = [255, 241, 242];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    doc.save(`alunos_${turma.nome.replace(/[^a-z0-9]+/gi, '-')}_${stamp}.pdf`);
  }

  // ---------- Abas "UCs EAD do semestre" (ETG) e "UCs EAD CTC" ----------
  // As duas abas compartilham a mesma logica; so muda a fonte de dados e o
  // campo usado pra agrupar (Unidade SENAI no ETG, Supervisor no CTC).

  const EAD_DATASETS = {
    ead: {
      getTurmas: () => (window.EAD_OFERTAS && window.EAD_OFERTAS.turmas) || [],
      geradoEm: () => window.EAD_OFERTAS && window.EAD_OFERTAS.geradoEm,
      groupField: 'unidade',
      groupLabel: 'Unidade',
      groupSelectTodos: 'Todas as unidades',
      eyebrow: 'Turmas ETG',
      titulo: 'UCs 100% EAD do semestre vigente',
      pdfNota: 'O PDF organiza as turmas em blocos por Unidade SENAI e, dentro de cada unidade, por turno (Matutino, Vespertino, Noturno), na ordem de entrada por data.',
      exportLabel: 'Exportar PDF por unidade',
      filenamePrefix: 'ucs-ead-semestre-por-unidade',
      filtroGrupoKey: 'eadUnidade',
      filtroPeriodoKey: 'eadPeriodo',
    },
    ctc: {
      getTurmas: () => (window.EAD_OFERTAS_CTC && window.EAD_OFERTAS_CTC.turmas) || [],
      geradoEm: () => window.EAD_OFERTAS_CTC && window.EAD_OFERTAS_CTC.geradoEm,
      groupField: 'supervisor',
      groupLabel: 'Supervisor',
      groupSelectTodos: 'Todos os supervisores',
      eyebrow: 'Turmas CTC',
      titulo: 'UCs 100% EAD do semestre vigente — CTC',
      pdfNota: 'O PDF organiza as turmas em blocos por Supervisor, na ordem de entrada por data. Turmas CTC de Jaraguá do Sul (alunos pagantes).',
      exportLabel: 'Exportar PDF por supervisor',
      filenamePrefix: 'ucs-ead-semestre-ctc-por-supervisor',
      filtroGrupoKey: 'ctcGrupo',
      filtroPeriodoKey: 'ctcPeriodo',
    },
  };

  function eadRows(viewKey, grupoFiltro, periodoFiltro) {
    const cfg = EAD_DATASETS[viewKey];
    const turmas = cfg.getTurmas();
    const rows = [];
    turmas.forEach((turma) => {
      if (grupoFiltro && turma[cfg.groupField] !== grupoFiltro) return;
      const periodo = periodoDaTurma(turma.nome);
      if (periodoFiltro && periodo.key !== periodoFiltro) return;
      (turma.ucs || []).forEach((uc) => {
        const status = statusOfertaUC(uc);
        if (status.key !== 'andamento' && status.key !== 'futura') return;
        rows.push({ turma, uc, status, periodo });
      });
    });
    rows.sort((a, b) => {
      if (a.status.key !== b.status.key) return a.status.key === 'andamento' ? -1 : 1;
      const ia = a.uc.inicio || '9999';
      const ib = b.uc.inicio || '9999';
      if (ia !== ib) return ia < ib ? -1 : 1;
      return a.turma.nome.localeCompare(b.turma.nome, 'pt-BR');
    });
    return rows;
  }

  // Agrupa pelo campo indicado (Unidade ou Supervisor) e, dentro de cada
  // grupo, por turno (M/V/N), ordenando cada bloco pela data de inicio
  // (ordem de entrada).
  function agruparPorGrupoETurno(rows, groupField) {
    const porGrupo = new Map();
    rows.forEach((row) => {
      const grupo = row.turma[groupField] || 'Sem ' + groupField;
      if (!porGrupo.has(grupo)) porGrupo.set(grupo, new Map());
      const porTurno = porGrupo.get(grupo);
      if (!porTurno.has(row.periodo.key)) porTurno.set(row.periodo.key, []);
      porTurno.get(row.periodo.key).push(row);
    });
    porGrupo.forEach((porTurno) => {
      porTurno.forEach((lista) => {
        lista.sort((a, b) => {
          const ia = a.uc.inicio || '9999';
          const ib = b.uc.inicio || '9999';
          if (ia !== ib) return ia < ib ? -1 : 1;
          const porTurma = a.turma.nome.localeCompare(b.turma.nome, 'pt-BR');
          if (porTurma !== 0) return porTurma;
          return a.uc.uc.localeCompare(b.uc.uc, 'pt-BR');
        });
      });
    });
    return porGrupo;
  }

  function renderEadView(viewKey) {
    const cfg = EAD_DATASETS[viewKey];
    const turmas = cfg.getTurmas();
    const grupos = [...new Set(turmas.map((t) => t[cfg.groupField]))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const turnosPresentes = new Set(turmas.map((t) => periodoDaTurma(t.nome).key));
    const grupoFiltro = state[cfg.filtroGrupoKey];
    const periodoFiltro = state[cfg.filtroPeriodoKey];
    const rows = eadRows(viewKey, grupoFiltro, periodoFiltro);
    const emAndamento = rows.filter((r) => r.status.key === 'andamento').length;
    const entrando = rows.length - emAndamento;
    const geradoEm = cfg.geradoEm();

    const html = `
      <div class="panel-card">
        <div class="panel-title">
          <span class="eyebrow">${escapeHtml(cfg.eyebrow)}</span>
          <h2>${escapeHtml(cfg.titulo)}</h2>
        </div>
        ${geradoEm ? `<p class="ead-panel-note">Matrículas de ${formatarData(geradoEm)}</p>` : ''}
        <div class="ead-resumo">
          <p>${rows.length} oferta${rows.length === 1 ? '' : 's'} EAD ${grupoFiltro || periodoFiltro ? 'com esse filtro' : 'no total'} — apenas o que está em andamento ou entrando (concluídas ficam de fora)</p>
          ${emAndamento || entrando ? `<p class="ead-highlight">${emAndamento} em andamento agora · ${entrando} entrando em breve</p>` : ''}
        </div>
        <div class="alunos-toolbar">
          <label class="field">
            <span>${escapeHtml(cfg.groupLabel)}</span>
            <select id="ead-grupo-select">
              <option value="">${escapeHtml(cfg.groupSelectTodos)}</option>
              ${grupos.map((g) => `<option value="${escapeHtml(g)}" ${g === grupoFiltro ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Turno</span>
            <select id="ead-periodo-select">
              <option value="">Todos os turnos</option>
              ${ORDEM_PERIODO.filter((p) => turnosPresentes.has(p)).map((p) => `<option value="${p}" ${p === periodoFiltro ? 'selected' : ''}>${p === 'outro' ? 'Outro turno' : LABEL_PERIODO[p]}</option>`).join('')}
            </select>
          </label>
          <div class="alunos-toolbar-actions">
            <button id="export-ead-btn" class="clear-btn" type="button" ${rows.length ? '' : 'disabled'}>${escapeHtml(cfg.exportLabel)}</button>
          </div>
        </div>
        <p class="ead-panel-note">${escapeHtml(cfg.pdfNota)}</p>
        ${rows.length ? `
        <div class="table-shell">
          <div class="table-scroll">
            <table>
              <thead><tr>
                <th>Turma</th><th>Turno</th><th>Curso</th><th>${escapeHtml(cfg.groupLabel)}</th><th>UC 100% EAD</th>
                <th class="center">Carga Horária</th><th>Início</th><th>Fim</th><th>Status</th>
              </tr></thead>
              <tbody>
                ${rows.map(({ turma, uc, status, periodo }) => `
                  <tr class="${status.key === 'andamento' ? 'row-andamento' : status.key === 'futura' ? 'row-entrando' : ''}">
                    <td><strong>${escapeHtml(turma.nome)}</strong>${turma.link ? `<br><a class="turma-link" href="${escapeHtml(turma.link)}" target="_blank" rel="noreferrer">Abrir no SGN</a>` : ''}</td>
                    <td>${escapeHtml(periodo.label)}</td>
                    <td>${escapeHtml(turma.curso)}</td>
                    <td>${escapeHtml(turma[cfg.groupField])}</td>
                    <td>${escapeHtml(uc.uc)}${uc.idDiario ? `<br><small class="diario-id">Diário nº ${escapeHtml(uc.idDiario)}</small>` : ''}</td>
                    <td class="center">${uc.cargaHoraria || '?'}h</td>
                    <td>${formatarData(uc.inicio)}</td>
                    <td>${formatarData(uc.fim)}</td>
                    <td><span class="ead-status-badge status-${status.key}">${status.label}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <p class="result-count">${rows.length} oferta${rows.length === 1 ? '' : 's'} EAD</p>
        ` : `<div class="empty-state">Nenhuma UC 100% EAD em andamento ou entrando no momento com esse filtro.</div>`}
      </div>`;
    return { html, rows };
  }

  function exportEadToPdf(viewKey, rows, grupoFiltro, periodoFiltro) {
    if (!window.jspdf) { alert('Biblioteca de PDF não carregada. Recarregue a página.'); return; }
    if (!rows.length) { alert('Nenhuma oferta para exportar com esse filtro.'); return; }
    const cfg = EAD_DATASETS[viewKey];
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const marginLeft = 14;
    const pageHeight = doc.internal.pageSize.getHeight();

    // Um bloco por grupo (Unidade SENAI no ETG, Supervisor no CTC) e, dentro
    // dele, um sub-bloco por turno quando houver mais de um presente, cada
    // um na ordem de entrada por data.
    const agrupado = agruparPorGrupoETurno(rows, cfg.groupField);
    const gruposOrdenados = [...agrupado.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const periodoLabel = periodoFiltro ? (periodoFiltro === 'outro' ? 'Outro turno' : LABEL_PERIODO[periodoFiltro]) : '';

    doc.setFontSize(14);
    doc.setTextColor(16, 20, 77);
    doc.text(
      cfg.titulo + (grupoFiltro ? ' — ' + grupoFiltro : '') + (periodoLabel ? ' — ' + periodoLabel : ''),
      marginLeft, 16,
    );
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(
      `Gerado em ${new Date().toLocaleDateString('pt-BR')}  ·  ${rows.length} oferta${rows.length === 1 ? '' : 's'} em ${gruposOrdenados.length} ${cfg.groupLabel.toLowerCase()}${gruposOrdenados.length === 1 ? '' : 's'} (em andamento ou entrando, por turno e ordem de entrada)`,
      marginLeft, 22,
    );

    let y = 30;
    gruposOrdenados.forEach((grupo) => {
      const porTurno = agrupado.get(grupo);
      const totalGrupo = [...porTurno.values()].reduce((n, lista) => n + lista.length, 0);
      if (y > pageHeight - 40) { doc.addPage(); y = 16; }
      doc.setFontSize(12.5);
      doc.setTextColor(16, 20, 77);
      doc.text(`${grupo}  ·  ${totalGrupo} oferta${totalGrupo === 1 ? '' : 's'}`, marginLeft, y);
      y += 6;

      const mostrarSubTitulo = porTurno.size > 1;
      ORDEM_PERIODO.forEach((turnoKey) => {
        const lista = porTurno.get(turnoKey);
        if (!lista || !lista.length) return;
        if (mostrarSubTitulo) {
          if (y > pageHeight - 30) { doc.addPage(); y = 16; }
          doc.setFontSize(10.5);
          doc.setTextColor(60, 68, 110);
          const label = turnoKey === 'outro' ? 'Outro turno' : LABEL_PERIODO[turnoKey];
          doc.text(`${label} (${lista.length})`, marginLeft + 2, y);
          y += 4;
        }

        doc.autoTable({
          head: [['Turma', 'Curso', 'UC 100% EAD', 'Carga Horária', 'Início', 'Fim', 'Status']],
          body: lista.map(({ turma, uc, status }) => [
            turma.nome, turma.curso, uc.uc, `${uc.cargaHoraria || '?'}h`,
            formatarData(uc.inicio), formatarData(uc.fim), status.label,
          ]),
          startY: y,
          margin: { left: marginLeft, right: marginLeft },
          styles: { fontSize: 8, cellPadding: 2, valign: 'top', lineColor: [220, 229, 255], lineWidth: 0.1 },
          headStyles: { fillColor: [16, 20, 77], textColor: 255, fontStyle: 'bold' },
          // Farol: linha inteira tingida pelo status da UC na data de hoje
          // (verde = andamento, amarelo = entrando), igual na tela.
          didParseCell: (data) => {
            if (data.section !== 'body') return;
            const statusRaw = data.row.raw[6];
            if (statusRaw === 'Em andamento') {
              data.cell.styles.fillColor = [214, 247, 224];
              if (data.column.index === 6) {
                data.cell.styles.textColor = [12, 107, 36];
                data.cell.styles.fontStyle = 'bold';
              }
            } else if (statusRaw === 'Entrando') {
              data.cell.styles.fillColor = [255, 244, 199];
              if (data.column.index === 6) {
                data.cell.styles.textColor = [146, 100, 6];
                data.cell.styles.fontStyle = 'bold';
              }
            }
          },
        });
        y = doc.lastAutoTable.finalY + 8;
      });
      y += 3;
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const sufixoGrupo = grupoFiltro ? '-' + grupoFiltro.replace(/[^a-z0-9]+/gi, '-') : '';
    const sufixoTurno = periodoLabel ? '-' + periodoLabel.replace(/[^a-z0-9]+/gi, '-') : '';
    doc.save(`${cfg.filenamePrefix}${sufixoGrupo}${sufixoTurno}_${stamp}.pdf`);
  }

  // ---------- Casca comum ----------

  function renderApp() {
    const mode = authMode();
    const authReady = mode === 'ready';
    const isEadView = state.view === 'ead' || state.view === 'ctc';
    const alunosView = (state.view === 'alunos' && authReady) ? renderAlunosView() : null;
    const eadView = isEadView ? renderEadView(state.view) : null;
    const bodyHtml = isEadView
      ? eadView.html
      : (authReady ? alunosView.html : renderAuthGatePanel(mode));

    root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="color-line"></div>
          <div class="header-inner">
            <div class="header-copy">
              <h1>CTSED &middot; Turmas ETG</h1>
              <p class="subtitle">${authReady ? `Área privada &middot; ${escapeHtml(state.profile.display_name || state.user.email)}` : 'Oferta de UCs 100% EAD do semestre vigente'}</p>
            </div>
          </div>
          <div class="stats-strip">
            ${window.EAD_OFERTAS && window.EAD_OFERTAS.geradoEm ? `<span class="stat-pill">Oferta EAD de ${formatarData(window.EAD_OFERTAS.geradoEm)}</span>` : ''}
            ${authReady ? `<span class="stat-pill">${escapeHtml(state.user.email)}</span>` : ''}
            ${authReady ? `<span class="stat-pill">Alunos de ${formatarData(state.data ? state.data.geradoEm : '')}</span>` : ''}
            ${authReady ? '<button id="logout-btn-header" class="stat-pill stat-pill-btn" type="button">Sair</button>' : ''}
          </div>
          <div class="color-line"></div>
        </header>
        <nav class="main-nav" role="tablist" aria-label="Seções">
          <button type="button" role="tab" aria-selected="${state.view === 'ead'}" class="nav-btn${state.view === 'ead' ? ' active' : ''}" data-view="ead">UCs EAD do semestre</button>
          <button type="button" role="tab" aria-selected="${state.view === 'ctc'}" class="nav-btn${state.view === 'ctc' ? ' active' : ''}" data-view="ctc">UCs EAD CTC</button>
          <button type="button" role="tab" aria-selected="${state.view === 'alunos'}" class="nav-btn${state.view === 'alunos' ? ' active' : ''}" data-view="alunos">Alunos por Turma${authReady ? '' : ' 🔒'}</button>
        </nav>
        <main class="main-content">
          <section class="ead-panel-centered">
            ${bodyHtml}
          </section>
        </main>
      </div>`;

    document.querySelectorAll('.main-nav .nav-btn').forEach((btn) => btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      renderApp();
    }));

    const logoutHeaderBtn = document.getElementById('logout-btn-header');
    if (logoutHeaderBtn) logoutHeaderBtn.addEventListener('click', () => auth.signOut());

    if (isEadView) {
      const cfg = EAD_DATASETS[state.view];
      const grupoSelect = document.getElementById('ead-grupo-select');
      if (grupoSelect) {
        grupoSelect.addEventListener('change', (event) => {
          state[cfg.filtroGrupoKey] = event.target.value;
          renderApp();
        });
      }
      const periodoSelect = document.getElementById('ead-periodo-select');
      if (periodoSelect) {
        periodoSelect.addEventListener('change', (event) => {
          state[cfg.filtroPeriodoKey] = event.target.value;
          renderApp();
        });
      }
      const exportEadBtn = document.getElementById('export-ead-btn');
      if (exportEadBtn) {
        exportEadBtn.addEventListener('click', () => exportEadToPdf(
          state.view, eadView.rows, state[cfg.filtroGrupoKey], state[cfg.filtroPeriodoKey],
        ));
      }
      return;
    }

    // view === 'alunos'
    if (!authReady) {
      wireAuthGate(mode);
      return;
    }
    const { turma, alunos } = alunosView;
    document.getElementById('turma-select').addEventListener('change', (event) => {
      state.turmaId = event.target.value;
      state.search = '';
      renderApp();
    });
    const buscaInput = document.getElementById('busca-aluno');
    if (buscaInput) {
      buscaInput.addEventListener('input', (event) => {
        state.search = event.target.value;
        renderApp();
        document.getElementById('busca-aluno').focus();
        document.getElementById('busca-aluno').selectionStart = document.getElementById('busca-aluno').value.length;
      });
    }
    const somenteReprovadosInput = document.getElementById('somente-reprovados');
    if (somenteReprovadosInput) {
      somenteReprovadosInput.addEventListener('change', (event) => {
        state.somenteReprovados = event.target.checked;
        renderApp();
      });
    }
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn && turma) exportBtn.addEventListener('click', () => exportTurmaToPdf(turma, alunos));
    document.querySelectorAll('.alunos-sortable').forEach((th) => th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) state.sortAsc = !state.sortAsc;
      else { state.sortCol = col; state.sortAsc = true; }
      renderApp();
    }));
  }

  async function refreshSetupComplete() {
    try {
      const snap = await db.ref('public/setupComplete').once('value');
      state.setupComplete = snap.val() === true;
    } catch (err) {
      // Regras negam leitura de public/setupComplete apenas em casos anormais;
      // segue assumindo setup concluido (tela de login padrao) se isso falhar.
      state.setupComplete = true;
    }
  }

  auth.onAuthStateChanged(async (user) => {
    state.user = user;
    state.profile = null;
    state.data = null;
    if (state.setupComplete === null) await refreshSetupComplete();
    if (user) {
      try {
        const profileSnap = await db.ref('users/' + user.uid).once('value');
        const profile = profileSnap.val();
        if (profile && profile.active) {
          state.profile = profile;
          const dataSnap = await db.ref('alunosPorTurma').once('value');
          state.data = { turmas: {}, ...(dataSnap.val() || {}) };
        }
      } catch (err) {
        state.authErrorMsg = traduzErro(err);
      }
    }
    state.authResolved = true;
    renderApp();
  });

  // Primeira pintura: a oferta EAD nao depende de login, entao a tela ja
  // aparece de cara. "Alunos por Turma" so pede acesso quando for aberta.
  renderApp();
})();
