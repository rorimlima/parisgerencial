# EXTRATO GERAL — formato único de importação de extratos

## O formato

Uma planilha, oito colunas, cabeçalho na primeira linha:

| Coluna | Conteúdo | Obrigatória |
|---|---|---|
| `ID` | nº da linha na planilha de origem | não |
| `BANCO` | conta de origem do dinheiro | **sim** |
| `LANCAMENTO` | histórico do movimento | não |
| `DATA` | data do lançamento | **sim** |
| `ENTRADA` | valor recebido (positivo) | ENTRADA ou SAIDA |
| `SAIDA` | valor pago (**negativo**) | ENTRADA ou SAIDA |
| `TIPO` | `ENTRADA` / `SAIDA` — conferência | não |
| `CONTA` | `BANCO` / `DINHEIRO` | não |

Um único arquivo carrega **todas as contas de uma vez**. Não há mais escolha de conta na tela: a coluna `BANCO` roteia cada linha.

### Contas reconhecidas

O cadastro de contas é **um só**, em `src/utils/paymentAccounts.ts`, e serve ao mesmo tempo o parser do extrato, o seletor de origem dos títulos e as somas por conta. Antes eram listas separadas — cadastrar um caixa em uma e não na outra fazia o dinheiro entrar no extrato e sumir das somas, sem erro em lugar nenhum.

| `BANCO` | Entra como | Conta contábil | Forma |
|---|---|---|---|
| `BRADESCO` | Entradas Bancos | — | Banco |
| `PAGBANK` / `PAGSEGURO` | Entradas Bancos | — | Banco |
| `TESOURARIA` | Entradas Tesouraria | 30101 | Dinheiro |
| `CAIXA30107` | Entradas Tesouraria | 30107 | Dinheiro |
| `CAIXA30108` | Entradas Tesouraria | 30108 | Dinheiro |
| `CAIXA30110` | Entradas Tesouraria | 30110 | Dinheiro |
| `ALBA30110` | Entradas Tesouraria | 30110 | Dinheiro |

`ALBA30110` e `CAIXA30110` são a **mesma conta contábil 301.10** com nomes operacionais diferentes: o código é o mesmo, o rótulo preserva quem movimentou.

A **forma de pagamento é derivada da conta** (caixa é dinheiro, conta corrente é banco), nunca digitada. Se fosse campo livre, um dia alguém marcaria "Dinheiro" num pagamento do Bradesco e o total por forma pararia de bater com o total por conta.

Qualquer `CAIXA 301.xx` novo é reconhecido automaticamente como caixa. **Banco fora dessa lista e sem 301.xx no nome faz a linha ser rejeitada, não adivinhada** — chutar a origem joga dinheiro na linha errada do Resultado Financeiro, e o erro só aparece meses depois. Para cadastrar uma conta nova: acrescente uma entrada em `PAYMENT_ACCOUNTS`; ela passa a aparecer no seletor, nas somas e no roteamento do extrato de uma vez.

## As três regras que decidem o número

**1. O sinal do valor manda; `TIPO` é conferência.**
`ENTRADA > 0` é entrada, `SAIDA < 0` é saída. Quando a coluna `TIPO` discorda, prevalece o valor — é ele que faz o extrato fechar com o saldo do banco. A divergência não é silenciada: aparece na prévia da tela e no relatório do script, para ser corrigida na planilha de origem.

**2. Linha sem valor não é lançamento.** `SALDO ANTERIOR`, `Saldo do dia` e linhas vazias são descartadas com o motivo registrado. Saldo não é movimento.

**3. A chave é o conteúdo, não o `ID`.** `ID` é número de linha, e número de linha se renumera a cada exportação. A identidade do lançamento é `banco + data + histórico + valor`, com contador de ocorrência para dois lançamentos legitimamente idênticos no mesmo dia. Consequência prática: **reimportar o mesmo arquivo atualiza as linhas, nunca duplica** — inclusive depois de inserir lançamentos no meio da planilha. O `ID` fica gravado em `documento_ref` para localizar a linha original quando um valor for contestado.

## Importar pela tela

Extrato Financeiro → cartão **Extrato Geral** (já vem selecionado) → arraste o `.xlsx`.

A prévia mostra, antes de gravar: para onde vai cada lançamento (quebra por conta), as divergências de `TIPO`, os lançamentos sem histórico e as linhas descartadas. Só então o botão de confirmar grava.

## Substituir o extrato inteiro pelo script

Usado quando a planilha passa a ser a fonte da verdade e o extrato atual precisa sair.

```bash
npm run import:extrato:dry    # relatório completo, NÃO grava nada
npm run import:extrato        # executa
```

Opções: `--arquivo=caminho.xlsx` (padrão `scripts/data/extratogeral.xlsx`), `--year=2026`, `--manter-baixas`, `--sem-financeiro`.

### O que ele faz, nesta ordem

