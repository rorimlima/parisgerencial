import React, { useState } from 'react';
import {
  Search,
  UserPlus,
  Download,
} from 'lucide-react';
import { Customer } from '../types';
import { formatCurrency, exportReportToExcel } from '../utils/exportUtils';
import * as XLSX from 'xlsx';

interface CustomerManagementViewProps {
  customers: Customer[];
  onAddCustomer: (customerData: Partial<Customer>) => void;
  userRole: string;
}

export const CustomerManagementView: React.FC<CustomerManagementViewProps> = ({
  customers,
  onAddCustomer,
  userRole,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Adimplente' | 'Inadimplente' | 'Risco'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [cnpjCpf, setCnpjCpf] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [currentBalance, setCurrentBalance] = useState('');
  const [delinquentAmount, setDelinquentAmount] = useState('');
  const [status, setStatus] = useState('Adimplente');

  const filteredCustomers = customers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cnpjCpf.includes(searchTerm) ||
      c.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalCredit = customers.reduce((acc, c) => acc + c.creditLimit, 0);
  const totalBalance = customers.reduce((acc, c) => acc + c.currentBalance, 0);
  const totalDelinquent = customers.reduce((acc, c) => acc + c.delinquentAmount, 0);

  const handleSubmitNewCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    onAddCustomer({
      code,
      name,
      tradeName,
      cnpjCpf,
      contactName,
      phone,
      email,
      city,
      state,
      creditLimit: parseFloat(creditLimit || '0'),
      currentBalance: parseFloat(currentBalance || '0'),
      delinquentAmount: parseFloat(delinquentAmount || '0'),
      status: status as any,
    });
    setIsModalOpen(false);
    // Reset
    setCode('');
    setName('');
    setTradeName('');
    setCnpjCpf('');
    setContactName('');
    setPhone('');
    setEmail('');
    setCity('');
    setState('');
    setCreditLimit('');
    setCurrentBalance('');
    setDelinquentAmount('');
    setStatus('Adimplente');
  };

  const handleExportExcel = () => {
    const exportData = filteredCustomers.map(c => ({
      'Código': c.code,
      'Razão Social': c.name,
      'Nome Fantasia': c.tradeName || '',
      'CNPJ / CPF': c.cnpjCpf,
      'Contato': c.contactName,
      'Telefone': c.phone,
      'E-mail': c.email,
      'Cidade': c.city || '',
      'UF': c.state || '',
      'Limite de Crédito': c.creditLimit,
      'Saldo Devedor': c.currentBalance,
      'Inadimplência': c.delinquentAmount,
      'Status': c.status,
    }));

    exportReportToExcel(exportData, 'Clientes', `Clientes_${Date.now()}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-[#EAE6DF] p-6 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#C19A6B]/15 text-[#C19A6B] border border-[#C19A6B]/30">
              CARTEIRA DE CLIENTES
            </span>
            <span className="text-xs text-[#8B7D6B]">• Total Cadastrados: {customers.length}</span>
          </div>
          <h2 className="text-xl font-black text-[#2D2A26] mt-1">Cadastro de Clientes e Limites de Crédito</h2>
          <p className="text-xs text-[#8B7D6B]">
            Controle corporativo de limites concedidos, saldos devedores e indicador de inadimplência por cliente.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="px-4 py-2.5 text-xs font-bold bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF] rounded-lg shadow-xs transition-all flex items-center gap-2 border border-[#EAE6DF]"
          >
            <Download className="w-4 h-4 text-[#8B7D6B]" />
            <span>Exportar Excel</span>
          </button>

          {userRole !== 'analista' && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2.5 text-xs font-bold bg-[#2D2A26] text-white hover:bg-[#3F3B35] rounded-lg shadow-xs transition-all flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4 text-[#C19A6B]" />
              <span>Cadastrar Novo Cliente</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">
            Limite de Crédito Total Concedido
          </span>
          <p className="text-lg font-black text-[#2D2A26] mt-1">{formatCurrency(totalCredit)}</p>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">
            Saldo Devedor Atual Carteira
          </span>
          <p className="text-lg font-black text-[#C19A6B] mt-1">{formatCurrency(totalBalance)}</p>
        </div>
        <div className="bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
          <span className="text-[10px] font-bold text-[#8B7D6B] uppercase tracking-wider block">
            Total Inadimplente no Momento
          </span>
          <p className="text-lg font-black text-rose-700 mt-1">{formatCurrency(totalDelinquent)}</p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white border border-[#EAE6DF] p-4 rounded-xl shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-[#8B7D6B] absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Buscar cliente por nome, CNPJ/CPF ou código..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#F9F7F2] border border-[#EAE6DF] text-xs text-[#2D2A26] pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:border-[#C19A6B]"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto">
          {(['all', 'Adimplente', 'Inadimplente', 'Risco'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                statusFilter === st
                  ? 'bg-[#C19A6B] text-white shadow-xs'
                  : 'bg-[#F3F1ED] text-[#433E37] hover:bg-[#EAE6DF]'
              }`}
            >
              {st === 'all' ? 'Todos os Clientes' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Directory Table */}
      <div className="bg-white border border-[#EAE6DF] rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-[#F9F7F2] text-[#8B7D6B] font-bold border-b border-[#EAE6DF]">
              <tr>
                <th className="p-3 whitespace-nowrap">Código</th>
                <th className="p-3 whitespace-nowrap">Razão Social</th>
                <th className="p-3 whitespace-nowrap">Nome Fantasia</th>
                <th className="p-3 whitespace-nowrap">CNPJ / CPF</th>
                <th className="p-3 whitespace-nowrap">Contato</th>
                <th className="p-3 whitespace-nowrap">Telefone</th>
                <th className="p-3 whitespace-nowrap">E-mail</th>
                <th className="p-3 whitespace-nowrap">Cidade</th>
                <th className="p-3 whitespace-nowrap">UF</th>
                <th className="p-3 text-right whitespace-nowrap">Limite de Crédito</th>
                <th className="p-3 text-right whitespace-nowrap">Saldo Devedor</th>
                <th className="p-3 text-right whitespace-nowrap">Inadimplência</th>
                <th className="p-3 text-center whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE6DF] text-[#433E37]">
              {filteredCustomers.map((c) => (
                <tr key={c.id} className="hover:bg-[#FDFBF7] transition-colors">
                  <td className="p-3 font-mono text-[#2D2A26] font-bold whitespace-nowrap">{c.code}</td>
                  <td className="p-3 text-[#2D2A26] font-semibold whitespace-nowrap">{c.name}</td>
                  <td className="p-3 text-[#433E37] whitespace-nowrap">{c.tradeName}</td>
                  <td className="p-3 text-[#433E37] text-[10px] whitespace-nowrap">{c.cnpjCpf}</td>
                  <td className="p-3 text-[#433E37] whitespace-nowrap">{c.contactName}</td>
                  <td className="p-3 text-[#433E37] text-[10px] whitespace-nowrap">{c.phone}</td>
                  <td className="p-3 text-[#433E37] text-[10px] whitespace-nowrap">{c.email}</td>
                  <td className="p-3 text-[#433E37] whitespace-nowrap">{c.city}</td>
                  <td className="p-3 text-[#433E37] font-bold whitespace-nowrap">{c.state}</td>
                  <td className="p-3 text-right font-mono font-semibold text-[#2D2A26] whitespace-nowrap">
                    {formatCurrency(c.creditLimit)}
                  </td>
                  <td className="p-3 text-right font-mono font-semibold text-[#C19A6B] whitespace-nowrap">
                    {formatCurrency(c.currentBalance)}
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-rose-700 whitespace-nowrap">
                    {c.delinquentAmount > 0 ? formatCurrency(c.delinquentAmount) : '-'}
                  </td>
                  <td className="p-3 text-center whitespace-nowrap">
                    {c.status === 'Adimplente' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        Adimplente
                      </span>
                    ) : c.status === 'Inadimplente' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                        Inadimplente
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#C19A6B]/20 text-[#C19A6B] border border-[#C19A6B]/30">
                        Risco
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Customer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#EAE6DF] rounded-xl w-full max-w-2xl shadow-xl flex flex-col text-[#2D2A26]" style={{ maxHeight: '90vh' }}>
            <div className="p-6 border-b border-[#EAE6DF]">
              <h3 className="text-base font-bold flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#C19A6B]" />
                Cadastrar Novo Cliente
              </h3>
            </div>

            <div className="p-6 overflow-y-auto">
              <form id="new-customer-form" onSubmit={handleSubmitNewCustomer} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Código</label>
                    <input
                      type="text"
                      placeholder="Ex: 00100"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Razão Social</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Transportadora Rally Dakar Ltda"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Nome Fantasia</label>
                    <input
                      type="text"
                      placeholder="Ex: Rally Dakar Logística"
                      value={tradeName}
                      onChange={(e) => setTradeName(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">CNPJ / CPF</label>
                    <input
                      type="text"
                      required
                      placeholder="00.000.000/0001-00"
                      value={cnpjCpf}
                      onChange={(e) => setCnpjCpf(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Contato</label>
                    <input
                      type="text"
                      placeholder="Ex: Carlos Silva"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Telefone</label>
                    <input
                      type="text"
                      placeholder="(11) 99999-9999"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-1">
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">E-mail</label>
                    <input
                      type="email"
                      placeholder="financeiro@cliente.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Cidade</label>
                    <input
                      type="text"
                      placeholder="Ex: São Paulo"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">UF</label>
                    <input
                      type="text"
                      placeholder="SP"
                      maxLength={2}
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Lim. Crédito (R$)</label>
                    <input
                      type="text"
                      placeholder="100000.00"
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] font-mono focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Saldo Devedor (R$)</label>
                    <input
                      type="text"
                      placeholder="0.00"
                      value={currentBalance}
                      onChange={(e) => setCurrentBalance(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] font-mono focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Inadimplente (R$)</label>
                    <input
                      type="text"
                      placeholder="0.00"
                      value={delinquentAmount}
                      onChange={(e) => setDelinquentAmount(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] font-mono focus:outline-none focus:border-[#C19A6B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#8B7D6B] mb-1">Status</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full bg-[#F9F7F2] border border-[#EAE6DF] rounded-lg p-2.5 text-xs text-[#2D2A26] focus:outline-none focus:border-[#C19A6B]"
                    >
                      <option value="Adimplente">Adimplente</option>
                      <option value="Inadimplente">Inadimplente</option>
                      <option value="Risco">Risco</option>
                    </select>
                  </div>
                </div>
              </form>
            </div>

            <div className="p-6 border-t border-[#EAE6DF] flex items-center justify-end space-x-3 bg-[#F9F7F2] rounded-b-xl">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-[#8B7D6B] hover:text-[#2D2A26] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="new-customer-form"
                className="px-5 py-2 text-xs font-bold bg-[#2D2A26] hover:bg-[#3F3B35] text-white rounded-lg shadow-xs transition-colors"
              >
                Salvar Cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
