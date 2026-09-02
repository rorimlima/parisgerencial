/**
 * TombamentoView.tsx — Módulo de Tombamento de Loja, Patrimônio & Gestão de Notas Fiscais
 *
 * Paris Dakar Gerencial
 * Gerencia ativos imobilizados, valores, setores, filiais e arquivamento de notas fiscais.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Building2,
  Plus,
  Search,
  Filter,
  FileText,
  Download,
  Paperclip,
  Trash2,
  Pencil,
  Eye,
  X,
  CheckCircle2,
  AlertCircle,
  PackageCheck,
  Store,
  DollarSign,
  Boxes,
  FileSpreadsheet,
  UploadCloud,
  File,
  ExternalLink,
  ChevronDown,
  RotateCcw,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { PatrimonioItem, PatrimonioAnexo, EstadoConservacaoPatrimonio, User } from '../types';
import {
  fetchPatrimonioItems,
  savePatrimonioItem,
  deletePatrimonioItem,
  fetchAnexosByPatrimonioId,
  saveAnexoPatrimonio,
  deleteAnexoPatrimonio,
} from '../services/patrimonioService';
import { exportPatrimonioPdf } from '../utils/patrimonioPdfExport';

interface TombamentoViewProps {
  currentUser?: User | null;
  selectedYear?: number;
}

const SETORES_PADRAO = [
  'Salão de Vendas',
  'Frente de Caixa',
  'Oficina / Mecânica',
  'Estoque / Depósito',
  'Administração / Escritório',
  'Fachada / Vitrine',
  'Copa / Refeitório',
  'Segurança / TI',
  'Outro',
];

const EMPRESAS_PADRAO = [
  'Paris Dakar Matriz',
  'Paris Dakar Filial 01',
  'Paris Dakar Express',
  'Depósito Central',
];

export const TombamentoView: React.FC<TombamentoViewProps> = ({
  currentUser,
}) => {
  // ── Estados de Dados ──────────────────────────────────────────────────────
  const [items, setItems] = useState<PatrimonioItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Estados de Filtro e Busca ─────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedEmpresa, setSelectedEmpresa] = useState<string>('todos');
  const [selectedSetor, setSelectedSetor] = useState<string>('todos');
  const [selectedEstado, setSelectedEstado] = useState<string>('todos');

  // ── Modais ────────────────────────────────────────────────────────────────
  const [isItemModalOpen, setIsItemModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<Partial<PatrimonioItem> | null>(null);

  // ── Modal de Anexos / Notas Fiscais ───────────────────────────────────────
  const [anexosModalItem, setAnexosModalItem] = useState<PatrimonioItem | null>(null);
  const [anexosList, setAnexosList] = useState<PatrimonioAnexo[]>([]);
  const [isLoadingAnexos, setIsLoadingAnexos] = useState<boolean>(false);
  const [isUploadingAnexo, setIsUploadingAnexo] = useState<boolean>(false);
  const [tipoNovoDocumento, setTipoNovoDocumento] = useState<PatrimonioAnexo['tipoDocumento']>('nota_fiscal');
  const [descricaoNovoDocumento, setDescricaoNovoDocumento] = useState<string>('');

  // ── Modal de Pré-visualização de Anexo ─────────────────────────────────────
  const [previewAnexo, setPreviewAnexo] = useState<PatrimonioAnexo | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // ── Carregamento Inicial ──────────────────────────────────────────────────
  const loadPatrimonio = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await fetchPatrimonioItems();
      setItems(data);
    } catch (err) {
      console.error(err);
      showToast('Erro ao carregar o patrimônio da loja.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadPatrimonio();
  }, [loadPatrimonio]);

  // ── Empresas e Setores Dinâmicos ──────────────────────────────────────────
  const empresasDisponiveis = useMemo(() => {
    const list = new Set(EMPRESAS_PADRAO);
    items.forEach((i) => {
      if (i.empresa) list.add(i.empresa);
    });
    return Array.from(list);
  }, [items]);

  const setoresDisponiveis = useMemo(() => {
    const list = new Set(SETORES_PADRAO);
    items.forEach((i) => {
      if (i.setor) list.add(i.setor);
    });
    return Array.from(list);
  }, [items]);

  // ── Filtragem de Itens ────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Filtro Empresa
      if (selectedEmpresa !== 'todos' && item.empresa !== selectedEmpresa) {
        return false;
      }
      // Filtro Setor
      if (selectedSetor !== 'todos' && item.setor !== selectedSetor) {
        return false;
      }
      // Filtro Estado
      if (selectedEstado !== 'todos' && item.estadoConservacao !== selectedEstado) {
        return false;
      }
      // Busca texto
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchProd = item.produto.toLowerCase().includes(term);
        const matchCode = item.codigoTombo.toLowerCase().includes(term);
        const matchNF = (item.numeroNotaFiscal || '').toLowerCase().includes(term);
        const matchForn = (item.fornecedor || '').toLowerCase().includes(term);
        const matchSetor = item.setor.toLowerCase().includes(term);
        if (!matchProd && !matchCode && !matchNF && !matchForn && !matchSetor) {
          return false;
        }
      }
      return true;
    });
  }, [items, selectedEmpresa, selectedSetor, selectedEstado, searchTerm]);

  // ── Totais e KPIs ─────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalValor = filteredItems.reduce((acc, i) => acc + (Number(i.valorTotal) || 0), 0);
    const totalQuantidadeFisica = filteredItems.reduce((acc, i) => acc + (Number(i.quantidade) || 0), 0);
    const totalTiposBens = filteredItems.length;
    const totalNotasAnexadas = filteredItems.reduce((acc, i) => acc + (Number(i.anexosCount) || 0), 0);
    const totalDanificados = filteredItems.filter(
      (i) => i.estadoConservacao === 'Danificado' || i.estadoConservacao === 'Baixado'
    ).length;

    return {
      totalValor,
      totalQuantidadeFisica,
      totalTiposBens,
      totalNotasAnexadas,
      totalDanificados,
    };
  }, [filteredItems]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  };

  const formatDateBr = (iso: string) => {
    if (!iso) return '—';
    const parts = iso.split('T')[0].split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return iso;
  };

  // ── Gerar Próximo Código Tombo ────────────────────────────────────────────
  const sugerirProximoTombo = useCallback(() => {
    let maior = 0;
    items.forEach((it) => {
      const match = it.codigoTombo.match(/TOM-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maior) maior = num;
      }
    });
    const proximo = maior + 1;
    return `TOM-${String(proximo).padStart(4, '0')}`;
  }, [items]);

  // ── Handlers do Modal de Cadastro / Edição ────────────────────────────────
  const handleOpenNewItem = () => {
    const nextTombo = sugerirProximoTombo();
    setEditingItem({
      codigoTombo: nextTombo,
      produto: '',
      quantidade: 1,
      valorUnitario: 0,
      valorTotal: 0,
      setor: 'Salão de Vendas',
      empresa: 'Paris Dakar Matriz',
      estadoConservacao: 'Novo',
      dataAquisicao: new Date().toISOString().split('T')[0],
      numeroNotaFiscal: '',
      fornecedor: '',
      observacao: '',
    });
    setIsItemModalOpen(true);
  };

  const handleEditItem = (item: PatrimonioItem) => {
    setEditingItem({ ...item });
    setIsItemModalOpen(true);
  };

  const handleSaveItem = async () => {
    if (!editingItem) return;
    if (!editingItem.produto?.trim()) {
      showToast('Informe a descrição do produto/bem patrimonial.', 'error');
      return;
    }
    if (!editingItem.codigoTombo?.trim()) {
      showToast('Informe o código de tombamento.', 'error');
      return;
    }

    try {
      setIsLoading(true);
      const qtd = Number(editingItem.quantidade) || 1;
      const valUnit = Number(editingItem.valorUnitario) || 0;
      const valTotal = qtd * valUnit;

      const payload: Omit<PatrimonioItem, 'id'> & { id?: string } = {
        codigoTombo: editingItem.codigoTombo.trim().toUpperCase(),
        produto: editingItem.produto.trim(),
        quantidade: qtd,
        valorUnitario: valUnit,
        valorTotal: valTotal,
        setor: editingItem.setor || 'Salão de Vendas',
        empresa: editingItem.empresa || 'Paris Dakar Matriz',
        dataAquisicao: editingItem.dataAquisicao || new Date().toISOString().split('T')[0],
        numeroNotaFiscal: editingItem.numeroNotaFiscal?.trim() || '',
        fornecedor: editingItem.fornecedor?.trim() || '',
        estadoConservacao: (editingItem.estadoConservacao as EstadoConservacaoPatrimonio) || 'Bom',
        observacao: editingItem.observacao?.trim() || '',
        id: editingItem.id,
      };

      const savedId = await savePatrimonioItem(payload);
      setIsItemModalOpen(false);
      setEditingItem(null);

      // Atualiza estado local
      setItems((prev) => {
        const index = prev.findIndex((i) => i.id === savedId);
        const itemCompleto: PatrimonioItem = {
          ...payload,
          id: savedId,
          anexosCount: editingItem.anexosCount || 0,
        };
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = itemCompleto;
          return updated;
        }
        return [itemCompleto, ...prev];
      });

      showToast('Bem patrimonial gravado com sucesso.');
    } catch (err) {
      console.error(err);
      showToast('Erro ao salvar o item patrimonial.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteItem = async (item: PatrimonioItem) => {
    if (!window.confirm(`Tem certeza que deseja excluir o bem "${item.produto}" (${item.codigoTombo}) e todos os seus anexos?`)) {
      return;
    }

    try {
      setIsLoading(true);
      await deletePatrimonioItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      showToast('Item patrimonial excluído.');
    } catch (err) {
      console.error(err);
      showToast('Erro ao excluir item do patrimônio.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Handlers do Modal de Anexos / Notas Fiscais ───────────────────────────
  const handleOpenAnexos = async (item: PatrimonioItem) => {
    setAnexosModalItem(item);
    setIsLoadingAnexos(true);
    try {
      const anexos = await fetchAnexosByPatrimonioId(item.id);
      setAnexosList(anexos);
    } catch (err) {
      console.error(err);
      showToast('Erro ao carregar anexos deste bem.', 'error');
    } finally {
      setIsLoadingAnexos(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !anexosModalItem) return;

    setIsUploadingAnexo(true);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();

        await new Promise<void>((resolve, reject) => {
          reader.onload = async (event) => {
            try {
              const fileData = event.target?.result as string;
              const novoAnexo: Omit<PatrimonioAnexo, 'id'> = {
                patrimonioId: anexosModalItem.id,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type || 'application/octet-stream',
                fileData,
                uploadedAt: new Date().toISOString(),
                uploadedBy: currentUser?.name || 'Administrador',
                tipoDocumento: tipoNovoDocumento,
                descricao: descricaoNovoDocumento.trim() || undefined,
              };

              const anexoId = await saveAnexoPatrimonio(novoAnexo);
              const anexoComId: PatrimonioAnexo = { ...novoAnexo, id: anexoId };
              setAnexosList((prev) => [anexoComId, ...prev]);

              // Atualiza contagem no item pai no estado
              setItems((prev) =>
                prev.map((it) =>
                  it.id === anexosModalItem.id
                    ? { ...it, anexosCount: (it.anexosCount || 0) + 1 }
                    : it
                )
              );
              setAnexosModalItem((prev) =>
                prev ? { ...prev, anexosCount: (prev.anexosCount || 0) + 1 } : null
              );

              resolve();
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = () => reject(new Error('Erro na leitura do arquivo'));
          reader.readAsDataURL(file);
        });
      }

      setDescricaoNovoDocumento('');
      showToast('Nota fiscal/anexo salvo com sucesso.');
    } catch (err) {
      console.error(err);
      showToast('Erro ao fazer upload do anexo.', 'error');
    } finally {
      setIsUploadingAnexo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAnexo = async (anexo: PatrimonioAnexo) => {
    if (!anexosModalItem) return;
    if (!window.confirm(`Excluir o anexo "${anexo.fileName}"?`)) return;

    try {
      await deleteAnexoPatrimonio(anexosModalItem.id, anexo.id);
      setAnexosList((prev) => prev.filter((a) => a.id !== anexo.id));

      // Atualiza contagem no item
      setItems((prev) =>
        prev.map((it) =>
          it.id === anexosModalItem.id
            ? { ...it, anexosCount: Math.max(0, (it.anexosCount || 1) - 1) }
            : it
        )
      );
      setAnexosModalItem((prev) =>
        prev ? { ...prev, anexosCount: Math.max(0, (prev.anexosCount || 1) - 1) } : null
      );

      showToast('Anexo removido.');
    } catch (err) {
      console.error(err);
      showToast('Erro ao excluir anexo.', 'error');
    }
  };

  // ── Exportação em PDF ─────────────────────────────────────────────────────
  const handleExportPdf = () => {
    if (filteredItems.length === 0) {
      showToast('Nenhum item para exportar com os filtros atuais.', 'error');
      return;
    }
    exportPatrimonioPdf({
      items: filteredItems,
      filtroEmpresa: selectedEmpresa !== 'todos' ? selectedEmpresa : undefined,
      filtroSetor: selectedSetor !== 'todos' ? selectedSetor : undefined,
      filtroEstado: selectedEstado !== 'todos' ? selectedEstado : undefined,
      termoBusca: searchTerm.trim() || undefined,
    });
    showToast('Livro de Inventário em PDF gerado com sucesso.');
  };

  // ── Exportação em Excel (XLSX) ───────────────────────────────────────────
  const handleExportExcel = () => {
    if (filteredItems.length === 0) {
      showToast('Nenhum item para exportar.', 'error');
      return;
    }

    const rows = filteredItems.map((item) => ({
      'Código Tombo': item.codigoTombo,
      'Produto / Bem': item.produto,
      'Quantidade': item.quantidade,
      'Valor Unitário (R$)': item.valorUnitario,
      'Valor Total (R$)': item.valorTotal,
      'Setor': item.setor,
      'Empresa / Unidade': item.empresa,
      'Nº Nota Fiscal': item.numeroNotaFiscal || '',
      'Fornecedor': item.fornecedor || '',
      'Data Aquisição': item.dataAquisicao,
      'Estado Conservação': item.estadoConservacao,
      'Anexos Gravados': item.anexosCount || 0,
      'Observações': item.observacao || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tombamento_Patrimonio');

    const fileName = `Inventario_Patrimonio_Paris_Dakar_${Date.now()}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast('Planilha de patrimônio exportada.');
  };

  const getBadgeEstado = (estado: EstadoConservacaoPatrimonio) => {
    switch (estado) {
      case 'Novo':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'Bom':
        return 'bg-sky-100 text-sky-800 border-sky-300';
      case 'Regular':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'Danificado':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      case 'Baixado':
        return 'bg-slate-200 text-slate-700 border-slate-400';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#F9F7F2] text-[#433E37] relative space-y-5">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border animate-in fade-in slide-in-from-top-2 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
              : 'bg-rose-50 text-rose-900 border-rose-300'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600" />
          )}
          <span className="font-semibold text-xs">{toastMessage.text}</span>
        </div>
      )}

      {/* ── CABEÇALHO DO MÓDULO (BANNER CORPORATIVO) ───────────────────────── */}
      <div className="bg-[#2D2A26] px-6 py-4 rounded-2xl shadow-sm flex flex-col md:flex-row items-center justify-between border-b-4 border-[#C19A6B] gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="w-10 h-10 rounded-xl bg-[#3F3B35] flex items-center justify-center text-[#C19A6B] border border-[#4A453E]">
            <PackageCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-black text-white tracking-wider uppercase flex items-center gap-2">
              Tombamento de Loja & Patrimônio
              <span className="px-2 py-0.5 text-[9px] bg-[#C19A6B] text-white rounded-full font-bold">
                Ativo Imobilizado
              </span>
            </h1>
            <p className="text-xs text-[#8B7D6B] mt-0.5">
              Cadastro oficial de bens, valores, setores, filiais e guarda segura de notas fiscais
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#3F3B35] hover:bg-[#4A453E] text-white rounded-xl text-xs font-bold transition-all border border-[#4A453E] shadow-2xs"
            title="Exportar dados para Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" /> Excel
          </button>

          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#C19A6B] hover:bg-[#a88252] text-white rounded-xl text-xs font-black transition-all shadow-xs"
            title="Gerar Livro de Inventário Patrimonial em PDF Corporativo"
          >
            <Download className="w-3.5 h-3.5" /> Exportar PDF
          </button>

          <button
            onClick={handleOpenNewItem}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all shadow-md"
          >
            <Plus className="w-4 h-4" /> + Novo Bem
          </button>
        </div>
      </div>

      {/* ── CARDS DE KPIS (INDICADORES DE PATRIMÔNIO) ─────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-[#EAE6DF] shadow-2xs">
          <div className="flex justify-between items-start">
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-[#8B7D6B]">
              Patrimônio Avaliado
            </p>
            <DollarSign className="w-4 h-4 text-[#C19A6B]" />
          </div>
          <p className="text-xl font-black text-[#2D2A26] mt-1">
            {formatCurrency(kpis.totalValor)}
          </p>
          <p className="text-[10px] text-[#8B7D6B] mt-0.5">Soma total dos bens listados</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#EAE6DF] shadow-2xs">
          <div className="flex justify-between items-start">
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-[#8B7D6B]">
              Qtd. Itens Físicos
            </p>
            <Boxes className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-xl font-black text-[#2D2A26] mt-1">
            {kpis.totalQuantidadeFisica} <span className="text-xs font-bold text-[#8B7D6B]">unidades</span>
          </p>
          <p className="text-[10px] text-[#8B7D6B] mt-0.5">Contagem física total</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#EAE6DF] shadow-2xs">
          <div className="flex justify-between items-start">
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-[#8B7D6B]">
              Bens Cadastrados
            </p>
            <Store className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-xl font-black text-[#2D2A26] mt-1">
            {kpis.totalTiposBens} <span className="text-xs font-bold text-[#8B7D6B]">registros</span>
          </p>
          <p className="text-[10px] text-[#8B7D6B] mt-0.5">Tipos de bens patrimoniais</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#EAE6DF] shadow-2xs">
          <div className="flex justify-between items-start">
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-[#8B7D6B]">
              Notas Anexadas
            </p>
            <Paperclip className="w-4 h-4 text-[#C19A6B]" />
          </div>
          <p className="text-xl font-black text-[#2D2A26] mt-1">
            {kpis.totalNotasAnexadas} <span className="text-xs font-bold text-[#8B7D6B]">anexos</span>
          </p>
          <p className="text-[10px] text-[#8B7D6B] mt-0.5">Comprovantes e NFs guardados</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#EAE6DF] shadow-2xs col-span-2 md:col-span-1">
          <div className="flex justify-between items-start">
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-[#8B7D6B]">
              Atenção / Reparo
            </p>
            <AlertCircle className={`w-4 h-4 ${kpis.totalDanificados > 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
          </div>
          <p className={`text-xl font-black mt-1 ${kpis.totalDanificados > 0 ? 'text-rose-600' : 'text-[#2D2A26]'}`}>
            {kpis.totalDanificados} <span className="text-xs font-bold text-[#8B7D6B]">itens</span>
          </p>
          <p className="text-[10px] text-[#8B7D6B] mt-0.5">Danificados ou baixados</p>
        </div>
      </div>

      {/* ── BARRA DE BUSCA E FILTROS ───────────────────────────────────────── */}
      <div className="bg-white p-3.5 rounded-xl border border-[#EAE6DF] shadow-2xs flex flex-wrap gap-3 items-center justify-between">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Pesquisar produto, código tombo, nota fiscal, fornecedor ou setor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 border border-[#EAE6DF] rounded-lg text-xs font-semibold text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro Empresa */}
          <div className="flex items-center gap-1.5 bg-[#F9F7F2] px-2.5 py-1.5 rounded-lg border border-[#EAE6DF]">
            <span className="text-[10px] uppercase font-bold text-[#8B7D6B]">Empresa:</span>
            <select
              value={selectedEmpresa}
              onChange={(e) => setSelectedEmpresa(e.target.value)}
              className="bg-transparent text-xs font-bold text-[#2D2A26] focus:outline-none border-0 pr-1"
            >
              <option value="todos">Todas as Unidades</option>
              {empresasDisponiveis.map((emp) => (
                <option key={emp} value={emp}>
                  {emp}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Setor */}
          <div className="flex items-center gap-1.5 bg-[#F9F7F2] px-2.5 py-1.5 rounded-lg border border-[#EAE6DF]">
            <span className="text-[10px] uppercase font-bold text-[#8B7D6B]">Setor:</span>
            <select
              value={selectedSetor}
              onChange={(e) => setSelectedSetor(e.target.value)}
              className="bg-transparent text-xs font-bold text-[#2D2A26] focus:outline-none border-0 pr-1"
            >
              <option value="todos">Todos os Setores</option>
              {setoresDisponiveis.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Estado */}
          <div className="flex items-center gap-1.5 bg-[#F9F7F2] px-2.5 py-1.5 rounded-lg border border-[#EAE6DF]">
            <span className="text-[10px] uppercase font-bold text-[#8B7D6B]">Estado:</span>
            <select
              value={selectedEstado}
              onChange={(e) => setSelectedEstado(e.target.value)}
              className="bg-transparent text-xs font-bold text-[#2D2A26] focus:outline-none border-0 pr-1"
            >
              <option value="todos">Todos os Estados</option>
              <option value="Novo">Novo</option>
              <option value="Bom">Bom</option>
              <option value="Regular">Regular</option>
              <option value="Danificado">Danificado</option>
              <option value="Baixado">Baixado</option>
            </select>
          </div>

          {(selectedEmpresa !== 'todos' || selectedSetor !== 'todos' || selectedEstado !== 'todos' || searchTerm) && (
            <button
              onClick={() => {
                setSelectedEmpresa('todos');
                setSelectedSetor('todos');
                setSelectedEstado('todos');
                setSearchTerm('');
              }}
              className="p-2 text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#EAE6DF]/60 rounded-lg transition-colors"
              title="Redefinir filtros"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── TABELA DE ITENS PATRIMONIAIS ──────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-xs border border-[#EAE6DF] overflow-hidden flex-1 flex flex-col">
        <div className="px-5 py-3 border-b border-[#EAE6DF] flex justify-between items-center bg-[#fdfcf9]">
          <h2 className="text-xs font-black text-[#2D2A26] uppercase tracking-wider flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#C19A6B]" /> Relação de Bens Tombados ({filteredItems.length})
          </h2>
          <span className="text-[11px] font-bold text-[#8B7D6B]">
            Total Alocado: <strong className="text-[#2D2A26]">{formatCurrency(kpis.totalValor)}</strong>
          </span>
        </div>

        <div className="overflow-x-auto flex-1">
          {isLoading ? (
            <div className="text-center py-16 text-xs text-[#8B7D6B] font-semibold animate-pulse">
              Carregando inventário de patrimônio...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-16 text-[#8B7D6B] flex flex-col items-center justify-center">
              <PackageCheck className="w-12 h-12 text-[#C19A6B] mb-2 opacity-60" />
              <p className="text-sm font-bold text-[#2D2A26]">Nenhum bem patrimonial encontrado</p>
              <p className="text-xs text-[#8B7D6B] mt-1 mb-4">
                {searchTerm || selectedEmpresa !== 'todos' || selectedSetor !== 'todos'
                  ? 'Nenhum resultado corresponde aos filtros selecionados.'
                  : 'Comece cadastrando o primeiro item de patrimônio da loja.'}
              </p>
              <button
                onClick={handleOpenNewItem}
                className="px-4 py-2 bg-[#2D2A26] text-white font-bold text-xs rounded-xl hover:bg-[#3F3B35] transition-all shadow-sm"
              >
                + Cadastrar Primeiro Bem
              </button>
            </div>
          ) : (
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-[#F9F7F2] text-[#8B7D6B] uppercase text-[10px] font-extrabold tracking-wider border-b border-[#EAE6DF]">
                <tr>
                  <th className="px-4 py-2.5">Cód. Tombo</th>
                  <th className="px-4 py-2.5">Produto / Descrição do Bem</th>
                  <th className="px-4 py-2.5">Empresa / Unidade</th>
                  <th className="px-4 py-2.5">Setor Alocado</th>
                  <th className="px-4 py-2.5 text-center">Qtd</th>
                  <th className="px-4 py-2.5 text-right">Valor Unit. (R$)</th>
                  <th className="px-4 py-2.5 text-right">Valor Total (R$)</th>
                  <th className="px-4 py-2.5">Nº NF / Fornecedor</th>
                  <th className="px-4 py-2.5 text-center">Estado</th>
                  <th className="px-4 py-2.5 text-center">Notas / Anexos</th>
                  <th className="px-4 py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE6DF]">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-[#fdfcf9] transition-colors">
                    {/* Código Tombo */}
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 bg-[#2D2A26] text-[#C19A6B] font-mono font-black rounded-md text-[10px] border border-[#3F3B35]">
                        {item.codigoTombo}
                      </span>
                    </td>

                    {/* Produto */}
                    <td className="px-4 py-2.5 font-bold text-[#2D2A26] max-w-[280px] truncate" title={item.produto}>
                      {item.produto}
                      {item.observacao && (
                        <span className="block text-[10px] font-normal text-[#8B7D6B] truncate">
                          {item.observacao}
                        </span>
                      )}
                    </td>

                    {/* Empresa */}
                    <td className="px-4 py-2.5 font-semibold text-[#433E37]">
                      {item.empresa}
                    </td>

                    {/* Setor */}
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-semibold text-[10px]">
                        {item.setor}
                      </span>
                    </td>

                    {/* Quantidade */}
                    <td className="px-4 py-2.5 text-center font-bold text-[#2D2A26]">
                      {item.quantidade}
                    </td>

                    {/* Valor Unitário */}
                    <td className="px-4 py-2.5 text-right font-medium text-[#433E37]">
                      {formatCurrency(item.valorUnitario)}
                    </td>

                    {/* Valor Total */}
                    <td className="px-4 py-2.5 text-right font-black text-[#C19A6B]">
                      {formatCurrency(item.valorTotal)}
                    </td>

                    {/* Nota Fiscal & Fornecedor */}
                    <td className="px-4 py-2.5 text-[#433E37]">
                      {item.numeroNotaFiscal ? (
                        <span className="font-semibold block">NF: {item.numeroNotaFiscal}</span>
                      ) : (
                        <span className="text-[#8B7D6B] block">Sem NF informada</span>
                      )}
                      {item.fornecedor && (
                        <span className="text-[10px] text-[#8B7D6B] block truncate max-w-[150px]">
                          {item.fornecedor}
                        </span>
                      )}
                    </td>

                    {/* Estado de Conservação */}
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${getBadgeEstado(
                          item.estadoConservacao
                        )}`}
                      >
                        {item.estadoConservacao}
                      </span>
                    </td>

                    {/* Botão de Anexos */}
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => handleOpenAnexos(item)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5 transition-all shadow-2xs ${
                          (item.anexosCount || 0) > 0
                            ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'
                        }`}
                        title="Ver ou anexar notas fiscais e comprovantes"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        <span>
                          {(item.anexosCount || 0) > 0 ? `${item.anexosCount} nota(s)` : 'Anexar Nota'}
                        </span>
                      </button>
                    </td>

                    {/* Ações */}
                    <td className="px-4 py-2.5 text-right space-x-1">
                      <button
                        onClick={() => handleEditItem(item)}
                        className="p-1.5 text-[#8B7D6B] hover:text-[#C19A6B] hover:bg-[#F9F7F2] rounded-lg transition-colors"
                        title="Editar bem patrimonial"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item)}
                        className="p-1.5 text-[#8B7D6B] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Excluir item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── MODAL DE CADASTRO / EDIÇÃO DE BEM PATRIMONIAL ──────────────────── */}
      {isItemModalOpen && editingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-[#EAE6DF] animate-in fade-in zoom-in-95 duration-100">
            {/* Cabeçalho */}
            <div className="bg-[#2D2A26] px-6 py-4 border-b-4 border-[#C19A6B] flex justify-between items-center">
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <PackageCheck className="w-4 h-4 text-[#C19A6B]" />
                  {editingItem.id ? 'Editar Bem Patrimonial' : 'Tombamento de Novo Bem'}
                </h2>
                <p className="text-[11px] text-[#8B7D6B]">
                  Preencha as informações do ativo para registro no inventário
                </p>
              </div>
              <button
                onClick={() => {
                  setIsItemModalOpen(false);
                  setEditingItem(null);
                }}
                className="text-[#8B7D6B] hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Formulário */}
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-xs text-[#433E37]">
              {/* Linha 1: Código e Produto */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-1">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Cód. Tombo *
                  </label>
                  <input
                    type="text"
                    value={editingItem.codigoTombo || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, codigoTombo: e.target.value })}
                    className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 font-mono font-bold text-xs focus:border-[#C19A6B] focus:outline-none uppercase bg-slate-50"
                    placeholder="Ex: TOM-0001"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Produto / Descrição do Bem *
                  </label>
                  <input
                    type="text"
                    value={editingItem.produto || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, produto: e.target.value })}
                    className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 font-bold text-xs focus:border-[#C19A6B] focus:outline-none"
                    placeholder="Ex: Computador Dell Inspiron i5 16GB + Monitor 24pol"
                    autoFocus
                  />
                </div>
              </div>

              {/* Linha 2: Quantidade, Valor Unitário, Valor Total */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-[#F9F7F2] p-3.5 rounded-xl border border-[#EAE6DF]">
                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Quantidade *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editingItem.quantidade ?? 1}
                    onChange={(e) => {
                      const q = Math.max(1, parseInt(e.target.value, 10) || 1);
                      const unit = Number(editingItem.valorUnitario) || 0;
                      setEditingItem({
                        ...editingItem,
                        quantidade: q,
                        valorTotal: q * unit,
                      });
                    }}
                    className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 font-bold text-xs focus:border-[#C19A6B] focus:outline-none bg-white text-center"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Valor Unitário (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editingItem.valorUnitario ?? 0}
                    onChange={(e) => {
                      const unit = Math.max(0, parseFloat(e.target.value) || 0);
                      const q = Number(editingItem.quantidade) || 1;
                      setEditingItem({
                        ...editingItem,
                        valorUnitario: unit,
                        valorTotal: q * unit,
                      });
                    }}
                    className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 font-bold text-xs focus:border-[#C19A6B] focus:outline-none bg-white text-right"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Valor Total Calculado (R$)
                  </label>
                  <div className="w-full border border-amber-200 rounded-lg px-3 py-2 font-black text-sm bg-amber-50 text-[#C19A6B] text-right">
                    {formatCurrency(
                      (Number(editingItem.quantidade) || 1) * (Number(editingItem.valorUnitario) || 0)
                    )}
                  </div>
                </div>
              </div>

              {/* Linha 3: Empresa e Setor */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Empresa / Filial *
                  </label>
                  <div className="space-y-1.5">
                    <select
                      value={editingItem.empresa || 'Paris Dakar Matriz'}
                      onChange={(e) => setEditingItem({ ...editingItem, empresa: e.target.value })}
                      className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs font-semibold focus:border-[#C19A6B] focus:outline-none"
                    >
                      {empresasDisponiveis.map((emp) => (
                        <option key={emp} value={emp}>
                          {emp}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Ou digite outra empresa/filial..."
                      value={editingItem.empresa || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, empresa: e.target.value })}
                      className="w-full border border-[#EAE6DF] rounded-lg px-2.5 py-1 text-[11px] focus:border-[#C19A6B] focus:outline-none text-[#8B7D6B]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Setor Alocado *
                  </label>
                  <div className="space-y-1.5">
                    <select
                      value={editingItem.setor || 'Salão de Vendas'}
                      onChange={(e) => setEditingItem({ ...editingItem, setor: e.target.value })}
                      className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs font-semibold focus:border-[#C19A6B] focus:outline-none"
                    >
                      {setoresDisponiveis.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Ou digite outro setor..."
                      value={editingItem.setor || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, setor: e.target.value })}
                      className="w-full border border-[#EAE6DF] rounded-lg px-2.5 py-1 text-[11px] focus:border-[#C19A6B] focus:outline-none text-[#8B7D6B]"
                    />
                  </div>
                </div>
              </div>

              {/* Linha 4: Estado, Data e Nota Fiscal */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Estado de Conservação
                  </label>
                  <select
                    value={editingItem.estadoConservacao || 'Novo'}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        estadoConservacao: e.target.value as EstadoConservacaoPatrimonio,
                      })
                    }
                    className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs font-bold focus:border-[#C19A6B] focus:outline-none"
                  >
                    <option value="Novo">Novo</option>
                    <option value="Bom">Bom</option>
                    <option value="Regular">Regular</option>
                    <option value="Danificado">Danificado / Manutenção</option>
                    <option value="Baixado">Baixado / Sucata</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Data de Aquisição
                  </label>
                  <input
                    type="date"
                    value={editingItem.dataAquisicao || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, dataAquisicao: e.target.value })}
                    className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs focus:border-[#C19A6B] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                    Número da Nota Fiscal
                  </label>
                  <input
                    type="text"
                    value={editingItem.numeroNotaFiscal || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, numeroNotaFiscal: e.target.value })}
                    className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs focus:border-[#C19A6B] focus:outline-none font-semibold"
                    placeholder="Ex: NF-e 12345"
                  />
                </div>
              </div>

              {/* Linha 5: Fornecedor */}
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                  Fornecedor / Loja de Compra
                </label>
                <input
                  type="text"
                  value={editingItem.fornecedor || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, fornecedor: e.target.value })}
                  className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs focus:border-[#C19A6B] focus:outline-none"
                  placeholder="Razão Social ou Nome Fantasia do Fornecedor"
                />
              </div>

              {/* Linha 6: Observações */}
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">
                  Observações e Especificações Técnicas
                </label>
                <textarea
                  value={editingItem.observacao || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, observacao: e.target.value })}
                  className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs focus:border-[#C19A6B] focus:outline-none h-16 resize-none"
                  placeholder="Detalhes adicionais, número de série, localização precisa dentro do setor, etc."
                />
              </div>
            </div>

            {/* Rodapé do Modal */}
            <div className="bg-[#fdfcf9] px-6 py-3.5 border-t border-[#EAE6DF] flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setIsItemModalOpen(false);
                  setEditingItem(null);
                }}
                className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveItem}
                className="px-5 py-2 text-xs font-black bg-[#C19A6B] hover:bg-[#a88252] text-white rounded-xl shadow-xs transition-all"
              >
                Salvar Bem Patrimonial
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL / GAVETA DE ANEXOS DE NOTAS FISCAIS ─────────────────────── */}
      {anexosModalItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden border border-[#EAE6DF] animate-in fade-in zoom-in-95 duration-100 flex flex-col max-h-[85vh]">
            {/* Cabeçalho */}
            <div className="bg-[#2D2A26] px-6 py-4 border-b-4 border-[#C19A6B] flex justify-between items-center">
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-[#C19A6B]" />
                  Notas Fiscais & Comprovantes Vinculados
                </h2>
                <p className="text-xs text-[#8B7D6B] mt-0.5">
                  <strong className="text-white">{anexosModalItem.produto}</strong> (Tombo: {anexosModalItem.codigoTombo})
                </p>
              </div>
              <button
                onClick={() => {
                  setAnexosModalItem(null);
                  setAnexosList([]);
                }}
                className="text-[#8B7D6B] hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6 text-xs text-[#433E37]">
              {/* Área de Envio de Novo Anexo */}
              <div className="bg-[#F9F7F2] p-4 rounded-xl border border-dashed border-[#C19A6B] space-y-3">
                <div className="flex items-center gap-2 text-xs font-black text-[#2D2A26] uppercase tracking-wider">
                  <UploadCloud className="w-4 h-4 text-[#C19A6B]" />
                  Anexar Nova Nota Fiscal ou Documento
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-bold text-[#8B7D6B] mb-1 uppercase">
                      Tipo de Documento
                    </label>
                    <select
                      value={tipoNovoDocumento}
                      onChange={(e) => setTipoNovoDocumento(e.target.value as any)}
                      className="w-full border border-[#EAE6DF] rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:border-[#C19A6B] focus:outline-none bg-white"
                    >
                      <option value="nota_fiscal">Nota Fiscal (DANFE / NF-e)</option>
                      <option value="recibo">Recibo / Comprovante de Pagamento</option>
                      <option value="termo_garantia">Termo de Garantia / Manual</option>
                      <option value="foto_bem">Foto do Bem / Plaqueta</option>
                      <option value="outro">Outro Documento</option>
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-[#8B7D6B] mb-1 uppercase">
                      Descrição Opcional
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Nota Fiscal emitida pela Dell Computadores do Brasil"
                      value={descricaoNovoDocumento}
                      onChange={(e) => setDescricaoNovoDocumento(e.target.value)}
                      className="w-full border border-[#EAE6DF] rounded-lg px-2.5 py-1.5 text-xs focus:border-[#C19A6B] focus:outline-none bg-white"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,image/png,image/jpeg,image/jpg,image/webp,.xml"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="patrimonio-file-upload"
                  />
                  <label
                    htmlFor="patrimonio-file-upload"
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer shadow-xs ${
                      isUploadingAnexo
                        ? 'bg-slate-200 text-slate-500 cursor-wait'
                        : 'bg-[#2D2A26] hover:bg-[#3F3B35] text-white'
                    }`}
                  >
                    <UploadCloud className="w-4 h-4 text-[#C19A6B]" />
                    {isUploadingAnexo ? 'Salvando documento...' : 'Selecionar Arquivo (PDF ou Foto da NF)'}
                  </label>
                  <span className="text-[11px] text-[#8B7D6B]">
                    Formatos aceitos: PDF, JPG, PNG e XML.
                  </span>
                </div>
              </div>

              {/* Lista de Documentos Gravados */}
              <div>
                <h3 className="text-xs font-black text-[#2D2A26] uppercase tracking-wider mb-2.5 flex items-center justify-between">
                  <span>Documentos Gravados ({anexosList.length})</span>
                  {anexosModalItem.numeroNotaFiscal && (
                    <span className="text-[11px] font-bold text-[#C19A6B]">
                      Nº NF Vinculada: {anexosModalItem.numeroNotaFiscal}
                    </span>
                  )}
                </h3>

                {isLoadingAnexos ? (
                  <div className="text-center py-10 text-xs text-[#8B7D6B] font-semibold animate-pulse">
                    Carregando documentos vinculados...
                  </div>
                ) : anexosList.length === 0 ? (
                  <div className="text-center py-8 bg-[#F9F7F2] rounded-xl border border-[#EAE6DF] text-[#8B7D6B]">
                    <Paperclip className="w-8 h-8 mx-auto mb-1.5 text-[#C19A6B] opacity-50" />
                    <p className="font-bold text-xs">Nenhum documento ou nota fiscal anexada ainda.</p>
                    <p className="text-[11px] text-[#8B7D6B] mt-0.5">
                      Utilize o formulário acima para anexar as notas fiscais deste bem.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {anexosList.map((anexo) => {
                      const isImage = anexo.fileType.startsWith('image/');
                      const isPdf = anexo.fileType.includes('pdf') || anexo.fileName.toLowerCase().endsWith('.pdf');

                      return (
                        <div
                          key={anexo.id}
                          className="bg-white border border-[#EAE6DF] p-3 rounded-xl shadow-2xs hover:border-[#C19A6B] transition-colors flex flex-col justify-between gap-2.5"
                        >
                          <div className="flex items-start gap-2.5">
                            {/* Ícone ou miniatura */}
                            <div className="w-12 h-12 rounded-lg bg-slate-100 flex-shrink-0 flex items-center justify-center overflow-hidden border border-[#EAE6DF]">
                              {isImage && anexo.fileData ? (
                                <img
                                  src={anexo.fileData}
                                  alt={anexo.fileName}
                                  className="w-full h-full object-cover cursor-pointer"
                                  onClick={() => setPreviewAnexo(anexo)}
                                />
                              ) : (
                                <FileText className="w-6 h-6 text-[#C19A6B]" />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-xs text-[#2D2A26] truncate" title={anexo.fileName}>
                                {anexo.fileName}
                              </p>
                              <div className="flex items-center gap-1.5 text-[10px] text-[#8B7D6B] mt-0.5">
                                <span className="uppercase font-bold text-[#C19A6B]">
                                  {anexo.tipoDocumento ? anexo.tipoDocumento.replace('_', ' ') : 'documento'}
                                </span>
                                <span>•</span>
                                <span>{(anexo.fileSize / 1024).toFixed(0)} KB</span>
                              </div>
                              {anexo.descricao && (
                                <p className="text-[10px] text-slate-600 mt-1 italic line-clamp-1">
                                  {anexo.descricao}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Rodapé do Card de Anexo com Ações */}
                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px] text-[#8B7D6B]">
                            <span>Enviado em {formatDateBr(anexo.uploadedAt)}</span>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setPreviewAnexo(anexo)}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-md flex items-center gap-1 transition-colors"
                                title="Visualizar documento em tela cheia"
                              >
                                <Eye className="w-3 h-3" /> Ver
                              </button>

                              <a
                                href={anexo.fileData}
                                download={anexo.fileName}
                                className="px-2 py-1 bg-[#C19A6B]/15 hover:bg-[#C19A6B]/25 text-[#C19A6B] font-bold rounded-md flex items-center gap-1 transition-colors"
                                title="Baixar arquivo original"
                              >
                                <Download className="w-3 h-3" /> Baixar
                              </a>

                              <button
                                onClick={() => handleDeleteAnexo(anexo)}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                title="Excluir anexo"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Rodapé */}
            <div className="bg-[#fdfcf9] px-6 py-3.5 border-t border-[#EAE6DF] flex justify-end">
              <button
                onClick={() => {
                  setAnexosModalItem(null);
                  setAnexosList([]);
                }}
                className="px-5 py-2 text-xs font-bold bg-[#2D2A26] text-white rounded-xl hover:bg-[#3F3B35] transition-colors"
              >
                Concluir & Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL DE PRÉ-VISUALIZAÇÃO DE DOCUMENTO / NOTA FISCAL ─────────── */}
      {previewAnexo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden border border-[#EAE6DF]">
            <div className="bg-[#2D2A26] px-5 py-3 border-b-2 border-[#C19A6B] flex justify-between items-center">
              <div className="text-white">
                <p className="font-bold text-xs truncate max-w-md">{previewAnexo.fileName}</p>
                <p className="text-[10px] text-[#8B7D6B]">
                  {(previewAnexo.fileSize / 1024).toFixed(0)} KB • Enviado em {formatDateBr(previewAnexo.uploadedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewAnexo.fileData}
                  download={previewAnexo.fileName}
                  className="px-3 py-1.5 bg-[#C19A6B] hover:bg-[#a88252] text-white rounded-lg text-xs font-bold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Baixar
                </a>
                <button
                  onClick={() => setPreviewAnexo(null)}
                  className="text-[#8B7D6B] hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-900 overflow-auto flex items-center justify-center p-4">
              {previewAnexo.fileType.startsWith('image/') ? (
                <img
                  src={previewAnexo.fileData}
                  alt={previewAnexo.fileName}
                  className="max-h-full max-w-full object-contain rounded shadow-lg"
                />
              ) : previewAnexo.fileType.includes('pdf') || previewAnexo.fileName.toLowerCase().endsWith('.pdf') ? (
                <iframe
                  src={previewAnexo.fileData}
                  title={previewAnexo.fileName}
                  className="w-full h-full rounded border-0 bg-white"
                />
              ) : (
                <div className="text-white text-center">
                  <File className="w-16 h-16 mx-auto text-[#C19A6B] mb-2" />
                  <p className="font-bold text-sm">Visualização direta não suportada para este formato</p>
                  <p className="text-xs text-slate-400 mt-1 mb-4">Clique no botão abaixo para baixar e abrir o arquivo.</p>
                  <a
                    href={previewAnexo.fileData}
                    download={previewAnexo.fileName}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#C19A6B] text-white rounded-lg font-bold text-xs"
                  >
                    <Download className="w-4 h-4" /> Fazer Download
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
