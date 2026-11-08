import { useState, useEffect } from 'react';
import {
  X,
  Share2,
  Copy,
  Check,
  Smartphone,
  Sparkles,
  Lock,
  ExternalLink
} from 'lucide-react';
import {
  buildShareMessage,
  shareToWhatsApp,
  shareToInstagramOrNative,
  shareViaNative,
  canNativeShare
} from '../lib/roomStorage';
import './ShareModal.css';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  roomTitle?: string;
  pin?: string;
}

// Brand SVG for WhatsApp
function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.301-.15-1.78-.878-2.056-.979-.276-.1-.476-.15-.676.15-.2.301-.776.979-.951 1.18-.175.201-.351.226-.652.075-.301-.15-1.27-.468-2.42-1.493-.895-.798-1.5-1.785-1.676-2.086-.175-.301-.019-.464.132-.614.136-.135.301-.351.451-.527.15-.175.201-.301.301-.501.101-.2.05-.376-.025-.526-.075-.15-.676-1.63-.926-2.233-.244-.588-.492-.508-.676-.517l-.577-.01c-.2 0-.526.075-.802.376-.275.301-1.052 1.028-1.052 2.508 0 1.48 1.077 2.909 1.228 3.109.15.201 2.12 3.238 5.136 4.542.717.311 1.278.496 1.715.635.72.229 1.376.197 1.895.12.578-.087 1.78-.727 2.03-1.43.25-.702.25-1.304.175-1.43-.075-.125-.275-.201-.576-.351zM12.04 2C6.51 2 2.02 6.49 2.02 12.02c0 1.95.56 3.77 1.53 5.31L2 22l4.82-1.51c1.48.88 3.21 1.39 5.07 1.39 5.53 0 10.02-4.49 10.02-10.02S17.57 2 12.04 2zm0 18.23c-1.64 0-3.17-.49-4.46-1.34l-.32-.21-2.86.9.92-2.79-.23-.36c-.95-1.5-1.46-3.26-1.46-5.09 0-4.65 3.78-8.43 8.43-8.43 4.65 0 8.43 3.78 8.43 8.43 0 4.66-3.78 8.45-8.45 8.45z" />
    </svg>
  );
}

