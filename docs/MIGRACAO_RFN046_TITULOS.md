# Migração da fonte de dados — Títulos Financeiros (RFN046)

Julho/2026 · troca da fonte de entrada e saída do sistema

---

## O que mudou, em uma frase

Contas a Receber e Contas a Pagar deixaram de vir de três relatórios diferentes
e passaram a vir de **um só** — o RFN046 (Títulos), exportado duas vezes.

## Antes × Depois

| | Antes | Depois |
|---|---|---|
| Recebimento | RFN029 (Títulos Atrasados por Vendedor) → `titulos_inadimplentes` | **RFN046 movimento `R`** → `contas_a_receber` |
| Pagamento realizado | RFN006 (Totais Pagos por Credor) → `contas_a_pagar` | **RFN046 movimento `P`** → `contas_a_pagar` |
| Pagamento previsto | RFN046 → `contas_a_pagar_previsao` (base separada) | mesma base, separado por `Titulo_Status` |
| Modelo de dados | 3 estruturas distintas | 1 (`TituloFinanceiro`) |
| Parser | 3 parsers | 1 (`rfn046Parser.ts`) |
| Tela | 2 telas + 1 painel | 1 componente (`TitulosWorkspace`), 2 instâncias |

**Por que a base de previsão sumiu.** Um título previsto e um título pago são a
mesma linha do RFN046 em momentos diferentes. Enquanto foram duas bases, o mesmo
compromisso conseguia existir nas duas ao mesmo tempo e o fluxo de caixa contava
a saída duas vezes — uma como previsão, outra como realizado. Hoje o que separa
os dois é uma coluna: `Titulo_Status`.

## As regras que sustentam os números

### 1. `Titulo_MovimentoFinanceiro` decide a base

```
'R' → ENTRADA → contas_a_receber
'P' → SAÍDA   → contas_a_pagar
```

A tela não decide nada: subir a planilha errada na aba errada é bloqueado na
prévia, com o motivo escrito linha a linha.

### 2. `Titulo_Status` decide previsto × realizado

| Status | Onde entra | Data que vale | Valor que vale |
|---|---|---|---|
| `Pago` | **realizado** do fluxo de caixa | `Titulo_DataPagamento` | `Titulo_Valor` |
| qualquer outro | **previsão** | `Titulo_DataVencimento` | `Titulo_Saldo` |

Por isso cada título guarda **dois** pares ano/mês: `year`/`monthKey` (vencimento,
competência) e `paidYear`/`paidMonthKey` (pagamento, caixa). Um título vencido em
30/06 e pago em 03/07 pertence a junho na previsão e a julho no caixa — guardar
só um dos pares obrigaria a escolher qual dos dois relatórios mentir.

### 3. `Titulo_PessoaCod` ⇄ `cod_cliente`

Vale para os dois lados: no ERP, cliente e fornecedor são "pessoa". O vínculo é
resolvido na importação (com normalização de zeros à esquerda) e a prévia mostra
o percentual amarrado **antes** de gravar.

### 4. Realizado do fluxo de caixa: extrato manda, título completa

O extrato bancário e o título com status `Pago` são duas testemunhas do mesmo
dinheiro. Somar as duas conta cada movimento duas vezes; ignorar os títulos perde
tudo o que andou fora dos extratos importados.

**Regra:** entra no realizado o extrato inteiro **mais** os títulos pagos que
*não* foram conciliados com nenhum lançamento. Título já baixado contra o extrato
já está representado pelo lançamento. É exatamente essa fronteira que a baixa
automática desenha — e o motivo de ela existir.

## Baixa automática (conciliação título ⇄ extrato)

Quatro evidências, nenhuma suficiente sozinha:

| Evidência | Peso | Papel |
|---|---|---|
| Valor | 45 | **eliminatória** — fora da tolerância, o par nem é considerado |
| Data | 25 | **eliminatória** — fora da janela, idem |
| Nome | 20 | confirmação, por sobreposição de palavras (não substring) |
| Nº do título no extrato | 10 | prova documental, quando existe |

Trava de direção: título `R` só casa com **crédito**; título `P` só com **débito**.
Cada lançamento quita no máximo um título, e vice-versa — os pares são ordenados
por score e consumidos de forma gulosa, então o casamento mais evidente escolhe
primeiro.

**Score ≥ corte de baixa** → baixa automática.
**Score entre sugestão e baixa** → status `Conferir`, espera olho humano.
**Abaixo** → descartado.

Todos os parâmetros são editáveis na aba **Conciliação** (tolerância em R$ e em %,
janela de dias, corte de nome, os dois scores e a exigência de nome). Ficam
salvos no navegador do gestor.

