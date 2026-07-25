# Consultoria Financeira — Paris Dakar
### Varredura das bases de Faturamento (RPR014) e Estoque (RPR053)
**Data-base:** 24/07/2026 · **Emitido em:** 25/07/2026

---

## Sobre as fontes e o que elas permitem (e não permitem) afirmar

| Base | Arquivo | Cobertura | Registros |
|---|---|---|---|
| Faturamento | `RPR014_NOTAFISCAL` | 29/10/2020 a 24/07/2026 | 29.320 linhas · 18.288 notas · 3.989 clientes |
| Estoque / Lista de preço | `RPR053_LISTAPRECO` | Posição pontual (fotografia) | 5.188 SKUs |

**Três limites que condicionam tudo o que segue — e que você deve ter em mente antes de agir sobre qualquer número:**

1. **O RPR014 traz o valor da nota, não o custo do que foi vendido.** Não existe CMV real nesta base. Onde o CMV aparece abaixo, ele é *estimado* a partir do markup médio do estoque (52,68%). É uma boa aproximação para dimensionar giro, mas **não substitui o CMV contábil** do módulo de DRE.
2. **O estoque é uma fotografia de um único dia.** Giro calculado sobre uma fotografia assume que a posição de hoje representa o estoque médio do ano. Se houve compra ou liquidação grande recentemente, o número distorce. Para acompanhar de verdade, é preciso importar o RPR053 mensalmente — o sistema já guarda o histórico de cada carga.
3. **Julho/2026 está incompleto** (dados até o dia 24). Nenhuma comparação abaixo usa julho como mês fechado.

---

## 1. Receita: a queda é real, mas menor do que parece à primeira vista

### Memória de cálculo

**1.1 — Últimos 12 meses fechados contra os 12 anteriores**

```
Janela A (jul/2025 a jun/2026) ......... R$ 7.070.742,84
Janela B (jul/2024 a jun/2025) ......... R$ 8.096.236,25
                                         ─────────────────
Variação = (7.070.742,84 ÷ 8.096.236,25) − 1 = −12,67%
Perda absoluta ......................... R$ 1.025.493,41
```

**1.2 — Ano corrente contra o mesmo período do ano anterior (jan–jun, meses completos)**

```
jan–jun/2026 ........................... R$ 3.443.484,82
jan–jun/2025 ........................... R$ 3.657.418,86
                                         ─────────────────
Variação = (3.443.484,82 ÷ 3.657.418,86) − 1 = −5,85%
```

**1.3 — Julho/2026 parcial, comparado dia a dia**

```
jul/2026, dias 1 a 24 .................. R$   396.252,85  (21 dias com movimento)
jul/2025, dias 1 a 24 .................. R$   552.059,85
                                         ─────────────────
Variação no mesmo intervalo ............ −28,22%
Média diária jul/26 = 396.252,85 ÷ 21 = R$ 18.869,18/dia
```

**Leitura.** A queda de 12 meses (−12,67%) é puxada pelo segundo semestre de 2025, não pelo desempenho recente: no acumulado do ano a retração é de apenas 5,85%, e março, abril e maio de 2026 vieram **acima** de 2025 (+15,4%, +10,5% e +13,0%). O que preocupa é o padrão dos dois últimos meses: junho fechou −14,3% e julho está −28,2% no comparativo dia a dia. **Dois meses seguidos de queda de dois dígitos depois de um trimestre positivo não é sazonalidade — é sinal para investigar agora**, não no fechamento do mês.

**Ação (esta semana):** puxe as notas de junho e julho na aba Faturamento → *Notas fiscais* e compare com maio por vendedor. Se a queda estiver concentrada em um vendedor ou em um punhado de clientes, é problema pontual e recuperável. Se estiver distribuída, é demanda de mercado e exige revisão de meta e de despesa fixa.

---

## 2. Estoque: aqui está o dinheiro — R$ 3,06 milhões parados

### Memória de cálculo

**2.1 — Valor imobilizado**

```
Valor a custo de reposição (Σ qtde × ValorReposicao) ..... R$ 3.064.370,67
Valor a preço de venda    (Σ qtde × ValorVenda) .......... R$ 4.678.568,55
Margem bruta potencial ................................... R$ 1.614.197,88
Markup implícito = (4.678.568,55 ÷ 3.064.370,67) − 1 ..... 52,68%
Margem sobre venda = 1.614.197,88 ÷ 4.678.568,55 ......... 34,50%
```

**2.2 — Giro do estoque**

```
CMV estimado 12m = Receita ÷ (1 + markup)
                 = 7.070.742,84 ÷ 1,5268 = R$ 4.631.087,79

Giro = CMV ÷ estoque a custo = 4.631.087,79 ÷ 3.064.370,67 = 1,51 vez/ano
Cobertura = 365 ÷ 1,51 = 242 dias de estoque
```

