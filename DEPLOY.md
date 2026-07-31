# Deploy — Paris Dakar Gerencial

## Publicar agora (build já está pronto em `dist/`)

Abra o PowerShell na pasta do projeto e rode:

```powershell
cd C:\Users\ELIELETRO\Desktop\PROJETOS\parisdakargerencial
npx firebase-tools@latest deploy --only hosting,firestore:rules
```

Se pedir login, rode antes `npx firebase-tools@latest login`.

### Por que `firestore:rules` junto e não só `hosting`

O módulo de negociação grava numa coleção nova, `acordos_negociacao`. A regra
de acesso dela foi adicionada em `firestore.rules` neste commit. Se você
publicar só o hosting, a tela sobe mas **toda gravação de acordo é negada pelo
Firestore** — o usuário fecha a negociação, aparenta salvar e nada persiste.
As duas coisas precisam ir juntas.

## Se quiser reconstruir do zero antes de publicar

```powershell
npm run build
npx firebase-tools@latest deploy --only hosting,firestore:rules
```

## Conferência pós-deploy

1. Menu lateral → grupo **Operacional** → item **Inadimplência & Negociação**
   (entre Contas a Receber e Contas a Pagar).
2. Aba **Títulos Vencidos** → botão de aperto de mão em qualquer linha →
   o modal de negociação abre com o cronograma já calculado.
3. Feche um acordo de teste com entrada e 3 parcelas e confira o selo verde
   "Entrada + parcelas = ... confere com o total acordado".
4. Aba **Acordos de Negociação** → dê baixa numa parcela e confirme que o
   status muda sozinho.
5. Apague o acordo de teste (botão da lixeira, disponível para admin/gestor).

## Testes automatizados do motor de cálculo

```powershell
npm run test:negociacao   # só a negociação (41 asserts)
npm test                  # toda a suíte
```
