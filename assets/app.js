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

  function getADMItems(adm, admFilter) {
    const allItems = [...adm.matched, ...adm.unmatched];
    if (admFilter === 'etg') return adm.matched.filter((item) => item.turmaBase && item.turmaBase.origem === 'ETG');
    if (admFilter === 'ctc') return adm.matched.filter((item) => item.turmaBase && item.turmaBase.origem === 'CTC');
    if (admFilter === 'fora') return adm.unmatched;
    return allItems;
  }

  function getADMFilterTitle(admFilter) {
    if (admFilter === 'etg') return 'Alunos ETG';
    if (admFilter === 'ctc') return 'Alunos CTC';
    if (admFilter === 'fora') return 'Fora da base';
    return 'Todos os registros';
  }

  function buildUCStats(items) {
    const stats = new Map();
    items.forEach((item) => {
      const studentKey = item.idTurma + '|' + (normalizar(item.aluno) || item.rowNumber);
      const seenInItem = new Set();
      item.ucs.forEach((uc) => {
        const key = normalizar(uc);
        if (!key || seenInItem.has(key)) return;
        seenInItem.add(key);
        const stat = stats.get(key) || { key, label: uc, items: [], studentKeys: new Set() };
        if (!stat.studentKeys.has(studentKey)) {
          stat.studentKeys.add(studentKey);
          stat.items.push(item);
        }
        stats.set(key, stat);
      });
    });
    return [...stats.values()]
      .map((stat) => ({ key: stat.key, label: stat.label, items: stat.items, count: stat.studentKeys.size }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
  }

  function ImportPanel({ adm, admFilter, onFilterADM, onImport, onClearImport }) {
    const totalETG = adm.matched.filter((item) => item.turmaBase && item.turmaBase.origem === 'ETG').length;
    const totalCTC = adm.matched.filter((item) => item.turmaBase && item.turmaBase.origem === 'CTC').length;
    const totalFora = adm.unmatched.length;
    return h('aside', { className: 'import-panel' },
      h('div', { className: 'panel-card' },
        h('div', { className: 'panel-title' },
          h('span', { className: 'eyebrow' }, 'Planilha ADM'),
          h('h2', null, 'Importar pendências')
        ),
        h('label', { className: 'upload-box' },
          h('input', { type: 'file', accept: '.xlsx,.xls', onChange: onImport }),
          h('strong', null, 'Selecionar planilha'),
          h('span', null, adm.fileName || 'Use o relatório com a aba UCsReprovadasBase')
        ),
        adm.error ? h('div', { className: 'notice danger' }, adm.error) : null,
        adm.fileName ? h('div', { className: 'notice' }, 'Aba lida: ' + (adm.sheetName || 'não identificada')) : null,
        h('div', { className: 'metric-grid' },
          h('button', { type: 'button', className: 'metric metric-btn' + (admFilter === 'all' ? ' active' : ''), onClick: () => onFilterADM('all') }, h('strong', null, adm.totalImported), h('span', null, 'linhas lidas')),
          h('button', { type: 'button', className: 'metric metric-btn success' + (admFilter === 'etg' ? ' active' : ''), onClick: () => onFilterADM('etg') }, h('strong', null, totalETG), h('span', null, 'alunos ETG')),
          h('button', { type: 'button', className: 'metric metric-btn ctc' + (admFilter === 'ctc' ? ' active' : ''), onClick: () => onFilterADM('ctc') }, h('strong', null, totalCTC), h('span', null, 'alunos CTC')),
          h('button', { type: 'button', className: 'metric metric-btn muted' + (admFilter === 'fora' ? ' active' : ''), onClick: () => onFilterADM('fora') }, h('strong', null, totalFora), h('span', null, 'fora da base'))
        ),
        adm.fileName ? h('button', { className: 'ghost-btn', type: 'button', onClick: onClearImport }, 'Limpar importação') : null
      )
    );
  }

  function WorkspaceTabs({ activeView, onChange, admTotal, unitTotal }) {
    return h('div', { className: 'workspace-tabs', role: 'tablist', 'aria-label': 'Visualização' },
      h('button', { type: 'button', role: 'tab', className: 'tab-btn' + (activeView === 'ucs' ? ' active' : ''), onClick: () => onChange('ucs') },
        h('span', null, 'Unidades curriculares'),
        h('strong', null, unitTotal)
      ),
      h('button', { type: 'button', role: 'tab', className: 'tab-btn' + (activeView === 'adm' ? ' active' : ''), onClick: () => onChange('adm') },
        h('span', null, 'Resultado ADM'),
        h('strong', null, admTotal)
      )
    );
  }

  function ADMResults({ adm, admFilter, selectedUc, onSelectUC, onSearchUc }) {
    const filteredItems = getADMItems(adm, admFilter);
    const ucStats = buildUCStats(filteredItems);
    const ucStatsByKey = new Map(ucStats.map((stat) => [stat.key, stat]));
    const selectedStat = selectedUc ? ucStatsByKey.get(selectedUc) : null;
    const visibleItems = selectedStat ? selectedStat.items : filteredItems;
    const title = selectedStat ? selectedStat.label : getADMFilterTitle(admFilter);
    const groups = [...visibleItems.reduce((map, item) => {
      const group = map.get(item.idTurma) || { idTurma: item.idTurma, turmaBase: item.turmaBase, items: [] };
      group.items.push(item);
      if (item.turmaBase) group.turmaBase = item.turmaBase;
      map.set(item.idTurma, group);
      return map;
    }, new Map()).values()].sort((a, b) => b.items.length - a.items.length || a.idTurma.localeCompare(b.idTurma));

    return h('section', { className: 'adm-results-section' },
      h('div', { className: 'section-head adm-head' },
        h('div', null,
          h('h2', null, title),
          h('p', null, adm.fileName ? visibleItems.length + ' aluno' + (visibleItems.length === 1 ? '' : 's') + ' em ' + groups.length + ' turma' + (groups.length === 1 ? '' : 's') : 'Importe a planilha ADM para visualizar os alunos por turma')
        ),
        adm.fileName ? h('span', { className: 'result-count' }, 'Aba: ' + (adm.sheetName || 'não identificada')) : null
      ),
      !adm.fileName ? h('div', { className: 'empty-state adm-empty' }, 'Os resultados da comparação aparecerão aqui em uma visualização ampla depois da importação.') : null,
      adm.fileName && ucStats.length ? h('div', { className: 'uc-analysis' },
        h('div', { className: 'uc-analysis-head' },
          h('div', null,
            h('h3', null, 'UCs reprovadas'),
            h('p', null, ucStats.length + ' unidade' + (ucStats.length === 1 ? '' : 's') + ' curricular' + (ucStats.length === 1 ? '' : 'es') + ' no filtro atual')
          ),
          selectedStat ? h('button', { type: 'button', className: 'ghost-inline-btn', onClick: () => onSelectUC('') }, 'Limpar UC') : null
        ),
        h('div', { className: 'uc-analysis-grid' },
          ucStats.map((stat) => h('button', {
            type: 'button',
            key: stat.key,
            className: 'uc-analysis-btn' + (selectedUc === stat.key ? ' active' : ''),
            onClick: () => onSelectUC(stat.key)
          },
            h('span', null, stat.label),
            h('strong', null, stat.count + ' aluno' + (stat.count === 1 ? '' : 's'))
          ))
        )
      ) : null,
      selectedStat ? h('div', { className: 'uc-selection-bar' },
        h('div', null,
          h('span', null, 'Unidade curricular selecionada'),
          h('strong', null, selectedStat.count + ' aluno' + (selectedStat.count === 1 ? '' : 's') + ' reprovado' + (selectedStat.count === 1 ? '' : 's') + ' em ' + groups.length + ' turma' + (groups.length === 1 ? '' : 's'))
        ),
        h('button', { type: 'button', className: 'search-offer-btn', onClick: () => onSearchUc(selectedStat.label, '') }, 'Buscar oferta desta UC')
      ) : null,
      adm.fileName && visibleItems.length === 0 ? h('div', { className: 'empty-state adm-empty' }, 'Nenhum aluno encontrado para esta UC e filtro.') : null,
      groups.length ? h('div', { className: 'adm-group-list' },
        groups.map((group) => {
          const first = group.items[0];
          const origem = group.turmaBase ? group.turmaBase.origem : 'Fora da base';
          const origemSlug = normalizar(origem).replace(/\s+/g, '-');
          const turmaNome = group.turmaBase ? group.turmaBase.nomeTurma : (first.produtoADM || 'Turma não mapeada');
          const produto = group.turmaBase ? group.turmaBase.produto : [first.modalidade, first.unidade].filter(Boolean).join(' · ');
          const turmaLink = group.turmaBase && group.turmaBase.linkTurma;
          return h('article', { className: 'adm-group', key: group.idTurma },
            h('div', { className: 'adm-group-head' },
              h('div', { className: 'adm-group-main' },
                h('div', { className: 'adm-group-title' },
                  turmaLink
                    ? h('a', { className: 'turma-link large', href: turmaLink, target: '_blank', rel: 'noreferrer', title: 'Abrir turma no SGN' }, '#' + group.idTurma)
                    : h('span', { className: 'turma-code large' }, '#' + group.idTurma),
                  h('span', { className: 'origin-badge origin-' + origemSlug }, origem),
                  h('strong', null, group.items.length + ' aluno' + (group.items.length === 1 ? '' : 's'))
                ),
                h('p', null, turmaNome + (produto ? ' · ' + produto : ''))
              )
            ),
            h('div', { className: 'adm-student-grid' },
              group.items.map((item) => h('div', { className: 'adm-student', key: item.rowNumber + item.idTurma + item.aluno },
                h('div', { className: 'adm-student-name' }, item.aluno || 'Aluno sem nome'),
                h('div', { className: 'uc-chip-row' },
                  item.ucs.map((uc) => {
                    const stat = ucStatsByKey.get(normalizar(uc));
                    return item.turmaBase
                      ? h('button', { key: uc, type: 'button', className: 'uc-chip' + (selectedUc === normalizar(uc) ? ' active' : ''), onClick: () => onSelectUC(normalizar(uc)) },
                          h('span', null, uc),
                          stat ? h('strong', null, stat.count) : null
                        )
                      : h('span', { key: uc, className: 'uc-chip static' }, uc);
                  })
                ),
                item.encaminhamento ? h('p', { className: 'adm-note' }, item.encaminhamento) : null
              ))
            )
          );
        })
      ) : null
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

  function UnitsTable({ rows, busca, sortCol, sortAsc, onSort, ucCounts, onInspectUC }) {
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
                h(TableHeader, { label: 'Período', column: 'periodo', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'Módulo', column: 'modulo', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'Unidade Curricular', column: 'nome', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'Carga Horária', column: 'horas', sortCol, sortAsc, onSort, center: true })
              )
            ),
            h('tbody', null,
              rows.map((row, index) => {
                const failureCount = ucCounts.get(normalizar(row.nome)) || 0;
                return h('tr', { key: row.curso + row.nome + index },
                  h('td', null, h('a', { className: 'course-link', href: row.url, target: '_blank', rel: 'noreferrer' }, row.curso)),
                  h('td', null, h('span', { className: 'badge period-badge' }, row.periodo)),
                  h('td', null, h('span', { className: 'badge ' + classeModulo(row.modulo) }, row.modulo)),
                  h('td', null, failureCount
                    ? h('button', { type: 'button', className: 'unit-inspect-btn', onClick: () => onInspectUC(row.nome) },
                        h('span', null, highlight(row.nome, busca)),
                        h('strong', null, failureCount + ' reprovado' + (failureCount === 1 ? '' : 's'))
                      )
                    : highlight(row.nome, busca)
                  ),
                  h('td', { className: 'hours' }, row.horas + 'h')
                );
              })
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
    const [admFilter, setADMFilter] = useState('all');
    const [activeView, setActiveView] = useState('ucs');
    const [selectedADMUC, setSelectedADMUC] = useState('');
    const allRows = useMemo(flattenCursos, []);
    const totalHoras = useMemo(() => CURSOS.reduce((sum, item) => sum + item.totalHoras, 0), []);
    const turmaMap = useMemo(buildTurmaMap, []);
    const allAdmUCStats = useMemo(() => buildUCStats([...adm.matched, ...adm.unmatched]), [adm]);
    const admUCCounts = useMemo(() => new Map(allAdmUCStats.map((stat) => [stat.key, stat.count])), [allAdmUCStats]);

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
      const matchedCourse = produtoNorm ? CURSOS.find((item) => normalizar(item.nome) === produtoNorm || produtoNorm.includes(normalizar(item.nome)) || normalizar(item.nome).includes(produtoNorm)) : null;
      setCurso(matchedCourse ? matchedCourse.nome : '');
      setActiveView('ucs');
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
        setADMFilter('all');
        setSelectedADMUC('');
        setActiveView('adm');
      } catch (error) {
        setADM({ fileName: file.name, sheetName: '', totalImported: 0, matched: [], unmatched: [], error: 'N\u00e3o foi poss\u00edvel ler a planilha. Confirme se o arquivo est\u00e1 em .xlsx e possui a aba de UCs reprovadas.' });
      } finally {
        event.target.value = '';
      }
    }

    function clearImport() {
      setADM({ fileName: '', sheetName: '', totalImported: 0, matched: [], unmatched: [], error: '' });
      setADMFilter('all');
      setSelectedADMUC('');
      setActiveView('ucs');
    }

    function handleADMFilter(filter) {
      setADMFilter(filter);
      setSelectedADMUC('');
      setActiveView('adm');
    }

    function handleInspectUC(uc) {
      setADMFilter('all');
      setSelectedADMUC(normalizar(uc));
      setActiveView('adm');
    }

    return h('div', { className: 'app-shell' },
      h(Header, { totalCursos: CURSOS.length, totalUnidades: allRows.length, totalHoras }),
      h(Filters, { busca, setBusca, curso, setCurso, modulo, setModulo, periodo, setPeriodo, onClear: clearFilters }),
      h('main', { className: 'main-content workspace-layout' },
        h(ImportPanel, { adm, admFilter, onFilterADM: handleADMFilter, onImport: handleImport, onClearImport: clearImport }),
        h('div', { className: 'content-area' },
          h(WorkspaceTabs, { activeView, onChange: setActiveView, admTotal: adm.totalImported, unitTotal: rows.length }),
          activeView === 'ucs' ? h(React.Fragment, null,
            h(CourseCards, { cursoSelecionado: curso, onSelect: setCurso }),
            h(UnitsTable, { rows, busca, sortCol, sortAsc, onSort: handleSort, ucCounts: admUCCounts, onInspectUC: handleInspectUC })
          ) : h(ADMResults, { adm, admFilter, selectedUc: selectedADMUC, onSelectUC: setSelectedADMUC, onSearchUc: handleSearchUc }),
          h('div', { className: 'footer-note' }, 'Dados organizados para consulta das unidades curriculares dos cursos técnicos gratuitos.')
        )
      )
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
