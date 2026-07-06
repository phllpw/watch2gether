import React, { useState, useEffect, useRef } from 'react';
import { Send, Copy, Check, Users, AlertTriangle } from 'lucide-react';
import { database, isConfigured } from '../firebase';
import { ref, push, onValue, serverTimestamp } from 'firebase/database';
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
}

export default function Chat({ roomId, nickname }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [copied, setCopied] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load and listen to messages
  useEffect(() => {
    if (!isConfigured || !database) {
      // Demo Mode initial messages
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
        
        // Sort messages by timestamp
        messageList.sort((a, b) => a.timestamp - b.timestamp);
        setMessages(messageList);
      } else {
        setMessages([]);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const messageData = {
      sender: nickname,
      text: inputText.trim(),
      timestamp: isConfigured ? serverTimestamp() : Date.now()
    };

    setInputText('');

    if (isConfigured && database) {
      try {
        const chatRef = ref(database, `rooms/${roomId}/chat`);
        await push(chatRef, messageData);
      } catch (error) {
        console.error("Erro ao enviar mensagem:", error);
      }
    } else {
      // Local Demo append
      const localMsg: Message = {
        id: `local-${Date.now()}`,
        sender: nickname,
        text: messageData.text,
        timestamp: messageData.timestamp as number
      };
      
      setMessages((prev) => [...prev, localMsg]);

      // Simple mock automatic response
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `reply-${Date.now()}`,
            sender: 'Amigo Virtual (Demo)',
            text: `Recebido! Sincronização offline funcionando para: "${messageData.text}"`,
            timestamp: Date.now()
          }
        ]);
      }, 1500);
    }
  };

  const copyRoomLink = () => {
    const inviteLink = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="chat-container glass">
      {/* Chat Header */}
      <div className="chat-header border-b">
        <div className="chat-info">
          <Users size={18} className="chat-header-icon" />
          <div>
            <h3>Chat: {nickname}</h3>
            <span className="room-code-tag">ID: {roomId}</span>
          </div>
        </div>
        <button 
          onClick={copyRoomLink} 
          className={`btn-icon-copy ${copied ? 'copied' : ''}`}
          title="Copiar Link de Convite"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          <span>{copied ? 'Copiado!' : 'Convidar'}</span>
        </button>
      </div>

      {/* Demo Warning if not configured */}
      {!isConfigured && (
        <div className="chat-demo-alert">
          <AlertTriangle size={14} />
          <span>Modo Demo: mensagens não serão sincronizadas.</span>
        </div>
      )}

      {/* Messages list */}
      <div className="chat-messages">
        {messages.map((msg) => {
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
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Input area */}
      <form onSubmit={handleSendMessage} className="chat-input-area border-t">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Digite sua mensagem..."
          className="input-field chat-input"
          maxLength={500}
        />
        <button type="submit" className="btn btn-primary btn-send" disabled={!inputText.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