1. **Lê e valida a planilha** antes de tocar no banco. Planilha com problema = extrato antigo intacto.
2. **Solta as baixas automáticas** dos títulos (voltam a `Em Aberto`). Vem antes de apagar o extrato de propósito: baixa é um ponteiro (`extrato_id`) para um lançamento. Apagar o extrato primeiro deixaria títulos "baixados" apontando para o nada — pagos aos olhos do sistema, sem prova, e invisíveis para a conciliação, que só procura par para quem está em aberto.
3. **Apaga o extrato antigo e grava o novo.**
4. **Reconcilia** com o mesmo motor da tela: acima do corte vira `Baixado Automático`, abaixo vira `Conferir`.
5. **Recalcula o Resultado Financeiro** (entradas por mês, por origem), com a regra do App: transferência interna não é entrada.

### Baixas manuais são preservadas

Baixa manual é decisão de uma pessoa que conferiu o caso; o script não a desfaz. As que apontarem para um lançamento que deixou de existir são **listadas no final** para conferência humana. Para zerar também as manuais, é preciso fazê-lo na tela de Títulos — não há flag para isso, por segurança.

### Proteções

- **Chave repetida aborta a execução.** Duas linhas na mesma chave significa uma sobrescrevendo a outra: dinheiro sumindo em silêncio.
- **Leitura sempre do servidor** (`getDocsFromServer`). Com `getDocs`, uma queda de rede faria o SDK responder "coleção vazia" do cache, o script concluiria que não há extrato antigo, não apagaria nada e gravaria os lançamentos novos **ao lado** dos antigos. O script prefere estourar a mentir.
- **Gravação idempotente.** O ID do documento vem da chave, então rodar de novo depois de uma falha regrava por cima em vez de duplicar.

## Conta de origem dos títulos e somas por conta

Em **Contas a Pagar** e **Contas a Receber**, aba Títulos, cada linha tem a coluna **Conta de origem** (em Receber, "Conta de entrada"): de qual conta saiu — ou em qual entrou — o dinheiro daquele título.

**Como ela é preenchida.** Quando o título é baixado contra o extrato, a conta já vem do próprio lançamento conciliado e aparece marcada como *pela baixa* — não é preciso tocar em nada. O dropdown existe para os dois casos em que a inferência não serve: pagamento feito fora do extrato (sem baixa) e correção de uma conta inferida errada, típico do pagamento que saiu do caixa e só depois foi reembolsado pelo banco.

**A escolha do gestor vence a baixa.** Uma vez selecionada no dropdown, a conta passa a ser a do gestor e a conciliação não a sobrescreve mais. Sem essa precedência, a correção duraria até a próxima conciliação e teria de ser refeita para sempre. A opção *"(da baixa)"* no topo da lista é o caminho de volta: limpa a escolha e devolve o título à conta inferida.

**Os três totais**, no topo da aba Títulos, seguindo o período e os filtros da tela:

- **por conta** — Bradesco, PagBank, Caixa 30107, Tesouraria…; clicar numa linha filtra a tabela por ela;
- **por forma de pagamento** — Banco x Dinheiro;
- **despesa fixa x variável** — herdada do campo *Classif. Despesa* do cadastro de clientes/fornecedores, pelo código da pessoa.

Só entram títulos **pagos**: a pergunta "de que conta saiu" não existe para um compromisso que ainda não foi pago. As três somas fecham no mesmo total, sempre — e é por isso que *"Sem conta definida"* e *"Não classificado"* aparecem como linha em vez de serem omitidos. Uma soma que ignora silenciosamente o que não sabe classificar mostra um total menor que o real, e quem lê o painel não tem como perceber o que ficou de fora. O filtro **Sem conta definida** isola exatamente o que falta apontar.

A conta de origem **não vem do RFN046** e por isso fica fora do `tituloToFirestore`: se fosse gravada junto com os campos do ERP, cada reimportação mandaria vazio por cima e apagaria as contas apontadas na mão — o mesmo cuidado que já protege as baixas.

## Conferir

```bash
npm run test:extrato-geral    # formato, chaves, totais, baixa automática
npm run test:contas-origem    # conta de origem, precedência e fechamento das somas
```

O primeiro valida contra a planilha real: totais banco por banco contra a soma direta das colunas, unicidade e estabilidade das chaves (inclusive renumerando o `ID` e inserindo linhas no meio), roteamento de conta, divergências de `TIPO`, e o comportamento da baixa automática — nenhum lançamento quitando dois títulos, entrada só casando com `R`, saída só com `P`, baixa manual fora do jogo.

O segundo valida a precedência gestor > baixa, o caminho de volta ao limpar a escolha, a forma derivada da conta, o registro único (parser e seletor concordando conta a conta) e o fechamento das três somas contra o total pago.

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/utils/paymentAccounts.ts` | cadastro único das contas/caixas, origem do título e somas |
| `src/utils/extratoGeralParser.ts` | leitura, validação e resumo do formato |
| `src/utils/statementKeys.ts` | `buildExtratoGeralDedupeKey` — a regra de identidade |
| `src/components/FinancialStatementView.tsx` | tela de importação e prévia |
| `src/components/TitulosWorkspace.tsx` | coluna de origem e painel de somas |
| `scripts/importExtratoGeral.mjs` | substituição do extrato + refação das baixas |
| `scripts/testExtratoGeralParser.mjs` | conferência do formato |
| `scripts/testContasOrigem.mjs` | conferência da origem e das somas |
