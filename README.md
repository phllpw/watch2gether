# Watch2Gether 🎬

Um MVP web moderno para duas pessoas assistirem a vídeos em salas compartilhadas com chat e sincronização quando o player permitir.

Construído utilizando **React**, **TypeScript**, **Vite**, **CSS Puro** (sem Tailwind) e **Firebase Realtime Database**.

---

## 🚀 Recursos

- 🌓 **Tema Dark Obsidian:** Interface moderna e imersiva inspirada em bibliotecas de design premium (Magic UI, Kokonut UI, etc.).
- 🔄 **Sincronização em Tempo Real:** Comandos de Play, Pause e Progresso (Seek) são sincronizados instantaneamente para ambos os participantes no player HTML5 (Modo HTML5).
- 📁 **Suporte ao Google Drive (Experimental):**
  - Tenta converter o link compartilhável do Drive em um stream direto compatível com o player HTML5.
  - Se o stream falhar ou for bloqueado por antivírus do Drive, ativa fallback automático para a visualização original em `iframe` (Modo Iframe), onde apenas o chat permanece sincronizado.
- 💬 **Chat em Tempo Real:** Converse com seu parceiro de maratona com nicknames personalizados.
- ⚡ **Modo Demo (Offline):** Se você não configurar o Firebase, o app entra em modo de demonstração local, simulando mensagens e permitindo testar a interface imediatamente.
- 📱 **Mobile Responsivo:** O player se adapta perfeitamente, empilhando o chat abaixo do vídeo em telas menores e posicionando-o lateralmente em desktops.

---

## 🛠️ Configuração e Execução

### 1. Clonar ou Acessar o Projeto
Navegue até o diretório do projeto:
```bash
cd drive-watch-party
```

### 2. Instalar Dependências
```bash
npm install
```