**Leitura.** **242 dias — oito meses de estoque.** Para uma operação de peças, acessórios e pneus, o referencial de mercado fica entre 90 e 120 dias. Cada dia a mais de cobertura é dinheiro que saiu do caixa e ainda não voltou.

**Quanto isso custa em dinheiro:** reduzir a cobertura de 242 para 150 dias liberaria

```
Estoque-alvo = CMV × (150 ÷ 365) = 4.631.087,79 × 0,41096 = R$ 1.903.187
Caixa liberado = 3.064.370,67 − 1.903.187 = R$ 1.161.183
```

**R$ 1,16 milhão de caixa** que hoje está em prateleira. Mesmo uma redução parcial — digamos, para 180 dias — libera cerca de R$ 780 mil.

**2.3 — Onde o capital está parado**

| Categoria | SKUs c/ saldo | Valor a custo | % do capital | % acumulado |
|---|---:|---:|---:|---:|
| RODAS E CALOTAS | 229 | R$ 1.248.727,71 | 40,7% | 40,7% |
| PNEUS E CÂMERAS | 267 | R$ 770.288,02 | 25,1% | 65,9% |
| USADOS (RECEBIDOS) | 118 | R$ 241.236,30 | 7,9% | 73,8% |
| RODA USADA | 64 | R$ 209.573,20 | 6,8% | 80,6% |
| PEÇAS NÃO ORIGINAIS | 100 | R$ 108.253,75 | 3,5% | 84,1% |
| KIT TRANSF NOVO | 10 | R$ 86.841,90 | 2,8% | 86,9% |
| Demais 17 categorias | 366 | R$ 399.449,79 | 13,1% | 100% |

**Duas conclusões operacionais:**

- **Rodas + pneus = 65,9% de todo o capital em estoque** (R$ 2,02 milhões) em apenas 496 SKUs. Qualquer política de redução de estoque que não comece por essas duas categorias é conversa fiada — mexer nas outras vinte categorias juntas resolve um terço do problema.
- **Usados (recebidos + roda usada) = R$ 450.809,50, 14,7% do capital, em 182 SKUs.** Este é o estoque de maior risco: item de troca não tem reposição, envelhece sem giro e não costuma ter preço de mercado claro. É o primeiro candidato a liquidação — mesmo com desconto agressivo, transformar R$ 450 mil em caixa é melhor do que carregá-los por mais um ano.

**2.4 — O cadastro de produtos está inflado**

```
SKUs cadastrados ......................... 5.188
SKUs com saldo disponível ................ 1.154   (22,2%)
SKUs zerados ............................. 4.034   (77,8%)
```

Quatro de cada cinco produtos cadastrados não têm saldo. Isso não é erro financeiro, mas é atrito diário: contagem, busca, listagem de preço e conferência ficam mais lentas para todo mundo. Vale um expurgo de itens sem saldo e sem venda nos últimos 24 meses.

**2.5 — A curva ABC do ERP está abandonada**

```
Classificação ABC por VENDA:
  Sem classificação .... 4.987 SKUs (96,1%)
  C .................... 200
  A .................... 1
```

Um único produto classificado como "A" em 5.188. **A curva ABC não está sendo mantida no ERP** — e sem ela não existe política de estoque mínimo, nem priorização de compra, nem critério objetivo para decidir o que liquidar. Reprocessar a classificação ABC no ERP é uma tarefa de configuração, não de investimento, e é pré-requisito para qualquer meta de giro.

---

## 3. Concentração de receita: dois riscos distintos

### 3.1 — Concentração em clientes (janela jul/25–jun/26)

```
Clientes ativos no período ............... 1.100
 20% da receita concentrada em ...........   10 clientes (0,9% da base)
 50% da receita concentrada em ...........   92 clientes (8,4% da base)
 80% da receita concentrada em ..........   338 clientes (30,7% da base)
```

| # | Cliente | Receita 12m | % |
|---|---|---:|---:|
| 1 | PARIS DAKAR AUTOMOVEIS LTDA | R$ 632.371,04 | 8,94% |
| 2 | JERRY FAÇANHA PEREIRA | R$ 167.544,00 | 2,37% |
| 3 | JOSE GUSTAVO BROL FISCH | R$ 106.678,00 | 1,51% |
| 4 | DANIEIDES DAS NEVES SOUSA | R$ 100.800,00 | 1,43% |
| 5 | DRIVE CAR COMERCIO DE VEICULOS | R$ 80.691,00 | 1,14% |

