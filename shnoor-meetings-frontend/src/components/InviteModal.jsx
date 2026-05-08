import { X, Share2, Mail, MessageCircle } from 'lucide-react';
import { useState } from 'react';

export default function InviteModal({ isOpen, onClose, roomId }) {
  const [showShareOptions, setShowShareOptions] = useState(false);

  if (!isOpen) return null;

  const inviteLink = `${window.location.origin}/meeting/${roomId}?role=participant&admitted=true`;
  const shareTitle = 'Join my Shnoor meeting';
  const shareMessage = `Join my Shnoor meeting: ${inviteLink}`;

  const handleShareByMail = () => {
    const subject = encodeURIComponent(shareTitle);
    const body = encodeURIComponent(`Hi,\n\nPlease join the meeting using this link:\n${inviteLink}`);
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=&su=${subject}&body=${body}`, '_blank', 'noopener,noreferrer');
    setShowShareOptions(false);
  };

  const handleShareByWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage)}`, '_blank', 'noopener,noreferrer');
    setShowShareOptions(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200 text-white">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold">Your meeting's ready</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-full hover:bg-gray-700 transition">
            <X size={20} />
          </button>
        </div>

        <p className="text-gray-400 text-sm mb-6">
          Share this meeting link with others you want in the meeting.
        </p>

        <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-2 border border-gray-700 mb-4">
          <input
            type="text"
            readOnly
            value={inviteLink}
            className="flex-1 bg-transparent border-none text-gray-300 px-2 outline-none text-sm"
          />
        </div>

        <div className="relative">
          <button
            onClick={() => setShowShareOptions((isOpen) => !isOpen)}
            className="w-full flex items-center justify-center gap-2 text-sm bg-blue-600 hover:bg-blue-500 transition px-4 py-2.5 text-white rounded-md font-semibold"
            aria-expanded={showShareOptions}
            aria-haspopup="menu"
          >
            <Share2 size={16} />
            Share
          </button>

          {showShareOptions && (
            <div
              className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 py-2 shadow-2xl"
              role="menu"
            >
              <button
                type="button"
                onClick={handleShareByMail}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-100 transition hover:bg-gray-800"
                role="menuitem"
              >
                <Mail size={16} className="text-blue-300" />
                Mail
              </button>
              <button
                type="button"
                onClick={handleShareByWhatsApp}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-100 transition hover:bg-gray-800"
                role="menuitem"
              >
                <MessageCircle size={16} className="text-green-300" />
                WhatsApp
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
