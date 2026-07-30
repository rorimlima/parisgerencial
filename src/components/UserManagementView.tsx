/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UserManagementView.tsx — Cadastro de Usuários e Controle de Acesso por E-mail (Gmail)
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Edit,
  Lock,
  Mail,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { User, UserRole } from '../types';
import { addUser, deleteUser, fetchUsers, updateUser } from '../services/firebaseService';

interface UserManagementViewProps {
  currentUser: User;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({ currentUser }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Filtros de busca e papel
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');

  // Estado do Modal (Criar / Editar)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    email: string;
    role: UserRole;
    status: 'active' | 'inactive';
  }>({
    name: '',
    email: '',
    role: 'analista',
    status: 'active',
  });
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Modal de confirmação de exclusão
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const loadUsers = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (err: any) {
      console.error('Erro ao carregar usuários:', err);
      setErrorMsg('Não foi possível carregar a lista de usuários.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleOpenCreateModal = () => {
    setEditingUser(null);
    setFormData({
      name: '',
      email: '',
      role: 'analista',
      status: 'active',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      role: user.role,
      status: (user as any).status || 'active',
    });
    setIsModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email.trim() || !formData.name.trim()) {
      setErrorMsg('Nome e E-mail são obrigatórios.');
      return;
    }

    setIsSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (editingUser) {
        // Edição
        await updateUser(editingUser.id, {
          name: formData.name.trim(),
          email: formData.email.trim(),
          role: formData.role,
          status: formData.status,
        } as any);
        setSuccessMsg(`Usuário "${formData.name}" atualizado com sucesso!`);
      } else {
        // Criação / Novo Cadastro
        await addUser({
          name: formData.name.trim(),
          email: formData.email.trim(),
          role: formData.role,
          status: formData.status,
        } as any);
        setSuccessMsg(`Novo e-mail "${formData.email}" cadastrado com sucesso!`);
      }

      setIsModalOpen(false);
      await loadUsers();
    } catch (err: any) {
      console.error('Erro ao salvar usuário:', err);
      setErrorMsg(err.message || 'Erro ao salvar usuário.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setIsDeleting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await deleteUser(deletingUser.id, deletingUser.email);
      setSuccessMsg(`Acesso do usuário "${deletingUser.email}" removido.`);
      setDeletingUser(null);
      await loadUsers();
    } catch (err: any) {
      console.error('Erro ao remover usuário:', err);
      setErrorMsg('Não foi possível remover o usuário.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtragem da lista
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = selectedRoleFilter === 'all' || u.role === selectedRoleFilter;
    return matchesSearch && matchesRole;
  });

  // Métricas
  const totalCount = users.length;
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const gestorCount = users.filter((u) => u.role === 'gestor').length;
  const analistaCount = users.filter((u) => u.role === 'analista').length;

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl p-6 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-[#C19A6B]/10 via-transparent to-transparent pointer-events-none rounded-bl-full" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-3 mb-1">
              <div className="w-10 h-10 rounded-lg bg-[#2D2A26] flex items-center justify-center text-[#C19A6B] shadow-xs">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-[#2D2A26]">Cadastro de Usuários &amp; Acessos</h1>
                <p className="text-xs text-[#8B7D6B] font-medium">
                  Autorização por E-mail (Gmail) e papéis de acesso ao sistema
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={loadUsers}
              disabled={isLoading}
              className="p-2 text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#F3F1ED] rounded-lg transition-colors border border-[#EAE6DF]"
              title="Atualizar lista de usuários"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleOpenCreateModal}
              className="flex items-center space-x-2 px-4 py-2 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-all active:scale-95"
            >
              <UserPlus className="w-4 h-4 text-[#C19A6B]" />
              <span>Cadastrar Novo Usuário</span>
            </button>
          </div>
        </div>
      </div>

      {/* Alerta de Feedback */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <p className="text-xs font-semibold text-rose-800">{errorMsg}</p>
          </div>
          <button onClick={() => setErrorMsg('')} className="text-rose-500 hover:text-rose-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <p className="text-xs font-semibold text-emerald-800">{successMsg}</p>
          </div>
          <button onClick={() => setSuccessMsg('')} className="text-emerald-500 hover:text-emerald-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Explicação de Autorização Gmail */}
      <div className="bg-[#F9F7F2] border border-[#EAE6DF] rounded-xl p-4 text-xs text-[#433E37] space-y-2">
        <div className="flex items-center gap-2 font-bold text-[#2D2A26]">
          <Shield className="w-4 h-4 text-[#C19A6B]" />
          <span>Como funciona a autorização de e-mails no Paris Dakar Gerencial?</span>
        </div>
        <p className="text-[#8B7D6B] leading-relaxed">
          Para permitir que um usuário ou e-mail Gmail acesse os relatórios e dados do sistema,{' '}
          <strong className="text-[#2D2A26]">basta cadastrar o e-mail exato dele nesta tela</strong>. Quando ele efetuar o
          login no app via <span className="font-bold text-[#C19A6B]">"Entrar com o Google"</span> ou por e-mail/senha, o sistema
          verificará se o e-mail consta na lista de autorizados e aplicará as permissões correspondentes ao seu perfil.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-[#EAE6DF] rounded-xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-[#8B7D6B] uppercase tracking-wider">Total Cadastrados</p>
          <p className="text-2xl font-black text-[#2D2A26] mt-1">{totalCount}</p>
          <p className="text-[10px] text-[#8B7D6B] mt-0.5">Usuários na base</p>
        </div>

        <div className="bg-white border border-[#EAE6DF] rounded-xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-[#C19A6B] uppercase tracking-wider">Administradores</p>
          <p className="text-2xl font-black text-[#C19A6B] mt-1">{adminCount}</p>
          <p className="text-[10px] text-[#8B7D6B] mt-0.5">Acesso total e gestão de usuários</p>
        </div>

        <div className="bg-white border border-[#EAE6DF] rounded-xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Gestores</p>
          <p className="text-2xl font-black text-emerald-700 mt-1">{gestorCount}</p>
          <p className="text-[10px] text-[#8B7D6B] mt-0.5">Lançamentos e conciliação</p>
        </div>

        <div className="bg-white border border-[#EAE6DF] rounded-xl p-4 shadow-xs">
          <p className="text-[11px] font-bold text-stone-700 uppercase tracking-wider">Analistas / Visualizadores</p>
          <p className="text-2xl font-black text-stone-700 mt-1">{analistaCount}</p>
          <p className="text-[10px] text-[#8B7D6B] mt-0.5">Leitura de relatórios e painéis</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail (ex: usuario@gmail.com)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:border-[#C19A6B]"
          />
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-[#8B7D6B]">Perfil:</span>
          <select
            value={selectedRoleFilter}
            onChange={(e) => setSelectedRoleFilter(e.target.value)}
            className="bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] py-2 px-3 rounded-lg focus:outline-none focus:border-[#C19A6B] font-bold"
          >
            <option value="all">Todos os perfis ({totalCount})</option>
            <option value="admin">Administradores ({adminCount})</option>
            <option value="gestor">Gestores ({gestorCount})</option>
            <option value="analista">Analistas ({analistaCount})</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F9F7F2] border-b border-[#EAE6DF] text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider">
                <th className="py-3 px-4">Usuário</th>
                <th className="py-3 px-4">E-mail Autorizado</th>
                <th className="py-3 px-4">Perfil de Acesso</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-xs text-[#2D2A26]">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#8B7D6B]">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-[#C19A6B]" />
                      <span>Carregando cadastro de usuários...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#8B7D6B]">
                    Nenhum usuário encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const isMaster = user.email.toLowerCase() === 'onaeror@gmail.com';
                  const userStatus = (user as any).status || 'active';

                  return (
                    <tr key={user.id} className="hover:bg-[#F9F7F2]/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full bg-[#2D2A26] text-[#C19A6B] flex items-center justify-center font-bold text-xs border border-[#3F3B35]">
                            {user.avatar ? (
                              <img
                                src={user.avatar}
                                alt={user.name}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              (user.name || user.email).substring(0, 2).toUpperCase()
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-[#2D2A26] flex items-center gap-1.5">
                              <span>{user.name || 'Sem nome'}</span>
                              {isMaster && (
                                <span className="px-1.5 py-0.2 text-[9px] font-extrabold bg-[#C19A6B] text-white rounded">
                                  MASTER
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono text-xs text-[#433E37]">
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-[#8B7D6B]" />
                          <span>{user.email}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        {user.role === 'admin' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
                            Administrador
                          </span>
                        ) : user.role === 'gestor' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Gestor
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-stone-100 text-stone-700 border border-stone-200">
                            Analista
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {userStatus === 'active' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Ativo</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-semibold text-[11px]">
                            <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            <span>Inativo</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => handleOpenEditModal(user)}
                            className="p-1.5 text-[#8B7D6B] hover:text-[#2D2A26] hover:bg-[#F3F1ED] rounded-lg transition-colors"
                            title="Editar usuário"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          {!isMaster && (
                            <button
                              onClick={() => setDeletingUser(user)}
                              className="p-1.5 text-[#8B7D6B] hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Remover permissão de acesso"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Criar / Editar Usuário */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#2D2A26]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-md shadow-lg overflow-hidden text-[#2D2A26]">
            <div className="p-5 bg-[#F9F7F2] border-b border-[#EAE6DF] flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#2D2A26] flex items-center justify-center text-[#C19A6B] font-bold">
                  {editingUser ? <Edit className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                </div>
                <h3 className="font-extrabold text-sm text-[#2D2A26]">
                  {editingUser ? 'Editar Usuário' : 'Cadastrar Novo Usuário'}
                </h3>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-[#8B7D6B] hover:text-[#2D2A26]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-5 space-y-4">
              {/* E-mail */}
              <div>
                <label className="block text-xs font-bold text-[#8B7D6B] mb-1">
                  E-mail do Usuário (Gmail ou Corporativo) *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    placeholder="exemplo@gmail.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] pl-9 pr-3 py-2.5 rounded-lg focus:outline-none focus:border-[#C19A6B] font-mono"
                  />
                </div>
                <p className="text-[10px] text-[#8B7D6B] mt-1">
                  O usuário poderá realizar login via "Entrar com o Google" usando este e-mail.
                </p>
              </div>

              {/* Nome */}
              <div>
                <label className="block text-xs font-bold text-[#8B7D6B] mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  placeholder="Nome do Usuário"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] px-3 py-2.5 rounded-lg focus:outline-none focus:border-[#C19A6B]"
                />
              </div>

              {/* Perfil / Função */}
              <div>
                <label className="block text-xs font-bold text-[#8B7D6B] mb-1">Perfil de Acesso (Papel)</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] px-3 py-2.5 rounded-lg focus:outline-none focus:border-[#C19A6B] font-bold"
                >
                  <option value="analista">Analista — Somente leitura de dados e relatórios</option>
                  <option value="gestor">Gestor — Lançamentos, edição de cadastros e conciliação</option>
                  <option value="admin">Administrador — Acesso total e gestão de usuários</option>
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-bold text-[#8B7D6B] mb-1">Status de Acesso</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] px-3 py-2.5 rounded-lg focus:outline-none focus:border-[#C19A6B] font-bold"
                >
                  <option value="active">Ativo (Acesso Liberado)</option>
                  <option value="inactive">Inativo (Acesso Bloqueado)</option>
                </select>
              </div>

              <div className="pt-3 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-[#8B7D6B] hover:text-[#2D2A26] bg-[#F9F7F2] hover:bg-[#EAE6DF] rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] disabled:opacity-60 text-white rounded-lg shadow-xs transition-all flex items-center gap-2"
                >
                  {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5 text-[#C19A6B]" />}
                  <span>{editingUser ? 'Salvar Alterações' : 'Cadastrar Usuário'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 bg-[#2D2A26]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-md shadow-lg p-6 space-y-4 text-[#2D2A26]">
            <div className="flex items-center space-x-3 text-rose-700">
              <AlertCircle className="w-6 h-6 flex-shrink-0" />
              <h3 className="font-extrabold text-base">Remover Acesso do Usuário?</h3>
            </div>

            <p className="text-xs text-[#8B7D6B] leading-relaxed">
              Você está prestes a revogar a autorização de acesso de{' '}
              <strong className="text-[#2D2A26] font-mono">{deletingUser.email}</strong> ({deletingUser.name}). Esse usuário
              não conseguirá mais logar nem visualizar os dados do sistema.
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setDeletingUser(null)}
                className="px-4 py-2 text-xs font-semibold text-[#8B7D6B] hover:text-[#2D2A26] bg-[#F9F7F2] hover:bg-[#EAE6DF] rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white rounded-lg shadow-xs transition-all flex items-center gap-1.5"
              >
                {isDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Confirmar Exclusão</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
