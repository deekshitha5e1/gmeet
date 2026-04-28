import React, { useState, useRef, useEffect } from 'react';
import { Send, X } from 'lucide-react';

const ChatPanel = React.memo(({ messages, onSendMessage, onClose }) => {
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-20 w-80 bg-gray-800 border-l border-gray-700 flex flex-col shadow-2xl md:relative md:rounded-xl md:my-2 md:mr-2">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center">
        <h2 className="font-semibold text-lg">Chat</h2>
        <button className="text-gray-400 hover:text-white" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, idx) => (
          <div key={idx} className={`flex flex-col ${m.sender === 'Me' ? 'items-end' : 'items-start'}`}>
            <span className="text-[10px] text-gray-400 mb-1">{m.sender === 'Me' ? 'You' : m.sender}</span>
            <div className={`px-3 py-2 rounded-xl text-sm max-w-[90%] break-words ${
              m.sender === 'Me' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-gray-700 text-white rounded-tl-none'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
        <div className="flex items-center bg-gray-700 rounded-full px-4 py-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send message..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-white"
          />
          <button type="submit" disabled={!input.trim()} className="text-blue-500 disabled:opacity-50">
            <Send size={18} />
          </button>
        </div>
      </form>
    </aside>
  );
});

ChatPanel.displayName = 'ChatPanel';
export default ChatPanel;