**Ponto de atenção que exige decisão sua, não do sistema:** o maior "cliente" é a **Paris Dakar Automóveis LTDA** — R$ 632.371,04, 8,94% do faturamento. Isso é venda entre empresas do mesmo grupo. Duas consequências práticas:

- **A receita externa real é R$ 6.438.371,80, não R$ 7.070.742,84.** Toda meta comercial e todo cálculo de ponto de equilíbrio deveriam usar a receita externa; caso contrário, uma parcela do resultado é apenas dinheiro trocando de bolso dentro do grupo.
- **O giro recalculado sobre a receita externa piora:** CMV externo ≈ 6.438.371,80 ÷ 1,5268 = R$ 4.216.907, giro = 1,38x, **cobertura de 265 dias**.

Fora a intercompany, a concentração é saudável: nenhum cliente externo passa de 2,4%. **Não há risco de dependência de cliente** — o risco está do outro lado, no item 3.2.

### 3.2 — Concentração na equipe comercial

| Vendedor | Receita 12m | % | Notas | Ticket médio |
|---|---:|---:|---:|---:|
| REGIS | R$ 4.027.333,32 | 57,0% | 1.493 | R$ 2.697,48 |
| ALOISIO | R$ 2.383.107,88 | 33,7% | 1.243 | R$ 1.917,22 |
| ADEFABIO | R$ 647.398,64 | 9,2% | 1.041 | R$ 621,90 |
| Demais | R$ 12.903,00 | 0,2% | 11 | — |

```
Concentração nos dois primeiros = 57,0% + 33,7% = 90,7% da receita
```

**Este é o maior risco isolado do negócio.** Nove em cada dez reais faturados passam por duas pessoas. A saída de qualquer uma delas — doença, concorrência, desligamento — leva junto de um terço a metade da receita, e a carteira vai junto porque o relacionamento é pessoal, não institucional.

Repare também no contraste de ticket: Adefabio emite quase o mesmo número de notas que Aloisio (1.041 contra 1.243) faturando **um quarto** do valor (R$ 621,90 contra R$ 1.917,22 por nota). Isso não significa necessariamente baixo desempenho — pode ser atendimento de balcão de baixo valor. Mas significa que **o custo de atendimento por real faturado é três vezes maior** nesse canal, e isso precisa entrar na conta de remuneração e de dimensionamento de equipe.

**Ações:** (a) documentar as carteiras dos dois principais vendedores no cadastro de clientes do sistema, com contato e histórico, para que o relacionamento deixe de ser exclusivamente pessoal; (b) estruturar um plano de sucessão comercial; (c) revisar se o modelo de comissão está reforçando a concentração.

---

## 4. Retenção: metade dos clientes some depois da primeira compra

### Memória de cálculo

```
Clientes que compraram no período ........ 1.100
  Compraram 1 única vez ..................   502  (45,6%)
  Compraram 2 a 3 vezes ..................   457  (41,5%)
  Compraram 4 ou mais vezes ..............   141  (12,8%)

Receita gerada pelos compradores de uma vez só = R$ 1.393.922,77 (19,7%)
```

**Leitura.** Quase metade da base é de passagem única, e isso representa quase 20% do faturamento. Em oficina e peças, o cliente que volta é o que sustenta a operação: adquirir cliente novo custa muito mais do que fazer o atual voltar.

**O cálculo do que está em jogo:** se 10% dos 502 clientes de compra única voltassem uma segunda vez, ao ticket médio de R$ 1.866,62:

```
50 clientes × 1 compra × R$ 1.866,62 = R$ 93.331 de receita incremental
```

Sem contratar ninguém, sem comprar estoque novo, sem desconto. É a intervenção de melhor relação custo/retorno disponível hoje. **Requisito:** o cadastro precisa ter telefone e e-mail — o que nos leva ao item 6.

---

## 5. Mix de canal: o balcão fatura mais por atendimento

```
CLIENTE OFICINA .... R$ 5.863.429,74 (82,9%) · 3.370 notas · ticket R$ 1.739,89
CLIENTE BALCÃO ..... R$ 1.207.313,10 (17,1%) ·   418 notas · ticket R$ 2.888,31
```

O balcão tem **ticket 66% maior** que a oficina (2.888,31 ÷ 1.739,89 = 1,66) mas responde por apenas 17,1% da receita. Vale entender por quê: se o balcão vende rodas e pneus (que são 66% do estoque parado), ampliar esse canal ataca dois problemas ao mesmo tempo — receita e giro. Este é o teste que eu faria antes de qualquer campanha de liquidação.

---

## 6. Controles: dois furos que travam a gestão de crédito

### 6.1 — A condição de pagamento não é registrada

```
Condição de pagamento nas notas dos últimos 12 meses:
  "MIGRACAO (PECAS / SERVICOS)" ......... 100,0% da receita
```

