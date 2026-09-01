import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  HardHat, Plus, Pencil, Trash2, Save, X, ChevronDown, ChevronRight, 
  Users, Calendar, FileText, CheckCircle2, XCircle, Clock, AlertCircle, Download 
} from 'lucide-react';
import { 
  fetchObras, saveObra, deleteObra, 
  fetchFuncionarios, saveFuncionario, deleteFuncionario, 
  fetchRegistrosPonto, saveRegistroPonto, saveRegistrosPontoBatch 
} from '../services/obrasService';
import { exportObraPdf, calcularResumos } from '../utils/obrasPdfExport';
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
  
  // Extra hours popover
  const [extraHoursPopover, setExtraHoursPopover] = useState<{
    funcionarioId: string;
    day: number;
    value: number;
    x: number;
    y: number;
  } | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
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
  }, [showToast]); // intentionally omitting selectedObraId to avoid re-running

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
      showToast('Obra excluída.');
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
      showToast('Funcionário salvo.');
    } catch (error) {
      showToast('Erro ao salvar funcionário.', 'error');
    }
  };

  const handleDeleteFuncionario = async (id: string) => {
    if (!window.confirm('Excluir funcionário?')) return;
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
    if (currentRecord) {
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

  const handleContextMenu = (e: React.MouseEvent, funcId: string, day: number) => {
    e.preventDefault();
    const key = getPontoKey(funcId, day);
    const currentRecord = pendingPontoChanges[key] || registrosPonto[key];
    
    setExtraHoursPopover({
      funcionarioId: funcId,
      day,
      value: currentRecord?.horasExtras || 0,
      x: e.clientX,
      y: e.clientY
    });
  };

  const handleSaveExtraHours = (hours: number) => {
    if (!extraHoursPopover) return;
    const { funcionarioId, day } = extraHoursPopover;
    const key = getPontoKey(funcionarioId, day);
    const currentRecord = pendingPontoChanges[key] || registrosPonto[key] || {
      id: key,
      funcionarioId,
      obraId: selectedObraId,
      data: makeDateStr(day),
      status: 'presente' as StatusPonto,
      horasExtras: 0,
    };

    setPendingPontoChanges(prev => ({
      ...prev,
      [key]: { ...currentRecord, horasExtras: hours }
    }));
    setExtraHoursPopover(null);
  };

  const handleMarkAllPresent = () => {
    const newChanges: Record<string, RegistroPonto> = { ...pendingPontoChanges };
    funcionarios.forEach(func => {
      daysArray.forEach(day => {
        const key = getPontoKey(func.id!, day);
        const currentRecord = pendingPontoChanges[key] || registrosPonto[key];
        if (!currentRecord || !currentRecord.status) {
          newChanges[key] = {
            id: key,
            funcionarioId: func.id!,
            obraId: selectedObraId,
            data: makeDateStr(day),
            status: 'presente',
            horasExtras: 0,
          };
        }
      });
    });
    setPendingPontoChanges(newChanges);
  };

  const handleSavePonto = async () => {
    const changesArray = Object.values(pendingPontoChanges);
    if (changesArray.length === 0) return;

    try {
      setIsLoading(true);
      await saveRegistrosPontoBatch(changesArray);
      setRegistrosPonto(prev => ({ ...prev, ...pendingPontoChanges }));
      setPendingPontoChanges({});
      showToast('Ponto salvo com sucesso.');
    } catch (err) {
      showToast('Erro ao salvar ponto.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportPdf = () => {
    if (!selectedObra) return;
    const currentData = { ...registrosPonto, ...pendingPontoChanges };
    exportObraPdf(selectedObra, funcionarios, Object.values(currentData), selectedMonth, selectedYearLocal);
  };

  // UI Helpers
  const getCellColor = (status?: StatusPonto) => {
    switch (status) {
      case 'presente': return 'bg-green-500 text-white border-green-600';
      case 'meia': return 'bg-yellow-400 text-amber-900 border-yellow-500';
      case 'falta': return 'bg-red-500 text-white border-red-600';
      case 'folga': return 'bg-blue-300 text-blue-900 border-blue-400';
      default: return 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200';
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
        <div className={`absolute top-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg flex items-center gap-2 ${
          toastMessage.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {toastMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="font-medium text-sm">{toastMessage.text}</span>
        </div>
      )}

      {/* TOP BAR */}
      <div className="bg-[#2D2A26] px-6 py-4 flex flex-col sm:flex-row items-center justify-between border-b-4 border-[#C19A6B]">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <HardHat className="w-6 h-6 text-[#C19A6B]" />
          <h1 className="text-xl font-bold text-white tracking-wide uppercase">Controle de Obras</h1>
          <div className="relative">
            <select
              value={selectedObraId}
              onChange={(e) => setSelectedObraId(e.target.value)}
              className="appearance-none bg-[#3F3B35] text-white border border-[#4A453E] rounded-md px-4 py-2 pr-10 focus:outline-none focus:border-[#C19A6B] font-medium min-w-[200px]"
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
            className="flex items-center gap-2 bg-[#C19A6B] hover:bg-[#b08b5e] text-white px-3 py-2 rounded-md font-medium text-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> Nova Obra
          </button>
        </div>

        {selectedObra && (
          <div className="flex items-center gap-4 mt-4 sm:mt-0">
            <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
              selectedObra.status === 'Em andamento' ? 'bg-green-900/40 text-green-400 border border-green-800' :
              selectedObra.status === 'Concluída' ? 'bg-blue-900/40 text-blue-400 border border-blue-800' :
              'bg-red-900/40 text-red-400 border border-red-800'
            }`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
              {selectedObra.status}
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => { setObraFormData(selectedObra); setIsObraModalOpen(true); }}
                className="p-2 text-[#8B7D6B] hover:text-[#C19A6B] hover:bg-[#3F3B35] rounded-md transition-colors"
                title="Editar obra"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button 
                onClick={handleDeleteObra}
                className="p-2 text-[#8B7D6B] hover:text-red-400 hover:bg-[#3F3B35] rounded-md transition-colors"
                title="Excluir obra"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading && <div className="text-center text-[#8B7D6B] py-10">Carregando dados...</div>}
        
        {!isLoading && !selectedObra && (
          <div className="flex flex-col items-center justify-center h-full text-[#8B7D6B] opacity-70">
            <HardHat className="w-16 h-16 mb-4" />
            <p className="text-lg">Selecione ou crie uma obra para começar.</p>
          </div>
        )}

        {!isLoading && selectedObra && (
          <div className="space-y-6">
            
            {/* EMPLOYEES SECTION */}
            <div className="bg-white rounded-xl shadow-sm border border-[#EAE6DF] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#EAE6DF] flex justify-between items-center bg-[#fdfcf9]">
                <h2 className="text-sm font-extrabold text-[#2D2A26] uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#C19A6B]" /> Quadro de Funcionários
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#F9F7F2] text-[#8B7D6B] uppercase text-[10px] font-bold tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Nome</th>
                      <th className="px-4 py-3">Função</th>
                      <th className="px-4 py-3">Valor Diária</th>
                      <th className="px-4 py-3">Valor H.Extra</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Observação</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE6DF]">
                    {funcionarios.map(func => (
                      <tr key={func.id} className="hover:bg-[#fdfcf9]">
                        {editingFuncionarioId === func.id ? (
                          <>
                            <td className="px-4 py-2"><input type="text" className="w-full border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.nome || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, nome: e.target.value})} /></td>
                            <td className="px-4 py-2"><input type="text" className="w-full border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.funcao || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, funcao: e.target.value})} /></td>
                            <td className="px-4 py-2"><input type="number" step="0.01" className="w-24 border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.valorDiaria || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, valorDiaria: Number(e.target.value)})} /></td>
                            <td className="px-4 py-2"><input type="number" step="0.01" className="w-24 border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.valorHoraExtra || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, valorHoraExtra: Number(e.target.value)})} /></td>
                            <td className="px-4 py-2">
                              <select className="border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.status || 'Ativo'} onChange={e => setFuncionarioFormData({...funcionarioFormData, status: e.target.value as any})}>
                                <option value="Ativo">Ativo</option>
                                <option value="Inativo">Inativo</option>
                              </select>
                            </td>
                            <td className="px-4 py-2"><input type="text" className="w-full border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.observacao || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, observacao: e.target.value})} /></td>
                            <td className="px-4 py-2 text-right space-x-2">
                              <button onClick={handleSaveFuncionario} className="p-1 text-green-600 hover:bg-green-50 rounded"><Save className="w-4 h-4" /></button>
                              <button onClick={() => {setEditingFuncionarioId(null); setFuncionarioFormData({status: 'Ativo'})}} className="p-1 text-red-600 hover:bg-red-50 rounded"><X className="w-4 h-4" /></button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 font-medium text-[#2D2A26]">{func.nome}</td>
                            <td className="px-4 py-3 text-[#433E37]">{func.funcao}</td>
                            <td className="px-4 py-3 text-[#433E37]">{formatCurrency(func.valorDiaria)}</td>
                            <td className="px-4 py-3 text-[#433E37]">{formatCurrency(func.valorHoraExtra || 0)}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${func.status === 'Ativo' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                                {func.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[#8B7D6B] max-w-[150px] truncate">{func.observacao || '-'}</td>
                            <td className="px-4 py-3 text-right space-x-1">
                              <button onClick={() => {setEditingFuncionarioId(func.id!); setFuncionarioFormData(func);}} className="p-1.5 text-[#8B7D6B] hover:text-[#C19A6B] hover:bg-[#F9F7F2] rounded transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteFuncionario(func.id!)} className="p-1.5 text-[#8B7D6B] hover:text-red-500 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                    
                    {/* Add new row inline */}
                    {editingFuncionarioId === 'new' && (
                      <tr className="bg-[#fdfcf9]">
                        <td className="px-4 py-2"><input type="text" placeholder="Nome" className="w-full border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.nome || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, nome: e.target.value})} /></td>
                        <td className="px-4 py-2"><input type="text" placeholder="Função" className="w-full border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.funcao || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, funcao: e.target.value})} /></td>
                        <td className="px-4 py-2"><input type="number" step="0.01" placeholder="0.00" className="w-24 border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.valorDiaria || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, valorDiaria: Number(e.target.value)})} /></td>
                        <td className="px-4 py-2"><input type="number" step="0.01" placeholder="0.00" className="w-24 border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.valorHoraExtra || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, valorHoraExtra: Number(e.target.value)})} /></td>
                        <td className="px-4 py-2">
                          <select className="border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.status || 'Ativo'} onChange={e => setFuncionarioFormData({...funcionarioFormData, status: e.target.value as any})}>
                            <option value="Ativo">Ativo</option>
                            <option value="Inativo">Inativo</option>
                          </select>
                        </td>
                        <td className="px-4 py-2"><input type="text" placeholder="Obs..." className="w-full border border-[#EAE6DF] rounded px-2 py-1 text-sm focus:border-[#C19A6B] focus:outline-none" value={funcionarioFormData.observacao || ''} onChange={e => setFuncionarioFormData({...funcionarioFormData, observacao: e.target.value})} /></td>
                        <td className="px-4 py-2 text-right space-x-2">
                          <button onClick={handleSaveFuncionario} className="p-1 text-green-600 hover:bg-green-50 rounded"><Save className="w-4 h-4" /></button>
                          <button onClick={() => {setEditingFuncionarioId(null); setFuncionarioFormData({status: 'Ativo'})}} className="p-1 text-red-600 hover:bg-red-50 rounded"><X className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {editingFuncionarioId !== 'new' && (
                <div className="p-3 border-t border-[#EAE6DF] bg-white">
                  <button 
                    onClick={() => { setEditingFuncionarioId('new'); setFuncionarioFormData({ status: 'Ativo' }); }}
                    className="flex items-center gap-2 text-sm font-medium text-[#C19A6B] hover:text-[#9e7d56] transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Adicionar Funcionário
                  </button>
                </div>
              )}
            </div>

            {/* ATTENDANCE SECTION */}
            <div className="bg-white rounded-xl shadow-sm border border-[#EAE6DF] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#EAE6DF] flex flex-wrap gap-4 justify-between items-center bg-[#fdfcf9]">
                <h2 className="text-sm font-extrabold text-[#2D2A26] uppercase tracking-wider flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#C19A6B]" /> Frequência
                </h2>
                
                <div className="flex items-center gap-4">
                  <div className="flex gap-2 items-center">
                    <select 
                      value={selectedMonth} 
                      onChange={(e) => setSelectedMonth(Number(e.target.value))}
                      className="border border-[#EAE6DF] rounded-md px-3 py-1.5 text-sm font-medium text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    >
                      {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map((m, i) => (
                        <option key={i} value={i + 1}>{m}</option>
                      ))}
                    </select>
                    <input 
                      type="number" 
                      value={selectedYearLocal}
                      onChange={(e) => setSelectedYearLocal(Number(e.target.value))}
                      className="border border-[#EAE6DF] rounded-md px-3 py-1.5 text-sm font-medium text-[#2D2A26] focus:outline-none focus:border-[#C19A6B] w-24"
                    />
                  </div>
                  
                  <button 
                    onClick={handleMarkAllPresent}
                    className="flex items-center gap-1.5 text-xs font-medium bg-[#F9F7F2] text-[#433E37] px-3 py-1.5 rounded border border-[#EAE6DF] hover:border-[#C19A6B] transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> Marcar Todos Presentes
                  </button>
                  
                  <button 
                    onClick={handleSavePonto}
                    disabled={Object.keys(pendingPontoChanges).length === 0}
                    className={`flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded transition-colors ${
                      Object.keys(pendingPontoChanges).length > 0 
                        ? 'bg-[#2D2A26] text-white hover:bg-[#3F3B35]' 
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" /> Salvar Ponto {Object.keys(pendingPontoChanges).length > 0 && `(${Object.keys(pendingPontoChanges).length})`}
                  </button>
                </div>
              </div>
              
              <div className="p-4 bg-white overflow-x-auto">
                <div className="flex gap-4 text-[10px] uppercase font-bold text-[#8B7D6B] mb-4 items-center">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500"></span> Presente (P)</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400"></span> Meia Diária (½)</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> Falta (F)</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-300"></span> Folga (FG)</span>
                  <span className="ml-auto text-gray-400 font-normal normal-case italic">*Clique para alternar. Botão direito p/ add Hora Extra.</span>
                </div>

                <div className="inline-block min-w-full">
                  <table className="border-collapse select-none w-full">
                    <thead>
                      <tr>
                        <th className="sticky left-0 bg-white z-10 border border-[#EAE6DF] p-2 text-xs font-bold text-[#433E37] text-left w-48 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Funcionário</th>
                        {daysArray.map(day => {
                          const dow = getDayOfWeek(day);
                          const isWeekend = dow === 0 || dow === 6;
                          return (
                            <th key={day} className={`border border-[#EAE6DF] p-1 min-w-[36px] w-[36px] text-center ${dow === 0 ? 'bg-red-50' : dow === 6 ? 'bg-gray-50' : 'bg-[#F9F7F2]'}`}>
                              <div className={`text-[9px] font-bold uppercase ${dow === 0 ? 'text-red-500' : 'text-[#8B7D6B]'}`}>{getDayName(day)}</div>
                              <div className={`text-sm font-bold ${dow === 0 ? 'text-red-700' : 'text-[#2D2A26]'}`}>{day}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {funcionarios.filter(f => f.status === 'Ativo').map(func => (
                        <tr key={func.id} className="hover:bg-[#fdfcf9]">
                          <td className="sticky left-0 bg-white z-10 border border-[#EAE6DF] p-2 text-xs font-medium text-[#433E37] truncate shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" title={func.nome}>
                            {func.nome}
                          </td>
                          {daysArray.map(day => {
                            const key = getPontoKey(func.id!, day);
                            const record = pendingPontoChanges[key] || registrosPonto[key];
                            const isPending = !!pendingPontoChanges[key];
                            const dow = getDayOfWeek(day);
                            const cellBgClass = getCellColor(record?.status);
                            
                            return (
                              <td key={day} className={`border border-[#EAE6DF] p-0.5 text-center ${dow === 0 ? 'bg-red-50/30' : dow === 6 ? 'bg-gray-50/30' : ''}`}>
                                <button
                                  onClick={() => handlePontoClick(func.id!, day)}
                                  onContextMenu={(e) => handleContextMenu(e, func.id!, day)}
                                  className={`w-full h-8 flex items-center justify-center rounded text-xs font-bold transition-all relative border ${cellBgClass} ${isPending ? 'ring-2 ring-[#C19A6B] ring-offset-1' : ''}`}
                                >
                                  {getCellLabel(record?.status)}
                                  {record?.horasExtras ? (
                                    <span className="absolute -top-1.5 -right-1.5 bg-purple-600 text-white text-[8px] px-1 py-0.5 rounded-full shadow-sm leading-none font-bold">
                                      +{record.horasExtras}
                                    </span>
                                  ) : null}
                                </button>
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

            {/* SUMMARY & EXPORT */}
            <div className="flex flex-col xl:flex-row gap-6">
              <div className="flex-1 bg-white rounded-xl shadow-sm border border-[#EAE6DF] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#EAE6DF] flex justify-between items-center bg-[#fdfcf9]">
                  <h2 className="text-sm font-extrabold text-[#2D2A26] uppercase tracking-wider flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#C19A6B]" /> Resumo do Mês
                  </h2>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {resumos.map(r => (
                    <div key={r.funcionario.id} className="border border-[#EAE6DF] rounded-lg p-3 bg-[#F9F7F2]">
                      <div className="font-bold text-[#2D2A26] text-sm mb-1">{r.funcionario.nome}</div>
                      <div className="text-[10px] text-[#8B7D6B] uppercase tracking-wider mb-3 pb-2 border-b border-[#EAE6DF]">{r.funcionario.funcao}</div>
                      
                      <div className="grid grid-cols-2 gap-y-2 text-xs mb-3">
                        <div className="flex justify-between pr-2"><span className="text-[#8B7D6B]">Presenças:</span> <span className="font-medium text-green-700">{r.diasPresente}</span></div>
                        <div className="flex justify-between pl-2"><span className="text-[#8B7D6B]">Meias:</span> <span className="font-medium text-amber-600">{r.diasMeia}</span></div>
                        <div className="flex justify-between pr-2"><span className="text-[#8B7D6B]">Faltas:</span> <span className="font-medium text-red-600">{r.diasFalta}</span></div>
                        <div className="flex justify-between pl-2"><span className="text-[#8B7D6B]">Folgas:</span> <span className="font-medium text-blue-600">{r.diasFolga}</span></div>
                        <div className="flex justify-between pr-2 col-span-2"><span className="text-[#8B7D6B]">Horas Extras:</span> <span className="font-medium text-purple-600">{r.totalHorasExtras}h</span></div>
                      </div>
                      
                      <div className="pt-2 border-t border-[#EAE6DF] flex justify-between items-center">
                        <span className="text-xs font-bold text-[#433E37]">Total a Pagar:</span>
                        <span className="text-sm font-extrabold text-[#C19A6B]">{formatCurrency(r.salarioTotal)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="xl:w-80 flex flex-col gap-4">
                <div className="bg-[#2D2A26] rounded-xl shadow-sm p-6 text-white border-t-4 border-[#C19A6B]">
                  <h3 className="text-xs uppercase tracking-wider text-[#8B7D6B] mb-2 font-bold">Custo Total (Mês)</h3>
                  <div className="text-3xl font-extrabold text-[#C19A6B] mb-4">
                    {formatCurrency(totalObra)}
                  </div>
                  <button 
                    onClick={handleExportPdf}
                    className="w-full py-3 bg-[#C19A6B] hover:bg-[#b08b5e] text-white rounded-lg font-bold flex justify-center items-center gap-2 transition-colors shadow-md"
                  >
                    <Download className="w-5 h-5" /> Exportar PDF da Obra
                  </button>
                  <p className="text-[10px] text-center text-[#8B7D6B] mt-3">
                    O PDF incluirá a folha de ponto e resumo financeiro.
                  </p>
                </div>
              </div>
            </div>
            
          </div>
        )}
      </div>

      {/* OBRA MODAL */}
      {isObraModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-[#EAE6DF]">
            <div className="bg-[#2D2A26] px-5 py-4 border-b-4 border-[#C19A6B] flex justify-between items-center">
              <h2 className="text-lg font-bold text-white uppercase tracking-wide">
                {obraFormData.id ? 'Editar Obra' : 'Nova Obra'}
              </h2>
              <button onClick={() => setIsObraModalOpen(false)} className="text-[#8B7D6B] hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-sm text-[#433E37]">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#8B7D6B] mb-1">Nome da Obra *</label>
                <input 
                  type="text" 
                  value={obraFormData.nome || ''} 
                  onChange={e => setObraFormData({...obraFormData, nome: e.target.value})}
                  className="w-full border border-[#EAE6DF] rounded-md px-3 py-2 focus:border-[#C19A6B] focus:outline-none" 
                  placeholder="Ex: Condomínio Villa Lobos"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#8B7D6B] mb-1">Endereço</label>
                <input 
                  type="text" 
                  value={obraFormData.endereco || ''} 
                  onChange={e => setObraFormData({...obraFormData, endereco: e.target.value})}
                  className="w-full border border-[#EAE6DF] rounded-md px-3 py-2 focus:border-[#C19A6B] focus:outline-none" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#8B7D6B] mb-1">Responsável</label>
                <input 
                  type="text" 
                  value={obraFormData.responsavel || ''} 
                  onChange={e => setObraFormData({...obraFormData, responsavel: e.target.value})}
                  className="w-full border border-[#EAE6DF] rounded-md px-3 py-2 focus:border-[#C19A6B] focus:outline-none" 
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#8B7D6B] mb-1">Data Início *</label>
                  <input 
                    type="date" 
                    value={obraFormData.dataInicio || ''} 
                    onChange={e => setObraFormData({...obraFormData, dataInicio: e.target.value})}
                    className="w-full border border-[#EAE6DF] rounded-md px-3 py-2 focus:border-[#C19A6B] focus:outline-none text-[#433E37]" 
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#8B7D6B] mb-1">Data Fim (Opcional)</label>
                  <input 
                    type="date" 
                    value={obraFormData.dataFim || ''} 
                    onChange={e => setObraFormData({...obraFormData, dataFim: e.target.value})}
                    className="w-full border border-[#EAE6DF] rounded-md px-3 py-2 focus:border-[#C19A6B] focus:outline-none text-[#433E37]" 
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#8B7D6B] mb-1">Status</label>
                <select 
                  value={obraFormData.status || 'Em andamento'} 
                  onChange={e => setObraFormData({...obraFormData, status: e.target.value as any})}
                  className="w-full border border-[#EAE6DF] rounded-md px-3 py-2 focus:border-[#C19A6B] focus:outline-none"
                >
                  <option value="Em andamento">Em andamento</option>
                  <option value="Concluída">Concluída</option>
                  <option value="Paralisada">Paralisada</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#8B7D6B] mb-1">Observações</label>
                <textarea 
                  value={obraFormData.observacao || ''} 
                  onChange={e => setObraFormData({...obraFormData, observacao: e.target.value})}
                  className="w-full border border-[#EAE6DF] rounded-md px-3 py-2 focus:border-[#C19A6B] focus:outline-none h-20 resize-none" 
                />
              </div>
            </div>
            <div className="bg-[#fdfcf9] px-5 py-4 border-t border-[#EAE6DF] flex justify-end gap-3">
              <button 
                onClick={() => setIsObraModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-[#8B7D6B] hover:text-[#2D2A26] transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveObra}
                className="px-5 py-2 text-sm font-bold bg-[#C19A6B] hover:bg-[#b08b5e] text-white rounded-md shadow-sm transition-colors"
              >
                Salvar Obra
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXTRA HOURS POPOVER */}
      {extraHoursPopover && (
        <div 
          className="fixed inset-0 z-50"
          onClick={() => setExtraHoursPopover(null)}
          onContextMenu={(e) => { e.preventDefault(); setExtraHoursPopover(null); }}
        >
          <div 
            className="absolute bg-white rounded-lg shadow-xl border border-[#EAE6DF] p-3 w-48 z-50"
            style={{ top: extraHoursPopover.y + 10, left: extraHoursPopover.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-bold uppercase text-[#8B7D6B] mb-2 tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Lançar Horas Extras
            </div>
            <div className="flex gap-2 items-center">
              <input 
                type="number" 
                min="0"
                step="0.5"
                value={extraHoursPopover.value}
                onChange={(e) => setExtraHoursPopover({...extraHoursPopover, value: Number(e.target.value)})}
                className="w-full border border-[#EAE6DF] rounded px-2 py-1.5 text-sm focus:border-purple-500 focus:outline-none text-center font-bold text-purple-700"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveExtraHours(extraHoursPopover.value);
                }}
              />
              <button 
                onClick={() => handleSaveExtraHours(extraHoursPopover.value)}
                className="bg-purple-600 hover:bg-purple-700 text-white p-1.5 rounded"
              >
                <CheckCircle2 className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[10px] text-gray-400 mt-2 italic text-center">
              Pressione Enter para salvar
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
