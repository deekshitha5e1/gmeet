import { useState, useEffect, useMemo } from 'react';
import { addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, isAfter } from 'date-fns';
import MeetingHeader from '../components/MeetingHeader';
import MeetingSidebar from '../components/MeetingSidebar';
import CalendarHeader from '../components/CalendarHeader';
import CalendarSidebar from '../components/CalendarSidebar';
import { MonthView, WeekView, DayView } from '../components/CalendarViews';
import EventModal from '../components/EventModal';
import { buildApiUrl } from '../utils/api';
import { normalizeEventCategory } from '../utils/calendarEventUtils';
import { getCurrentUser } from '../utils/currentUser';

function getCalendarIdentityKey(currentUser) {
  return currentUser?.email?.trim().toLowerCase() || currentUser?.meetingUserId || 'guest';
}

function getCalendarStorageKey(identityKey) {
  return `shnoor_calendar_events_${identityKey || 'guest'}`;
}

function readStoredEvents(userId) {
  try {
    const stored = localStorage.getItem(getCalendarStorageKey(userId));
    const parsed = JSON.parse(stored || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to read saved calendar events:', error);
    return [];
  }
}

function writeStoredEvents(userId, nextEvents) {
  try {
    localStorage.setItem(getCalendarStorageKey(userId), JSON.stringify(nextEvents));
  } catch (error) {
    console.error('Failed to store calendar events locally:', error);
  }
}

function mergeEvents(apiEvents, localEvents) {
  const eventMap = new Map();

  [...localEvents, ...apiEvents].forEach((event) => {
    if (!event?.id) {
      return;
    }

    eventMap.set(event.id, {
      ...event,
      category: normalizeEventCategory(event.category),
    });
  });

  return Array.from(eventMap.values()).sort(
    (a, b) => new Date(a.start_time) - new Date(b.start_time),
  );
}

async function persistEventToApi(event, currentUser, options = {}) {
  const isEditing = Boolean(options.isEditing);
  const method = isEditing ? 'PUT' : 'POST';
  const url = isEditing
    ? buildApiUrl(`/api/calendar/events/${event.id}`)
    : buildApiUrl('/api/calendar/events');

  const payload = {
    ...event,
    category: normalizeEventCategory(event.category),
    user_id: currentUser?.meetingUserId || null,
    user_email: currentUser?.email || null,
    user_name: currentUser?.name || 'Guest',
    room_id: normalizeEventCategory(event.category) === 'meetings'
      ? (event.room_id || event.id || crypto.randomUUID())
      : null,
  };

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Calendar API request failed');
  }

  return payload;
}

