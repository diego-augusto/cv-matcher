# CV Matcher

Extensão do Chrome que gera um currículo adaptado à vaga aberta na aba atual, usando o Claude.

Ela lê o texto da página, combina com o seu currículo completo e devolve uma versão de até duas páginas que destaca o que é mais relevante para aquela vaga, pronta para salvar em PDF.

## Instalação

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta.

## Configuração

Em `chrome://extensions`, abra **Detalhes → Opções da extensão** e preencha:

- **Chave da API da Anthropic** (`sk-ant-...`), criada em [platform.claude.com](https://platform.claude.com).
- **Seu currículo completo**, em texto ou Markdown. Cole tudo: experiências, projetos, skills, formação e contatos. A extensão só usa o que estiver aqui, então quanto mais completo, melhor a seleção para cada vaga.

## Uso

1. Abra a página de uma vaga (qualquer site).
2. Clique no ícone da extensão.
3. Aguarde a geração na nova aba (cerca de um minuto).
4. Clique no texto para ajustar o que quiser.
5. Clique em **Imprimir / Salvar PDF**.

## Regras de geração

- **Sem invenção:** o modelo seleciona, reordena e reescreve o que está no seu currículo, mas não acrescenta experiência, skill ou resultado que você não declarou.
- **Idioma:** o currículo sai no idioma em que a vaga está escrita.
- **Página como dado:** instruções que apareçam no texto da página são ignoradas.

Para mudar essas regras, edite a constante `SYSTEM` em `result.js`.

## Arquivos

| Arquivo | Função |
|---|---|
| `manifest.json` | Manifesto da extensão (Manifest V3). |
| `background.js` | No clique do ícone, captura o texto da aba e abre a página de resultado. |
| `options.html`, `options.js` | Tela de configurações (chave e currículo). |
| `result.html`, `result.js` | Chama a API do Claude, renderiza o currículo e cuida da impressão. |

Não há etapa de build nem dependências.

## Modelo e custo

A extensão usa `claude-opus-5-5`. Cada geração envia seu currículo e o texto inteiro da página, e é cobrada na sua conta da Anthropic. Para trocar de modelo, altere o campo `model` em `result.js`.

## Privacidade

- A chave e o currículo ficam em `chrome.storage.local`, sem criptografia, apenas neste navegador.
- Os dados são enviados somente para `api.anthropic.com`.
- A extensão só lê a página quando você clica no ícone (permissão `activeTab`).

## Limitações

- Páginas internas do Chrome (`chrome://`, Web Store) não podem ser lidas.
- Vagas que carregam a descrição dentro de um iframe podem vir sem o texto; nesse caso, abra a vaga em página própria.
- Sem histórico: cada clique gera um currículo novo e substitui o anterior.