> A conciliação sempre roda contra a base **completa**, todos os anos. Título pago
> em 30/12 compensa no extrato em 03/01: com recorte anual, esse par nunca é
> encontrado.

## O que foi preservado

Não foram tocados: resultado econômico, resultado financeiro, fluxo de caixa,
faturamento, vendas de produtos, estoque, clientes, vendedores e os **extratos de
Bradesco, PagBank e Caixa/Tesouraria**.

## Zeramento das bases antigas

`Importação → Manutenção da base` (visível apenas para administrador). Três travas:

1. **Lista fechada** — só coleções de títulos chegam à tela; as protegidas nem
   aparecem, então não há clique errado possível.
2. **Seleção explícita** — nada vem marcado.
3. **Confirmação digitada** — é preciso escrever `ZERAR`.

Bases zeráveis: `titulos_inadimplentes`, `contas_a_receber`, `contas_a_pagar`,
`contas_a_pagar_previsao` (legado).

O Firestore não tem lixeira. Exporte antes se o histórico ainda tiver valor de
auditoria.

## Conferência da carga inicial

Parser validado linha a linha contra as duas planilhas do ERP:

| Arquivo | Linhas | Total | Pagos | Em aberto | Chave única |
|---|---|---|---|---|---|
| `...153246` (R) | 196 | R$ 426.610,79 | 195 · R$ 426.430,79 | 1 · R$ 180,00 | 196/196 sem colisão |
| `...153505` (P) | 393 | R$ 1.692.687,11 | 353 · R$ 1.286.619,99 | 40 · R$ 402.493,65 | 393/393 sem colisão |

Zero linhas rejeitadas, zero colunas faltando, 100% vinculável ao cadastro.

## Carga inicial — um comando

As duas planilhas já estão em `scripts/data/`. Na pasta do projeto:

```bash
npm run import:titulos:dry     # simula: mostra totais, vínculos e o que apagaria
npm run import:titulos:limpo   # grava e apaga as bases legadas no mesmo passo
```

O script `scripts/importTitulosRfn046.mjs` faz, nesta ordem: lê as planilhas com
o **parser do app**, resolve `Titulo_PessoaCod` ⇄ `cod_cliente` contra a coleção
`clientes`, grava com o **mesmo ID e os mesmos campos da tela** e roda a baixa
automática contra `extrato_financeiro`.

Nenhuma regra é reimplementada no script: parser, mapeamento e motor de
conciliação são carregados dos arquivos `.ts` do próprio app. É isso que garante
que carregar pelo script ou pela tela produza exatamente o mesmo resultado — e
que rodar os dois não duplique nada.

| Opção | Efeito |
|---|---|
| `--dry` | simula e imprime tudo, sem escrever |
| `--limpar-legado` | apaga `titulos_inadimplentes`, `contas_a_pagar_previsao` e os documentos `mov_*` (RFN006) remanescentes em `contas_a_pagar` |
| `--sem-conciliar` | pula a baixa automática |

**Trava de segurança:** todas as leituras usam `getDocsFromServer`. Sem rede, o
SDK do Firestore devolveria o cache vazio em silêncio — o script concluiria que
a base está zerada, trataria todos os títulos como novos e imprimiria "gravado"
com as escritas presas numa fila que nunca sai. Com a leitura forçada ao
servidor, ele para antes de tocar em qualquer coisa.

## Alternativa: carga pela tela

1. Zerar as bases legadas em **Importação → Manutenção da base**.
2. **Contas a Receber → Importar** → RFN046 filtrado em `R`.
3. **Contas a Pagar → Importar** → RFN046 filtrado em `P`.
4. Conferir os totais da prévia contra o rodapé do relatório do ERP **antes** de
   gravar. Se não bater aqui, não adianta procurar a diferença depois.
5. Aba **Conciliação** em cada lado: simular, ajustar a régua, aplicar.
6. **Fluxo de Caixa**: conferir o realizado do mês.

## Filtro de período

Toda tela de títulos tem uma barra de período com duas escolhas — e a segunda é
a que costuma faltar nos sistemas:

**Quando:** exercício, mês, trimestre, semestre, últimos 30/90 dias, próximos 30
dias ou intervalo digitado.

**De quê (data-base):** vencimento, pagamento ou emissão.

Um título emitido em 20/05, vencido em 30/06 e pago em 03/07 aparece em três
meses diferentes conforme a régua. Relatório que não diz qual usou é relatório
que ninguém consegue conferir — por isso a barra mostra a base em uso ao lado do
intervalo, e o resumo repete em texto para quem imprime a tela.