### 3. Configurar o Firebase Realtime Database (Opcional, mas necessário para Sync real)
1. Crie um projeto no console do [Firebase](https://console.firebase.google.com/).
2. Adicione um **Web App** ao projeto e obtenha suas credenciais.
3. No painel lateral, vá em **Realtime Database** e crie um banco de dados.
4. Defina as regras de segurança do banco para desenvolvimento (MVP sem autenticação):
   ```json
   {
     "rules": {
       ".read": "true",
       ".write": "true"
     }
   }
   ```
   *Nota: Lembre-se de restringir as regras se colocar o app em produção comercial.*

5. Copie o arquivo `.env.example` para `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
6. Preencha as chaves no arquivo `.env.local` com as credenciais copiadas do console do Firebase.

### 4. Rodar em Desenvolvimento
```bash
npm run dev
```
O servidor estará rodando localmente (geralmente em `http://localhost:5173`).

### 5. Compilar para Produção
```bash
npm run build
```

---

## 💡 Dicas de Uso

### Links do Google Drive
Para usar vídeos do Google Drive:
1. Certifique-se de que a visibilidade do arquivo no Drive esteja configurada como **"Qualquer pessoa com o link"** (Leitor).
2. Cole o link no formato padrão: `https://drive.google.com/file/d/ID_DO_ARQUIVO/view?usp=sharing`.
3. O player tentará carregar o stream direto. Se o Google bloquear ou exigir verificação de vírus (comum para arquivos maiores que 100MB), o player ativará o **Modo Google Drive iframe** automaticamente.
   - *Nota no Modo Iframe:* Por segurança do navegador, o app não consegue controlar play, pause ou tempo automaticamente nesse modo. Use os botões internos do player do iframe para assistir, enquanto conversa pelo chat em tempo real.
4. Para sincronização automática perfeita de play/pause/seek, use links diretos de arquivos de vídeo MP4/WebM.

---

## 🔍 Diagnóstico de Sincronização

Se você encontrar problemas com a reprodução simultânea, siga este roteiro de diagnóstico:

1. **Teste Primeiro com o Vídeo Local de Teste:**
   - Adicione no player o caminho local: `/test-video.mp4` (ou cole a URL `http://localhost:5173/test-video.mp4`).
   - Se o vídeo carregar em modo HTML5 e os controles (play, pause, seek) sincronizarem entre as duas abas, **a infraestrutura do Firebase Realtime Database e o motor de sincronização estão 100% corretos.**
2. **Entenda o Comportamento do Google Drive:**
   - Se ao colocar um link do Google Drive ele abrir, mas os controles não sincronizarem automaticamente, o player caiu no **Modo Iframe**. Isso ocorre por restrições de segurança de domínio cruzado (CORS) aplicadas pelo próprio Google Drive (especialmente em arquivos maiores de 100MB que exigem confirmação de vírus).
3. **Alternativas para Sync Real em Arquivos Grandes:**
   - Obtenha um link direto de streaming que não seja envelopado em iframe (ex: arquivos hospedados em servidores com suporte a CORS, buckets de Storage públicos, ou servidores WebDAV).

---

## 🔑 Configuração do Google Cloud Console (Google Drive & Picker)

Para habilitar a seleção direta de arquivos de vídeo e streaming nativo em HTML5 usando tokens individuais de usuário:

### 1. Criar Projeto no Google Cloud
- Acesse o [Google Cloud Console](https://console.cloud.google.com/).
- Crie um novo projeto (ou selecione um projeto existente).

### 2. Ativar APIs Necessárias
- No menu lateral, acesse **APIs & Services** > **Library**.
- Busque e ative a **Google Picker API**.
- Busque e ative a **Google Drive API** (necessária para reprodução nativa `alt=media`).

### 3. Configurar Tela de Consentimento OAuth
- Vá em **APIs & Services** > **OAuth consent screen**.
- Selecione o tipo de usuário (**External** para testes gerais) e preencha as informações básicas do aplicativo.
- Na aba **Scopes** (Escopos), adicione o escopo específico:
  `https://www.googleapis.com/auth/drive.readonly` (Acesso somente leitura aos arquivos do Drive).
- Na aba **Test Users** (Usuários de teste), adicione o seu e-mail do Google (e de quem for testar com você) para autorizar logins em modo de desenvolvimento.

### 4. Criar Credenciais
- Acesse **APIs & Services** > **Credentials**.
- Clique em **Create Credentials**:
  1. **API Key**: Crie uma chave de API. Recomenda-se restringir seu uso para a *Google Picker API* e restringir as origens de HTTP para `http://localhost:*`. Use este valor na variável `VITE_GOOGLE_API_KEY`.
  2. **OAuth Client ID**: Crie um ID do cliente OAuth.
     - Selecione o tipo de aplicativo: **Web Application**.
     - Nome: `Watch2Gether Dev`.
     - Sob **Authorized JavaScript origins** (Origens JavaScript autorizadas), adicione exatamente:
       `http://localhost:5173`
     - Obtenha o Client ID e use este valor na variável `VITE_GOOGLE_CLIENT_ID`.

### 5. Obter o Project Number (App ID)
- No topo esquerdo do painel do Google Cloud Console (próximo ao nome do seu projeto), clique na lista de projetos.
- Localize o **Project Number** do seu projeto. Use este número (apenas dígitos numéricos) na variável `VITE_GOOGLE_APP_ID`.

### 6. Atualizar o arquivo `.env.local`
Adicione as variáveis ao `.env.local` e reinicie o servidor local:
```env
VITE_GOOGLE_CLIENT_ID=seu_client_id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=sua_api_key_aqui
VITE_GOOGLE_APP_ID=seu_project_number_aqui
VITE_DRIVE_STREAM_BASE_URL=http://localhost:5001/watch2gether-9b6dd/us-central1/driveStream
```

---

## ⚡ Backend Proxy de Streaming (Google Drive Cloud Function) - Fase 3

Para contornar as restrições de CORS e carregar os vídeos do Drive nativamente no player HTML5 `<video>`, implementamos uma Cloud Function HTTP v2 chamada `driveStream`. Ela recebe o ID do arquivo e o token de acesso temporário do usuário logado, repassando a requisição para a Google Drive API com suporte a **Range Requests** (206 Partial Content), permitindo buffer e seek de tempo contínuos.

### Executando o Emulador Localmente
1. Certifique-se de ter o Firebase CLI instalado:
   ```bash
   npm install -g firebase-tools
   ```
2. Instale as dependências da pasta `functions` e compile o TypeScript:
   ```bash
   cd functions
   npm install
   npm run build
   cd ..
   ```

3. **Terminais Necessários para Desenvolvimento:**
   Para rodar o projeto localmente com suporte ao streaming proxy, você deve abrir **dois terminais distintos**:
   
   - **Terminal 1: Frontend App**
     ```bash
     npm run dev
     ```
   - **Terminal 2: Firebase Cloud Functions Emulator**
     ```bash
     firebase emulators:start --only functions --project watch2gether-9b6dd
     ```
     *Nota:* O emulador de funções ficará rodando de forma **contínua** no terminal, interceptando e tratando as requisições de proxy do player, até que você o finalize pressionando `Ctrl + C`.

4. Em produção, você deve apontar a variável `VITE_DRIVE_STREAM_BASE_URL` para a URL real da Cloud Function gerada após o deploy (`firebase deploy --only functions`).

---

## ✅ Estado Validado do MVP

O Watch2Gether foi homologado com sucesso nos seguintes fluxos de funcionamento:
- **Firebase Realtime Database:** Armazenamento e sincronização em tempo real configurados (modo real e mock de demonstração).
- **Chat:** Envio, recebimento e rolagem automática de mensagens síncronas em tempo real.
- **Teste de Mídia Local:** O vídeo `/test-video.mp4` carrega nativamente no HTML5 `<video>` e sincroniza ações de play/pause/seek com baixíssimo delay.
- **Google Cloud OAuth & Picker:** Fluxo de login e seletor do Google Drive funcionando para carregar arquivos de vídeo.
- **driveStream Cloud Function Proxy:** O emulador intercepta as requisições, repassa os cabeçalhos de `Range` e responde com chunks parciais de mídia (`206 Partial Content`), superando os bloqueios de CORS do navegador.
- **Sync de Playback do Drive:** Vídeos do Google Drive selecionados tocam nativamente no HTML5 `<video>` com sincronia integral de play, pause, seeks e heartbeats periódicos de posicionamento.
- **Controles Nativos e Responsivos:** O player de vídeo renderiza e expõe corretamente os controles nativos (barra de timeline, play/pause, volume, tela cheia) em layouts mobile e desktop de forma fluida.

---

## 🔒 Considerações de Segurança e Problemas Conhecidos

### 1. Limitações de Acesso ao Arquivo (Erro 403)
Se um convidado abrir a sala e se deparar com um erro no player, verifique se a conta do Google dele possui permissão de leitura no arquivo selecionado.
- *Mensagem do App:* `"Sua conta Google não tem acesso a este arquivo. Peça ao host para compartilhar o vídeo com você ou tornar o arquivo acessível por link."`

### 2. Expiração de Tokens do Google Drive
Os tokens de acesso OAuth fornecidos pela API do Google expiram automaticamente após 1 hora. Se a reprodução do vídeo parar repentinamente ou o Picker falhar ao ser aberto, o usuário deverá clicar no botão de conexão novamente para restabelecer a sessão e renovar o token.

### 3. Tráfego de Token via Query Parameter
No MVP, a tag nativa `<video>` do navegador realiza solicitações GET diretas e não permite anexar cabeçalhos HTTP adicionais (como `Authorization: Bearer`). Por isso, repassamos o token de acesso temporário na query string do player (`accessToken=...`).
- **Segurança no MVP:** Essa abordagem é temporária para viabilizar o fluxo no frontend sem servidor próprio de sessão. O token fica apenas em memória de renderização (`sessionStorage`), não sendo salvo em nenhuma parte do banco de dados e nunca sendo impresso nos logs do console.
- **Uso em Produção:** Em ambientes comerciais reais de produção, deve-se evoluir para o uso de Cookies seguros `HttpOnly` associados ao domínio do proxy ou criar sessões temporárias assinadas no backend (`streamSessionId` de curta duração na memória do servidor para o token real do Google).



