/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TaskManagerView — Gerenciador de Tarefas e Rotinas Diárias com Fluxo de Confirmação (Teams / Planner style).
 * Inclui Central Técnica de Ingestão de Dados (Planilhas & Especificações DBA), Botões de Incluir/Cancelar Tarefas
 * e Espaço no Banco de Dados para Comprovantes, Francesas Bancárias e Extratos do Dia.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Ban,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  Database,
  Download,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import { TECHNICAL_SPREADSHEETS } from '../data/technicalSpreadsheets';
import {
  deleteAttachment,
  deleteTask,
  getAttachmentsForDate,
  getOrInitializeDailyTasks,
  saveAttachment,
  saveSingleTask,
  saveTasksList,
} from '../services/tasksService';
import {
  AttachmentType,
  BankName,
  FinancialAttachment,
  RoutineTask,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  TechnicalSpreadsheetSpec,
  ViewTab,
} from '../types';
import { TechnicalImportModal } from './TechnicalImportModal';

interface TaskManagerViewProps {
  onNavigateToModule: (targetTab: ViewTab) => void;
  onNavigateToImport: (targetModule: 'economic' | 'financial' | 'customers' | 'delinquency' | 'sales') => void;
  userRole?: string;
  userName?: string;
}

export const TaskManagerView: React.FC<TaskManagerViewProps> = ({
  onNavigateToModule,
  onNavigateToImport,
  userRole = 'gestor',
  userName = 'Operador Financeiro',
}) => {
  // Data selecionada (YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  const [tasks, setTasks] = useState<RoutineTask[]>([]);
  const [attachments, setAttachments] = useState<FinancialAttachment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'board' | 'list' | 'catalog' | 'attachments'>('board');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modais
  const [activeSpecModal, setActiveSpecModal] = useState<TechnicalSpreadsheetSpec | null>(null);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState<boolean>(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState<boolean>(false);
  const [taskToCancel, setTaskToCancel] = useState<RoutineTask | null>(null);

  // Form de Nova Tarefa
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskCategory, setNewTaskCategory] = useState<TaskCategory>('geral');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('media');
  const [newTaskSpecId, setNewTaskSpecId] = useState<string>('');
  const [newTaskChecklistText, setNewTaskChecklistText] = useState('');

  // Form de Anexo de Comprovante/Francesa
  const [newAttachType, setNewAttachType] = useState<AttachmentType>('francesa');
  const [newAttachBank, setNewAttachBank] = useState<BankName>('Bradesco');
  const [newAttachNotes, setNewAttachNotes] = useState('');
  const [isUploadingAttach, setIsUploadingAttach] = useState(false);

  // Carrega tarefas e anexos quando a data selecionada muda
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    Promise.all([
      getOrInitializeDailyTasks(selectedDate),
      getAttachmentsForDate(selectedDate),
    ]).then(([loadedTasks, loadedAttachs]) => {
      if (isMounted) {
        setTasks(loadedTasks);
        setAttachments(loadedAttachs);
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [selectedDate]);

  // Recarregar rotinas padrão do dia
  const handleResetDailyRoutines = async () => {
    if (window.confirm('Deseja reiniciar as rotinas padrão do dia de hoje?')) {
      setIsLoading(true);
      const routines = (await import('../services/tasksService')).getDefaultSystemRoutines(selectedDate);
      setTasks(routines);
      await saveTasksList(selectedDate, routines);
      setIsLoading(false);
    }
  };

  // Atualiza status de uma tarefa
  const handleUpdateStatus = async (task: RoutineTask, newStatus: TaskStatus) => {
    const updated: RoutineTask = {
      ...task,
      status: newStatus,
      completedAt: newStatus === 'concluido' ? new Date().toISOString() : undefined,
      completedBy: newStatus === 'concluido' ? userName : undefined,
    };
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    await saveSingleTask(updated);
  };

  // Alterna item do checklist de uma tarefa
  const handleToggleChecklist = async (task: RoutineTask, checklistId: string) => {
    if (!task.checklists) return;
    const updatedChecklist = task.checklists.map((chk) =>
      chk.id === checklistId ? { ...chk, done: !chk.done } : chk
    );
    const allDone = updatedChecklist.every((c) => c.done);
    const updatedTask: RoutineTask = {
      ...task,
      checklists: updatedChecklist,
      status: allDone ? 'concluido' : task.status === 'concluido' ? 'em_andamento' : task.status,
    };

    setTasks((prev) => prev.map((t) => (t.id === task.id ? updatedTask : t)));
    await saveSingleTask(updatedTask);
  };

  // Criação de Nova Tarefa (Solicitada pelo usuário)
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const checklists = newTaskChecklistText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, idx) => ({ id: `chk_cust_${Date.now()}_${idx}`, text: line, done: false }));

    const spec = TECHNICAL_SPREADSHEETS.find((s) => s.id === newTaskSpecId);

    const newTask: RoutineTask = {
      id: `task_cust_${Date.now()}`,
      dateISO: selectedDate,
      title: newTaskTitle.trim(),
      description: newTaskDesc.trim(),
      category: newTaskCategory,
      priority: newTaskPriority,
      status: 'pendente',
      spreadsheetSpecId: newTaskSpecId || undefined,
      targetViewTab: spec?.targetModule || undefined,
      checklists: checklists.length > 0 ? checklists : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assignedTo: userName,
    };

    const updatedList = [...tasks, newTask];
    setTasks(updatedList);
    await saveSingleTask(newTask);

    setNewTaskTitle('');
    setNewTaskDesc('');
    setNewTaskCategory('geral');
    setNewTaskPriority('media');
    setNewTaskSpecId('');
    setNewTaskChecklistText('');
    setIsNewTaskModalOpen(false);
  };

  // Cancela / Apaga tarefa (Solicitada pelo usuário)
  const handleConfirmCancelTask = async (permanent: boolean) => {
    if (!taskToCancel) return;
    if (permanent) {
      setTasks((prev) => prev.filter((t) => t.id !== taskToCancel.id));
      await deleteTask(taskToCancel.id, selectedDate);
    } else {
      const updated: RoutineTask = {
        ...taskToCancel,
        status: 'cancelado',
        updatedAt: new Date().toISOString(),
      };
      setTasks((prev) => prev.map((t) => (t.id === taskToCancel.id ? updated : t)));
      await saveSingleTask(updated);
    }
    setTaskToCancel(null);
    setIsCancelModalOpen(false);
  };

  // Upload de Comprovante / Francesa / Extrato do dia no Banco de Dados
  const handleFileUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploadingAttach(true);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();

      await new Promise<void>((resolve) => {
        reader.onload = async (event) => {
          const fileData = event.target?.result as string;
          const newAttach: FinancialAttachment = {
            id: `att_${Date.now()}_${i}`,
            dateISO: selectedDate,
            type: newAttachType,
            bank: newAttachBank,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type || 'application/octet-stream',
            fileData,
            uploadedAt: new Date().toISOString(),
            uploadedBy: userName,
            notes: newAttachNotes.trim() || undefined,
          };

          setAttachments((prev) => [...prev, newAttach]);
          await saveAttachment(newAttach);
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }

    setNewAttachNotes('');
    setIsUploadingAttach(false);
    e.target.value = '';
  };

  // Exclui anexo do banco de dados
  const handleDeleteAttachmentItem = async (attachId: string) => {
    if (window.confirm('Deseja excluir este comprovante/francesa do banco de dados?')) {
      setAttachments((prev) => prev.filter((a) => a.id !== attachId));
      await deleteAttachment(attachId, selectedDate);
    }
  };

  // Filtro de tarefas
  const filteredTasks = tasks.filter((t) => {
    if (selectedCategory !== 'all' && t.category !== selectedCategory) return false;
    if (
      searchQuery &&
      !t.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !t.description.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  // KPIs
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'concluido').length;
  const pendingHigh = tasks.filter((t) => t.priority === 'alta' && t.status !== 'concluido' && t.status !== 'cancelado').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Renderiza Badge de Prioridade
  const renderPriorityBadge = (priority: TaskPriority) => {
    if (priority === 'alta') {
      return <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase bg-red-500/20 text-red-300 border border-red-500/40 rounded">Alta</span>;
    }
    if (priority === 'media') {
      return <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded">Média</span>;
    }
    return <span className="px-2 py-0.5 text-[9px] font-semibold uppercase bg-gray-500/20 text-gray-300 border border-gray-500/30 rounded">Baixa</span>;
  };

  // Renderiza Badge de Status
  const renderStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'concluido':
        return <span className="px-2 py-0.5 text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Concluído</span>;
      case 'em_andamento':
        return <span className="px-2 py-0.5 text-[9px] font-bold uppercase bg-sky-500/20 text-sky-300 border border-sky-500/40 rounded flex items-center gap-1"><Clock className="w-3 h-3" /> Em Andamento</span>;
      case 'aguardando_importacao':
        return <span className="px-2 py-0.5 text-[9px] font-bold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded flex items-center gap-1"><Upload className="w-3 h-3" /> Aguardando Carga</span>;
      case 'cancelado':
        return <span className="px-2 py-0.5 text-[9px] font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/40 rounded flex items-center gap-1"><Ban className="w-3 h-3" /> Cancelado</span>;
      default:
        return <span className="px-2 py-0.5 text-[9px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Pendente</span>;
    }
  };

  return (
    <div className="space-y-6 pb-12 text-[#EAE6DF]">
      {/* ── Top Control Bar & Header ────────────────────────────────────────── */}
      <div className="bg-[#2D2A26] border border-[#3F3B35] rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#C19A6B]/20 text-[#C19A6B] rounded-lg">
                <CheckSquare className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-wide">Gerenciador de Tarefas & Rotinas Diárias</h1>
                <p className="text-xs text-[#EAE6DF]/70">
                  Fluxos operacionais a serem confirmados (Teams / Planner style), Central Técnica e Guarda de Comprovantes/Francesas
                </p>
              </div>
            </div>
          </div>

          {/* Botões de Ação do Topo */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Seletor de Data */}
            <div className="flex items-center gap-2 bg-[#23201D] border border-[#3F3B35] px-3 py-1.5 rounded-lg text-xs font-semibold">
              <Calendar className="w-4 h-4 text-[#C19A6B]" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-white border-none focus:outline-none cursor-pointer text-xs"
              />
            </div>

            {/* Reiniciar Rotinas do Dia */}
            <button
              onClick={handleResetDailyRoutines}
              title="Reiniciar rotinas padrão para a data selecionada"
              className="px-3 py-1.5 bg-[#3F3B35] hover:bg-[#4F4B45] text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Gerar Rotinas Padrão</span>
            </button>

            {/* Botão de Incluir Nova Tarefa */}
            <button
              onClick={() => setIsNewTaskModalOpen(true)}
              className="px-4 py-1.5 bg-[#C19A6B] hover:bg-[#b0895a] text-white rounded-lg text-xs font-bold transition-colors shadow-lg flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Incluir Nova Tarefa</span>
            </button>
          </div>
        </div>

        {/* ── KPIs Cards Summary ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-[#3F3B35]/60">
          <div className="bg-[#23201D] p-3 rounded-lg border border-[#3F3B35] flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[#EAE6DF]/60 uppercase tracking-wider">Total de Rotinas</p>
              <p className="text-xl font-bold text-white mt-0.5">{totalTasks}</p>
            </div>
            <div className="p-2 bg-[#3F3B35] text-[#C19A6B] rounded-lg">
              <CheckSquare className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#23201D] p-3 rounded-lg border border-[#3F3B35] flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[#EAE6DF]/60 uppercase tracking-wider">Taxa de Conclusão</p>
              <p className="text-xl font-bold text-emerald-400 mt-0.5">{completionRate}%</p>
            </div>
            <div className="w-12 h-12 flex items-center justify-center relative">
              <svg className="w-10 h-10 transform -rotate-90">
                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" className="text-[#3F3B35]" fill="transparent" />
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-emerald-400 transition-all duration-500"
                  fill="transparent"
                  strokeDasharray="100"
                  strokeDashoffset={100 - completionRate}
                />
              </svg>
            </div>
          </div>

          <div className="bg-[#23201D] p-3 rounded-lg border border-[#3F3B35] flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[#EAE6DF]/60 uppercase tracking-wider">Comprovantes & Francesas</p>
              <p className="text-xl font-bold text-sky-400 mt-0.5">{attachments.length} Anexados</p>
            </div>
            <div className="p-2 bg-sky-500/20 text-sky-300 rounded-lg">
              <Paperclip className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-[#23201D] p-3 rounded-lg border border-[#3F3B35] flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-[#EAE6DF]/60 uppercase tracking-wider">Planilhas Técnicas</p>
              <p className="text-xl font-bold text-amber-300 mt-0.5">{TECHNICAL_SPREADSHEETS.length} Fontes</p>
            </div>
            <div className="p-2 bg-amber-500/20 text-amber-300 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Subheader Navigation Tabs & Filters ────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#2D2A26] p-2 rounded-xl border border-[#3F3B35]">
        {/* Modos de Visão */}
        <div className="flex flex-wrap items-center gap-1 bg-[#23201D] p-1 rounded-lg border border-[#3F3B35]">
          <button
            onClick={() => setViewMode('board')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5 ${
              viewMode === 'board' ? 'bg-[#C19A6B] text-white shadow' : 'text-[#EAE6DF]/70 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Quadro (Planner)</span>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5 ${
              viewMode === 'list' ? 'bg-[#C19A6B] text-white shadow' : 'text-[#EAE6DF]/70 hover:text-white'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>Lista de Rotinas</span>
          </button>
          <button
            onClick={() => setViewMode('attachments')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5 ${
              viewMode === 'attachments' ? 'bg-[#C19A6B] text-white shadow' : 'text-[#EAE6DF]/70 hover:text-white'
            }`}
          >
            <Paperclip className="w-3.5 h-3.5" />
            <span>Comprovantes & Francesas</span>
            {attachments.length > 0 && (
              <span className="px-1.5 py-0.2 text-[9px] bg-white/20 rounded-full font-bold">{attachments.length}</span>
            )}
          </button>
          <button
            onClick={() => setViewMode('catalog')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5 ${
              viewMode === 'catalog' ? 'bg-[#C19A6B] text-white shadow' : 'text-[#EAE6DF]/70 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Catálogo Técnico de Ingestão</span>
          </button>
        </div>

        {/* Filtros e Busca */}
        <div className="flex items-center gap-2">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-[#23201D] border border-[#3F3B35] text-[#EAE6DF] px-3 py-1.5 rounded-lg text-xs font-semibold focus:outline-none focus:border-[#C19A6B]"
          >
            <option value="all">Todas as Categorias</option>
            <option value="extratos_tesouraria">Tesouraria & Extratos</option>
            <option value="pagamentos_dia">Pagamentos do Dia</option>
            <option value="compras_pendentes">Compras & Recebíveis</option>
            <option value="vendas_estoque">Vendas & Estoque</option>
            <option value="fechamento_caixa">Fechamento de Caixa</option>
            <option value="geral">Geral</option>
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#EAE6DF]/50 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar tarefa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#23201D] border border-[#3F3B35] text-white text-xs pl-8 pr-3 py-1.5 rounded-lg focus:outline-none focus:border-[#C19A6B] w-36 sm:w-48"
            />
          </div>
        </div>
      </div>

      {/* ── CONTENT AREA ────────────────────────────────────────────────────── */}

      {isLoading ? (
        <div className="bg-[#2D2A26] border border-[#3F3B35] rounded-xl p-12 text-center">
          <RefreshCw className="w-8 h-8 text-[#C19A6B] animate-spin mx-auto mb-3" />
          <p className="text-sm font-semibold text-[#EAE6DF]/70">Carregando gerenciador de tarefas...</p>
        </div>
      ) : (
        <>
          {/* 1. VISÃO DE QUADRO (PLANNER / KANBAN) */}
          {viewMode === 'board' && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Coluna 1: A Fazer / Pendente */}
              <div className="bg-[#23201D] border border-[#3F3B35] rounded-xl p-4 flex flex-col min-h-[500px]">
                <div className="flex items-center justify-between pb-3 border-b border-[#3F3B35] mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">A Fazer / Pendentes</h3>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-[#3F3B35] text-white rounded-full">
                    {filteredTasks.filter((t) => t.status === 'pendente').length}
                  </span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto">
                  {filteredTasks
                    .filter((t) => t.status === 'pendente')
                    .map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onUpdateStatus={handleUpdateStatus}
                        onToggleChecklist={handleToggleChecklist}
                        onOpenSpec={(spec) => setActiveSpecModal(spec)}
                        onNavigateToModule={onNavigateToModule}
                        onCancelTask={(task) => {
                          setTaskToCancel(task);
                          setIsCancelModalOpen(true);
                        }}
                      />
                    ))}
                </div>
              </div>

              {/* Coluna 2: Em Andamento */}
              <div className="bg-[#23201D] border border-[#3F3B35] rounded-xl p-4 flex flex-col min-h-[500px]">
                <div className="flex items-center justify-between pb-3 border-b border-[#3F3B35] mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">Em Andamento</h3>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-[#3F3B35] text-white rounded-full">
                    {filteredTasks.filter((t) => t.status === 'em_andamento').length}
                  </span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto">
                  {filteredTasks
                    .filter((t) => t.status === 'em_andamento')
                    .map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onUpdateStatus={handleUpdateStatus}
                        onToggleChecklist={handleToggleChecklist}
                        onOpenSpec={(spec) => setActiveSpecModal(spec)}
                        onNavigateToModule={onNavigateToModule}
                        onCancelTask={(task) => {
                          setTaskToCancel(task);
                          setIsCancelModalOpen(true);
                        }}
                      />
                    ))}
                </div>
              </div>

              {/* Coluna 3: Aguardando Importação */}
              <div className="bg-[#23201D] border border-[#3F3B35] rounded-xl p-4 flex flex-col min-h-[500px]">
                <div className="flex items-center justify-between pb-3 border-b border-[#3F3B35] mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">Aguardando Carga</h3>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-[#3F3B35] text-white rounded-full">
                    {filteredTasks.filter((t) => t.status === 'aguardando_importacao').length}
                  </span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto">
                  {filteredTasks
                    .filter((t) => t.status === 'aguardando_importacao')
                    .map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onUpdateStatus={handleUpdateStatus}
                        onToggleChecklist={handleToggleChecklist}
                        onOpenSpec={(spec) => setActiveSpecModal(spec)}
                        onNavigateToModule={onNavigateToModule}
                        onCancelTask={(task) => {
                          setTaskToCancel(task);
                          setIsCancelModalOpen(true);
                        }}
                      />
                    ))}
                </div>
              </div>

              {/* Coluna 4: Concluído & Confirmado */}
              <div className="bg-[#23201D] border border-[#3F3B35] rounded-xl p-4 flex flex-col min-h-[500px]">
                <div className="flex items-center justify-between pb-3 border-b border-[#3F3B35] mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">Concluído & Confirmado</h3>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-[#3F3B35] text-white rounded-full">
                    {filteredTasks.filter((t) => t.status === 'concluido').length}
                  </span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto">
                  {filteredTasks
                    .filter((t) => t.status === 'concluido')
                    .map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onUpdateStatus={handleUpdateStatus}
                        onToggleChecklist={handleToggleChecklist}
                        onOpenSpec={(spec) => setActiveSpecModal(spec)}
                        onNavigateToModule={onNavigateToModule}
                        onCancelTask={(task) => {
                          setTaskToCancel(task);
                          setIsCancelModalOpen(true);
                        }}
                      />
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* 2. VISÃO DE LISTA DE ROTINAS DIÁRIAS */}
          {viewMode === 'list' && (
            <div className="bg-[#2D2A26] border border-[#3F3B35] rounded-xl overflow-hidden shadow-lg">
              <div className="px-6 py-4 border-b border-[#3F3B35] bg-[#23201D] flex items-center justify-between">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Lista de Confirmação de Rotinas</h3>
                <span className="text-xs text-[#EAE6DF]/60">{filteredTasks.length} tarefas cadastradas</span>
              </div>
              <div className="divide-y divide-[#3F3B35]">
                {filteredTasks.map((task) => {
                  const spec = TECHNICAL_SPREADSHEETS.find((s) => s.id === task.spreadsheetSpecId);
                  return (
                    <div key={task.id} className="p-4 hover:bg-[#35312D] transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <button
                          onClick={() => handleUpdateStatus(task, task.status === 'concluido' ? 'pendente' : 'concluido')}
                          className={`mt-0.5 p-1 rounded-md border transition-colors ${
                            task.status === 'concluido'
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                              : 'border-[#3F3B35] text-transparent hover:text-[#C19A6B]'
                          }`}
                        >
                          <CheckCircle2 className="w-5 h-5" />
                        </button>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-sm font-bold ${task.status === 'concluido' ? 'line-through text-[#EAE6DF]/50' : 'text-white'}`}>
                              {task.title}
                            </span>
                            {renderPriorityBadge(task.priority)}
                            {renderStatusBadge(task.status)}
                            {spec && (
                              <button
                                onClick={() => setActiveSpecModal(spec)}
                                className="px-2 py-0.5 text-[9px] font-extrabold bg-[#C19A6B]/20 text-[#C19A6B] border border-[#C19A6B]/40 rounded hover:bg-[#C19A6B] hover:text-white transition-colors"
                              >
                                Planilha: {spec.code}
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-[#EAE6DF]/70">{task.description}</p>

                          {/* Checklist preview */}
                          {task.checklists && task.checklists.length > 0 && (
                            <div className="pt-2 flex flex-wrap gap-3">
                              {task.checklists.map((chk) => (
                                <label key={chk.id} className="flex items-center gap-1.5 text-[11px] text-[#EAE6DF]/80 cursor-pointer hover:text-white">
                                  <input
                                    type="checkbox"
                                    checked={chk.done}
                                    onChange={() => handleToggleChecklist(task, chk.id)}
                                    className="rounded border-[#3F3B35] bg-[#181614] text-[#C19A6B] focus:ring-0"
                                  />
                                  <span className={chk.done ? 'line-through opacity-60' : ''}>{chk.text}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Botões de Ação na Lista */}
                      <div className="flex items-center gap-2 shrink-0">
                        {task.targetViewTab && (
                          <button
                            onClick={() => onNavigateToModule(task.targetViewTab!)}
                            className="px-3 py-1.5 bg-[#3F3B35] hover:bg-[#4F4B45] text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                          >
                            <span>Ir ao Módulo</span>
                            <ArrowRight className="w-3.5 h-3.5 text-[#C19A6B]" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setTaskToCancel(task);
                            setIsCancelModalOpen(true);
                          }}
                          title="Cancelar ou Excluir Tarefa"
                          className="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg transition-colors border border-rose-500/30"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. VISÃO DE GUARDA DE COMPROVANTES, FRANCESAS E EXTRATOS DO DIA */}
          {viewMode === 'attachments' && (
            <div className="space-y-6">
              {/* Uploader Box */}
              <div className="bg-[#2D2A26] border border-[#3F3B35] rounded-xl p-5 shadow-lg space-y-4">
                <div className="flex items-center gap-3 border-b border-[#3F3B35] pb-3">
                  <div className="p-2 bg-sky-500/20 text-sky-400 rounded-lg">
                    <Paperclip className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      Guarda de Comprovantes, Francesas Bancárias e Extratos do Dia
                    </h3>
                    <p className="text-xs text-[#EAE6DF]/70">
                      Armazenamento persistente no Banco de Dados (`comprovantes_francesas`) vinculado à data de {selectedDate}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block font-bold text-[#EAE6DF] mb-1">Tipo de Documento</label>
                    <select
                      value={newAttachType}
                      onChange={(e) => setNewAttachType(e.target.value as AttachmentType)}
                      className="w-full bg-[#23201D] border border-[#3F3B35] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#C19A6B]"
                    >
                      <option value="francesa">Francesa Bancária (Borderô de Liquidação)</option>
                      <option value="comprovante">Comprovante de Pagamento / Transferência</option>
                      <option value="extrato">Extrato Bancário Diário (PDF / OFX)</option>
                      <option value="outro">Outro Documento de Caixa</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-[#EAE6DF] mb-1">Banco / Origem</label>
                    <select
                      value={newAttachBank}
                      onChange={(e) => setNewAttachBank(e.target.value as BankName)}
                      className="w-full bg-[#23201D] border border-[#3F3B35] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#C19A6B]"
                    >
                      <option value="Bradesco">Banco Bradesco</option>
                      <option value="PagBank">PagBank / PagSeguro</option>
                      <option value="Caixa">Caixa / Tesouraria Física</option>
                      <option value="Outro">Outra Instituição</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-[#EAE6DF] mb-1">Observações do Documento</label>
                    <input
                      type="text"
                      placeholder="Ex: Lote de 15 boletos pagos às 14h..."
                      value={newAttachNotes}
                      onChange={(e) => setNewAttachNotes(e.target.value)}
                      className="w-full bg-[#23201D] border border-[#3F3B35] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                </div>

                {/* Zona de Drop & Upload */}
                <div className="relative border-2 border-dashed border-[#3F3B35] hover:border-[#C19A6B] rounded-xl p-6 text-center transition-colors bg-[#23201D]">
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.ofx,.xlsx,.csv,.xml"
                    onChange={handleFileUploadAttachment}
                    disabled={isUploadingAttach}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <Upload className="w-8 h-8 text-[#C19A6B]" />
                    <p className="text-xs font-bold text-white">
                      {isUploadingAttach ? 'Salvando arquivos no Banco de Dados...' : 'Clique ou arraste arquivos de Comprovantes, Francesas ou Extratos aqui'}
                    </p>
                    <p className="text-[10px] text-[#EAE6DF]/60">Suporta arquivos PDF, PNG, JPG, OFX, XLSX, CSV</p>
                  </div>
                </div>
              </div>

              {/* Lista de Anexos Guardados no Banco */}
              <div className="bg-[#2D2A26] border border-[#3F3B35] rounded-xl p-5 shadow-lg space-y-4">
                <div className="flex items-center justify-between border-b border-[#3F3B35] pb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    Documentos Guardados na Data ({attachments.length})
                  </h4>
                  <span className="text-[10px] text-emerald-400 font-mono">Status: Sincronizado com Firestore</span>
                </div>

                {attachments.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#EAE6DF]/50">
                    Nenhum comprovante ou francesa bancária anexado para a data {selectedDate}.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {attachments.map((att) => (
                      <div key={att.id} className="bg-[#23201D] border border-[#3F3B35] p-3.5 rounded-lg flex items-center justify-between gap-3 hover:border-[#C19A6B] transition-colors">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="p-2 bg-sky-500/20 text-sky-300 rounded-lg shrink-0">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="overflow-hidden text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white truncate">{att.fileName}</span>
                              <span className="px-1.5 py-0.2 text-[9px] font-extrabold bg-[#C19A6B]/20 text-[#C19A6B] rounded uppercase">
                                {att.bank}
                              </span>
                            </div>
                            <p className="text-[10px] text-[#EAE6DF]/60 mt-0.5 capitalize">
                              Tipo: <strong>{att.type}</strong> • {(att.fileSize / 1024).toFixed(1)} KB • {new Date(att.uploadedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            {att.notes && <p className="text-[10px] text-amber-300/80 italic mt-0.5">{att.notes}</p>}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {att.fileData && (
                            <a
                              href={att.fileData}
                              download={att.fileName}
                              title="Baixar Documento"
                              className="p-1.5 bg-[#3F3B35] hover:bg-[#4F4B45] text-white rounded-lg transition-colors"
                            >
                              <Download className="w-3.5 h-3.5 text-[#C19A6B]" />
                            </a>
                          )}
                          <button
                            onClick={() => handleDeleteAttachmentItem(att.id)}
                            title="Excluir do Banco"
                            className="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg transition-colors border border-rose-500/30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. VISÃO DE CATÁLOGO TÉCNICO DE INGESTÃO DE DADOS */}
          {viewMode === 'catalog' && (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex items-start gap-3">
                <Database className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                    Catálogo de Engenharia de Dados & Estrutura de Tabelas (DBA Senior)
                  </h3>
                  <p className="text-xs text-[#EAE6DF]/80 mt-1 leading-relaxed">
                    Abaixo estão listadas todas as 8 fontes de planilhas oficiais que atualizam a base de dados do sistema.
                    Clique em qualquer cartão para ver a especificação das colunas, chaves primárias, coleção Firestore e acionar o upload direto.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {TECHNICAL_SPREADSHEETS.map((spec) => (
                  <div key={spec.id} className="bg-[#2D2A26] border border-[#3F3B35] rounded-xl p-5 hover:border-[#C19A6B] transition-colors space-y-4 shadow-lg flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="px-2.5 py-1 text-[10px] font-extrabold bg-[#C19A6B] text-white rounded uppercase tracking-wider">
                          {spec.code}
                        </span>
                        <code className="text-[10px] font-mono text-amber-300 bg-[#181614] px-2 py-0.5 rounded border border-amber-500/20">
                          {spec.targetCollection}
                        </code>
                      </div>

                      <h4 className="text-sm font-bold text-white">{spec.name}</h4>
                      <p className="text-xs text-[#EAE6DF]/70 leading-relaxed">{spec.description}</p>

                      <div className="bg-[#23201D] p-3 rounded-lg border border-[#3F3B35] space-y-1">
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">Função no Banco de Dados:</span>
                        <p className="text-[11px] text-[#EAE6DF]/80">{spec.dbImpact}</p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#3F3B35] flex items-center justify-between gap-2">
                      <button
                        onClick={() => onNavigateToModule(spec.targetModule)}
                        className="text-xs font-bold text-[#C19A6B] hover:underline flex items-center gap-1"
                      >
                        <span>Acessar Módulo</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setActiveSpecModal(spec)}
                        className="px-3 py-1.5 bg-[#C19A6B] hover:bg-[#b0895a] text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Especificação & Ingestão</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── MODAL: ESPECIFICAÇÃO E INGESTÃO TÉCNICA ────────────────────────────── */}
      <TechnicalImportModal
        spec={activeSpecModal}
        isOpen={!!activeSpecModal}
        onClose={() => setActiveSpecModal(null)}
        onNavigateToImport={onNavigateToImport}
        onNavigateToModule={onNavigateToModule}
      />

      {/* ── MODAL: INCLUIR NOVA TAREFA ────────────────────────────────────────── */}
      {isNewTaskModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#2D2A26] border border-[#3F3B35] text-[#EAE6DF] rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-[#3F3B35] flex items-center justify-between bg-[#23201D]">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-[#C19A6B]" />
                <h3 className="text-base font-bold text-white">Incluir Nova Tarefa / Rotina</h3>
              </div>
              <button
                onClick={() => setIsNewTaskModalOpen(false)}
                className="p-1 rounded-lg text-[#EAE6DF]/50 hover:text-white hover:bg-[#3F3B35]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#EAE6DF] mb-1">Título da Tarefa *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Baixar boletos do PagBank do dia..."
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full bg-[#23201D] border border-[#3F3B35] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#C19A6B]"
                />
              </div>

              <div>
                <label className="block font-bold text-[#EAE6DF] mb-1">Descrição detalhada</label>
                <textarea
                  rows={2}
                  placeholder="Orientações e detalhes técnicos da execução..."
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  className="w-full bg-[#23201D] border border-[#3F3B35] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#C19A6B]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#EAE6DF] mb-1">Categoria</label>
                  <select
                    value={newTaskCategory}
                    onChange={(e) => setNewTaskCategory(e.target.value as TaskCategory)}
                    className="w-full bg-[#23201D] border border-[#3F3B35] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#C19A6B]"
                  >
                    <option value="geral">Geral</option>
                    <option value="extratos_tesouraria">Tesouraria & Extratos</option>
                    <option value="pagamentos_dia">Pagamentos do Dia</option>
                    <option value="compras_pendentes">Compras & Recebíveis</option>
                    <option value="vendas_estoque">Vendas & Estoque</option>
                    <option value="fechamento_caixa">Fechamento de Caixa</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#EAE6DF] mb-1">Prioridade</label>
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
                    className="w-full bg-[#23201D] border border-[#3F3B35] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#C19A6B]"
                  >
                    <option value="alta">Alta</option>
                    <option value="media">Média</option>
                    <option value="baixa">Baixa</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#EAE6DF] mb-1">Vincular a Planilha Técnica (Opcional)</label>
                <select
                  value={newTaskSpecId}
                  onChange={(e) => setNewTaskSpecId(e.target.value)}
                  className="w-full bg-[#23201D] border border-[#3F3B35] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#C19A6B]"
                >
                  <option value="">Nenhuma planilha específica</option>
                  {TECHNICAL_SPREADSHEETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-[#EAE6DF] mb-1">Checklist de Passos (uma linha por item)</label>
                <textarea
                  rows={3}
                  placeholder="Passo 1: Baixar extrato no banco&#10;Passo 2: Conferir saldos no sistema..."
                  value={newTaskChecklistText}
                  onChange={(e) => setNewTaskChecklistText(e.target.value)}
                  className="w-full bg-[#23201D] border border-[#3F3B35] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#C19A6B] font-mono text-[11px]"
                />
              </div>

              <div className="pt-3 border-t border-[#3F3B35] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewTaskModalOpen(false)}
                  className="px-4 py-2 border border-[#3F3B35] hover:bg-[#3F3B35] text-[#EAE6DF]/80 rounded-lg text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#C19A6B] hover:bg-[#b0895a] text-white rounded-lg text-xs font-bold transition-colors shadow-lg"
                >
                  Salvar Tarefa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: CONFIRMAR CANCELAMENTO / EXCLUSÃO DE TAREFA ───────────────── */}
      {isCancelModalOpen && taskToCancel && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#2D2A26] border border-[#3F3B35] text-[#EAE6DF] rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <Ban className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">Cancelar ou Excluir Tarefa</h3>
            </div>

            <p className="text-xs text-[#EAE6DF]/80">
              Deseja cancelar a tarefa <strong className="text-white">"{taskToCancel.title}"</strong>?
            </p>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => handleConfirmCancelTask(false)}
                className="w-full py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-lg text-xs font-bold transition-colors text-center"
              >
                Marcar como Cancelada (Manter Histórico)
              </button>
              <button
                onClick={() => handleConfirmCancelTask(true)}
                className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-colors text-center shadow"
              >
                Excluir Permanentemente
              </button>
              <button
                onClick={() => setIsCancelModalOpen(false)}
                className="w-full py-2 border border-[#3F3B35] hover:bg-[#3F3B35] text-[#EAE6DF]/70 rounded-lg text-xs font-semibold text-center mt-1"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── COMPONENTE AUXILIAR DE CARD DE TAREFA (PLANNER STYLE) ────────────────────

interface TaskCardProps {
  task: RoutineTask;
  onUpdateStatus: (task: RoutineTask, status: TaskStatus) => void;
  onToggleChecklist: (task: RoutineTask, checklistId: string) => void;
  onOpenSpec: (spec: TechnicalSpreadsheetSpec) => void;
  onNavigateToModule: (tab: ViewTab) => void;
  onCancelTask: (task: RoutineTask) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onUpdateStatus,
  onToggleChecklist,
  onOpenSpec,
  onNavigateToModule,
  onCancelTask,
}) => {
  const spec = TECHNICAL_SPREADSHEETS.find((s) => s.id === task.spreadsheetSpecId);
  const checklistTotal = task.checklists?.length || 0;
  const checklistDone = task.checklists?.filter((c) => c.done).length || 0;

  return (
    <div className="bg-[#2D2A26] border border-[#3F3B35] hover:border-[#C19A6B] rounded-xl p-3.5 space-y-3 shadow transition-all duration-200 group">
      {/* Header do Card */}
      <div className="flex items-start justify-between gap-2">
        <h4 className={`text-xs font-bold ${task.status === 'concluido' ? 'line-through text-[#EAE6DF]/50' : 'text-white'}`}>
          {task.title}
        </h4>
        <button
          onClick={() => onCancelTask(task)}
          title="Cancelar Tarefa"
          className="text-[#EAE6DF]/40 hover:text-rose-400 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-[11px] text-[#EAE6DF]/70 line-clamp-2 leading-relaxed">{task.description}</p>

      {/* Badges e Vínculo Técnico */}
      <div className="flex flex-wrap items-center gap-1.5">
        {spec && (
          <button
            onClick={() => onOpenSpec(spec)}
            className="px-2 py-0.5 text-[9px] font-extrabold bg-[#C19A6B]/20 text-[#C19A6B] border border-[#C19A6B]/40 rounded hover:bg-[#C19A6B] hover:text-white transition-colors"
          >
            Planilha: {spec.code}
          </button>
        )}
      </div>

      {/* Checklist items */}
      {task.checklists && task.checklists.length > 0 && (
        <div className="bg-[#23201D] p-2.5 rounded-lg border border-[#3F3B35] space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold text-[#EAE6DF]/60 mb-1">
            <span>Subtarefas</span>
            <span>
              {checklistDone}/{checklistTotal}
            </span>
          </div>
          {task.checklists.map((chk) => (
            <label key={chk.id} className="flex items-center gap-2 text-[10px] text-[#EAE6DF]/80 cursor-pointer hover:text-white">
              <input
                type="checkbox"
                checked={chk.done}
                onChange={() => onToggleChecklist(task, chk.id)}
                className="rounded border-[#3F3B35] bg-[#181614] text-[#C19A6B] focus:ring-0 w-3 h-3"
              />
              <span className={chk.done ? 'line-through opacity-50' : ''}>{chk.text}</span>
            </label>
          ))}
        </div>
      )}

      {/* Footer do Card com Transição de Status */}
      <div className="pt-2 border-t border-[#3F3B35] flex items-center justify-between gap-1 text-[10px]">
        {task.targetViewTab && (
          <button
            onClick={() => onNavigateToModule(task.targetViewTab!)}
            className="text-[#C19A6B] hover:underline font-bold flex items-center gap-1"
          >
            <span>Acessar</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        )}

        <select
          value={task.status}
          onChange={(e) => onUpdateStatus(task, e.target.value as TaskStatus)}
          className="bg-[#23201D] border border-[#3F3B35] text-[#EAE6DF] rounded px-1.5 py-0.5 font-semibold text-[10px] focus:outline-none"
        >
          <option value="pendente">Pendente</option>
          <option value="em_andamento">Em Andamento</option>
          <option value="aguardando_importacao">Aguardando Carga</option>
          <option value="concluido">Concluído</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </div>
    </div>
  );
};
