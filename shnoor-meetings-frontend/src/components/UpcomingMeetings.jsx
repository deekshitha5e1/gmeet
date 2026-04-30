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
    // Over 1.5 hours past start
    if (diffMs < -5400000) {
      return { label: 'Ended', urgent: false, started: false };
    }
    return { label: 'Started', urgent: true, started: true };
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

/** Single meeting card with live countdown badge and full details */
function MeetingCard({ event, onRefresh }) {
  const navigate = useNavigate();
  const countdown = useCountdown(event.start_time);
  const [showDetails, setShowDetails] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const meetingUrl = event.room_id ? `${window.location.origin}/meeting/${event.room_id}?role=participant` : '';

  const handleCardClick = () => {
    setShowDetails(!showDetails);
  };

  const handleJoin = (e) => {
    e.stopPropagation();
    if (event.room_id) navigate(`/meeting/${event.room_id}`);
  };

  const handleCopyLink = (e) => {
    e.stopPropagation();
    if (!meetingUrl) return;
    navigator.clipboard.writeText(meetingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCancel = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to cancel "${event.title}"?`)) return;

    setIsDeleting(true);
    try {
      const res = await fetch(buildApiUrl(`/api/calendar/events/${event.id}`), {
        method: 'DELETE',
      });
      if (res.ok) {
        const user = getCurrentUser();
        const identityKey = user?.email?.trim().toLowerCase() || user?.meetingUserId || 'guest';
        const storageKey = `shnoor_calendar_events_${identityKey}`;
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const events = JSON.parse(stored);
          const filtered = events.filter(ev => ev.id !== event.id);
          localStorage.setItem(storageKey, JSON.stringify(filtered));
          window.dispatchEvent(new Event('storage'));
        }
        onRefresh?.();
      } else {
        alert("Failed to cancel meeting.");
      }
    } catch (err) {
      console.error("Cancel meeting error:", err);
      alert("Error connecting to server.");
    } finally {
      setIsDeleting(false);
    }
  };

  const isLive    = countdown.started;
  const isUrgent  = countdown.urgent && !countdown.started;

  return (
    <div
      className={`group relative bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer ${
        isLive   ? 'border-emerald-200 ring-1 ring-emerald-100 hover:border-emerald-300' :
        isUrgent ? 'border-amber-200 ring-1 ring-amber-100 hover:border-amber-300' :
                   'border-gray-100 hover:border-blue-100'
      } ${isDeleting ? 'opacity-50 grayscale pointer-events-none' : ''}`}
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
              <span>•</span>
              <span>{format(new Date(event.start_time), 'MMM d, yyyy')}</span>
            </div>
          </div>

          {/* ── Countdown badge ── */}
          <div className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-black border shadow-sm ${
            isLive
              ? 'bg-emerald-500 text-white border-emerald-500 animate-pulse'
              : isUrgent
              ? 'bg-amber-50 text-amber-700 border-amber-300'
              : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}>
            {isLive ? (
              <><Zap size={12} className="fill-white" /> LIVE</>
            ) : (
              <><Clock size={12} /> {countdown.label}</>
            )}
          </div>
        </div>

        {/* ── Summary Details ── */}
        {!showDetails && event.description && (
          <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">
            <AlignLeft size={13} className="text-gray-400 mt-0.5 shrink-0" />
            <p className="line-clamp-2 leading-relaxed italic">{event.description}</p>
          </div>
        )}

        {/* ── Full Details Expansion ── */}
        {showDetails && (
          <div className="space-y-4 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Time Range */}
            <div className="flex flex-col gap-1 px-1">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <Calendar size={10} /> Full Schedule
              </div>
              <div className="text-xs text-gray-700 font-medium bg-gray-50 p-2 rounded-lg border border-gray-100">
                {format(new Date(event.start_time), 'EEEE, MMMM d')} • {format(new Date(event.start_time), 'h:mm a')}
                {event.end_time && ` to ${format(new Date(event.end_time), 'h:mm a')}`}
              </div>
            </div>

            {/* Meeting Link */}
            {meetingUrl && (
              <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3">
                <div className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <Zap size={10} /> Meeting Link Ready
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-[11px] text-blue-700 font-medium truncate bg-white px-2 py-1.5 rounded border border-blue-100">
                    {meetingUrl}
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className="p-1.5 bg-white border border-blue-200 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors shadow-sm"
                    title="Copy Link"
                  >
                    {copied ? <Zap size={14} className="fill-blue-600" /> : <Link size={14} />}
                  </button>
                </div>
              </div>
            )}

            {/* Description */}
            {event.description && (
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Description</div>
                <div className="text-xs text-gray-600 bg-gray-50 p-3 rounded-xl border border-gray-100 leading-relaxed italic">
                  {event.description}
                </div>
              </div>
            )}

            {/* Guest Emails */}
            {event.guest_emails?.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Participants</div>
                <div className="flex flex-wrap gap-1.5">
                  {event.guest_emails.map((email, idx) => (
                    <span key={idx} className="text-[10px] text-gray-600 bg-white px-2.5 py-1 rounded-full border border-gray-200 shadow-sm flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      {email}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Footer: reminder + guests + join/cancel buttons ── */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-50">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Reminder badge */}
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
              <Bell size={11} />
              {event.reminder_offset_minutes === 60 ? '1 hour' : `${event.reminder_offset_minutes ?? 5} mins`} before
            </span>

            {/* Guest count */}
            {event.guest_emails?.length > 0 && !showDetails && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                <Users size={11} />
                {event.guest_emails.length + 1} people
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Cancel Button */}
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-500 hover:bg-red-50 transition-colors"
            >
              Cancel
            </button>

            {/* Join button */}
            {event.room_id && (
              <button
                onClick={handleJoin}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold shadow-sm transition-all hover:scale-105 active:scale-95 ${
                  isLive || isUrgent
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isLive ? '▶ Join Now' : 'Join'}
              </button>
            )}
          </div>
        </div>
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
  const [refreshCount, setRefreshCount] = useState(0);
  const navigate = useNavigate();

  const triggerRefresh = () => setRefreshCount(c => c + 1);

  /* Sync user and trigger reload when localStorage changes */
  useEffect(() => {
    const handle = () => {
      setCurrentUser(getCurrentUser());
      triggerRefresh();
    };
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
        // First retrieve any local events to guarantee immediate consistency
        const identityKey = userEmail || userId || 'guest';
        let localEvents = [];
        try {
          const stored = localStorage.getItem(`shnoor_calendar_events_${identityKey}`);
          if (stored) localEvents = JSON.parse(stored);
        } catch (e) {
          console.error("Failed parsing localStorage events in UpcomingMeetings", e);
        }
        if (!Array.isArray(localEvents)) localEvents = [];

        const params = new URLSearchParams();
        if (userEmail)   params.set('user_email', userEmail);
        else if (userId) params.set('user_id', userId);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(buildApiUrl(`/api/calendar/events?${params}`), {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        let data = [];
        if (res.ok) {
          data = await res.json();
        } else {
          console.warn("Failed API fetch, falling back to local events.");
        }
        
        // Merge API data with local data just like CalendarPage does
        const eventMap = new Map();
        [...localEvents, ...(Array.isArray(data) ? data : [])].forEach(ev => {
          if (ev && ev.id) eventMap.set(ev.id, ev);
        });
        const mergedData = Array.from(eventMap.values());

        const now  = new Date();
        const upcoming = mergedData
          .filter(e => {
            const cat = (e.category || '').trim().toLowerCase();
            if (cat === 'reminders' || cat === 'reminder') return false;

            const start = new Date(e.start_time);
            const end = e.end_time ? new Date(e.end_time) : null;
            
            // Safer same-day check: compare Year, Month, Date
            const isToday = 
              start.getFullYear() === now.getFullYear() &&
              start.getMonth() === now.getMonth() &&
              start.getDate() === now.getDate();

            // Future check
            const isFuture = start > now;
            
            // Is it happening right now?
            const isCurrentlyHappening = end ? (start <= now && end >= now) : false;

            return isToday || isFuture || isCurrentlyHappening;
          })
          .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
          .slice(0, 10);
          
        setEvents(upcoming);
      } catch (err) {
        console.error('UpcomingMeetings fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    load();

    // Auto-refresh every 60 s so newly-scheduled meetings appear without a reload
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [currentUser, refreshCount]);

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
      <button onClick={triggerRefresh}
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
      <button onClick={triggerRefresh}
        className="text-[10px] font-bold text-blue-600 uppercase tracking-widest hover:underline">
        Refresh
      </button>
    </div>
  );

  return (
    <div className="mt-12 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
          <Clock size={13} /> Upcoming Meetings
        </h3>
        <button 
          onClick={() => navigate('/calendar')}
          className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-full transition-all shadow-sm"
        >
          View Full Calendar <ChevronRight size={14} />
        </button>
      </div>

      {/* Cards */}
      <div className="grid gap-4">
        {events.map(event => (
          <MeetingCard key={event.id} event={event} onRefresh={triggerRefresh} />
        ))}
      </div>
    </div>
  );
}
