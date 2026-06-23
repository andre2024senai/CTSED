(function () {
  const { useMemo, useState } = React;
  const h = React.createElement;
  const CURSOS = window.CURSOS || [];
  const TURMAS_ETG = window.TURMAS_ETG || [];
  const TURMAS_CTC = window.TURMAS_CTC || [];
  const TURMAS_BASE = [
    ...TURMAS_ETG.map((turma) => ({ ...turma, origem: turma.origem || 'ETG' })),
    ...TURMAS_CTC.map((turma) => ({ ...turma, origem: turma.origem || 'CTC' }))
  ];

  function normalizar(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function onlyDigits(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    const numeric = Number(raw.replace(',', '.'));
    if (Number.isFinite(numeric)) return String(Math.trunc(numeric));
    return raw.replace(/\D/g, '');
  }

  function cleanUcName(value) {
    return String(value || '').replace(/^"|"$/g, '').trim();
  }

  function splitUcs(value) {
    const text = String(value || '').trim();
    if (!text) return [];
    const quoted = [...text.matchAll(/"([^"]+)"/g)].map((match) => cleanUcName(match[1]));
    if (quoted.length) return quoted.filter(Boolean);
    return text.split(',').map(cleanUcName).filter(Boolean);
  }

  function classeModulo(modulo) {
    const mod = normalizar(modulo);
    if (mod.includes('industria')) return 'mod-industria';
    if (mod.includes('introdutorio')) return 'mod-introdutorio';
    if (mod.includes('especifico')) return 'mod-especifico';
    if (mod.includes('inovacao')) return 'mod-inovacao';
    return 'mod-outro';
  }

  function highlight(text, term) {
    if (!term) return text;
    const raw = String(text);
    const normalized = normalizar(raw);
    const normalizedTerm = normalizar(term);
    const index = normalized.indexOf(normalizedTerm);
    if (index < 0) return raw;
    const before = raw.slice(0, index);
    const match = raw.slice(index, index + normalizedTerm.length);
    const after = raw.slice(index + normalizedTerm.length);
    return [before, h('mark', { key: 'match' }, match), after];
  }

  function flattenCursos() {
    return CURSOS.flatMap((curso) => curso.unidades.map((unidade) => ({
      curso: curso.nome,
      url: curso.url,
      totalHorasCurso: curso.totalHoras,
      periodo: unidade.periodo,
      modulo: unidade.modulo,
      nome: unidade.nome,
      horas: unidade.horas
    })));
  }

  function sortRows(rows, sortCol, sortAsc) {
    const periodoOrdem = { '1\u00ba Per\u00edodo': 1, '2\u00ba Per\u00edodo': 2, '3\u00ba Per\u00edodo': 3, '4\u00ba Per\u00edodo': 4 };
    return [...rows].sort((a, b) => {
      let va = a[sortCol];
      let vb = b[sortCol];
      if (sortCol === 'horas') {
        va = Number(va);
        vb = Number(vb);
      } else if (sortCol === 'periodo') {
        va = periodoOrdem[va] || 9;
        vb = periodoOrdem[vb] || 9;
      } else {
        va = normalizar(va);
        vb = normalizar(vb);
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  function buildTurmaMap() {
    const map = new Map();
    TURMAS_BASE.forEach((turma) => {
      const codigo = onlyDigits(turma.codigoTurma);
      if (codigo && !map.has(codigo)) map.set(codigo, turma);
    });
    return map;
  }

  function sheetToRows(workbook) {
    const sheetNames = workbook.SheetNames || [];
    const preferred = sheetNames.find((name) => normalizar(name).includes('ucsreprovadasbase')) || sheetNames[0];
    const sheet = workbook.Sheets[preferred];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    if (rows.some((row) => row['ID Turma'] !== undefined && row['UC Reprovada'] !== undefined)) {
      return { sheetName: preferred, rows };
    }
    for (const name of sheetNames) {
      const candidate = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '', raw: false });
      if (candidate.some((row) => row['ID Turma'] !== undefined && row['UC Reprovada'] !== undefined)) {
        return { sheetName: name, rows: candidate };
      }
    }
    return { sheetName: preferred, rows };
  }

  function compareADMRows(rows, turmaMap) {
    const matched = [];
    const unmatched = [];
    rows.forEach((row, index) => {
      const idTurma = onlyDigits(row['ID Turma']);
      if (!idTurma) return;
      const turmaBase = turmaMap.get(idTurma);
      const ucs = splitUcs(row['UC Reprovada']);
      const item = {
        rowNumber: index + 2,
        idTurma,
        unidade: row.Unidade || '',
        modalidade: row.Modaliade || row.Modalidade || '',
        produtoADM: row.Produto || '',
        terminoTurma: row['T\u00e9rmino Turma'] || '',
        aluno: row.Nome || row.NOME || '',
        ucReprovada: row['UC Reprovada'] || '',
        ucs,
        encaminhamento: row['Encaminhamento (Supervisor)'] || row.Encaminhamento || '',
        turmaBase
      };
      if (turmaBase) matched.push(item);
      else unmatched.push(item);
    });
    return { matched, unmatched };
  }

  function Header({ totalCursos, totalUnidades, totalHoras }) {
    return h('header', { className: 'topbar' },
      h('div', { className: 'color-line' }),
      h('div', { className: 'header-inner' },
        h('img', { className: 'brand-logo', src: 'assets/logo-ensino-tecnico-gratuito.png', alt: 'Ensino T\u00e9cnico Gratuito' }),
        h('div', { className: 'header-copy' },
          h('h1', null, 'Cursos T\u00e9cnicos Gratuitos SED \u2014 Unidades Curriculares'),
          h('p', { className: 'subtitle' }, 'Consulta, importa\u00e7\u00e3o e compara\u00e7\u00e3o de pend\u00eancias por turma')
        )
      ),
      h('div', { className: 'stats-strip' },
        h('span', { className: 'stat-pill' }, totalCursos + ' cursos'),
        h('span', { className: 'stat-pill' }, totalUnidades + ' unidades curriculares'),
        h('span', { className: 'stat-pill' }, TURMAS_ETG.length + ' turmas ETG'),
        h('span', { className: 'stat-pill' }, TURMAS_CTC.length + ' turmas CTC'),
        h('span', { className: 'stat-pill' }, totalHoras.toLocaleString('pt-BR') + 'h mapeadas')
      ),
      h('div', { className: 'color-line' })
    );
  }

  function Filters({ busca, setBusca, curso, setCurso, modulo, setModulo, periodo, setPeriodo, onClear }) {
    return h('section', { className: 'controls-band', 'aria-label': 'Filtros' },
      h('div', { className: 'controls-inner' },
        h('label', { className: 'field' },
          h('span', null, 'Buscar unidade curricular'),
          h('input', { value: busca, onChange: (event) => setBusca(event.target.value), placeholder: 'Ex: manuten\u00e7\u00e3o, projetos, qu\u00edmica...' })
        ),
        h('label', { className: 'field' },
          h('span', null, 'Curso'),
          h('select', { value: curso, onChange: (event) => setCurso(event.target.value) },
            h('option', { value: '' }, 'Todos os cursos'),
            CURSOS.map((item) => h('option', { key: item.nome, value: item.nome }, item.nome))
          )
        ),
        h('label', { className: 'field' },
          h('span', null, 'M\u00f3dulo'),
          h('select', { value: modulo, onChange: (event) => setModulo(event.target.value) },
            h('option', { value: '' }, 'Todos os m\u00f3dulos'),
            h('option', { value: 'Ind\u00fastria' }, 'Ind\u00fastria'),
            h('option', { value: 'Introdut\u00f3rio' }, 'Introdut\u00f3rio'),
            h('option', { value: 'Espec\u00edfico' }, 'Espec\u00edfico (I / II / III...)'),
            h('option', { value: 'Inova\u00e7\u00e3o' }, 'Inova\u00e7\u00e3o')
          )
        ),
        h('label', { className: 'field' },
          h('span', null, 'Per\u00edodo'),
          h('select', { value: periodo, onChange: (event) => setPeriodo(event.target.value) },
            h('option', { value: '' }, 'Todos os per\u00edodos'),
            ['1\u00ba Per\u00edodo', '2\u00ba Per\u00edodo', '3\u00ba Per\u00edodo', '4\u00ba Per\u00edodo'].map((p) => h('option', { key: p, value: p }, p))
          )
        ),
        h('button', { className: 'clear-btn', type: 'button', onClick: onClear }, 'Limpar filtros')
      )
    );
  }

  function ImportPanel({ adm, onImport, onClearImport, onSearchUc }) {
    const hasRows = adm.matched.length > 0;
    const totalETG = adm.matched.filter((item) => item.turmaBase && item.turmaBase.origem === 'ETG').length;
    const totalCTC = adm.matched.filter((item) => item.turmaBase && item.turmaBase.origem === 'CTC').length;
    return h('aside', { className: 'import-panel' },
      h('div', { className: 'panel-card' },
        h('div', { className: 'panel-title' },
          h('span', { className: 'eyebrow' }, 'Planilha ADM'),
          h('h2', null, 'Importar pend\u00eancias')
        ),
        h('label', { className: 'upload-box' },
          h('input', { type: 'file', accept: '.xlsx,.xls', onChange: onImport }),
          h('strong', null, 'Selecionar planilha'),
          h('span', null, adm.fileName || 'Use o relat\u00f3rio com a aba UCsReprovadasBase')
        ),
        adm.error ? h('div', { className: 'notice danger' }, adm.error) : null,
        adm.fileName ? h('div', { className: 'notice' }, 'Aba lida: ' + (adm.sheetName || 'n\u00e3o identificada')) : null,
        h('div', { className: 'metric-grid' },
          h('div', { className: 'metric' }, h('strong', null, adm.totalImported), h('span', null, 'linhas lidas')),
          h('div', { className: 'metric success' }, h('strong', null, totalETG), h('span', null, 'alunos ETG')),
          h('div', { className: 'metric ctc' }, h('strong', null, totalCTC), h('span', null, 'alunos CTC')),
          h('div', { className: 'metric muted' }, h('strong', null, adm.unmatched.length), h('span', null, 'fora da base'))
        ),
        adm.fileName ? h('button', { className: 'ghost-btn', type: 'button', onClick: onClearImport }, 'Limpar importa\u00e7\u00e3o') : null
      ),
      h('div', { className: 'panel-card compact' },
        h('div', { className: 'panel-title' },
          h('span', { className: 'eyebrow' }, 'Resultado filtrado'),
          h('h2', null, 'UCs reprovadas em turmas ETG e CTC')
        ),
        hasRows ? h('div', { className: 'matched-list' },
          adm.matched.slice(0, 120).map((item) => h('article', { className: 'student-item', key: item.rowNumber + item.idTurma + item.aluno },
            h('div', { className: 'student-head' },
              h('strong', null, item.aluno || 'Aluno sem nome'),
              item.turmaBase.linkTurma
                ? h('a', { className: 'turma-link', href: item.turmaBase.linkTurma, target: '_blank', rel: 'noreferrer', title: 'Abrir turma no SGN' }, '#' + item.idTurma)
                : h('span', { className: 'turma-code' }, '#' + item.idTurma),
              h('span', { className: 'origin-badge origin-' + normalizar(item.turmaBase.origem) }, item.turmaBase.origem)
            ),
            h('p', null, item.turmaBase.nomeTurma + ' \u00b7 ' + item.turmaBase.produto),
            h('div', { className: 'uc-chip-row' },
              item.ucs.map((uc) => h('button', { key: uc, type: 'button', className: 'uc-chip', onClick: () => onSearchUc(uc, item.turmaBase.produto) }, uc))
            )
          )),
          adm.matched.length > 120 ? h('div', { className: 'notice' }, 'Mostrando 120 de ' + adm.matched.length + ' registros filtrados.') : null
        ) : h('div', { className: 'empty-panel' }, adm.fileName ? 'Nenhum ID Turma encontrado nas bases ETG/CTC.' : 'Importe a planilha para ver os alunos filtrados automaticamente.')
      )
    );
  }

  function CourseCards({ cursoSelecionado, onSelect }) {
    return h('section', null,
      h('div', { className: 'section-head' },
        h('h2', null, 'Cursos'),
        h('span', { className: 'result-count' }, 'Clique em um curso para filtrar')
      ),
      h('div', { className: 'course-grid' },
        CURSOS.map((curso) => h('button', {
          key: curso.nome,
          type: 'button',
          className: 'course-card' + (cursoSelecionado === curso.nome ? ' active' : ''),
          onClick: () => onSelect(cursoSelecionado === curso.nome ? '' : curso.nome)
        },
          h('strong', null, curso.nome),
          h('small', null, curso.unidades.length + ' UCs \u00b7 ' + curso.totalHoras + 'h')
        ))
      )
    );
  }

  function TableHeader({ label, column, sortCol, sortAsc, onSort, center }) {
    const active = sortCol === column;
    return h('th', { className: 'sortable' + (center ? ' center' : ''), onClick: () => onSort(column) },
      label,
      h('span', { 'aria-hidden': 'true' }, active ? (sortAsc ? ' \u25b2' : ' \u25bc') : '')
    );
  }

  function UnitsTable({ rows, busca, sortCol, sortAsc, onSort }) {
    return h('section', null,
      h('div', { className: 'section-head' },
        h('h2', null, 'Unidades curriculares'),
        h('span', { className: 'result-count' }, rows.length + ' resultado' + (rows.length === 1 ? '' : 's'))
      ),
      h('div', { className: 'table-shell' },
        h('div', { className: 'table-scroll' },
          h('table', null,
            h('thead', null,
              h('tr', null,
                h(TableHeader, { label: 'Curso', column: 'curso', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'Per\u00edodo', column: 'periodo', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'M\u00f3dulo', column: 'modulo', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'Unidade Curricular', column: 'nome', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'Carga Hor\u00e1ria', column: 'horas', sortCol, sortAsc, onSort, center: true })
              )
            ),
            h('tbody', null,
              rows.map((row, index) => h('tr', { key: row.curso + row.nome + index },
                h('td', null, h('a', { className: 'course-link', href: row.url, target: '_blank', rel: 'noreferrer' }, row.curso)),
                h('td', null, h('span', { className: 'badge period-badge' }, row.periodo)),
                h('td', null, h('span', { className: 'badge ' + classeModulo(row.modulo) }, row.modulo)),
                h('td', null, highlight(row.nome, busca)),
                h('td', { className: 'hours' }, row.horas + 'h')
              ))
            )
          )
        ),
        rows.length === 0 ? h('div', { className: 'empty-state' }, 'Nenhuma unidade curricular encontrada com estes filtros.') : null
      )
    );
  }

  function App() {
    const [busca, setBusca] = useState('');
    const [curso, setCurso] = useState('');
    const [modulo, setModulo] = useState('');
    const [periodo, setPeriodo] = useState('');
    const [sortCol, setSortCol] = useState('curso');
    const [sortAsc, setSortAsc] = useState(true);
    const [adm, setADM] = useState({ fileName: '', sheetName: '', totalImported: 0, matched: [], unmatched: [], error: '' });
    const allRows = useMemo(flattenCursos, []);
    const totalHoras = useMemo(() => CURSOS.reduce((sum, item) => sum + item.totalHoras, 0), []);
    const turmaMap = useMemo(buildTurmaMap, []);

    const rows = useMemo(() => {
      const termoBusca = normalizar(busca);
      const filtroModulo = normalizar(modulo);
      const filtradas = allRows.filter((row) => {
        if (curso && row.curso !== curso) return false;
        if (periodo && row.periodo !== periodo) return false;
        if (termoBusca && !normalizar(row.nome).includes(termoBusca) && !normalizar(row.curso).includes(termoBusca)) return false;
        if (filtroModulo) {
          const moduloRow = normalizar(row.modulo);
          if (filtroModulo === 'especifico') return moduloRow.includes('especifico');
          return moduloRow.includes(filtroModulo);
        }
        return true;
      });
      return sortRows(filtradas, sortCol, sortAsc);
    }, [allRows, busca, curso, modulo, periodo, sortCol, sortAsc]);

    function clearFilters() {
      setBusca('');
      setCurso('');
      setModulo('');
      setPeriodo('');
    }

    function handleSort(column) {
      if (sortCol === column) setSortAsc((current) => !current);
      else {
        setSortCol(column);
        setSortAsc(true);
      }
    }

    function handleSearchUc(uc, produto) {
      setBusca(uc);
      setModulo('');
      setPeriodo('');
      const produtoNorm = normalizar(produto).replace(/\s*\(2025\)$/, '');
      const matchedCourse = CURSOS.find((item) => normalizar(item.nome) === produtoNorm || produtoNorm.includes(normalizar(item.nome)) || normalizar(item.nome).includes(produtoNorm));
      setCurso(matchedCourse ? matchedCourse.nome : '');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function handleImport(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (!window.XLSX) {
        setADM({ fileName: file.name, sheetName: '', totalImported: 0, matched: [], unmatched: [], error: 'Biblioteca de leitura XLSX n\u00e3o carregada. Verifique sua conex\u00e3o e recarregue a p\u00e1gina.' });
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const { sheetName, rows: importedRows } = sheetToRows(workbook);
        const compared = compareADMRows(importedRows, turmaMap);
        setADM({ fileName: file.name, sheetName, totalImported: importedRows.length, matched: compared.matched, unmatched: compared.unmatched, error: '' });
      } catch (error) {
        setADM({ fileName: file.name, sheetName: '', totalImported: 0, matched: [], unmatched: [], error: 'N\u00e3o foi poss\u00edvel ler a planilha. Confirme se o arquivo est\u00e1 em .xlsx e possui a aba de UCs reprovadas.' });
      } finally {
        event.target.value = '';
      }
    }

    function clearImport() {
      setADM({ fileName: '', sheetName: '', totalImported: 0, matched: [], unmatched: [], error: '' });
    }

    return h('div', { className: 'app-shell' },
      h(Header, { totalCursos: CURSOS.length, totalUnidades: allRows.length, totalHoras }),
      h(Filters, { busca, setBusca, curso, setCurso, modulo, setModulo, periodo, setPeriodo, onClear: clearFilters }),
      h('main', { className: 'main-content workspace-layout' },
        h(ImportPanel, { adm, onImport: handleImport, onClearImport: clearImport, onSearchUc: handleSearchUc }),
        h('div', { className: 'content-area' },
          h(CourseCards, { cursoSelecionado: curso, onSelect: setCurso }),
          h(UnitsTable, { rows, busca, sortCol, sortAsc, onSort: handleSort }),
          h('div', { className: 'footer-note' }, 'Dados organizados para consulta das unidades curriculares dos cursos t\u00e9cnicos gratuitos.')
        )
      )
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