export default function CalendarPage() {
  const currentUser = getCurrentUser();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('Month');
  const [events, setEvents] = useState([]);
  const [activeCategories, setActiveCategories] = useState(['personal', 'meetings', 'reminders']);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    const userId = currentUser?.meetingUserId || null;
    const userEmail = currentUser?.email?.trim().toLowerCase() || null;
    const identityKey = getCalendarIdentityKey(currentUser);
    const localEvents = readStoredEvents(identityKey);

    try {
      const params = new URLSearchParams();
      if (userEmail) {
        params.set('user_email', userEmail);
      } else if (userId) {
        params.set('user_id', userId);
      }
      const query = params.toString() ? `?${params.toString()}` : '';
      const response = await fetch(buildApiUrl(`/api/calendar/events${query}`));
      if (response.ok) {
        const data = await response.json();
        const apiEventIds = new Set((Array.isArray(data) ? data : []).map((event) => event.id));

        for (const localEvent of localEvents) {
          if (!apiEventIds.has(localEvent.id)) {
            try {
              await persistEventToApi(localEvent, currentUser, { isEditing: false });
            } catch (syncError) {
              console.error('Failed to sync local calendar event to API:', syncError);
            }
          }
        }

        const refreshResponse = await fetch(buildApiUrl(`/api/calendar/events${query}`));
        const refreshedData = refreshResponse.ok ? await refreshResponse.json() : data;
        const mergedEvents = mergeEvents(refreshedData, localEvents);
        setEvents(mergedEvents);
        writeStoredEvents(identityKey, mergedEvents);
        return;
      }

      const errorText = await response.text();
      console.error('Failed to fetch events from API:', errorText);
    } catch (err) {
      console.error('Failed to fetch events:', err);
    }

    setEvents(mergeEvents([], localEvents));
  };

  const handlePrev = () => {
    if (view === 'Month') setCurrentDate(subMonths(currentDate, 1));
    else if (view === 'Week') setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const handleNext = () => {
    if (view === 'Month') setCurrentDate(addMonths(currentDate, 1));
    else if (view === 'Week') setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addDays(currentDate, 1));
  };

  const handleToday = () => setCurrentDate(new Date());

  const handleDateClick = (date) => {
    setSelectedDate(date);
    setSelectedEvent(null);
    setIsModalOpen(true);
  };

  const handleToggleCategory = (category) => {
    setActiveCategories((prev) => (
      prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category]
    ));
  };

  const handleSaveEvent = async (eventData) => {
    const payload = {
      ...eventData,
      category: normalizeEventCategory(eventData.category),
      user_id: currentUser?.meetingUserId || null,
      user_email: currentUser?.email || null,
      user_name: currentUser?.name || 'Guest',
      room_id: normalizeEventCategory(eventData.category) === 'meetings'
        ? (eventData.room_id || eventData.id || crypto.randomUUID())
        : null,
    };

    const identityKey = getCalendarIdentityKey(currentUser);
    const existingLocalEvents = readStoredEvents(identityKey);
    const nextLocalEvents = mergeEvents(
      [{
        ...payload,
        id: eventData.id,
      }],
      existingLocalEvents.filter((event) => event.id !== eventData.id),
    );

    writeStoredEvents(identityKey, nextLocalEvents);
    setEvents(nextLocalEvents);
    setIsModalOpen(false);

    try {
      await persistEventToApi(payload, currentUser, { isEditing: Boolean(selectedEvent?.id) });
      await fetchEvents();
    } catch (err) {
      console.error('Failed to save event:', err);
    }
  };

  const handleRemoveEvent = async (eventId) => {
    if (!eventId) {
      return;
    }

    const identityKey = getCalendarIdentityKey(currentUser);
    const existingLocalEvents = readStoredEvents(identityKey);
    const nextLocalEvents = existingLocalEvents.filter((event) => event.id !== eventId);

    writeStoredEvents(identityKey, nextLocalEvents);
    setEvents((prev) => prev.filter((event) => event.id !== eventId));

    try {
      const response = await fetch(buildApiUrl(`/api/calendar/events/${eventId}`), {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await fetchEvents();
    } catch (err) {
      console.error('Failed to remove calendar event:', err);
      await fetchEvents();
    }
  };

  const filteredEvents = useMemo(() => (
    events.filter((event) => activeCategories.includes(normalizeEventCategory(event.category)))
  ), [activeCategories, events]);

  const upcomingReminders = useMemo(() => (
    events
      .filter((event) => normalizeEventCategory(event.category) === 'reminders' && isAfter(new Date(event.start_time), new Date()))
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
  ), [events]);

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden text-gray-900">
      <MeetingHeader />
      
      <div className="flex flex-1 overflow-hidden">
        <MeetingSidebar />
        <CalendarSidebar
          currentDate={currentDate}
          onDateSelect={setCurrentDate}
          onCreateEvent={() => {
            setSelectedEvent(null);
            setSelectedDate(new Date());
            setIsModalOpen(true);
          }}
          activeCategories={activeCategories}
          onToggleCategory={handleToggleCategory}
          upcomingReminders={upcomingReminders}
        />
        
        <main className="flex-1 flex flex-col min-w-0">
          <CalendarHeader 
            currentDate={currentDate} 
            onPrev={handlePrev} 
            onNext={handleNext} 
            onToday={handleToday}
            view={view}
            setView={setView}
          />
          {view === 'Month' && (
            <MonthView 
              currentDate={currentDate} 
              events={filteredEvents} 
              onDateClick={handleDateClick} 
              onRemoveEvent={handleRemoveEvent}
            />
          )}
          {view === 'Week' && (
            <WeekView 
              currentDate={currentDate} 
              events={filteredEvents} 
              onSlotClick={handleDateClick} 
              onRemoveEvent={handleRemoveEvent}
            />
          )}
          {view === 'Day' && (
            <DayView 
              currentDate={currentDate} 
              events={filteredEvents} 
              onSlotClick={handleDateClick} 
              onRemoveEvent={handleRemoveEvent}
            />
          )}
        </main>
      </div>

      <EventModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        selectedDate={selectedDate}
        onSave={handleSaveEvent}
        event={selectedEvent}
      />
    </div>
  );
}
