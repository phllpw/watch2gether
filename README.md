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
