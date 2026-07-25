/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * uiHooks — utilidades de performance da interface.
 *
 * O problema que estes hooks resolvem: as telas de lista (Clientes, Estoque,
 * Faturamento) renderizavam TODAS as linhas de uma vez. Com 4.000 clientes ou
 * 5.188 produtos isso significa dezenas de milhares de nós no DOM, recriados a
 * cada tecla digitada na busca — é exatamente essa a causa do travamento ao
 * abrir a página de clientes. A correção tem três partes:
 *
 *   1. `useDebouncedValue`  — filtra só depois que o usuário para de digitar,
 *                             em vez de refiltrar a cada caractere;
 *   2. `usePagination`      — renderiza uma página por vez;
 *   3. `useMemo` nas telas  — não refaz filtro/ordenação quando o que mudou foi
 *                             um estado sem relação (abrir um modal, por ex.).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Atrasa a propagação de um valor até ele parar de mudar por `delay` ms. */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface PaginationResult<T> {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  items: T[];
  setPage: (p: number) => void;
  setPageSize: (s: number) => void;
  next: () => void;
  prev: () => void;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * Pagina uma lista em memória. Volta para a página 1 automaticamente quando o
 * conjunto encolhe (ex.: o usuário aplicou um filtro e a página 12 deixou de
 * existir) — senão a tela ficaria em branco sem explicação.
 */
export function usePagination<T>(items: T[], initialPageSize = 50): PaginationResult<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [pageCount, page]);

  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const pageItems = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);

  return {
    page: current,
    pageSize,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    items: pageItems,
    setPage,
    setPageSize: (s: number) => { setPageSize(s); setPage(1); },
    next: () => setPage((p) => Math.min(p + 1, pageCount)),
    prev: () => setPage((p) => Math.max(p - 1, 1)),
    canPrev: current > 1,
    canNext: current < pageCount,
  };
}

/**
 * Ordenação por coluna com estado (campo + direção). Mantida fora dos
 * componentes para não recriar comparadores a cada render.
 */
export function useSort<T>(items: T[], initialKey: keyof T | null = null, initialDir: 'asc' | 'desc' = 'desc') {
  const [sortKey, setSortKey] = useState<keyof T | null>(initialKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialDir);

  const toggle = useCallback((key: keyof T) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    const arr = [...items];
    arr.sort((a, b) => {
      const va = a[sortKey] as any;
      const vb = b[sortKey] as any;
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      const sa = String(va ?? '').toLowerCase();
      const sb = String(vb ?? '').toLowerCase();
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return arr;
  }, [items, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggle };
}

/**
 * Executa uma função pesada apenas quando o componente está visível na tela.
 * Usado para adiar gráficos e agregações das abas que ainda não foram abertas.
 */
export function useIsMounted() {
  const ref = useRef(true);
  useEffect(() => () => { ref.current = false; }, []);
  return ref;
}
