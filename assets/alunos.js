(function () {
  const app = firebase.initializeApp(window.ALUNOS_FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.database();
  const root = document.getElementById('root');

  const state = { user: null, profile: null, data: null, turmaId: '', search: '', sortCol: 'nome', sortAsc: true };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function showError(message) {
    const node = document.getElementById('auth-error');
    if (node) node.textContent = message || '';
  }

  function renderLogin(mode) {
    const titles = {
      login: ['Área privada', 'Entrar com e-mail e senha para consultar os alunos por turma.'],
      setup: ['Configuração inicial', 'Nenhum administrador cadastrado ainda. Crie o primeiro acesso (o seu).'],
      pending: ['Acesso pendente', 'Sua conta ainda não foi liberada. Peça para um administrador liberar seu acesso.'],
    };
    const [title, subtitle] = titles[mode] || titles.login;
    root.innerHTML = `
      <div class="auth-shell">
        <div class="auth-panel panel-card">
          <span class="eyebrow">CTSED &middot; privado</span>
          <h1>${title}</h1>
          <p class="auth-subtitle">${subtitle}</p>
          ${mode === 'pending' ? `
            <button id="logout-btn" class="clear-btn" type="button">Sair</button>
          ` : `
            <form id="auth-form" class="auth-form">
              ${mode === 'setup' ? '<label class="field"><span>Nome completo</span><input name="name" required autocomplete="name"></label>' : ''}
              <label class="field"><span>E-mail</span><input name="email" type="email" required autocomplete="username"></label>
              <label class="field"><span>Senha</span><input name="password" type="password" minlength="6" required autocomplete="${mode === 'setup' ? 'new-password' : 'current-password'}"></label>
              <button type="submit" class="clear-btn">${mode === 'setup' ? 'Criar administrador' : 'Entrar'}</button>
              <div id="auth-error" class="form-error"></div>
            </form>
          `}
        </div>
      </div>`;
    if (mode === 'pending') {
      document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());
      return;
    }
    document.getElementById('auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      showError('');
      const form = new FormData(event.currentTarget);
      const email = form.get('email').trim();
      const password = form.get('password');
      try {
        if (mode === 'setup') {
          const credential = await auth.createUserWithEmailAndPassword(email, password);
          await db.ref('users/' + credential.user.uid).set({
            display_name: form.get('name').trim(),
            role: 'admin',
            active: true,
          });
          await db.ref('public/setupComplete').set(true);
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

  function renderApp() {
    const turmas = (state.data && state.data.turmas) || {};
    const options = turmaOptions(turmas);
    const turma = state.turmaId ? turmas[state.turmaId] : null;
    const term = state.search.toLocaleLowerCase('pt-BR').trim();
    const alunos = turma
      ? ordenarAlunos(turma.alunos.filter((aluno) => studentMatches(aluno, term)), state.sortCol, state.sortAsc)
      : [];

    root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="color-line"></div>
          <div class="header-inner">
            <div class="header-copy">
              <h1>Alunos por Turma</h1>
              <p class="subtitle">Área privada &middot; ${escapeHtml(state.profile.display_name || state.user.email)}</p>
            </div>
          </div>
          <div class="stats-strip">
            <span class="stat-pill">${escapeHtml(state.user.email)}</span>
            <span class="stat-pill">Dados de ${formatarData(state.data ? state.data.geradoEm : '')}</span>
          </div>
          <div class="color-line"></div>
        </header>
        <main class="main-content">
          <section class="ead-panel-centered">
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
                <div class="alunos-toolbar-actions">
                  <button id="export-btn" class="clear-btn" type="button" ${turma ? '' : 'disabled'}>Exportar PDF</button>
                  <button id="logout-btn" class="ghost-btn" type="button">Sair</button>
                </div>
              </div>
              ${turma ? renderTurmaTable(turma, alunos) : '<div class="empty-state">Selecione uma turma para ver os alunos.</div>'}
            </div>
          </section>
        </main>
      </div>`;

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
    document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn && turma) exportBtn.addEventListener('click', () => exportTurmaToPdf(turma, alunos));
    document.querySelectorAll('.alunos-sortable').forEach((th) => th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) state.sortAsc = !state.sortAsc;
      else { state.sortCol = col; state.sortAsc = true; }
      renderApp();
    }));
  }

  function sortHeader(label, col) {
    const active = state.sortCol === col;
    const arrow = active ? (state.sortAsc ? ' ▲' : ' ▼') : '';
    return `<th class="alunos-sortable${active ? ' active' : ''}" data-col="${col}">${label}${arrow}</th>`;
  }

  function ucChips(lista, tipo) {
    if (!lista || !lista.length) return '<span class="empty-cell">—</span>';
    return `<div class="uc-chip-stack">${lista.map((uc) => `<span class="uc-chip-linha ${tipo}">${escapeHtml(uc)}</span>`).join('')}</div>`;
  }

  function renderTurmaTable(turma, alunos) {
    return `
      <div class="ead-turma-head">
        <strong>${escapeHtml(turma.nome)} — ${escapeHtml(turma.curso)}</strong>
        ${turma.link ? `<a class="turma-link" href="${escapeHtml(turma.link)}" target="_blank" rel="noreferrer">Abrir no SGN</a>` : ''}
      </div>
      <div class="table-shell">
        <div class="table-scroll">
          <table>
            <thead><tr>
              ${sortHeader('Aluno', 'nome')}
              ${sortHeader('Status', 'status')}
              ${sortHeader('UCs reprovadas', 'reprovadas')}
              ${sortHeader('UCs cursando', 'cursando')}
              ${sortHeader('Contato', 'contato')}
            </tr></thead>
            <tbody>
              ${alunos.map((aluno) => `
                <tr>
                  <td><strong>${escapeHtml(aluno.nome)}</strong><br><small>Matrícula ${escapeHtml(aluno.matricula)}</small></td>
                  <td>${escapeHtml(aluno.status)}</td>
                  <td>${ucChips(aluno.ucsReprovadas, 'reprovada')}</td>
                  <td>${ucChips(aluno.ucsCursando, 'cursando')}</td>
                  <td>${escapeHtml(aluno.email || '')}${aluno.telefones && aluno.telefones.length ? '<br>' + escapeHtml(aluno.telefones.join(', ')) : ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${alunos.length === 0 ? '<div class="empty-state">Nenhum aluno encontrado com esse filtro.</div>' : ''}
      </div>
      <p class="result-count">${alunos.length} aluno${alunos.length === 1 ? '' : 's'}</p>`;
  }

  function formatarData(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  function exportTurmaToPdf(turma, alunos) {
    if (!window.jspdf) { alert('Biblioteca de PDF não carregada. Recarregue a página.'); return; }
    if (!alunos.length) { alert('Nenhum aluno para exportar com esse filtro.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFontSize(14);
    doc.setTextColor(16, 20, 77);
    doc.text(`${turma.nome} — ${turma.curso}`, 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Unidade: ${turma.unidade}  ·  Gerado em ${new Date().toLocaleDateString('pt-BR')}  ·  ${alunos.length} aluno${alunos.length === 1 ? '' : 's'}`, 14, 21);

    doc.autoTable({
      head: [['Aluno', 'Matrícula', 'Status', 'UCs reprovadas', 'UCs cursando', 'E-mail']],
      body: alunos.map((aluno) => [
        aluno.nome,
        aluno.matricula,
        aluno.status,
        (aluno.ucsReprovadas && aluno.ucsReprovadas.length) ? aluno.ucsReprovadas.join('\n') : '—',
        (aluno.ucsCursando && aluno.ucsCursando.length) ? aluno.ucsCursando.join('\n') : '—',
        aluno.email || '',
      ]),
      startY: 26,
      styles: { fontSize: 8, cellPadding: 2.2, valign: 'top', lineColor: [220, 229, 255], lineWidth: 0.1 },
      headStyles: { fillColor: [16, 20, 77], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 251, 255] },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 22 },
        2: { cellWidth: 32 },
        3: { cellWidth: 68 },
        4: { cellWidth: 68 },
        5: { cellWidth: 45 },
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

  auth.onAuthStateChanged(async (user) => {
    state.user = user;
    let setupComplete = true;
    try {
      const setupSnap = await db.ref('public/setupComplete').once('value');
      setupComplete = setupSnap.val() === true;
    } catch (err) {
      // Regras negam leitura de public/setupComplete apenas em casos anormais;
      // segue assumindo setup concluido (tela de login padrao) se isso falhar.
    }
    if (!user) {
      renderLogin(setupComplete ? 'login' : 'setup');
      return;
    }
    try {
      const profileSnap = await db.ref('users/' + user.uid).once('value');
      const profile = profileSnap.val();
      if (profile && profile.active) {
        state.profile = profile;
        const dataSnap = await db.ref('alunosPorTurma').once('value');
        state.data = { turmas: {}, ...(dataSnap.val() || {}) };
        renderApp();
        return;
      }
      renderLogin(setupComplete ? 'pending' : 'setup');
    } catch (err) {
      renderLogin('login');
      showError(traduzErro(err));
    }
  });
})();
