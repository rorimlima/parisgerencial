import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  HardHat, Plus, Pencil, Trash2, Save, X, ChevronDown, 
  Users, Calendar, FileText, CheckCircle2, AlertCircle, Download,
  Printer, UserCheck
} from 'lucide-react';
import { 
  fetchObras, saveObra, deleteObra, 
  fetchFuncionarios, saveFuncionario, deleteFuncionario, 
  fetchRegistrosPonto, saveRegistrosPontoBatch 
} from '../services/obrasService';
import { 
  exportObraPdf, 
  exportFuncionarioDetalhadoPdf, 
  exportTodosFuncionariosDetalhadosPdf, 
  calcularResumos 
} from '../utils/obrasPdfExport';
import type { Obra, FuncionarioObra, RegistroPonto, StatusPonto } from '../types';

interface ObrasViewProps {
  selectedYear: number;
}

export const ObrasView: React.FC<ObrasViewProps> = ({ selectedYear }) => {
  // State
  const [obras, setObras] = useState<Obra[]>([]);
  const [selectedObraId, setSelectedObraId] = useState<string>('');
  const [funcionarios, setFuncionarios] = useState<FuncionarioObra[]>([]);
  const [registrosPonto, setRegistrosPonto] = useState<Record<string, RegistroPonto>>({});
  
  // Date state
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYearLocal, setSelectedYearLocal] = useState<number>(selectedYear || new Date().getFullYear());
  
  // UI State
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [pendingPontoChanges, setPendingPontoChanges] = useState<Record<string, RegistroPonto>>({});
  
  // Modals / Forms
  const [isObraModalOpen, setIsObraModalOpen] = useState<boolean>(false);
  const [obraFormData, setObraFormData] = useState<Partial<Obra>>({ status: 'Em andamento' });
  const [editingFuncionarioId, setEditingFuncionarioId] = useState<string | null>(null);
  const [funcionarioFormData, setFuncionarioFormData] = useState<Partial<FuncionarioObra>>({ status: 'Ativo' });

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  // Data Loading
  useEffect(() => {
    const loadObras = async () => {
      try {
        setIsLoading(true);
        const data = await fetchObras();
        setObras(data);
        if (data.length > 0 && !selectedObraId) {
          setSelectedObraId(data[0].id!);
        }
      } catch (err) {
        showToast('Erro ao carregar obras.', 'error');
      } finally {
        setIsLoading(false);
      }
    };
    loadObras();
  }, [showToast]);

  useEffect(() => {
    if (selectedYear) {
      setSelectedYearLocal(selectedYear);
    }
  }, [selectedYear]);

  useEffect(() => {
    const loadDetails = async () => {
      if (!selectedObraId) return;
      try {
        setIsLoading(true);
        const funcData = await fetchFuncionarios(selectedObraId);
        setFuncionarios(funcData);
        
        const pontoData = await fetchRegistrosPonto(selectedObraId, selectedMonth, selectedYearLocal);
        const pontoMap: Record<string, RegistroPonto> = {};
        pontoData.forEach(p => {
          if (p.id) pontoMap[p.id] = p;
        });
        setRegistrosPonto(pontoMap);
        setPendingPontoChanges({});
      } catch (err) {
        showToast('Erro ao carregar dados da obra.', 'error');
      } finally {
        setIsLoading(false);
      }
    };
    loadDetails();
  }, [selectedObraId, selectedYearLocal, selectedMonth, showToast]);

  const selectedObra = useMemo(() => obras.find(o => o.id === selectedObraId), [obras, selectedObraId]);

  // Helpers
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
  };
  
  const daysInMonth = new Date(selectedYearLocal, selectedMonth, 0).getDate();
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const getDayOfWeek = (day: number) => {
    return new Date(selectedYearLocal, selectedMonth - 1, day).getDay();
  };

  const getDayName = (day: number) => {
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return days[getDayOfWeek(day)];
  };

  // --- Obra Handlers ---
  const handleSaveObra = async () => {
    try {
      if (!obraFormData.nome || !obraFormData.dataInicio) {
        showToast('Nome e Data de Início são obrigatórios.', 'error');
        return;
      }
      const savedId = await saveObra(obraFormData as Obra);
      const newObra = { ...obraFormData, id: savedId } as Obra;
      
      setObras(prev => {
        const exists = prev.find(o => o.id === savedId);
        if (exists) return prev.map(o => o.id === savedId ? newObra : o);
        return [...prev, newObra];
      });
      setSelectedObraId(savedId);
      setIsObraModalOpen(false);
      showToast('Obra salva com sucesso.');
    } catch (error) {
      showToast('Erro ao salvar obra.', 'error');
    }
  };

  const handleDeleteObra = async () => {
    if (!selectedObraId) return;
    if (!window.confirm('Tem certeza que deseja excluir esta obra e todos os seus dados?')) return;
    
    try {
      await deleteObra(selectedObraId);
      setObras(prev => prev.filter(o => o.id !== selectedObraId));
      setSelectedObraId(obras.length > 1 ? obras.find(o => o.id !== selectedObraId)?.id || '' : '');
      showToast('Obra excluída com sucesso.');
    } catch (error) {
      showToast('Erro ao excluir obra.', 'error');
    }
  };

  // --- Funcionario Handlers ---
  const handleSaveFuncionario = async () => {
    if (!selectedObraId) return;
    try {
      if (!funcionarioFormData.nome || !funcionarioFormData.funcao) {
        showToast('Nome e Função são obrigatórios.', 'error');
        return;
      }
      
      const funcToSave = {
        ...funcionarioFormData,
        obraId: selectedObraId,
        valorDiaria: Number(funcionarioFormData.valorDiaria) || 0,
        valorHoraExtra: Number(funcionarioFormData.valorHoraExtra) || 0,
      } as FuncionarioObra;

      const savedId = await saveFuncionario(funcToSave);
      const newFunc = { ...funcToSave, id: savedId };
      
      setFuncionarios(prev => {
        const exists = prev.find(f => f.id === savedId);
        if (exists) return prev.map(f => f.id === savedId ? newFunc : f);
        return [...prev, newFunc];
      });
      
      setEditingFuncionarioId(null);
      setFuncionarioFormData({ status: 'Ativo' });
      showToast('Funcionário cadastrado com sucesso.');
    } catch (error) {
      showToast('Erro ao salvar funcionário.', 'error');
    }
  };

  const handleDeleteFuncionario = async (id: string) => {
    if (!window.confirm('Excluir este funcionário e seu histórico de ponto nesta obra?')) return;
    try {
      await deleteFuncionario(selectedObraId, id);
      setFuncionarios(prev => prev.filter(f => f.id !== id));
      showToast('Funcionário excluído.');
    } catch (error) {
      showToast('Erro ao excluir funcionário.', 'error');
    }
  };

  // --- Attendance Handlers ---
  const makeDateStr = (day: number) => {
    return `${selectedYearLocal}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const getPontoKey = (funcId: string, day: number) => {
    return `${funcId}_${makeDateStr(day)}`;
  };

  const handlePontoClick = (funcId: string, day: number) => {
    const key = getPontoKey(funcId, day);
    const currentRecord = pendingPontoChanges[key] || registrosPonto[key];
    
    let nextStatus: StatusPonto = 'presente';
    if (currentRecord && currentRecord.status) {
      const currentStatus = currentRecord.status;
      if (currentStatus === 'presente') nextStatus = 'meia';
      else if (currentStatus === 'meia') nextStatus = 'falta';
      else if (currentStatus === 'falta') nextStatus = 'folga';
      else if (currentStatus === 'folga') nextStatus = 'presente';
    }

    const newRecord: RegistroPonto = {
      id: key,
      funcionarioId: funcId,
      obraId: selectedObraId,
      data: makeDateStr(day),
      status: nextStatus,
      horasExtras: currentRecord?.horasExtras || 0,
    };

    setPendingPontoChanges(prev => ({ ...prev, [key]: newRecord }));
  };

  const handleDirectExtraHoursChange = (funcId: string, day: number, rawVal: string) => {
    const key = getPontoKey(funcId, day);
    const currentRecord = pendingPontoChanges[key] || registrosPonto[key];
    const numVal = rawVal === '' ? 0 : Math.max(0, parseFloat(rawVal) || 0);

    const dow = getDayOfWeek(day);
    const isWeekend = dow === 0 || dow === 6;

    // Se o dia não tinha status e o usuário informou horas extras, assume status 'presente'
    let statusToSet: StatusPonto = currentRecord?.status || (numVal > 0 ? 'presente' : (isWeekend ? 'folga' : 'presente'));

    const newRecord: RegistroPonto = {
      id: key,
      funcionarioId: funcId,
      obraId: selectedObraId,
      data: makeDateStr(day),
      status: statusToSet,
      horasExtras: numVal,
    };

    setPendingPontoChanges(prev => ({ ...prev, [key]: newRecord }));
  };

  /**
   * Marca como presentes AUTOMATICAMENTE apenas Segunda a Sexta (dias úteis).
   * Sábados (6) e Domingos (0) permanecem DESMARCADOS por padrão.
   */
  const handleMarkAllPresent = () => {
    const newChanges: Record<string, RegistroPonto> = { ...pendingPontoChanges };
    let countMarked = 0;

    funcionarios.forEach(func => {
      daysArray.forEach(day => {
        const dow = getDayOfWeek(day);
        // Exclui Sábados (6) e Domingos (0)
        if (dow >= 1 && dow <= 5) {
          const key = getPontoKey(func.id!, day);
          const currentRecord = pendingPontoChanges[key] || registrosPonto[key];
          if (!currentRecord || !currentRecord.status) {
            newChanges[key] = {
              id: key,
              funcionarioId: func.id!,
              obraId: selectedObraId,
              data: makeDateStr(day),
              status: 'presente',
              horasExtras: currentRecord?.horasExtras || 0,
            };
            countMarked++;
          }
        }
      });
    });

    setPendingPontoChanges(newChanges);
    showToast(`Dias úteis (Seg-Sex) marcados como presentes. Sábados e Domingos mantidos desmarcados.`);
  };

  const handleSavePonto = async () => {
    const changesArray = Object.values(pendingPontoChanges);
    if (changesArray.length === 0) return;

    try {
      setIsLoading(true);
      await saveRegistrosPontoBatch(changesArray);
      setRegistrosPonto(prev => ({ ...prev, ...pendingPontoChanges }));
      setPendingPontoChanges({});
      showToast('Lançamentos de ponto e horas extras salvos com sucesso.');
    } catch (err) {
      showToast('Erro ao salvar ponto.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // --- PDF Export Handlers ---
  const getAllCurrentRecords = useCallback(() => {
    return Object.values({ ...registrosPonto, ...pendingPontoChanges });
  }, [registrosPonto, pendingPontoChanges]);

  const handleExportConsolidadoPdf = () => {
    if (!selectedObra) return;
    exportObraPdf(selectedObra, funcionarios, getAllCurrentRecords(), selectedMonth, selectedYearLocal);
    showToast('Relatório Consolidado gerado.');
  };

  const handleExportTodosDetalhadosPdf = () => {
    if (!selectedObra) return;
    exportTodosFuncionariosDetalhadosPdf(selectedObra, funcionarios, getAllCurrentRecords(), selectedMonth, selectedYearLocal);
    showToast('Caderno Descritivo Geral de Funcionários gerado.');
  };

  const handleExportIndividualPdf = (func: FuncionarioObra) => {
    if (!selectedObra) return;
    exportFuncionarioDetalhadoPdf(selectedObra, func, getAllCurrentRecords(), selectedMonth, selectedYearLocal);
    showToast(`Relatório Descritivo de ${func.nome} gerado.`);
  };

  // UI Helpers
  const getCellColor = (status?: StatusPonto) => {
    switch (status) {
      case 'presente': return 'bg-emerald-500 text-white border-emerald-600';
      case 'meia': return 'bg-amber-400 text-amber-950 border-amber-500';
      case 'falta': return 'bg-rose-500 text-white border-rose-600';
      case 'folga': return 'bg-sky-200 text-sky-900 border-sky-300';
      default: return 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100';
    }
  };

  const getCellLabel = (status?: StatusPonto) => {
    switch (status) {
      case 'presente': return 'P';
      case 'meia': return '½';
      case 'falta': return 'F';
      case 'folga': return 'FG';
      default: return '—';
    }
  };

  const currentDataValues = { ...registrosPonto, ...pendingPontoChanges };
  const resumos = calcularResumos(funcionarios, Object.values(currentDataValues));
  const totalObra = resumos.reduce((acc, curr) => acc + curr.salarioTotal, 0);

  return (
    <div className="flex flex-col h-full bg-[#F9F7F2] text-[#433E37] relative">
      {toastMessage && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border animate-in fade-in slide-in-from-top-2 ${
          toastMessage.type === 'success' 
            ? 'bg-emerald-50 text-emerald-900 border-emerald-300' 
            : 'bg-rose-50 text-rose-900 border-rose-300'
        }`}>
          {toastMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
          <span className="font-semibold text-xs">{toastMessage.text}</span>
        </div>
      )}

      {/* TOP BAR */}
      <div className="bg-[#2D2A26] px-6 py-4 flex flex-col sm:flex-row items-center justify-between border-b-4 border-[#C19A6B] gap-4">
        <div className="flex flex-wrap items-center gap-3.5 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <HardHat className="w-6 h-6 text-[#C19A6B]" />
            <h1 className="text-lg font-black text-white tracking-wider uppercase">Controle de Obras & Ponto</h1>
          </div>
          
          <div className="relative">
            <select
              value={selectedObraId}
              onChange={(e) => setSelectedObraId(e.target.value)}
              className="appearance-none bg-[#3F3B35] text-white border border-[#4A453E] rounded-lg px-3.5 py-1.5 pr-9 focus:outline-none focus:border-[#C19A6B] font-semibold text-xs min-w-[220px]"
            >
              <option value="" disabled>Selecione uma obra...</option>
              {obras.map(o => (
                <option key={o.id} value={o.id}>{o.nome}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B7D6B] pointer-events-none" />
          </div>

          <button
            onClick={() => { setObraFormData({ status: 'Em andamento' }); setIsObraModalOpen(true); }}
            className="flex items-center gap-1.5 bg-[#C19A6B] hover:bg-[#a88252] text-white px-3 py-1.5 rounded-lg font-bold text-xs transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" /> Nova Obra
          </button>
        </div>

        {selectedObra && (
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <div className={`px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 ${
              selectedObra.status === 'Em andamento' ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700' :
              selectedObra.status === 'Concluída' ? 'bg-sky-900/50 text-sky-300 border border-sky-700' :
              'bg-rose-900/50 text-rose-300 border border-rose-700'
            }`}>
              <span className="w-2 h-2 rounded-full bg-current"></span>
              {selectedObra.status}
            </div>

            <div className="flex gap-1.5">
              <button 
                onClick={() => { setObraFormData(selectedObra); setIsObraModalOpen(true); }}
                className="p-1.5 text-[#8B7D6B] hover:text-[#C19A6B] hover:bg-[#3F3B35] rounded-lg transition-colors"
                title="Editar dados da obra"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button 
                onClick={handleDeleteObra}
                className="p-1.5 text-[#8B7D6B] hover:text-rose-400 hover:bg-[#3F3B35] rounded-lg transition-colors"
                title="Excluir obra"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
        {isLoading && <div className="text-center text-[#8B7D6B] py-12 text-sm font-semibold">Carregando dados da obra...</div>}
        
        {!isLoading && !selectedObra && (
          <div className="flex flex-col items-center justify-center h-80 text-[#8B7D6B] bg-white rounded-2xl border border-[#EAE6DF] p-8 shadow-xs">
            <HardHat className="w-16 h-16 mb-4 text-[#C19A6B]" />
            <p className="text-base font-bold text-[#2D2A26]">Nenhuma obra selecionada</p>
            <p className="text-xs text-[#8B7D6B] mt-1 mb-4">Cadastre sua primeira obra ou selecione uma existente para iniciar o controle de ponto.</p>
            <button
              onClick={() => { setObraFormData({ status: 'Em andamento' }); setIsObraModalOpen(true); }}
              className="px-4 py-2 bg-[#2D2A26] text-white font-bold text-xs rounded-xl hover:bg-[#3F3B35] transition-all shadow-sm"
            >
              + Criar Primeira Obra
            </button>
          </div>
        )}

        {!isLoading && selectedObra && (
          <>
            {/* ── QUADRO DE FUNCIONÁRIOS ────────────────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-xs border border-[#EAE6DF] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EAE6DF] flex justify-between items-center bg-[#fdfcf9]">
                <h2 className="text-xs font-black text-[#2D2A26] uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#C19A6B]" /> Equipe da Obra & Valores de Diária / Hora Extra
                </h2>
                <span className="text-[11px] font-bold text-[#8B7D6B]">
                  {funcionarios.length} funcionário(s) cadastrado(s)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-[#F9F7F2] text-[#8B7D6B] uppercase text-[10px] font-extrabold tracking-wider border-b border-[#EAE6DF]">
                    <tr>
                      <th className="px-4 py-2.5">Nome do Funcionário</th>
                      <th className="px-4 py-2.5">Função / Cargo</th>
                      <th className="px-4 py-2.5 text-right">Valor Diária (R$)</th>
                      <th className="px-4 py-2.5 text-right">Valor Hora Extra (R$/h)</th>
                      <th className="px-4 py-2.5 text-center">Status</th>
                      <th className="px-4 py-2.5">Observações</th>
                      <th className="px-4 py-2.5 text-right">Ações & Relatórios</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE6DF]">
                    {funcionarios.map(func => (
                      <tr key={func.id} className="hover:bg-[#fdfcf9] transition-colors">
                        {editingFuncionarioId === func.id ? (
                          <>
                            <td className="px-4 py-2"><input type="text" className="w-full border border-[#EAE6DF] rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.nome || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, nome: e.target.value})} placeholder="Nome completo" /></td>
                            <td className="px-4 py-2"><input type="text" className="w-full border border-[#EAE6DF] rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.funcao || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, funcao: e.target.value})} placeholder="Ex: Pedreiro" /></td>
                            <td className="px-4 py-2 text-right"><input type="number" step="0.01" className="w-24 border border-[#EAE6DF] rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none text-right" value={funcionarioFormData.valorDiaria || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, valorDiaria: parseFloat(e.target.value) || 0})} placeholder="0.00" /></td>
                            <td className="px-4 py-2 text-right"><input type="number" step="0.01" className="w-24 border border-[#EAE6DF] rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none text-right" value={funcionarioFormData.valorHoraExtra || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, valorHoraExtra: parseFloat(e.target.value) || 0})} placeholder="0.00" /></td>
                            <td className="px-4 py-2 text-center">
                              <select className="border border-[#EAE6DF] rounded-md px-2 py-1 text-xs focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.status || 'Ativo'} onChange={e => setFuncionarioFormData({...funcionarioFormData, status: e.target.value as any})}>
                                <option value="Ativo">Ativo</option>
                                <option value="Inativo">Inativo</option>
                              </select>
                            </td>
                            <td className="px-4 py-2"><input type="text" className="w-full border border-[#EAE6DF] rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.observacao || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, observacao: e.target.value})} placeholder="Obs..." /></td>
                            <td className="px-4 py-2 text-right space-x-1.5">
                              <button onClick={handleSaveFuncionario} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-xs shadow-xs">Salvar</button>
                              <button onClick={() => {setEditingFuncionarioId(null); setFuncionarioFormData({status: 'Ativo'});}} className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-md font-bold text-xs">Cancelar</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2.5 font-bold text-[#2D2A26]">{func.nome}</td>
                            <td className="px-4 py-2.5 text-[#433E37]">{func.funcao}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-[#2D2A26]">{formatCurrency(func.valorDiaria)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-[#2D2A26]">{formatCurrency(func.valorHoraExtra || 0)}/h</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${func.status === 'Ativo' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                                {func.status}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-[#8B7D6B] max-w-[180px] truncate">{func.observacao || '—'}</td>
                            <td className="px-4 py-2.5 text-right space-x-1">
                              <button 
                                onClick={() => handleExportIndividualPdf(func)} 
                                className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors font-bold inline-flex items-center gap-1 text-[11px]"
                                title="Exportar Folha Descritiva Individual em PDF"
                              >
                                <Printer className="w-3.5 h-3.5" /> PDF Individual
                              </button>
                              <button 
                                onClick={() => {setEditingFuncionarioId(func.id!); setFuncionarioFormData(func);}} 
                                className="p-1.5 text-[#8B7D6B] hover:text-[#C19A6B] hover:bg-[#F9F7F2] rounded-lg transition-colors"
                                title="Editar funcionário"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => handleDeleteFuncionario(func.id!)} 
                                className="p-1.5 text-[#8B7D6B] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Excluir funcionário"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                    
                    {/* Linha inline para cadastrar novo funcionário */}
                    {editingFuncionarioId === 'new' && (
                      <tr className="bg-amber-50/40">
                        <td className="px-4 py-2"><input type="text" placeholder="Nome do Funcionário" className="w-full border border-amber-300 rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none bg-white" value={funcionarioFormData.nome || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, nome: e.target.value})} autoFocus /></td>
                        <td className="px-4 py-2"><input type="text" placeholder="Função / Cargo" className="w-full border border-amber-300 rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none bg-white" value={funcionarioFormData.funcao || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, funcao: e.target.value})} /></td>
                        <td className="px-4 py-2 text-right"><input type="number" step="0.01" placeholder="Diária (R$)" className="w-24 border border-amber-300 rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none text-right bg-white" value={funcionarioFormData.valorDiaria || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, valorDiaria: parseFloat(e.target.value) || 0})} /></td>
                        <td className="px-4 py-2 text-right"><input type="number" step="0.01" placeholder="HE (R$/h)" className="w-24 border border-amber-300 rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none text-right bg-white" value={funcionarioFormData.valorHoraExtra || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, valorHoraExtra: parseFloat(e.target.value) || 0})} /></td>
                        <td className="px-4 py-2 text-center">
                          <select className="border border-amber-300 rounded-md px-2 py-1 text-xs focus:border-[#C19A6B] focus:outline-none bg-white" value={funcionarioFormData.status || 'Ativo'} onChange={e => setFuncionarioFormData({...funcionarioFormData, status: e.target.value as any})}>
                            <option value="Ativo">Ativo</option>
                            <option value="Inativo">Inativo</option>
                          </select>
                        </td>
                        <td className="px-4 py-2"><input type="text" placeholder="Observação opcional..." className="w-full border border-amber-300 rounded-md px-2.5 py-1 text-xs focus:border-[#C19A6B] focus:outline-none bg-white" value={funcionarioFormData.observacao || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, observacao: e.target.value})} /></td>
                        <td className="px-4 py-2 text-right space-x-1.5">
                          <button onClick={handleSaveFuncionario} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold text-xs shadow-xs">Salvar</button>
                          <button onClick={() => {setEditingFuncionarioId(null); setFuncionarioFormData({status: 'Ativo'});}} className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-md font-bold text-xs">Cancelar</button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {editingFuncionarioId !== 'new' && (
                <div className="p-3 border-t border-[#EAE6DF] bg-[#fdfcf9]">
                  <button 
                    onClick={() => { setEditingFuncionarioId('new'); setFuncionarioFormData({ status: 'Ativo', valorDiaria: 0, valorHoraExtra: 0 }); }}
                    className="flex items-center gap-1.5 text-xs font-bold text-[#C19A6B] hover:text-[#9e7d56] transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Adicionar Funcionário
                  </button>
                </div>
              )}
            </div>

            {/* ── GRADE DE FREQUÊNCIA & HORAS EXTRAS ────────────────────────────── */}
            <div className="bg-white rounded-xl shadow-xs border border-[#EAE6DF] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#EAE6DF] flex flex-wrap gap-4 justify-between items-center bg-[#fdfcf9]">
                <div>
                  <h2 className="text-xs font-black text-[#2D2A26] uppercase tracking-wider flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#C19A6B]" /> Registro de Ponto Diário & Horas Extras
                  </h2>
                  <p className="text-[11px] text-[#8B7D6B] mt-0.5">
                    Clique no botão de presença para alternar (P / ½ / F / FG) ou digite a quantidade de horas extras no campo <strong>HE</strong> abaixo do dia.
                  </p>
                </div>
                
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex gap-1.5 items-center bg-white p-1 rounded-lg border border-[#EAE6DF]">
                    <select 
                      value={selectedMonth} 
                      onChange={(e) => setSelectedMonth(Number(e.target.value))}
                      className="border-0 bg-transparent px-2.5 py-1 text-xs font-bold text-[#2D2A26] focus:outline-none"
                    >
                      {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map((m, i) => (
                        <option key={i} value={i + 1}>{m}</option>
                      ))}
                    </select>
                    <span className="text-[#8B7D6B]">/</span>
                    <input 
                      type="number" 
                      value={selectedYearLocal}
                      onChange={(e) => setSelectedYearLocal(Number(e.target.value))}
                      className="border-0 bg-transparent px-1.5 py-1 text-xs font-bold text-[#2D2A26] focus:outline-none w-16"
                    />
                  </div>
                  
                  <button 
                    onClick={handleMarkAllPresent}
                    className="flex items-center gap-1.5 text-xs font-bold bg-[#F9F7F2] text-[#433E37] px-3 py-2 rounded-lg border border-[#EAE6DF] hover:border-[#C19A6B] hover:bg-amber-50/50 transition-all shadow-2xs"
                    title="Marca automaticamente Segunda a Sexta como Presente. Sábados e Domingos ficam desmarcados."
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Marcar Seg-Sex Presentes
                  </button>
                  
                  <button 
                    onClick={handleSavePonto}
                    disabled={Object.keys(pendingPontoChanges).length === 0}
                    className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-wider px-4 py-2 rounded-lg transition-all shadow-xs ${
                      Object.keys(pendingPontoChanges).length > 0 
                        ? 'bg-[#2D2A26] text-white hover:bg-[#3F3B35] ring-2 ring-[#C19A6B]/50' 
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <Save className="w-4 h-4 text-[#C19A6B]" /> Salvar Alterações {Object.keys(pendingPontoChanges).length > 0 && `(${Object.keys(pendingPontoChanges).length})`}
                  </button>
                </div>
              </div>
              
              <div className="p-4 bg-white overflow-x-auto">
                <div className="flex flex-wrap gap-4 text-[10px] uppercase font-bold text-[#8B7D6B] mb-3.5 items-center">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-emerald-500 text-white flex items-center justify-center font-bold text-[8px]">P</span> Presente (Diária)</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-amber-400 text-amber-950 flex items-center justify-center font-bold text-[8px]">½</span> Meia Diária (50%)</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-rose-500 text-white flex items-center justify-center font-bold text-[8px]">F</span> Falta</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-sky-200 text-sky-900 flex items-center justify-center font-bold text-[8px]">FG</span> Folga</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-purple-600 text-white flex items-center justify-center font-bold text-[8px]">HE</span> Horas Extras (campo inferior)</span>
                  <span className="ml-auto text-[#8B7D6B] font-semibold normal-case italic">
                    *Sábados e Domingos ficam desmarcados por padrão — preencha presença ou digite a quantidade de horas extras se houver expediente.
                  </span>
                </div>

                <div className="inline-block min-w-full">
                  <table className="border-collapse select-none w-full">
                    <thead>
                      <tr>
                        <th className="sticky left-0 bg-white z-20 border border-[#EAE6DF] p-2 text-xs font-black text-[#2D2A26] text-left w-52 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                          Funcionário / Cargo
                        </th>
                        {daysArray.map(day => {
                          const dow = getDayOfWeek(day);
                          const isWeekend = dow === 0 || dow === 6;
                          return (
                            <th key={day} className={`border border-[#EAE6DF] p-1 min-w-[44px] w-[44px] text-center ${dow === 0 ? 'bg-rose-50/80 border-rose-200' : dow === 6 ? 'bg-amber-50/60 border-amber-200' : 'bg-[#F9F7F2]'}`}>
                              <div className={`text-[9px] font-black uppercase ${dow === 0 ? 'text-rose-600' : dow === 6 ? 'text-amber-700' : 'text-[#8B7D6B]'}`}>
                                {getDayName(day)}
                              </div>
                              <div className={`text-xs font-extrabold ${dow === 0 ? 'text-rose-700' : dow === 6 ? 'text-amber-900' : 'text-[#2D2A26]'}`}>
                                {day}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {funcionarios.filter(f => f.status === 'Ativo').map(func => (
                        <tr key={func.id} className="hover:bg-[#fdfcf9]">
                          <td className="sticky left-0 bg-white z-10 border border-[#EAE6DF] p-2.5 text-xs shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                            <div className="font-bold text-[#2D2A26] truncate" title={func.nome}>{func.nome}</div>
                            <div className="text-[10px] text-[#8B7D6B] truncate">{func.funcao} • {formatCurrency(func.valorDiaria)}</div>
                          </td>
                          {daysArray.map(day => {
                            const key = getPontoKey(func.id!, day);
                            const record = pendingPontoChanges[key] || registrosPonto[key];
                            const isPending = !!pendingPontoChanges[key];
                            const dow = getDayOfWeek(day);
                            const cellBgClass = getCellColor(record?.status);
                            const horasExtrasVal = record?.horasExtras !== undefined && record?.horasExtras !== 0 ? record.horasExtras : '';
                            
                            return (
                              <td key={day} className={`border border-[#EAE6DF] p-1 text-center align-top ${dow === 0 ? 'bg-rose-50/20' : dow === 6 ? 'bg-amber-50/20' : ''}`}>
                                <div className="flex flex-col items-center gap-1">
                                  {/* Botão de Presença */}
                                  <button
                                    type="button"
                                    onClick={() => handlePontoClick(func.id!, day)}
                                    className={`w-full h-7 flex items-center justify-center rounded-md text-[11px] font-black transition-all border shadow-2xs ${cellBgClass} ${isPending ? 'ring-2 ring-[#C19A6B] ring-offset-1' : ''}`}
                                    title="Clique para alternar: Presente (P) -> Meia (½) -> Falta (F) -> Folga (FG)"
                                  >
                                    {getCellLabel(record?.status)}
                                  </button>

                                  {/* Campo de Horas Extras Direto */}
                                  <div className="w-full relative" title="Horas Extras (ex: 1.5, 2, 3)">
                                    <input
                                      type="number"
                                      min="0"
                                      max="24"
                                      step="0.5"
                                      placeholder="HE"
                                      value={horasExtrasVal}
                                      onChange={(e) => handleDirectExtraHoursChange(func.id!, day, e.target.value)}
                                      className={`w-full text-[10px] text-center font-bold border rounded-md py-0.5 px-0.5 focus:outline-none transition-all ${
                                        Number(horasExtrasVal) > 0 
                                          ? 'bg-purple-100 border-purple-400 text-purple-900 font-black ring-1 ring-purple-400' 
                                          : 'bg-white border-[#EAE6DF] text-slate-700 placeholder:text-slate-300 focus:border-purple-500'
                                      }`}
                                    />
                                    {Number(horasExtrasVal) > 0 && (
                                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-purple-600"></span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ── RESUMO FINANCEIRO & BOTÕES DE EXPORTAÇÃO ─────────────────────── */}
            <div className="flex flex-col xl:flex-row gap-6 items-start">
              {/* Cards individuais por funcionário */}
              <div className="flex-1 bg-white rounded-xl shadow-xs border border-[#EAE6DF] overflow-hidden w-full">
                <div className="px-5 py-4 border-b border-[#EAE6DF] flex flex-wrap justify-between items-center bg-[#fdfcf9] gap-3">
                  <div>
                    <h2 className="text-xs font-black text-[#2D2A26] uppercase tracking-wider flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[#C19A6B]" /> Apuração Mensal por Funcionário ({selectedMonth}/{selectedYearLocal})
                    </h2>
                    <p className="text-[11px] text-[#8B7D6B] mt-0.5">
                      Cálculo: (Diárias Integrais × Valor Diária) + (Meias Diárias × 50%) + (Horas Extras × Valor HE)
                    </p>
                  </div>

                  <button
                    onClick={handleExportTodosDetalhadosPdf}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg font-bold text-xs transition-colors shadow-xs"
                    title="Gera um PDF com a folha descritiva dia a dia de todos os funcionários da obra"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#C19A6B]" /> Caderno Descritivo (Todos)
                  </button>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {resumos.map(r => (
                    <div key={r.funcionario.id} className="border border-[#EAE6DF] rounded-xl p-4 bg-[#F9F7F2] flex flex-col justify-between hover:border-[#C19A6B]/50 transition-colors shadow-2xs">
                      <div>
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-extrabold text-[#2D2A26] text-xs">{r.funcionario.nome}</span>
                          <span className="px-2 py-0.5 bg-slate-200 text-slate-700 text-[9px] font-bold rounded-full">{r.funcionario.funcao}</span>
                        </div>
                        <div className="text-[10px] text-[#8B7D6B] mb-3 pb-2 border-b border-[#EAE6DF] flex justify-between">
                          <span>Diária: {formatCurrency(r.funcionario.valorDiaria)}</span>
                          <span>HE: {formatCurrency(r.funcionario.valorHoraExtra)}/h</span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-y-1.5 text-[11px] mb-3 bg-white p-2.5 rounded-lg border border-[#EAE6DF]">
                          <div className="flex justify-between pr-2"><span className="text-[#8B7D6B]">Presenças:</span> <span className="font-bold text-emerald-700">{r.diasPresente}d</span></div>
                          <div className="flex justify-between pl-2"><span className="text-[#8B7D6B]">Meias:</span> <span className="font-bold text-amber-700">{r.diasMeia}d</span></div>
                          <div className="flex justify-between pr-2"><span className="text-[#8B7D6B]">Faltas:</span> <span className="font-bold text-rose-700">{r.diasFalta}d</span></div>
                          <div className="flex justify-between pl-2"><span className="text-[#8B7D6B]">Folgas:</span> <span className="font-bold text-sky-700">{r.diasFolga}d</span></div>
                          <div className="flex justify-between pr-2 col-span-2 pt-1 border-t border-slate-100">
                            <span className="text-[#8B7D6B]">Horas Extras:</span> <span className="font-black text-purple-700">{r.totalHorasExtras.toFixed(1)} horas ({formatCurrency(r.salarioHorasExtras)})</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="pt-2.5 border-t border-[#EAE6DF] flex items-center justify-between">
                        <div>
                          <span className="block text-[9px] uppercase font-bold text-[#8B7D6B]">Salário Total</span>
                          <span className="text-sm font-black text-[#C19A6B]">{formatCurrency(r.salarioTotal)}</span>
                        </div>

                        <button
                          onClick={() => handleExportIndividualPdf(r.funcionario)}
                          className="px-2.5 py-1.5 bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors shadow-2xs"
                          title="Exportar PDF detalhado dia a dia deste funcionário"
                        >
                          <Printer className="w-3 h-3" /> PDF Detalhado
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Card consolidado da obra */}
              <div className="xl:w-80 w-full flex flex-col gap-4">
                <div className="bg-[#2D2A26] rounded-2xl shadow-md p-6 text-white border-t-4 border-[#C19A6B] space-y-4">
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wider text-[#C19A6B] font-black">Custo Total da Mão de Obra</h3>
                    <p className="text-xs text-[#8B7D6B]">{selectedObra.nome} — {selectedMonth}/{selectedYearLocal}</p>
                  </div>

                  <div className="text-3xl font-black text-[#C19A6B] tracking-tight">
                    {formatCurrency(totalObra)}
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-300 pt-2 border-t border-[#3F3B35]">
                    <div className="flex justify-between">
                      <span className="text-[#8B7D6B]">Funcionários Ativos:</span>
                      <span className="font-bold text-white">{funcionarios.filter(f => f.status === 'Ativo').length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7D6B]">Total Diárias Integrais:</span>
                      <span className="font-bold text-emerald-400">{resumos.reduce((s, r) => s + r.diasPresente, 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7D6B]">Total Meias Diárias:</span>
                      <span className="font-bold text-amber-400">{resumos.reduce((s, r) => s + r.diasMeia, 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B7D6B]">Total Horas Extras:</span>
                      <span className="font-bold text-purple-300">{resumos.reduce((s, r) => s + r.totalHorasExtras, 0).toFixed(1)}h</span>
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-3">
                    <button 
                      onClick={handleExportConsolidadoPdf}
                      className="w-full py-2.5 bg-[#C19A6B] hover:bg-[#a88252] text-white rounded-xl font-bold text-xs flex justify-center items-center gap-2 transition-all shadow-md"
                    >
                      <Download className="w-4 h-4" /> PDF Geral Consolidado
                    </button>

                    <button 
                      onClick={handleExportTodosDetalhadosPdf}
                      className="w-full py-2.5 bg-[#3F3B35] hover:bg-[#4A453E] text-white rounded-xl font-bold text-xs flex justify-center items-center gap-2 transition-all border border-[#4A453E]"
                    >
                      <Printer className="w-4 h-4 text-[#C19A6B]" /> PDF Descritivo de Todos
                    </button>
                  </div>

                  <p className="text-[10px] text-center text-[#8B7D6B] leading-relaxed">
                    Documentos oficiais empresariais com cabeçalho corporativo, folhas descritivas diárias e termos de quitação para assinatura.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* MODAL DE CADASTRO/EDIÇÃO DE OBRA */}
      {isObraModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-[#EAE6DF]">
            <div className="bg-[#2D2A26] px-5 py-4 border-b-4 border-[#C19A6B] flex justify-between items-center">
              <h2 className="text-sm font-black text-white uppercase tracking-wider">
                {obraFormData.id ? 'Editar Dados da Obra' : 'Cadastrar Nova Obra'}
              </h2>
              <button onClick={() => setIsObraModalOpen(false)} className="text-[#8B7D6B] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3.5 text-xs text-[#433E37]">
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">Nome da Obra *</label>
                <input 
                  type="text" 
                  value={obraFormData.nome || ''} 
                  onChange={e => setObraFormData({...obraFormData, nome: e.target.value})}
                  className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 focus:border-[#C19A6B] focus:outline-none font-semibold text-xs" 
                  placeholder="Ex: Edifício Paris Dakar - Torre A"
                />
              </div>
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">Endereço da Obra</label>
                <input 
                  type="text" 
                  value={obraFormData.endereco || ''} 
                  onChange={e => setObraFormData({...obraFormData, endereco: e.target.value})}
                  className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 focus:border-[#C19A6B] focus:outline-none text-xs" 
                  placeholder="Av. Paulista, 1000 - São Paulo/SP"
                />
              </div>
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">Engenheiro / Responsável</label>
                <input 
                  type="text" 
                  value={obraFormData.responsavel || ''} 
                  onChange={e => setObraFormData({...obraFormData, responsavel: e.target.value})}
                  className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 focus:border-[#C19A6B] focus:outline-none text-xs" 
                  placeholder="Ex: Eng. Carlos Silva (CREA 12345)"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">Data Início *</label>
                  <input 
                    type="date" 
                    value={obraFormData.dataInicio || ''} 
                    onChange={e => setObraFormData({...obraFormData, dataInicio: e.target.value})}
                    className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 focus:border-[#C19A6B] focus:outline-none text-xs text-[#433E37]" 
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">Data Fim (Opcional)</label>
                  <input 
                    type="date" 
                    value={obraFormData.dataFim || ''} 
                    onChange={e => setObraFormData({...obraFormData, dataFim: e.target.value})}
                    className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 focus:border-[#C19A6B] focus:outline-none text-xs text-[#433E37]" 
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">Status da Obra</label>
                <select 
                  value={obraFormData.status || 'Em andamento'} 
                  onChange={e => setObraFormData({...obraFormData, status: e.target.value as any})}
                  className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 focus:border-[#C19A6B] focus:outline-none text-xs font-semibold"
                >
                  <option value="Em andamento">Em andamento</option>
                  <option value="Concluída">Concluída</option>
                  <option value="Paralisada">Paralisada</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8B7D6B] mb-1">Observações Gerais</label>
                <textarea 
                  value={obraFormData.observacao || ''} 
                  onChange={e => setObraFormData({...obraFormData, observacao: e.target.value})}
                  className="w-full border border-[#EAE6DF] rounded-lg px-3 py-2 focus:border-[#C19A6B] focus:outline-none text-xs h-20 resize-none" 
                  placeholder="Anotações sobre a obra..."
                />
              </div>
            </div>
            <div className="bg-[#fdfcf9] px-5 py-3.5 border-t border-[#EAE6DF] flex justify-end gap-2.5">
              <button 
                onClick={() => setIsObraModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26] transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveObra}
                className="px-5 py-2 text-xs font-black bg-[#C19A6B] hover:bg-[#a88252] text-white rounded-xl shadow-xs transition-colors"
              >
                Salvar Obra
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
