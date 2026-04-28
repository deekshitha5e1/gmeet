import { Copy, X, Check, Share2 } from 'lucide-react';
import { useState } from 'react';

export default function InviteModal({ isOpen, onClose, roomId }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const inviteLink = `${window.location.origin}/meeting/${roomId}?role=participant`;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          <button 
            onClick={handleCopy}
            className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-500 transition px-4 py-2 rounded-md font-medium"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <button
          onClick={async () => {
            if (navigator.share) {
              try {
                await navigator.share({
                  title: 'Join my Shnoor Meeting',
                  text: 'Please join my meeting on Shnoor Meetings:',
                  url: inviteLink,
                });
              } catch (err) {
                console.error('Error sharing:', err);
              }
            } else {
              handleCopy();
            }
          }}
          className="w-full flex items-center justify-center gap-2 text-sm bg-gray-700 hover:bg-gray-600 transition px-4 py-2 text-white rounded-md font-medium"
        >
          <Share2 size={16} />
          Share via App
        </button>



      </div>
    </div>
  );
}
