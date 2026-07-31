# Deploy — Paris Dakar Gerencial

## Deploy automático (recomendado) — configurar uma única vez

A partir deste commit, todo push na branch `main` publica sozinho no Firebase
Hosting e atualiza as regras do Firestore via GitHub Actions
(`.github/workflows/deploy.yml`). Falta um passo manual, que só se faz uma vez:
cadastrar a credencial de publicação como secret do repositório.

### 1. Gerar a chave da service account

1. Abra o [Console do Google Cloud — Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=paris-dakar-gerencial)
   do projeto `paris-dakar-gerencial`.
2. Se não existir uma service account para deploy, crie uma (nome sugerido:
   `github-actions-deploy`) e conceda os papéis **Firebase Hosting Admin** e
   **Cloud Datastore/Firestore — Firestore Service Agent** (ou, mais simples,
   o papel **Editor** do projeto, se preferir não detalhar permissões).
3. Na service account, vá em **Chaves** → **Adicionar chave** → **Criar nova
   chave** → tipo **JSON**. Isso baixa um arquivo `.json` — guarde-o só até o
   próximo passo e depois apague do computador.

### 2. Cadastrar o secret no GitHub

1. Vá em `https://github.com/rorimlima/parisgerencial/settings/secrets/actions`.
2. **New repository secret**.
3. Nome: `FIREBASE_SERVICE_ACCOUNT` (exatamente assim — o workflow procura por
   este nome).
4. Valor: cole o **conteúdo inteiro** do arquivo `.json` baixado no passo 1.
5. Salvar.

Pronto. A partir daqui, todo `git push` na `main` (incluindo os que eu fizer)
builda, roda a suíte de testes e publica sozinho. Você pode acompanhar em
`https://github.com/rorimlima/parisgerencial/actions`.

**Segurança:** esse arquivo `.json` dá permissão de publicação no projeto
inteiro. Não o envie por e-mail nem o deixe em pasta compartilhada — o único
lugar onde ele deve existir é dentro do secret do GitHub (que nem os
colaboradores conseguem ler de volta, só sobrescrever).

## Publicar manualmente (sem esperar o Actions, ou enquanto o secret não está configurado)

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