Um efeito contraintuitivo, e correto: filtrando por **pagamento**, títulos em
aberto desaparecem, porque ainda não têm data de pagamento. A barra avisa quando
isso zera o resultado.

Intervalos são **fechados dos dois lados**: "até 31/07" inclui o dia 31. Semiaberto
descartaria silenciosamente o último dia do mês, que costuma ser o de maior
movimento.

## Auditoria da base gravada

```bash
npm run auditar:titulos              # confere banco × planilha
npm run auditar:titulos:detalhado    # lista os títulos de cada achado
```

Só lê — auditoria que corrige o que mede deixa de ser auditoria. Oito perguntas:

1. **Faltou?** título da planilha ausente no banco
2. **Sobrou?** título no banco fora da planilha
3. **Bate?** 17 campos conferidos um a um
4. **Duplicou?** dois documentos para o mesmo `Titulo_Codigo`
5. **Fecha?** somatórios em centavos inteiros, planilha × banco
6. **Vinculou?** cobertura do `cod_cliente`
7. **Conciliou?** baixa sem extrato, extrato inexistente, extrato quitando dois
   títulos, baixa em título não pago
8. **Formato antigo?** documentos `mov_*` remanescentes do RFN006

Sai com código 2 se houver erro, para encadear em rotina automática.

**A auditoria se audita:** `npm run test:auditoria-titulos` monta uma base
sintética com oito defeitos plantados e confere se ela encontra todos. Uma
auditoria que nunca acusou nada pode estar funcionando — ou pode estar quebrada
devolvendo "tudo certo" para qualquer entrada.

## Precisão do fluxo de caixa

**Toda soma de dinheiro acumula em centavos inteiros.** Ponto flutuante binário
não representa 0,79 exatamente: somando as 196 entradas, o total sai
`426610.79000000004`. Isso não muda o valor exibido, mas quebra qualquer
comparação automática e reaparece como "diferença de arredondamento" no rodapé.
As duas planilhas reais demonstram o resíduo — e a soma em centavos elimina.

**O saldo encadeado arredonda a cada semana**, não só no fim. O resíduo da S1
entra na S2 e é carregado até dezembro; fechar em centavos a cada elo impede a
projeção de derivar sozinha.

**Régua de semana única.** `weekOfMonthIso` em `periodFilter.ts` serve o fluxo de
caixa e a previsão de títulos. Enquanto cada tela tinha sua cópia, bastava
alguém "melhorar" uma para o mesmo título cair na S3 de um lado e na S4 do
outro. Os cabeçalhos agora mostram o intervalo de dias de cada semana — a S5
cobre 1 a 3 dias e sempre pareceu "fraca" sem essa informação.

**Aritmética de datas em UTC.** Subtrair dois `new Date(...T00:00:00)` locais
erra por uma hora na virada do horário de verão, e o `Math.floor` transforma
essa hora em um dia — títulos pulando de faixa de aging sozinhos, uma vez por
ano.

**Painel "de onde vem cada real".** Abre a composição do realizado: quanto veio
do extrato, quanto veio de título pago sem par no extrato, quanto é previsão, e
a divergência contra o digitado. Quanto mais títulos conciliados, menor a linha
"sem par" — e mais o realizado se apoia em documento bancário em vez de registro
do ERP.

> Divergência zero não significa base completa: significa que o digitado bate
> com o automático. Se o extrato do mês não foi importado inteiro, os dois estão
> igualmente incompletos.

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/types.ts` | `TituloFinanceiro`, `ReconciliationSettings`, `ReconciliationMatch` |
| `src/utils/rfn046Parser.ts` | leitor único das 34 colunas, roteia R/P |
| `src/utils/reconciliation.ts` | motor de baixa automática |
| `src/services/titulosService.ts` | persistência das duas coleções + zeramento |
| `src/components/TitulosWorkspace.tsx` | a tela dos dois lados |
| `src/components/BaseMaintenancePanel.tsx` | zeramento controlado |
| `src/utils/payableForecast.ts` | regras de previsão (agora pelo status) |
| `src/utils/titulosMapping.ts` | tradução título ⇄ documento, compartilhada por app e script |
| `scripts/importTitulosRfn046.mjs` | carga direta no Firestore |
| `src/utils/periodFilter.ts` | período, data-base, semana do mês e soma em centavos |
| `src/components/PeriodFilterBar.tsx` | barra de seleção de período |
| `scripts/auditarTitulos.mjs` | auditoria banco × planilha (+ autoteste) |
| `scripts/testPeriodoPrecisao.mjs` | 54 testes de período e precisão monetária |
