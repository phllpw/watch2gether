import React, { useState, useEffect, useRef } from 'react';
import { Send, Copy, Check, MessageSquare, AlertTriangle } from 'lucide-react';
import { database, isConfigured } from '../firebase';
import { ref, push, onValue, serverTimestamp } from 'firebase/database';
import { playPopSound } from '../lib/soundEffects';
import './Chat.css';

interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

interface ChatProps {
  roomId: string;
  nickname: string;
  roomTitle?: string;
  roomPin?: string;
}

const QUICK_EMOJIS = ['🍿', '❤️', '😂', '🔥', '😱', '👏'];

export default function Chat({ roomId, nickname }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [copied, setCopied] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const sendRawMessage = async (text: string) => {
    if (!text.trim()) return;
    playPopSound();
    const messageData = {
      sender: nickname,
      text: text.trim(),
      timestamp: isConfigured ? serverTimestamp() : Date.now()
    };

    if (isConfigured && database) {
      try {
        const chatRef = ref(database, `rooms/${roomId}/chat`);
        await push(chatRef, messageData);
      } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
      }
    } else {
      const localMsg: Message = {
        id: `local-${Date.now()}`,
        sender: nickname,
        text: messageData.text,
        timestamp: Date.now()
      };
      setMessages((prev) => [...prev, localMsg]);
    }
  };

  const handleQuickSend = (emoji: string) => {
    playPopSound();
    if (isConfigured && database) {
      push(ref(database, `rooms/${roomId}/reactions`), {
        emoji,
        sender: nickname || 'Convidado',
        timestamp: Date.now()
      }).catch(() => {});
    }
    sendRawMessage(emoji);
  };

  // Load and listen to messages
  useEffect(() => {
    if (!isConfigured || !database) {
      setMessages([
        {
          id: 'welcome-1',
          sender: 'Sistema',
          text: `Bem-vindo à sala ${roomId}! 🎉`,
          timestamp: Date.now() - 60000
        },
        {
          id: 'welcome-2',
          sender: 'Amigo Virtual (Demo)',
          text: 'Oi! Este chat está rodando em modo de demonstração local. Envie uma mensagem!',
          timestamp: Date.now() - 30000
        }
      ]);
      return;
    }

    const chatRef = ref(database, `rooms/${roomId}/chat`);
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const messageList = Object.keys(data).map((key) => ({
          id: key,
          ...data[key]
        })) as Message[];

        messageList.sort((a, b) => a.timestamp - b.timestamp);
        setMessages(messageList);
      } else {
        setMessages([]);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  // Scroll internal chat container to bottom on new messages (NEVER scroll window!)
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);


  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText.trim();
    setInputText('');
    await sendRawMessage(text);
  };

  const copyRoomLink = () => {
    const inviteLink = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="chat-container studio-chat">
      {/* Chat Header */}
      <div className="chat-header">
        <div className="chat-info">
          <div className="chat-icon-box">
            <MessageSquare size={16} className="chat-header-icon" />
          </div>
          <div className="chat-title-meta">
            <div className="chat-title-row">
              <h3>Chat da Sessão</h3>
              <span className="chat-live-pulse-dot" />
            </div>
            <span className="room-code-tag">Você: {nickname} • Em sincronia</span>
          </div>
        </div>
        <button
          type="button"
          onClick={copyRoomLink}
          className={`btn-icon-copy ${copied ? 'copied' : ''}`}
          title="Copiar Link de Convite da Sala"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? 'Copiado!' : 'Convidar'}</span>
        </button>
      </div>

      {/* Demo Warning if not configured */}
      {!isConfigured && (
        <div className="chat-demo-alert">
          <AlertTriangle size={14} />
          <span>Modo Demo: mensagens locais.</span>
        </div>
      )}

      {/* Messages list */}
      <div ref={messagesContainerRef} className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty-placeholder">
            <div className="chat-empty-beacon">
              <MessageSquare size={22} className="beacon-glyph" />
            </div>
            <h4>Sala Conectada</h4>
            <p>Mande uma mensagem ou toque em uma das reações rápidas abaixo para interagir na tela ao vivo!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender === nickname;
            const isSystem = msg.sender === 'Sistema';

            let bubbleClass = 'msg-bubble';
            if (isSystem) bubbleClass += ' system';
            else if (isMe) bubbleClass += ' me';
            else bubbleClass += ' other';

            return (
              <div
                key={msg.id}
                className={`message-wrapper ${isSystem ? 'system' : isMe ? 'me' : 'other'}`}
              >
                {!isSystem && <span className="msg-sender">{msg.sender}</span>}
                <div className={bubbleClass}>
                  <p className="msg-text">{msg.text}</p>
                  <span className="msg-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Quick Interactive Reaction Bar */}
      <div className="chat-quick-reactions-bar">
        <div className="emoji-quick-row">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleQuickSend(emoji)}
              className="btn-quick-emoji"
              title={`Enviar ${emoji}`}
            >
              <span>{emoji}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input area */}
      <form onSubmit={handleSendMessage} className="chat-input-area">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Digite sua mensagem na party..."
          className="input-field chat-input"
          maxLength={500}
        />
        <button type="submit" className="btn btn-primary btn-send" disabled={!inputText.trim()}>
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