// Brand SVG for Instagram
function InstagramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export default function ShareModal({
  isOpen,
  onClose,
  roomId,
  roomTitle,
  pin
}: ShareModalProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  const shareData = buildShareMessage(roomId, roomTitle, pin);
  const hasNativeShare = canNativeShare();

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(''), 3500);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareData.url).then(() => {
      setCopiedLink(true);
      showToast('Link da sala copiado com sucesso! 🔗');
      setTimeout(() => setCopiedLink(false), 2200);
    });
  };

  const handleCopyFullText = () => {
    navigator.clipboard.writeText(shareData.text).then(() => {
      setCopiedText(true);
      showToast('Mensagem de convite copiada! Pronto para colar 📋');
      setTimeout(() => setCopiedText(false), 2200);
    });
  };

  const handleWhatsApp = () => {
    shareToWhatsApp(roomId, roomTitle, pin);
    showToast('Abrindo WhatsApp para você escolher o contato... 💬');
  };

  const handleInstagram = async () => {
    const res = await shareToInstagramOrNative(roomId, roomTitle, pin);
    if (res === 'copied') {
      showToast('Convite copiado! Abrindo o Instagram Direct para colar 📸');
    } else {
      showToast('Compartilhando com o Instagram...');
    }
  };

  const handleNative = async () => {
    const success = await shareViaNative(roomId, roomTitle, pin);
    if (success) {
      showToast('Compartilhado com sucesso!');
    }
  };

  return (
    <div className="share-modal-backdrop" onClick={onClose}>
      <div
        className="share-modal-surface"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
      >
        {/* Subtle Ambient Halo */}
        <div className="share-ambient-halo" aria-hidden="true" />

        {/* Header Bar */}
        <div className="share-modal-header">
          <div className="share-title-cluster">
            <span className="share-badge-kicker">
              <Sparkles size={11} />
              <span>CONVITE DE SESSÃO</span>
            </span>
            <h2 id="share-modal-title">Compartilhar Party</h2>
            <p className="share-subtitle">
              Convide amigos ou sua amada para assistir tudo em sincronia.
            </p>
          </div>

          <button
            type="button"
            className="share-modal-close"
            onClick={onClose}
            title="Fechar (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Room Info Tag Row */}
        <div className="share-room-meta-row">
          <div className="meta-tag code">
            <span className="tag-label">SALA</span>
            <strong>{roomId}</strong>
          </div>
          {roomTitle && (
            <div className="meta-tag title">
              <span className="tag-label">TÍTULO</span>
              <span>{roomTitle}</span>
            </div>
          )}
          {pin && (
            <div className="meta-tag pin">
              <Lock size={12} />
              <span>PIN: {pin}</span>
            </div>
          )}
        </div>

        {/* Toast alert inside modal */}
        {feedbackMsg && (
          <div className="share-toast-banner" role="status">
            <span>{feedbackMsg}</span>
          </div>
        )}

        {/* Main Action Channels */}
        <div className="share-channels-grid">
          {/* WhatsApp Card Button */}
          <button
            type="button"
            onClick={handleWhatsApp}
            className="channel-card whatsapp"
          >
            <div className="channel-icon-box whatsapp">
              <WhatsAppIcon size={24} />
            </div>
            <div className="channel-info">
              <div className="channel-title-row">
                <span className="channel-name">WhatsApp</span>
                <span className="channel-tag">Direto</span>
              </div>
              <p className="channel-desc">
                Abre o WhatsApp para você escolher qualquer contato ou grupo com o convite pronto.
              </p>
            </div>
            <ExternalLink size={16} className="channel-action-glyph" />
          </button>

          {/* Instagram Card Button */}
          <button
            type="button"
            onClick={handleInstagram}
            className="channel-card instagram"
          >
            <div className="channel-icon-box instagram">
              <InstagramIcon size={22} />
            </div>
            <div className="channel-info">
              <div className="channel-title-row">
                <span className="channel-name">Instagram</span>
                <span className="channel-tag">Direct</span>
              </div>
              <p className="channel-desc">
                Copia o convite formatado e abre o Direct para colar na conversa que quiser.
              </p>
            </div>
            <ExternalLink size={16} className="channel-action-glyph" />
          </button>

          {/* Native Smartphone Share (if supported) */}
          {hasNativeShare && (
            <button
              type="button"
              onClick={handleNative}
              className="channel-card native-sheet"
            >
              <div className="channel-icon-box native">
                <Smartphone size={22} />
              </div>
              <div className="channel-info">
                <div className="channel-title-row">
                  <span className="channel-name">Mais Aplicativos do Celular</span>
                  <span className="channel-tag">Nativo</span>
                </div>
                <p className="channel-desc">
                  Abre a gaveta do celular para enviar por Telegram, SMS ou qualquer outro app.
                </p>
              </div>
              <Share2 size={16} className="channel-action-glyph" />
            </button>
          )}
        </div>

        {/* Direct Link Section */}
        <div className="share-link-unit">
          <div className="link-unit-header">
            <span className="unit-label">Link Direto da Sessão</span>
            <button
              type="button"
              onClick={handleCopyFullText}
              className="btn-copy-preview-text"
              title="Copiar mensagem completa formatada com título e código"
            >
              {copiedText ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedText ? 'Texto Completo Copiado!' : 'Copiar Texto Completo'}</span>
            </button>
          </div>

          <div className="link-copy-box">
            <input
              type="text"
              readOnly
              value={shareData.url}
              className="link-input-display"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className={`btn-copy-link-main ${copiedLink ? 'copied' : ''}`}
            >
              {copiedLink ? <Check size={15} /> : <Copy size={15} />}
              <span>{copiedLink ? 'Copiado!' : 'Copiar Link'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Message Preview */}
        <div className="share-preview-card">
          <span className="preview-label">Prévia do Convite Enviado:</span>
          <pre className="preview-text-block">{shareData.text}</pre>
        </div>
      </div>
    </div>
  );
}
