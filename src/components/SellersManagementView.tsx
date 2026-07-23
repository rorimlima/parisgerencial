import React, { useState } from 'react';
import { Briefcase, Edit2, Plus, Search, Trash2, UserCheck, AlertTriangle, X, Check } from 'lucide-react';
import { Customer, DelinquentTitle, Seller, UserRole } from '../types';

interface SellersManagementViewProps {
  sellers: Seller[];
  delinquentTitles: DelinquentTitle[];
  customers: Customer[];
  onAddSeller: (seller: Seller) => void;
  onUpdateSeller: (id: string, seller: Partial<Seller>) => void;
  onDeleteSeller: (id: string) => void;
  userRole: UserRole;
}

export const SellersManagementView: React.FC<SellersManagementViewProps> = ({
  sellers,
  delinquentTitles,
  customers,
  onAddSeller,
  onUpdateSeller,
  onDeleteSeller,
  userRole,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSeller, setEditingSeller] = useState<Seller | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form State
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formStatus, setFormStatus] = useState<'Ativo' | 'Inativo'>('Ativo');

  // Abre modal para criar
  const handleOpenAddModal = () => {
    setEditingSeller(null);
    setFormCode(`VEND${String(sellers.length + 1).padStart(3, '0')}`);
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormStatus('Ativo');
    setIsModalOpen(true);
  };

  // Abre modal para editar
  const handleOpenEditModal = (seller: Seller) => {
    setEditingSeller(seller);
    setFormCode(seller.code);
    setFormName(seller.name);
    setFormEmail(seller.email || '');
    setFormPhone(seller.phone || '');
    setFormStatus(seller.status);
    setIsModalOpen(true);
  };

  // Salva (cria ou edita)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('Por favor, informe o nome do vendedor.');
      return;
    }

    if (editingSeller) {
      onUpdateSeller(editingSeller.id, {
        code: formCode.trim() || editingSeller.code,
        name: formName.trim(),
        email: formEmail.trim(),
        phone: formPhone.trim(),
        status: formStatus,
      });
    } else {
      const newSeller: Seller = {
        id: `vend_${Date.now()}`,
        code: formCode.trim() || `VEND${Date.now().toString().slice(-4)}`,
        name: formName.trim(),
        email: formEmail.trim(),
        phone: formPhone.trim(),
        status: formStatus,
      };
      onAddSeller(newSeller);
    }

    setIsModalOpen(false);
  };

  // Confirma exclusão
  const handleConfirmDelete = (id: string) => {
    onDeleteSeller(id);
    setDeleteConfirmId(null);
  };

  // Normaliza string para remoção de acentos e case-insensitivity
  const normalizeText = (str: string) =>
    str
      ? str
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim()
      : '';

  // Calcula total inadimplente por vendedor
  const getSellerDelinquentAmount = (seller: Seller) => {
    const normSellerName = normalizeText(seller.name);
    const normSellerCode = normalizeText(seller.code);

    return delinquentTitles
      .filter((t) => {
        // Vínculo direto pelos campos do título
        if (t.sellerId && t.sellerId === seller.id) return true;
        if (t.sellerCode && normalizeText(t.sellerCode) === normSellerCode) return true;
        if (t.sellerName && normalizeText(t.sellerName) === normSellerName) return true;

        // Fallback: Vínculo através do Vendedor Responsável cadastrado no Cliente do título
        const titleCustomer = customers.find(
          (c) =>
            c.id === t.customerId ||
            (t.customerCode && c.code.toLowerCase() === t.customerCode.toLowerCase())
        );
        if (titleCustomer && titleCustomer.sellerResponsible) {
          const normCustSeller = normalizeText(titleCustomer.sellerResponsible);
          if (normCustSeller === normSellerName || normCustSeller === normSellerCode) return true;
        }

        return false;
      })
      .reduce((acc, t) => acc + (t.updatedAmount || t.originalAmount || 0), 0);
  };

  const filteredSellers = sellers.filter(
    (s) =>
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.email && s.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totalDelinquentAllSellers = delinquentTitles.reduce(
    (acc, t) => acc + (t.updatedAmount || t.originalAmount || 0),
    0
  );

  const formatCurrency = (val: number) =>
    val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              EQUIPE DE VENDAS
            </span>
            <span className="text-xs text-[#8B7D6B]">• Vínculo direto com carteira de cobrança</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Gestão de Vendedores</h2>
          <p className="text-xs text-[#8B7D6B]">
            Cadastre, edite e acompanhe a inadimplência associada à carteira de cada vendedor responsável.
          </p>
        </div>

        {userRole !== 'analista' && (
          <button
            onClick={handleOpenAddModal}
            className="flex items-center space-x-2 px-4 py-2 bg-[#2D2A26] hover:bg-[#3F3B35] text-white text-xs font-bold rounded-lg shadow-xs transition-all"
          >
            <Plus className="w-4 h-4 text-[#C19A6B]" />
            <span>Novo Vendedor</span>
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#EAE6DF] shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-[#F9F7F2] text-[#C19A6B] border border-[#EAE6DF]">
            <Briefcase className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-[#8B7D6B] uppercase">Total de Vendedores</p>
            <p className="text-2xl font-black text-[#2D2A26]">{sellers.length}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#EAE6DF] shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-[#8B7D6B] uppercase">Vendedores Ativos</p>
            <p className="text-2xl font-black text-emerald-700">
              {sellers.filter((s) => s.status === 'Ativo').length}
            </p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#EAE6DF] shadow-xs flex items-center space-x-4">
          <div className="p-3 rounded-lg bg-rose-50 text-rose-600 border border-rose-100">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-[#8B7D6B] uppercase">Inadimplência sob Carteiras</p>
            <p className="text-xl font-black text-rose-700">
              {formatCurrency(totalDelinquentAllSellers)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabela de Vendedores */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        {/* Barra de Busca */}
        <div className="p-4 border-b border-[#EAE6DF] bg-[#F9F7F2] flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por código, nome ou e-mail..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-[#EAE6DF] rounded-lg pl-9 pr-4 py-2 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
            />
          </div>
          <span className="text-xs text-[#8B7D6B] font-medium">
            Exibindo {filteredSellers.length} de {sellers.length} vendedor(es)
          </span>
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F9F7F2] text-[#8B7D6B] border-b border-[#EAE6DF] font-bold uppercase text-[10px]">
              <tr>
                <th className="p-3.5">Código</th>
                <th className="p-3.5">Vendedor / Nome</th>
                <th className="p-3.5">E-mail</th>
                <th className="p-3.5">Telefone</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Inadimplência da Carteira</th>
                <th className="p-3.5 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
              {filteredSellers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-[#8B7D6B]">
                    Nenhum vendedor encontrado.
                  </td>
                </tr>
              ) : (
                filteredSellers.map((seller) => {
                  const delAmount = getSellerDelinquentAmount(seller);

                  return (
                    <tr key={seller.id} className="hover:bg-[#FDFBF7] transition-colors">
                      <td className="p-3.5 font-mono font-bold text-[#C19A6B]">
                        {seller.code}
                      </td>
                      <td className="p-3.5 font-bold text-[#2D2A26]">{seller.name}</td>
                      <td className="p-3.5 font-mono text-[11px] text-[#8B7D6B]">
                        {seller.email || '-'}
                      </td>
                      <td className="p-3.5 font-mono text-[11px]">{seller.phone || '-'}</td>
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            seller.status === 'Ativo'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-gray-100 text-gray-600 border-gray-200'
                          }`}
                        >
                          {seller.status}
                        </span>
                      </td>
                      <td className="p-3.5 text-right font-bold text-rose-700">
                        {formatCurrency(delAmount)}
                      </td>
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => handleOpenEditModal(seller)}
                            title="Editar Vendedor"
                            className="p-1.5 rounded-lg bg-[#F3F1ED] hover:bg-[#C19A6B] text-[#433E37] hover:text-white transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {userRole === 'admin' && (
                            <button
                              onClick={() => setDeleteConfirmId(seller.id)}
                              title="Excluir Vendedor"
                              className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

      {/* Modal de Cadastro/Edição */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#EAE6DF] rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-[#EAE6DF] pb-3">
              <h3 className="text-base font-black text-[#2D2A26]">
                {editingSeller ? 'Editar Vendedor' : 'Cadastrar Novo Vendedor'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-[#8B7D6B] hover:text-[#2D2A26]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#8B7D6B] mb-1">
                  Código do Vendedor *
                </label>
                <input
                  type="text"
                  required
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  placeholder="Ex: VEND001"
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs font-mono text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#8B7D6B] mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Nome do vendedor"
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#8B7D6B] mb-1">E-mail</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="vendedor@empresa.com"
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#8B7D6B] mb-1">Telefone</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="(11) 99999-9999"
                    className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#8B7D6B] mb-1">Status</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as any)}
                  className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg px-3 py-2 text-xs font-bold text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                >
                  <option value="Ativo">Ativo</option>
                  <option value="Inativo">Inativo</option>
                </select>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#EAE6DF]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center space-x-1.5 px-4 py-2 bg-[#2D2A26] hover:bg-[#3F3B35] text-white text-xs font-bold rounded-lg shadow-xs"
                >
                  <Check className="w-4 h-4 text-[#C19A6B]" />
                  <span>Salvar Vendedor</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-base font-black text-[#2D2A26]">Excluir Vendedor?</h4>
              <p className="text-xs text-[#8B7D6B] mt-1">
                Esta ação removerá o vendedor do cadastro. Os títulos de cobrança permanecerão protegidos.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-3 pt-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-xs font-bold bg-[#F3F1ED] text-[#433E37] rounded-lg hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleConfirmDelete(deleteConfirmId)}
                className="px-4 py-2 text-xs font-bold bg-rose-700 text-white rounded-lg hover:bg-rose-800"
              >
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
