import { useState, useEffect } from 'react';
import { Calendar, Video, Clock, ChevronRight } from 'lucide-react';
import { format, isAfter, isSameDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { buildApiUrl } from '../utils/api';
import { getCurrentUser } from '../utils/currentUser';

export default function UpcomingMeetings() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const currentUser = getCurrentUser();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUpcoming = async () => {
      const userEmail = currentUser?.email?.trim().toLowerCase();
      const userId = currentUser?.meetingUserId;
      
      if (!userEmail && !userId) {
        setLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams();
        if (userEmail) params.set('user_email', userEmail);
        else if (userId) params.set('user_id', userId);
        
        const response = await fetch(buildApiUrl(`/api/calendar/events?${params.toString()}`));
        if (response.ok) {
          const data = await response.json();
          const upcoming = data
            .filter(e => isAfter(new Date(e.start_time), new Date()) || isSameDay(new Date(e.start_time), new Date()))
            .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
            .slice(0, 3);
          setEvents(upcoming);
        }
      } catch (error) {
        console.error('Failed to fetch upcoming meetings:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUpcoming();
  }, [currentUser]);

  if (loading) {
    return (
      <div className="mt-8 animate-pulse space-y-4">
        <div className="h-4 bg-gray-100 rounded w-1/4"></div>
        <div className="h-20 bg-gray-50 rounded-xl"></div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="mt-12 p-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50">
        <div className="flex items-center gap-3 text-gray-400 mb-2">
          <Calendar size={18} />
          <span className="text-sm font-medium">No upcoming meetings</span>
        </div>
        <p className="text-xs text-gray-500">Your scheduled meetings will appear here.</p>
      </div>
    );
  }

  return (
    <div className="mt-12 space-y-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
          <Clock size={14} />
          Upcoming Meetings
        </h3>
        <button 
          onClick={() => navigate('/calendar')}
          className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-colors"
        >
          View Calendar <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid gap-3">
        {events.map((event) => (
          <div 
            key={event.id}
            className="group relative bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-blue-100 transition-all cursor-pointer"
            onClick={() => event.room_id ? navigate(`/meeting/${event.room_id}`) : navigate('/calendar')}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${event.category === 'meetings' ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                  <h4 className="text-sm font-bold text-gray-800 truncate">{event.title}</h4>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 font-medium">
                  <span className="flex items-center gap-1">
                    {format(new Date(event.start_time), 'h:mm a')}
                  </span>
                  <span>•</span>
                  <span>{format(new Date(event.start_time), 'MMM d, yyyy')}</span>
                </div>
              </div>
              
              {event.room_id && (
                <button className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                  Join
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
