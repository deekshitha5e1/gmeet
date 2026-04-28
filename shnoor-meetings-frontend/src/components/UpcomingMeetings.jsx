import { useState, useEffect, useCallback } from 'react';
import { Calendar, Video, Clock, ChevronRight, Bell, Users, AlignLeft, Zap } from 'lucide-react';
import { format, isAfter, isSameDay, differenceInSeconds, differenceInMinutes, differenceInHours } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { buildApiUrl } from '../utils/api';
import { getCurrentUser } from '../utils/currentUser';

/** Returns a live human-readable countdown string for the meeting */
function useCountdown(startTime) {
  const getCountdown = useCallback(() => {
    const now = new Date();
    const start = new Date(startTime);
    const totalSeconds = differenceInSeconds(start, now);

    if (totalSeconds <= 0) return { label: 'Starting now', urgent: true, started: true };

    const hours = differenceInHours(start, now);
    const mins = differenceInMinutes(start, now) % 60;
    const secs = totalSeconds % 60;

    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return { label: `in ${days}d ${hours % 24}h`, urgent: false, started: false };
    }
    if (hours >= 1) {
      return { label: `in ${hours}h ${mins}m`, urgent: false, started: false };
    }
    if (mins >= 5) {
      return { label: `in ${mins}m`, urgent: mins <= 15, started: false };
    }
    // Under 5 minutes — show live seconds
    return {
      label: mins > 0 ? `in ${mins}m ${secs}s` : `in ${secs}s`,
      urgent: true,
      started: false,
    };
  }, [startTime]);

  const [countdown, setCountdown] = useState(getCountdown);

  useEffect(() => {
    const interval = setInterval(() => setCountdown(getCountdown()), 1000);
    return () => clearInterval(interval);
  }, [getCountdown]);

  return countdown;
}

/** Single meeting card with live countdown */
function MeetingCard({ event }) {
  const navigate = useNavigate();
  const countdown = useCountdown(event.start_time);

  const handleClick = () => {
    if (event.room_id) navigate(`/meeting/${event.room_id}`);
    else navigate('/calendar');
  };

  return (
    <div
      className={`group relative bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer ${
        countdown.urgent
          ? 'border-amber-200 hover:border-amber-300 ring-1 ring-amber-100'
          : 'border-gray-100 hover:border-blue-100'
      }`}
      onClick={handleClick}
    >
      {/* Urgency pulse dot */}
      {countdown.urgent && !countdown.started && (
        <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
        </span>
      )}
      {countdown.started && (
        <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
      )}

      <div className="flex flex-col gap-3">
        {/* Header: Title + Countdown Badge */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`w-2.5 h-2.5 rounded-full shadow-sm ${
                  event.category === 'meetings' ? 'bg-emerald-500' : 'bg-blue-500'
                }`}
              />
              <h4 className="text-sm font-bold text-gray-800 truncate leading-tight">{event.title}</h4>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-gray-500 font-bold uppercase tracking-wider">
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {format(new Date(event.start_time), 'h:mm a')}
                {event.end_time && ` – ${format(new Date(event.end_time), 'h:mm a')}`}
              </span>
              <span>•</span>
              <span>{format(new Date(event.start_time), 'MMM d, yyyy')}</span>
            </div>
          </div>

          {/* Countdown badge */}
          <div
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold shadow-sm transition-all ${
              countdown.started
                ? 'bg-emerald-500 text-white animate-pulse'
                : countdown.urgent
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-blue-50 text-blue-700 border border-blue-100'
            }`}
          >
            {countdown.started ? (
              <>
                <Zap size={11} />
                Live
              </>
            ) : (
              <>
                <Clock size={11} />
                {countdown.label}
              </>
            )}
          </div>
        </div>

        {/* Description snippet */}
        {event.description && (
          <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 p-2 rounded-lg border border-gray-100/50">
            <AlignLeft size={14} className="text-gray-400 mt-0.5 shrink-0" />
            <p className="line-clamp-2 leading-relaxed italic">{event.description}</p>
          </div>
        )}

        {/* Footer: Reminder + Guests + Join button */}
        <div className="flex items-center justify-between gap-4 pt-1 border-t border-gray-50">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
              <Bell size={12} />
              <span>{event.reminder_offset_minutes ?? 5}m before</span>
            </div>
            {event.guest_emails && event.guest_emails.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                <Users size={12} />
                <span>{event.guest_emails.length + 1} people</span>
              </div>
            )}
          </div>

          {event.room_id && (
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/meeting/${event.room_id}`); }}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold shadow-md transition-colors ${
                countdown.started || countdown.urgent
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {countdown.started ? '▶ Join Now' : 'Join'}
            </button>
          )}
        </div>

        {/* Guest email list */}
        {event.guest_emails && event.guest_emails.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {event.guest_emails.map((email, idx) => (
              <span
                key={idx}
                className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200"
              >
                {email}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function UpcomingMeetings() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(getCurrentUser());
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  // Sync user state if it changes in other tabs or after login
  useEffect(() => {
    const handleSync = () => setCurrentUser(getCurrentUser());
    window.addEventListener('storage', handleSync);
    return () => window.removeEventListener('storage', handleSync);
  }, []);

  useEffect(() => {
    const fetchUpcoming = async () => {
      const userEmail = currentUser?.email?.trim().toLowerCase();
      const userId = currentUser?.meetingUserId;

      if (!userEmail && !userId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (userEmail) params.set('user_email', userEmail);
        else if (userId) params.set('user_id', userId);

        const apiUrl = buildApiUrl(`/api/calendar/events?${params.toString()}`);
        const response = await fetch(apiUrl);
        if (response.ok) {
          const data = await response.json();
          const upcoming = data
            .filter((e) => isAfter(new Date(e.start_time), new Date()) || isSameDay(new Date(e.start_time), new Date()))
            .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
            .slice(0, 3);
          setEvents(upcoming);
        } else {
          const errText = await response.text();
          console.error('UpcomingMeetings: API error', response.status, errText);
          setError(`Failed to load meetings (${response.status})`);
        }
      } catch (err) {
        console.error('UpcomingMeetings: Fetch failed', err);
        setError('Network error: Could not reach the server');
      } finally {
        setLoading(false);
      }
    };

    fetchUpcoming();
  }, [currentUser]);

  if (loading) {
    return (
      <div className="mt-8 animate-pulse space-y-4">
        <div className="h-4 bg-gray-100 rounded w-1/4" />
        <div className="h-24 bg-gray-50 rounded-xl" />
        <div className="h-24 bg-gray-50 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-12 p-6 rounded-2xl border border-red-100 bg-red-50/30">
        <div className="flex items-center gap-3 text-red-500 mb-2">
          <Calendar size={18} />
          <span className="text-sm font-bold">Something went wrong</span>
        </div>
        <p className="text-xs text-red-600/70 mb-4">{error}</p>
        <button
          onClick={() => setCurrentUser(getCurrentUser())}
          className="text-xs font-bold text-red-600 underline hover:no-underline"
        >
          Try again
        </button>
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
        <button
          onClick={() => setCurrentUser(getCurrentUser())}
          className="mt-3 text-[10px] font-bold text-blue-600 uppercase tracking-widest hover:underline"
        >
          Check for updates
        </button>
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

      <div className="grid gap-4">
        {events.map((event) => (
          <MeetingCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
