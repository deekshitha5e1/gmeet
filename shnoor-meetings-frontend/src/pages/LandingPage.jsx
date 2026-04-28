import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Video, Keyboard, Plus, Link, Calendar, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import MeetingHeader from '../components/MeetingHeader';
import MeetingSidebar from '../components/MeetingSidebar';
import InviteModal from '../components/InviteModal';
import ChatbotPanel from '../components/ChatbotPanel';
import { Bot } from 'lucide-react';
import illustration from '../assets/illustration.png';
import { buildApiUrl } from '../utils/api';
import { getCurrentUser } from '../utils/currentUser';

export default function LandingPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [meetingCode, setMeetingCode] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);
  const [laterRoomId, setLaterRoomId] = useState('');
  const currentUser = getCurrentUser();
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const markMeetingHost = (roomId) => {
    const normalizedEmail = (currentUser?.email || '').trim().toLowerCase();
    localStorage.setItem(`meeting_host_${roomId}`, normalizedEmail);
    sessionStorage.setItem(`meeting_role_${roomId}`, 'host');
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('chatbot') === '1') {
      setIsChatbotOpen(true);
    }
  }, [location.search]);

  const extractRoomId = (value) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return '';
    }

    try {
      const parsedUrl = new URL(trimmedValue);
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      const roomIndex = segments.findIndex((segment) => segment === 'room' || segment === 'meeting');

      if (roomIndex >= 0 && segments[roomIndex + 1]) {
        return segments[roomIndex + 1];
      }
    } catch (error) {
      return trimmedValue;
    }

    return trimmedValue;
  };

  const handleStartInstantMeeting = async () => {
    setIsLoading(true);
    setShowDropdown(false);
    const frontendRoomId = crypto.randomUUID();
    try {
      const response = await fetch(buildApiUrl('/api/meetings/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
           room_id: frontendRoomId,
           host_id: currentUser?.meetingUserId || null,
           host_email: currentUser?.email || null,
           host_name: currentUser?.name || null,
           firebase_uid: currentUser?.firebaseUid || null,
        }),
      });
      const data = await response.json();
      if (data.room_id) {
        markMeetingHost(data.room_id);
        navigate(`/meeting/${data.room_id}`);
      }
    } catch (err) {
      console.error('Failed to create instant meeting:', err);
      const fallbackRoomId = frontendRoomId;
      markMeetingHost(fallbackRoomId);
      navigate(`/meeting/${fallbackRoomId}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateMeetingLater = async () => {
    setIsLoading(true);
    setShowDropdown(false);
    const frontendRoomId = crypto.randomUUID();
    try {
      const response = await fetch(buildApiUrl('/api/meetings/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
           room_id: frontendRoomId,
           host_id: currentUser?.meetingUserId || null,
           host_email: currentUser?.email || null,
           host_name: currentUser?.name || null,
           firebase_uid: currentUser?.firebaseUid || null,
        }),
      });
      const data = await response.json();
      if (data.room_id) {
        markMeetingHost(data.room_id);
        setLaterRoomId(data.room_id);
        setShowInviteModal(true);
      }
    } catch (err) {
      console.error('Failed to create meeting for later:', err);
      const fallbackRoomId = frontendRoomId;
      markMeetingHost(fallbackRoomId);
      setLaterRoomId(fallbackRoomId);
      setShowInviteModal(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScheduleCalendar = () => {
    setShowDropdown(false);
    navigate('/calendar');
  };

  const handleJoinMeeting = (e) => {
    e.preventDefault();
    const roomId = extractRoomId(meetingCode);
    const displayName = participantName.trim() || currentUser?.name || 'Guest';

    if (roomId) {
      sessionStorage.setItem(`meeting_role_${roomId}`, 'participant');
      sessionStorage.setItem(`meeting_name_${roomId}`, displayName);
      sessionStorage.removeItem(`meeting_admitted_${roomId}`);
      navigate(`/meeting/${roomId}?role=participant`);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      <MeetingHeader 
  onOpenChatbot={() => setIsChatbotOpen(true)}
  toggleSidebar={() => setIsSidebarOpen(prev => !prev)}
/>
      
      <div className="flex flex-1 overflow-hidden">
        {isSidebarOpen && <MeetingSidebar />}
        
        <main className="flex-1 flex flex-col md:flex-row items-center justify-between px-8 md:px-16 py-12 gap-12 overflow-y-auto ml-[60px]">
          {/* Left Column: Call to Action */}
          <div className="flex-1 max-w-xl text-left">
            <h1 className="text-4xl md:text-5xl font-normal text-gray-800 leading-tight mb-6">
              Video calls and meetings for everyone
            </h1>
            <p className="text-gray-500 text-xl mb-12 font-light">
              Connect, collaborate and celebrate from anywhere with Shnoor International LLC
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              {/* New Meeting Dropdown */}
              <div className="relative w-full sm:w-auto" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  disabled={isLoading}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-md shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  <Video size={18} />
                  {isLoading ? 'Loading...' : 'New meeting'}
                </button>

                {showDropdown && (
                  <div className="absolute left-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-xl py-2 z-50">
                    <button
                      onClick={handleCreateMeetingLater}
                      className="w-full flex items-center gap-4 px-6 py-3 text-left hover:bg-gray-50 transition-colors group"
                    >
                      <Link size={18} className="text-gray-500 group-hover:text-blue-600" />
                      <span className="text-sm font-medium text-gray-700">Create a meeting for later</span>
                    </button>
                    <button
                      onClick={handleStartInstantMeeting}
                      className="w-full flex items-center gap-4 px-6 py-3 text-left hover:bg-gray-50 transition-colors group"
                    >
                      <Plus size={18} className="text-gray-500 group-hover:text-blue-600" />
                      <span className="text-sm font-medium text-gray-700">Start an instant meeting</span>
                    </button>
                    <button
                      onClick={handleScheduleCalendar}
                      className="w-full flex items-center gap-4 px-6 py-3 text-left hover:bg-gray-50 border-t border-gray-100 transition-colors group"
                    >
                      <Calendar size={18} className="text-gray-500 group-hover:text-blue-600" />
                      <span className="text-sm font-medium text-gray-700">Schedule in Shnoor Calendar</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Join Meeting Button */}
              <button
                onClick={() => setShowJoinModal(true)}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-transparent border border-gray-300 hover:bg-gray-50 font-medium py-3 px-6 rounded-md shadow-sm transition-all active:scale-95 text-gray-700"
              >
                <Keyboard size={18} className="text-gray-500" />
                Join a meeting
              </button>
            </div>

            <div className="mt-10 border-t border-gray-200 pt-8">
              <p className="text-gray-500 text-sm">
                <a href="#" className="text-blue-600 hover:underline">Learn more</a> about Shnoor Meetings
              </p>
            </div>
          </div>

          {/* Right Column: Carousel/Illustration */}
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="relative group max-w-lg">
              <div className="bg-blue-50/50 rounded-full p-12 mb-6">
                <img 
                  src={illustration} 
                  alt="Meeting Illustration" 
                  className="w-full h-auto drop-shadow-xl transform group-hover:scale-105 transition-transform duration-700"
                />
              </div>
              
              <div className="flex flex-col items-center gap-2">
                <h3 className="text-xl font-medium text-gray-800">Get a link you can share</h3>
                <p className="text-gray-500 text-center text-sm max-w-sm">
                  Click <strong>New meeting</strong> to get a link you can send to people you want to meet with
                </p>
                
                <div className="flex items-center gap-4 mt-8">
                  <button className="p-2 hover:bg-gray-100 rounded-full border border-gray-200 shadow-sm transition-colors">
                    <ChevronLeft size={20} className="text-gray-500" />
                  </button>
                  <div className="flex gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-200"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-200"></span>
                  </div>
                  <button className="p-2 hover:bg-gray-100 rounded-full border border-gray-200 shadow-sm transition-colors">
                    <ChevronRight size={20} className="text-gray-500" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <InviteModal 
        isOpen={showInviteModal} 
        onClose={() => setShowInviteModal(false)} 
        roomId={laterRoomId} 
      />

      {/* Join Meeting Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] px-4 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md transform scale-100 transition-transform">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-medium text-gray-800">Join a meeting</h2>
              <button onClick={() => {setShowJoinModal(false); setMeetingCode(''); setParticipantName('');}} className="text-gray-400 hover:bg-gray-100 rounded-full p-2 transition-colors">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleJoinMeeting} className="flex flex-col gap-4">
              <input
                type="text"
                placeholder="Your name"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all text-gray-700"
                value={participantName}
                onChange={(e) => setParticipantName(e.target.value)}
              />
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Link size={18} className="text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder="Paste meeting link or code"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all text-gray-700"
                  value={meetingCode}
                  onChange={(e) => setMeetingCode(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => {setShowJoinModal(false); setMeetingCode(''); setParticipantName('');}}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!meetingCode.trim() || !participantName.trim()}
                  className={`px-5 py-2 rounded-lg font-medium transition-all ${meetingCode.trim() && participantName.trim() ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md transform active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Chatbot Floating Button & Panel */}
      {isChatbotOpen ? (
        <ChatbotPanel onClose={() => setIsChatbotOpen(false)} />
      ) : (
        <button 
          onClick={() => setIsChatbotOpen(true)}
          className="fixed bottom-8 right-8 bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-2xl transition-transform hover:scale-110 z-40 flex items-center justify-center animate-bounce-short"
          title="Open AI Assistant"
        >
          <Bot size={28} />
        </button>
      )}

      <style>{`
        @keyframes bounce-short {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10%); }
        }
        .animate-bounce-short {
          animation: bounce-short 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