Em 2023, 2024, 2025 e 2026 o resultado é o mesmo: **100% das notas saem com a condição de pagamento genérica de migração de sistema.** Na prática, o ERP não sabe o que foi vendido à vista e o que foi vendido a prazo.

**Por que isso é grave, e não um detalhe cadastral:** sem condição de pagamento não existe previsão de recebimento, não existe prazo médio de recebimento (PMR), não dá para projetar fluxo de caixa a partir da venda, e não dá para avaliar se a inadimplência vem de um vendedor, de um prazo ou de um perfil de cliente. É a informação que liga faturamento a caixa — e ela está em branco há três anos.

**Ação:** corrigir o cadastro de condições de pagamento no ERP e passar a exigir o preenchimento na emissão. É configuração, custa zero, e destrava o cálculo de PMR e a projeção de recebíveis dentro do sistema.

### 6.2 — Os impostos não estão na nota

```
Impostos destacados nos últimos 12 meses ...... R$ 17.044,54 (0,24% da receita)
  ISS ......................................... R$ 17.044,54
  ICMS, ICMS-ST, PIS, COFINS, IPI, CSLL ....... R$ 0,00
```

O padrão é compatível com **Simples Nacional** (tributo recolhido em guia única, sem destaque na nota). Não é erro — mas significa que **a carga tributária real não pode ser lida do faturamento**. Ao montar o DRE no módulo de Resultado Econômico, o imposto precisa entrar como lançamento próprio, a partir do DAS. Se hoje o DRE está usando o campo de impostos da nota, ele está subestimando a carga em praticamente todo o valor do DAS.

---

## 7. Plano de ação, por retorno sobre esforço

| # | Ação | Impacto estimado | Prazo | Esforço |
|---|---|---|---|---|
| 1 | Liquidar estoque de usados (R$ 450 mil em 182 SKUs) | Caixa imediato | 60 dias | Baixo |
| 2 | Meta de cobertura de 180 dias em rodas e pneus | ~R$ 780 mil de caixa | 6 meses | Médio |
| 3 | Corrigir condição de pagamento no ERP | Destrava PMR e projeção de caixa | 15 dias | Baixo |
| 4 | Reprocessar curva ABC no ERP | Base para política de estoque mínimo | 30 dias | Baixo |
| 5 | Campanha de reativação dos 502 clientes de compra única | ~R$ 93 mil de receita | 90 dias | Baixo |
| 6 | Investigar a queda de junho e julho por vendedor | Contenção de perda | Imediato | Baixo |
| 7 | Documentar carteiras e plano de sucessão comercial | Mitiga o risco de 90,7% | 90 dias | Médio |
| 8 | Separar receita intercompany das metas comerciais | Correção de 8,94% na base de meta | 30 dias | Baixo |
| 9 | Expurgar SKUs sem saldo e sem venda em 24 meses | Ganho operacional | 60 dias | Médio |

**Se for para escolher três:** as ações 1, 3 e 6. A primeira gera caixa sem depender de venda nova, a terceira custa quinze dias de configuração e destrava toda a gestão de recebíveis, e a sexta é urgente por definição — dois meses de queda de dois dígitos não esperam o próximo fechamento.

---

## Anexo — Fórmulas usadas

| Indicador | Fórmula | Resultado |
|---|---|---|
| Markup do estoque | (Valor a venda ÷ Valor a custo) − 1 | 52,68% |
| Margem sobre venda | (Venda − Custo) ÷ Venda | 34,50% |
| CMV estimado 12m | Receita ÷ (1 + markup) | R$ 4.631.087,79 |
| Giro de estoque | CMV ÷ Estoque a custo | 1,51 x/ano |
| Cobertura em dias | 365 ÷ Giro | 242 dias |
| Estoque-alvo (n dias) | CMV × (n ÷ 365) | R$ 1.903.323 (150 dias) |
| Ticket médio | Receita ÷ Notas distintas | R$ 1.866,62 |
| Concentração (Pareto) | Receita acumulada ordenada ÷ Receita total | 50% em 92 clientes |
| Variação comparável | (Período atual ÷ Mesmo período anterior) − 1 | −5,85% (jan–jun) |

**Convenção adotada:** todas as janelas de 12 meses referem-se a **jul/2025 – jun/2026** (meses completos). Julho/2026 é usado apenas nas comparações dia a dia, sempre identificadas como tal.

---

*Documento gerado a partir das bases importadas no Paris Dakar Gerencial. Os números de faturamento e estoque são conferíveis nas abas **Faturamento** e **Estoque** do sistema. As estimativas de CMV e giro dependem do markup do estoque como proxy de margem — substitua-as pelo CMV contábil assim que ele estiver lançado no módulo de Resultado Econômico.*
