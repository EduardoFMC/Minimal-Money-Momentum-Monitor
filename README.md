# M⁴ — Minimal Money Momentum Monitor

App desktop **leve e minimalista** para acompanhar despesas, investimentos e ativos monitorados.
Feito com **Tauri 2 + React** (WebView2 nativo do Windows — sem Electron, ~10 MB).

Todos os dados ficam **100% locais**, num único arquivo JSON.

## Seções

| Aba | O que faz |
|---|---|
| **Despesas** | Entradas e saídas estilo app de banco: categorias, busca, filtro de assinaturas, gráfico por categoria (rosca), gasto por semana e entradas × saídas por mês. Assinaturas marcadas com ↻ são **lançadas automaticamente** a cada mês novo. Importação de **extrato OFX** com categoria sugerida e deduplicação. |
| **Investimentos** | **Renda fixa** (CDB, LCI, Tesouro Direto…) com **valor atual estimado automaticamente** via CDI/Selic/IPCA do Banco Central (bruto + líquido de IR; LCI/LCA isentas). **Renda variável** (ações, FIIs, cripto, moedas, opções) com quantidade, preço médio e P/L. Quantidade negativa = perna vendida (travas/spreads). Gráfico de **evolução do patrimônio** (snapshot diário). |
| **Monitoramento** | Watchlist do que você ainda não comprou: ações, cripto, dólar/moedas, CDBs de outras corretoras… com preço-alvo e alerta visual quando atingido. |
| **⚙ Configurações** | Paleta de cores customizável (presets + cor a cor, estilo Fan Control), token da brapi, categorias, backup. |

Todo ativo aceita **atributos extras** livres (chave → valor), tipo ficha de personagem —
útil para strike/vencimento de opções, taxa de CDB monitorado etc.

## Cotações automáticas

- **Ações e FIIs (B3)**: [brapi.dev](https://brapi.dev) — crie um token gratuito em `brapi.dev/dashboard` e cole em ⚙ Configurações.
- **Cripto**: [CoinGecko](https://coingecko.com) — sem token. Use o *ID* da moeda como ticker (`bitcoin`, `ethereum`, `solana`…).
- **Moedas**: [AwesomeAPI](https://docs.awesomeapi.com.br) — sem token. Ticker no formato `USD-BRL`, `EUR-BRL`.
- **Renda fixa**: séries públicas do [Banco Central (SGS)](https://api.bcb.gov.br) — CDI diário, Selic e IPCA — para estimar o valor atual de CDBs/LCIs/Tesouro sem digitar nada. Estimativa bruta + líquida de IR (tabela regressiva; LCI/LCA/CRI/CRA detectadas pelo nome como isentas). O valor manual em "Valor atual" sempre tem prioridade.
- **Opções (calls/puts/travas)**: sem API gratuita confiável — preço atualizado manualmente direto no card (campo tracejado).

Cotações atualizam ao abrir o app, **automaticamente em intervalo configurável** (padrão 5 min),
ao voltar o foco para a janela, no botão **↻** ou com **F5** / **Ctrl+R**.

### Banco Inter (conta PF)

A API oficial do Inter ([developers.inter.co](https://developers.inter.co)) — Banking com
extrato/saldo, Pix e Cobranças — **exige conta PJ** ("é necessário ser um cliente Inter PJ").
Para conta física não há API. O caminho suportado pelo app é a **importação OFX**:
no app do Inter, Extrato → Compartilhar → OFX, e depois ⚙ Configurações → Importar extrato OFX.
Se um dia houver conta PJ, a integração usaria OAuth2 + certificado mTLS nos endpoints de extrato.

> ⚠️ Opção/spread deve ser cadastrado com o tipo **Opção** — se cadastrar como Ação com
> ticker do papel (ex.: PETR4), o app vai puxar a cotação da **ação** e inflar o resultado.

Campos de dinheiro usam máscara estilo Pix: digite só números e os centavos entram
da direita para a esquerda (`4590` → `45,90`). Categorias têm busca com lista alfabética.

## Dados e backup

- Arquivo: `%APPDATA%\br.com.eduardo.m4\data.json` (caminho exato exibido em ⚙ Configurações).
- Gravação atômica com `fsync` (à prova de desligamento no meio da escrita).
- Ao fechar a janela, alterações pendentes são gravadas antes de encerrar.
- A cada gravação o arquivo anterior vira `data.bak.json`, e o app guarda **um backup por dia
  (14 dias)** na pasta `backups\`. Se `data.json` corromper, o backup mais recente é
  restaurado automaticamente na abertura; se nada puder ser lido, o app mostra uma tela de
  erro e **não grava nada por cima**.
- **Exportar/Importar backup** em ⚙ Configurações gera/lê um `.json` que você pode guardar onde quiser (Drive, pendrive…).

## Desenvolvimento

Pré-requisitos: Node 18+, Rust (toolchain MSVC), WebView2 (já vem no Windows 10/11).

```sh
npm install
npm run tauri dev     # roda o app em modo dev (hot reload)
npm run tauri build   # gera o .exe + instalador NSIS em src-tauri/target/release/
npm run dev           # só a UI no navegador (dados em localStorage, para testes)
```

## Stack

- [Tauri 2](https://tauri.app) — janela nativa + backend Rust (arquivo, HTTP, diálogos)
- React 18 + Vite — UI (sem lib de gráficos: SVG feito à mão)
- Zero dependências de UI externas — CSS puro com variáveis de tema
