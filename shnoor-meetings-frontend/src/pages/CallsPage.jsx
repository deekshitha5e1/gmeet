import { Search, Clock3, User, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import MeetingHeader from '../components/MeetingHeader';
import MeetingSidebar from '../components/MeetingSidebar';
import { formatDateTime, formatDuration, getCallHistory, removeCallHistoryEntry } from '../utils/meetingUtils';

export default function CallsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [callHistory, setCallHistory] = useState(getCallHistory);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const loadHistory = () => setCallHistory(getCallHistory());
    const interval = window.setInterval(() => {
      setTick(Date.now());
      loadHistory();
    }, 1000);

    window.addEventListener('storage', loadHistory);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', loadHistory);
    };
  }, []);

  const filteredHistory = useMemo(() => (
    callHistory.filter((entry) =>
      `${entry.name} ${entry.roomId}`.toLowerCase().includes(searchTerm.toLowerCase())
    )
  ), [callHistory, searchTerm]);

  const handleRemoveHistory = (sessionId) => {
    removeCallHistoryEntry(sessionId);
    setCallHistory(getCallHistory());
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      <MeetingHeader />

      <div className="flex flex-1 overflow-hidden">
        <MeetingSidebar />

        <main className="flex-1 flex flex-col items-center bg-white overflow-y-auto pt-8 px-4 md:px-0">
          <div className="w-full max-w-2xl bg-white shadow-[0_2px_10px_rgba(0,0,0,0.08)] border border-gray-100 rounded-2xl p-4 mb-12 flex items-center gap-4 group transition-all hover:shadow-lg focus-within:ring-2 focus-within:ring-blue-100">
            <Search className="text-gray-400 group-focus-within:text-blue-600 transition-colors" size={24} />
            <input
              type="text"
              placeholder="Search participants or room code"
              className="flex-1 bg-transparent border-none outline-none text-gray-700 placeholder-gray-400 font-medium"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>

          <div className="w-full max-w-4xl px-4 pb-8">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6">Call activity</h2>

            <div className="space-y-3">
              {filteredHistory.map((call) => {
                const duration = call.exitTime
                  ? call.durationMs
                  : tick - new Date(call.entryTime).getTime();

                return (
                  <div
                    key={call.sessionId}
                    className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shadow-sm ${call.role === 'host' ? 'bg-blue-600' : 'bg-emerald-600'}`}>
                        {call.name?.charAt(0) || <User size={20} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                          <div>
                            <div className="text-gray-800 font-semibold">{call.name || 'Participant'}</div>
                            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">
                              {call.role === 'host' ? 'Host' : 'Participant'} - Room {call.roomId}
                            </div>
                          </div>
                          <div className="inline-flex items-center gap-2 text-sm text-gray-500">
                            <Clock3 size={16} />
                            {call.exitTime ? 'Completed' : 'In meeting'}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-sm">
                          <InfoBlock label="Entry Time" value={formatDateTime(call.entryTime)} />
                          <InfoBlock label="Exit Time" value={formatDateTime(call.exitTime)} />
                          <InfoBlock label="Time in Meeting" value={formatDuration(duration)} />
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemoveHistory(call.sessionId)}
                        className="self-start rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Remove history"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredHistory.length === 0 && (
              <div className="text-center py-20">
                <div className="text-gray-300 mb-4 flex justify-center">
                  <Clock3 size={64} />
                </div>
                <p className="text-gray-400 font-medium">No participant activity recorded yet.</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function InfoBlock({ label, value }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
      <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">{label}</div>
      <div className="text-gray-700 font-medium">{value}</div>
    </div>
  );
}
