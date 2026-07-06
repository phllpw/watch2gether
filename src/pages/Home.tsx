import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, Users, PlusCircle, ArrowRight } from 'lucide-react';
import { isConfigured } from '../firebase';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const [createName, setCreateName] = useState('');
  const [joinName, setJoinName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');

  // Load nickname from localStorage if exists
  useEffect(() => {
    const savedName = localStorage.getItem('watchparty_nickname') || '';
    setCreateName(savedName);
    setJoinName(savedName);
  }, []);

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;

    // Save nickname
    localStorage.setItem('watchparty_nickname', createName.trim());

    // Generate random room ID (e.g., PARTY-XXXX)
    const randomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const generatedRoomId = `PARTY-${randomId}`;

    navigate(`/room/${generatedRoomId}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinName.trim() || !roomIdInput.trim()) return;

    // Save nickname
    localStorage.setItem('watchparty_nickname', joinName.trim());

    // Format roomId (trim spaces, uppercase)
    const cleanRoomId = roomIdInput.trim().toUpperCase();

    navigate(`/room/${cleanRoomId}`);
  };

  return (
    <div className="home-container animate-fade-in">
      <div className="home-header">
        <div className="logo-badge">
          <Film className="logo-icon" size={24} />
          <span>BETA</span>
        </div>
        <h1 className="home-title">
          Watch<span className="text-gradient">2Gether</span>
        </h1>
        <p className="home-subtitle">
          Assista vídeos em salas compartilhadas com chat e sincronização quando o player permitir.
        </p>

        {!isConfigured && (
          <div className="firebase-warning-banner">
            <span>⚠️ Rodando em Modo Demo (Offline). Configure o Firebase no <code>.env.local</code> para sincronização real.</span>
          </div>
        )}
      </div>

      <div className="cards-grid">
        {/* Card: Create Room */}
        <div className="home-card glass">
          <div className="card-header">
            <PlusCircle className="card-icon purple" size={28} />
            <h2>Criar Nova Sala</h2>
            <p>Inicie uma nova sala e convide um amigo para assistir.</p>
          </div>

          <form onSubmit={handleCreateRoom} className="card-form">
            <div className="form-group">
              <label htmlFor="create-nickname">Seu Apelido</label>
              <input
                id="create-nickname"
                type="text"
                className="input-field"
                placeholder="Ex: Phillip"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={20}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Criar Sala <ArrowRight size={18} />
            </button>
          </form>
        </div>

        {/* Card: Join Room */}
        <div className="home-card glass">
          <div className="card-header">
            <Users className="card-icon indigo" size={28} />
            <h2>Entrar em Sala</h2>
            <p>Insira o código da sala enviado pelo seu amigo.</p>
          </div>

          <form onSubmit={handleJoinRoom} className="card-form">
            <div className="form-group">
              <label htmlFor="join-room-id">Código da Sala</label>
              <input
                id="join-room-id"
                type="text"
                className="input-field"
                placeholder="Ex: PARTY-A1B2C3"
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="join-nickname">Seu Apelido</label>
              <input
                id="join-nickname"
                type="text"
                className="input-field"
                placeholder="Ex: Player 2"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                maxLength={20}
                required
              />
            </div>

            <button type="submit" className="btn btn-secondary w-full">
              Entrar na Sala <ArrowRight size={18} />
            </button>
          </form>
        </div>
      </div>

      <div className="home-footer">
        <p>Desenvolvido com carinho para maratonas compartilhadas.</p>
      </div>
    </div>
  );
}
