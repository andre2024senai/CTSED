(function () {
  const { useMemo, useState } = React;
  const h = React.createElement;
  const CURSOS = window.CURSOS || [];

  function normalizar(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
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
    const periodoOrdem = { '1º Período': 1, '2º Período': 2, '3º Período': 3, '4º Período': 4 };
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

  function Header({ totalCursos, totalUnidades, totalHoras }) {
    return h('header', { className: 'topbar' },
      h('div', { className: 'color-line' }),
      h('div', { className: 'header-inner' },
        h('img', { className: 'brand-logo', src: 'assets/logo-ensino-tecnico-gratuito.png', alt: 'Ensino Técnico Gratuito' }),
        h('div', { className: 'header-copy' },
          h('h1', null, 'Cursos Técnicos Gratuitos SED — Unidades Curriculares'),
          h('p', { className: 'subtitle' }, 'Consulta rápida por curso, módulo, período e carga horária')
        )
      ),
      h('div', { className: 'stats-strip' },
        h('span', { className: 'stat-pill' }, totalCursos + ' cursos'),
        h('span', { className: 'stat-pill' }, totalUnidades + ' unidades curriculares'),
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
          h('input', { value: busca, onChange: (event) => setBusca(event.target.value), placeholder: 'Ex: manutenção, projetos, química...' })
        ),
        h('label', { className: 'field' },
          h('span', null, 'Curso'),
          h('select', { value: curso, onChange: (event) => setCurso(event.target.value) },
            h('option', { value: '' }, 'Todos os cursos'),
            CURSOS.map((item) => h('option', { key: item.nome, value: item.nome }, item.nome))
          )
        ),
        h('label', { className: 'field' },
          h('span', null, 'Módulo'),
          h('select', { value: modulo, onChange: (event) => setModulo(event.target.value) },
            h('option', { value: '' }, 'Todos os módulos'),
            h('option', { value: 'Indústria' }, 'Indústria'),
            h('option', { value: 'Introdutório' }, 'Introdutório'),
            h('option', { value: 'Específico' }, 'Específico (I / II / III...)'),
            h('option', { value: 'Inovação' }, 'Inovação')
          )
        ),
        h('label', { className: 'field' },
          h('span', null, 'Período'),
          h('select', { value: periodo, onChange: (event) => setPeriodo(event.target.value) },
            h('option', { value: '' }, 'Todos os períodos'),
            ['1º Período', '2º Período', '3º Período', '4º Período'].map((p) => h('option', { key: p, value: p }, p))
          )
        ),
        h('button', { className: 'clear-btn', type: 'button', onClick: onClear }, 'Limpar filtros')
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
          h('small', null, curso.unidades.length + ' UCs · ' + curso.totalHoras + 'h')
        ))
      )
    );
  }

  function TableHeader({ label, column, sortCol, sortAsc, onSort, center }) {
    const active = sortCol === column;
    return h('th', { className: 'sortable' + (center ? ' center' : ''), onClick: () => onSort(column) },
      label,
      h('span', { 'aria-hidden': 'true' }, active ? (sortAsc ? ' ▲' : ' ▼') : '')
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
                h(TableHeader, { label: 'Período', column: 'periodo', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'Módulo', column: 'modulo', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'Unidade Curricular', column: 'nome', sortCol, sortAsc, onSort }),
                h(TableHeader, { label: 'Carga Horária', column: 'horas', sortCol, sortAsc, onSort, center: true })
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
    const allRows = useMemo(flattenCursos, []);
    const totalHoras = useMemo(() => CURSOS.reduce((sum, item) => sum + item.totalHoras, 0), []);

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

    return h('div', { className: 'app-shell' },
      h(Header, { totalCursos: CURSOS.length, totalUnidades: allRows.length, totalHoras }),
      h(Filters, { busca, setBusca, curso, setCurso, modulo, setModulo, periodo, setPeriodo, onClear: clearFilters }),
      h('main', { className: 'main-content' },
        h(CourseCards, { cursoSelecionado: curso, onSelect: setCurso }),
        h(UnitsTable, { rows, busca, sortCol, sortAsc, onSort: handleSort }),
        h('div', { className: 'footer-note' }, 'Dados organizados para consulta das unidades curriculares dos cursos técnicos gratuitos.')
      )
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
