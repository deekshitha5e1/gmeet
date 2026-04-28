import { useState, useEffect } from 'react';
import { Calendar, Clock, ChevronRight, Bell, Users, AlignLeft, Zap } from 'lucide-react';
import { format, isAfter, isSameDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { buildApiUrl } from '../utils/api';
import { getCurrentUser } from '../utils/currentUser';

/**
 * Pure-JS countdown — no date-fns dependency for the math.
 * Returns { label, urgent, started }
 */
function computeCountdown(startTime) {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const diffMs = start - now;

  if (diffMs <= 0) {
    return { label: 'Starting now', urgent: true, started: true };
  }

  const totalSecs = Math.floor(diffMs / 1000);
  const days  = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins  = Math.floor((totalSecs % 3600) / 60);
  const secs  = totalSecs % 60;

  if (days >= 1) {
    return { label: `in ${days}d ${hours}h`, urgent: false, started: false };
  }
  if (hours >= 1) {
    return { label: `in ${hours}h ${mins}m`, urgent: false, started: false };
  }
  if (mins >= 5) {
    return { label: `in ${mins}m`, urgent: mins <= 15, started: false };
  }
  // < 5 min — show live seconds
  const liveLabel = mins > 0 ? `in ${mins}m ${secs}s` : `in ${secs}s`;
  return { label: liveLabel, urgent: true, started: false };
}

/** Hook: ticks every second */
function useCountdown(startTime) {
  const [countdown, setCountdown] = useState(() => computeCountdown(startTime));

  useEffect(() => {
    // Recalculate immediately when startTime changes
    setCountdown(computeCountdown(startTime));

    const interval = setInterval(() => {
      setCountdown(computeCountdown(startTime));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  return countdown;
}

/** Single meeting card with live countdown badge */
function MeetingCard({ event }) {
  const navigate = useNavigate();
  const countdown = useCountdown(event.start_time);

  const handleCardClick = () => {
    if (event.room_id) navigate(`/meeting/${event.room_id}`);
    else navigate('/calendar');
  };

  const handleJoin = (e) => {
    e.stopPropagation();
    navigate(`/meeting/${event.room_id}`);
  };

  const isLive    = countdown.started;
  const isUrgent  = countdown.urgent && !countdown.started;

  return (
    <div
      className={`group relative bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer ${
        isLive   ? 'border-emerald-200 ring-1 ring-emerald-100 hover:border-emerald-300' :
        isUrgent ? 'border-amber-200 ring-1 ring-amber-100 hover:border-amber-300' :
                   'border-gray-100 hover:border-blue-100'
      }`}
      onClick={handleCardClick}
    >
      {/* Pulse indicator top-right */}
      {(isLive || isUrgent) && (
        <span className="absolute top-4 right-4 flex h-3 w-3">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isLive ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className={`relative inline-flex rounded-full h-3 w-3 ${isLive ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        </span>
      )}

      <div className="flex flex-col gap-3">

        {/* ── Row 1: Title + Countdown Badge ── */}
        <div className="flex items-start justify-between gap-3 pr-6">
          <div className="flex-1 min-w-0">
            {/* Dot + title */}
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                event.category === 'meetings' ? 'bg-emerald-500' : 'bg-blue-500'
              }`} />
              <h4 className="text-sm font-bold text-gray-800 truncate">{event.title}</h4>
            </div>
            {/* Time + date */}
            <div className="flex items-center gap-2 text-[11px] text-gray-500 font-semibold uppercase tracking-wider">
              <Clock size={11} />
              <span>{format(new Date(event.start_time), 'h:mm a')}</span>
              {event.end_time && (
                <span>→ {format(new Date(event.end_time), 'h:mm a')}</span>
              )}
              <span>•</span>
              <span>{format(new Date(event.start_time), 'MMM d, yyyy')}</span>
            </div>
          </div>

          {/* ── Countdown badge ── */}
          <div className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border ${
            isLive
              ? 'bg-emerald-500 text-white border-emerald-500 animate-pulse'
              : isUrgent
              ? 'bg-amber-50 text-amber-700 border-amber-300'
              : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}>
            {isLive ? (
              <><Zap size={11} /> Live</>
            ) : (
              <><Clock size={11} /> {countdown.label}</>
            )}
          </div>
        </div>

        {/* ── Description ── */}
        {event.description && (
          <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">
            <AlignLeft size={13} className="text-gray-400 mt-0.5 shrink-0" />
            <p className="line-clamp-2 leading-relaxed italic">{event.description}</p>
          </div>
        )}

        {/* ── Footer: reminder + guests + join btn ── */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-50">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Reminder badge */}
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
              <Bell size={11} />
              {event.reminder_offset_minutes ?? 5}m reminder
            </span>

            {/* Guest count */}
            {event.guest_emails?.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                <Users size={11} />
                {event.guest_emails.length + 1} people
              </span>
            )}
          </div>

          {/* Join button */}
          {event.room_id && (
            <button
              onClick={handleJoin}
              className={`px-4 py-1.5 rounded-lg text-[11px] font-bold shadow-sm transition-colors ${
                isLive || isUrgent
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isLive ? '▶ Join Now' : 'Join'}
            </button>
          )}
        </div>

        {/* Guest email pills */}
        {event.guest_emails?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {event.guest_emails.map((email, idx) => (
              <span key={idx} className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                {email}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── */

export default function UpcomingMeetings() {
  const [events, setEvents]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [currentUser, setCurrentUser] = useState(getCurrentUser());
  const [error, setError]             = useState(null);
  const navigate = useNavigate();

  /* Sync user when localStorage changes (other tab login) */
  useEffect(() => {
    const handle = () => setCurrentUser(getCurrentUser());
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  }, []);

  /* Fetch upcoming meetings for the logged-in user */
  useEffect(() => {
    const load = async () => {
      const userEmail = currentUser?.email?.trim().toLowerCase();
      const userId    = currentUser?.meetingUserId;

      if (!userEmail && !userId) { setLoading(false); return; }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (userEmail)   params.set('user_email', userEmail);
        else if (userId) params.set('user_id', userId);

        const res = await fetch(buildApiUrl(`/api/calendar/events?${params}`));
        if (res.ok) {
          const data = await res.json();
          const now  = new Date();
          const upcoming = data
            .filter(e => {
              const start = new Date(e.start_time);
              // keep: today same day OR strictly in the future
              return isAfter(start, now) || isSameDay(start, now);
            })
            .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
            .slice(0, 3);
          setEvents(upcoming);
        } else {
          const txt = await res.text();
          setError(`Failed to load meetings (${res.status}): ${txt}`);
        }
      } catch (err) {
        console.error('UpcomingMeetings fetch error:', err);
        setError('Network error – could not reach the server');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [currentUser]);

  /* ── Render states ── */
  if (loading) return (
    <div className="mt-8 animate-pulse space-y-3">
      <div className="h-4 bg-gray-100 rounded w-1/3" />
      <div className="h-24 bg-gray-50 rounded-xl" />
      <div className="h-24 bg-gray-50 rounded-xl" />
    </div>
  );

  if (error) return (
    <div className="mt-12 p-5 rounded-2xl border border-red-100 bg-red-50/40">
      <div className="flex items-center gap-2 text-red-500 mb-2">
        <Calendar size={16} />
        <span className="text-sm font-bold">Something went wrong</span>
      </div>
      <p className="text-xs text-red-600/70 mb-3">{error}</p>
      <button onClick={() => setCurrentUser(getCurrentUser())}
        className="text-xs font-bold text-red-600 underline">Try again</button>
    </div>
  );

  if (events.length === 0) return (
    <div className="mt-12 p-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50">
      <div className="flex items-center gap-2 text-gray-400 mb-1">
        <Calendar size={16} />
        <span className="text-sm font-medium">No upcoming meetings</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">Schedule a meeting from the Calendar page to see it here.</p>
      <button onClick={() => setCurrentUser(getCurrentUser())}
        className="text-[10px] font-bold text-blue-600 uppercase tracking-widest hover:underline">
        Refresh
      </button>
    </div>
  );

  return (
    <div className="mt-12 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
          <Clock size={13} /> Upcoming Meetings
        </h3>
        <button onClick={() => navigate('/calendar')}
          className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1">
          View Calendar <ChevronRight size={13} />
        </button>
      </div>

      {/* Cards */}
      <div className="grid gap-4">
        {events.map(event => (
          <MeetingCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
