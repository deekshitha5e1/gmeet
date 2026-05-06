import { useState, useEffect } from 'react';
import { X, Clock, AlignLeft, Video, Calendar, Copy, Target, List, User, ChevronDown, MapPin, Users, Check, Briefcase, MinusCircle, Lock, HelpCircle } from 'lucide-react';
import { format, addHours, startOfToday, isBefore, isValid } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { getCurrentUser } from '../utils/currentUser';
import {
  buildMeetingLink,
  getReminderOffsetMinutes,
  normalizeEventCategory,
} from '../utils/calendarEventUtils';

function toLocalDateTimeInputValue(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function EventModal({ isOpen, onClose, selectedDate, onSave, event = null, initialCategory = 'meetings' }) {
  const currentUser = getCurrentUser();
  const [activeTab, setActiveTab] = useState('meetings');
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [category, setCategory] = useState(normalizeEventCategory(event?.category));
  const [roomId, setRoomId] = useState(event?.room_id || '');
  const [reminderOffsetMinutes, setReminderOffsetMinutes] = useState(5);
  const [guestEmails, setGuestEmails] = useState(event?.guest_emails || []);
  const [newGuestEmail, setNewGuestEmail] = useState('');
  const [participantEmails, setParticipantEmails] = useState(event?.participant_emails || []);
  const [newParticipantEmail, setNewParticipantEmail] = useState('');
  const [validationMessage, setValidationMessage] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [location, setLocation] = useState(event?.location || '');
  const [guestPermissions, setGuestPermissions] = useState(() => {
    try {
      return JSON.parse(event?.guest_permissions || '{"modify": false, "invite": true, "seeGuestList": true}');
    } catch {
      return { modify: false, invite: true, seeGuestList: true };
    }
  });
  const [availability, setAvailability] = useState(event?.availability || 'free');
  const [visibility, setVisibility] = useState(event?.visibility || 'private');
  const [dnd, setDnd] = useState(event?.dnd || false);

  useEffect(() => {
    if (isOpen) {
      if (event) {
        setTitle(event.title);
        setDescription(event.description);
        setStartTime(toLocalDateTimeInputValue(event.start_time));
        setEndTime(toLocalDateTimeInputValue(event.end_time));
        setCategory(normalizeEventCategory(event.category));
        setRoomId(event.room_id || '');
        setReminderOffsetMinutes(getReminderOffsetMinutes(event.reminder_offset_minutes));
        setGuestEmails(event.guest_emails || []);
        setNewGuestEmail('');
        setParticipantEmails(event.participant_emails || []);
        setNewParticipantEmail('');
        setValidationMessage('');
        setCopyMessage('');
        setLocation(event.location || '');
        try {
          setGuestPermissions(JSON.parse(event.guest_permissions || '{"modify": false, "invite": true, "seeGuestList": true}'));
        } catch {
          setGuestPermissions({ modify: false, invite: true, seeGuestList: true });
        }
        setAvailability(event.availability || 'free');
        setVisibility(event.visibility || 'private');
        setDnd(event.dnd || false);
      } else {
        setTitle('');
        setDescription('');
        const start = new Date(selectedDate || new Date());
        start.setHours(new Date().getHours() + 1, 0, 0, 0);
        const end = addHours(start, 1);
        setStartTime(format(start, "yyyy-MM-dd'T'HH:mm"));
        setEndTime(format(end, "yyyy-MM-dd'T'HH:mm"));
        setCategory(normalizeEventCategory(initialCategory || 'meetings'));
        setRoomId('');
        setReminderOffsetMinutes(5);
        setGuestEmails([]);
        setNewGuestEmail('');
        setParticipantEmails([]);
        setNewParticipantEmail('');
        setValidationMessage('');
        setCopyMessage('');
        setLocation('');
        setGuestPermissions({ modify: false, invite: true, seeGuestList: true });
        setAvailability('free');
        setVisibility('private');
        setDnd(false);
        setActiveTab(normalizeEventCategory(initialCategory || 'meetings'));
      }
    }
  }, [isOpen, event, selectedDate, initialCategory]);

  const tabs = [
    { id: 'meetings', label: 'Event' },
    { id: 'reminders', label: 'Task' },
  ];

  const meetingLink = category === 'meetings' ? buildMeetingLink(roomId) : '';

  const submitEvent = (nextCategory) => {
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    if (isBefore(startDate, startOfToday())) {
      setValidationMessage('Only today and future dates can be saved in calendar.');
      return;
    }

    if (endDate < startDate) {
      setValidationMessage('End time must be after start time.');
      return;
    }

    setValidationMessage('');
    const normalizedCategory = normalizeEventCategory(activeTab || nextCategory);
    const nextRoomId = normalizedCategory === 'meetings' ? (roomId || event?.room_id || crypto.randomUUID()) : null;
    
    // For tasks, default to 5 minutes if not specified, 
    // and ensure guest_emails includes currentUser if empty
    const finalReminderOffset = normalizedCategory === 'reminders' ? 5 : getReminderOffsetMinutes(reminderOffsetMinutes);
    const finalGuestEmails = (normalizedCategory === 'reminders' && guestEmails.length === 0 && currentUser?.email) 
      ? [currentUser.email] 
      : guestEmails;

    onSave({
      id: event?.id || crypto.randomUUID(),
      title: title || '(No title)',
      description,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      category: normalizedCategory,
      room_id: nextRoomId,
      reminder_offset_minutes: finalReminderOffset,
      guest_emails: finalGuestEmails,
      participant_emails: participantEmails,
      location,
      guest_permissions: JSON.stringify(guestPermissions),
      availability,
      visibility,
      dnd,
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    submitEvent(category);
  };

  const handleGenerateMeetingLink = () => {
    setCategory('meetings');
    setRoomId((prev) => prev || event?.room_id || crypto.randomUUID());
    setValidationMessage('');
  };

  const handleCopyMeetingLink = async () => {
    if (!meetingLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(meetingLink);
      setCopyMessage('Meeting link copied');
      window.setTimeout(() => setCopyMessage(''), 2000);
    } catch (error) {
      console.error('Failed to copy generated meeting link:', error);
      setCopyMessage('Copy failed');
      window.setTimeout(() => setCopyMessage(''), 2000);
    }
  };

  const handleAddGuestEmail = () => {
    const trimmed = newGuestEmail.trim().toLowerCase();
    if (trimmed && trimmed.includes('@')) {
      if (!guestEmails.includes(trimmed)) {
        setGuestEmails([...guestEmails, trimmed]);
      }
      setNewGuestEmail('');
    } else {
      setValidationMessage('Please enter a valid email address.');
      window.setTimeout(() => setValidationMessage(''), 3000);
    }
  };

  const handleRemoveGuestEmail = (emailToRemove) => {
    setGuestEmails(guestEmails.filter(e => e !== emailToRemove));
  };

  const handleAddParticipantEmail = () => {
    const trimmed = newParticipantEmail.trim().toLowerCase();
    if (trimmed && trimmed.includes('@')) {
      if (!participantEmails.includes(trimmed)) {
        setParticipantEmails([...participantEmails, trimmed]);
      }
      setNewParticipantEmail('');
    } else {
      setValidationMessage('Please enter a valid participant email.');
      window.setTimeout(() => setValidationMessage(''), 3000);
    }
  };

  const handleRemoveParticipantEmail = (emailToRemove) => {
    setParticipantEmails(participantEmails.filter(e => e !== emailToRemove));
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-50 bg-white">
              <h3 className="text-xl font-semibold text-gray-800">
                {activeTab === 'reminders' 
                  ? (event ? 'Edit Task' : 'New Task') 
                  : (event ? 'Edit Event' : 'New Event')}
              </h3>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
              >
                <X size={22} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="px-6 py-4 space-y-6 overflow-y-auto flex-1 scrollbar-hide">
                {activeTab === 'reminders' ? (
                  /* Task Specific View (New Layout) */
                  <div className="space-y-6 px-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="relative group">
                      <input
                        type="text"
                        placeholder="Add title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full bg-transparent border-b-2 border-transparent focus:border-blue-600 px-0 py-2 text-2xl font-medium text-gray-800 outline-none transition-all placeholder-gray-400"
                        autoFocus
                      />
                    </div>
                    
                    <div className="flex items-start gap-4">
                      <Clock size={20} className="text-gray-400 mt-1" />
                      <div className="flex-1">
                        <div className="text-sm text-gray-700 font-medium">
                          {isValid(new Date(startTime)) ? format(new Date(startTime), 'EEEE, d MMMM') : 'Invalid date'}
                          <span className="ml-4">
                            {isValid(new Date(startTime)) ? format(new Date(startTime), 'h:mm a') : ''}
                            {isValid(new Date(endTime)) ? ` - ${format(new Date(endTime), 'h:mm a')}` : ''}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Doesn't repeat</div>
                        <div className="mt-3 flex gap-2">
                           <input
                            type="datetime-local"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 text-xs text-gray-600 outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <Target size={20} className="text-gray-400" />
                      <button type="button" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
                        Add deadline
                      </button>
                    </div>

                    <div className="flex items-start gap-4">
                      <AlignLeft size={20} className="text-gray-400 mt-2" />
                      <div className="flex-1 bg-gray-50 rounded-xl p-4 min-h-[100px] hover:bg-gray-100 transition-colors cursor-text">
                        <textarea
                          placeholder="Add description"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          className="w-full bg-transparent text-sm text-gray-700 outline-none resize-none placeholder-gray-500"
                          rows={3}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <List size={20} className="text-gray-400" />
                      <div className="relative">
                        <button 
                          type="button"
                          className="flex items-center gap-2 bg-gray-50 hover:bg-gray-100 px-4 py-2 rounded-lg text-sm text-gray-700 transition-colors"
                        >
                          My Tasks
                          <ChevronDown size={14} className="text-gray-400" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4 pt-2">
                      <div className="flex items-center gap-4">
                        <Calendar size={20} className="text-gray-400" />
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-700">{currentUser?.name || 'Guest'}</span>
                          <div className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 px-2 py-1.5 rounded-lg cursor-pointer transition-colors">
                            <div className="w-4 h-4 rounded-full bg-blue-500" />
                            <ChevronDown size={14} className="text-gray-400" />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <Briefcase size={20} className="text-gray-400" />
                        <div className="relative">
                          <select
                            value={availability}
                            onChange={(e) => setAvailability(e.target.value)}
                            className="appearance-none bg-gray-100 hover:bg-gray-200 px-4 py-2 pr-8 rounded-lg text-sm text-gray-700 transition-colors outline-none cursor-pointer"
                          >
                            <option value="free">Free</option>
                            <option value="busy">Busy</option>
                          </select>
                          <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <button 
                          type="button"
                          onClick={() => setDnd(!dnd)}
                          className="flex items-start gap-4 text-left w-full group"
                        >
                          <MinusCircle size={20} className={`${dnd ? 'text-red-500' : 'text-gray-300'} mt-0.5 transition-colors`} />
                          <div>
                            <div className={`text-sm ${dnd ? 'text-gray-900 font-semibold' : 'text-gray-700'} transition-colors`}>Do Not Disturb</div>
                            <div className="text-xs text-gray-400">Mute chat notifications</div>
                          </div>
                        </button>
                      </div>

                      <div className="flex items-center gap-4">
                        <Lock size={20} className="text-gray-400" />
                        <div className="flex items-center gap-2">
                          <div className="relative">
                            <select
                              value={visibility}
                              onChange={(e) => setVisibility(e.target.value)}
                              className="appearance-none bg-gray-100 hover:bg-gray-200 px-4 py-2 pr-8 rounded-lg text-sm text-gray-700 transition-colors outline-none cursor-pointer"
                            >
                              <option value="private">Private</option>
                              <option value="public">Public</option>
                              <option value="default">Default visibility</option>
                            </select>
                            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          </div>
                          <HelpCircle size={16} className="text-gray-400 cursor-help" />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Original Event View (Previous UI) */
                  <div className="space-y-6 px-2 animate-in fade-in duration-300">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Event Title</label>
                      <input
                        type="text"
                        placeholder="Add title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-2xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all placeholder-gray-400"
                        autoFocus
                      />
                    </div>

                    <div className="flex items-start gap-6 text-gray-600">
                      <div className="mt-8"><Clock size={20} className="text-gray-400" /></div>
                      <div className="flex-1 space-y-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Start Time</label>
                          <input
                            type="datetime-local"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none w-full transition-all cursor-pointer"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">End Time</label>
                          <input
                            type="datetime-local"
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none w-full transition-all cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-gray-600">
                      <div><Video size={20} className="text-gray-400" /></div>
                      <div className="flex-1 space-y-3">
                        <button
                          type="button"
                          onClick={handleGenerateMeetingLink}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-xl font-bold shadow-lg shadow-blue-100 transition-all flex items-center justify-center gap-3 transform active:scale-95"
                        >
                          {meetingLink ? 'Shnoor Meeting Link Ready' : 'Add Shnoor Meeting'}
                        </button>
                        {meetingLink && (
                          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-bold uppercase tracking-widest text-blue-600">
                                  Meeting Link
                                </div>
                                <div className="mt-1 break-all text-sm text-blue-900">
                                  {meetingLink}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={handleCopyMeetingLink}
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-blue-700 shadow-sm transition hover:bg-blue-100"
                                title="Copy meeting link"
                              >
                                <Copy size={16} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-6 text-gray-600">
                      <div className="mt-2"><MapPin size={20} className="text-gray-400" /></div>
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Location</label>
                        <input
                          type="text"
                          placeholder="Add location"
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all placeholder-gray-400"
                        />
                      </div>
                    </div>

                    <div className="flex items-start gap-6 text-gray-600">
                      <div className="mt-2"><Users size={20} className="text-gray-400" /></div>
                      <div className="flex-1 space-y-6">
                        {/* Guest Emails Section */}
                        <div className="space-y-3">
                          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Guest Emails</label>
                          <div className="flex gap-2">
                            <input
                              type="email"
                              placeholder="Add guest email"
                              value={newGuestEmail}
                              onChange={(e) => setNewGuestEmail(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddGuestEmail();
                                }
                              }}
                              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all placeholder-gray-400"
                            />
                            <button
                              type="button"
                              onClick={handleAddGuestEmail}
                              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md transition-colors"
                            >
                              Add Guest
                            </button>
                          </div>
                          {guestEmails.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {guestEmails.map(email => (
                                <div key={email} className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-xs font-medium border border-blue-100">
                                  {email}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveGuestEmail(email)}
                                    className="text-blue-400 hover:text-blue-800 focus:outline-none"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Guest Permissions Section */}
                        <div className="pt-4 border-t border-gray-50">
                          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Guest Permissions</label>
                          <div className="mt-3 space-y-3">
                            {[
                              ['modify', 'Modify event'],
                              ['invite', 'Invite others'],
                              ['seeGuestList', 'See guest list'],
                            ].map(([key, label]) => (
                              <label key={key} className="flex items-center gap-3 cursor-pointer group">
                                <div className="relative flex items-center justify-center">
                                  <input
                                    type="checkbox"
                                    checked={guestPermissions[key]}
                                    onChange={(e) => setGuestPermissions({...guestPermissions, [key]: e.target.checked})}
                                    className="peer h-5 w-5 appearance-none rounded border border-gray-300 transition-all checked:bg-blue-600 checked:border-blue-600"
                                  />
                                  <Check className="absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" />
                                </div>
                                <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">{label}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Participant Emails Section */}
                        <div className="space-y-3 pt-4 border-t border-gray-50">
                          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Participant Emails</label>
                          <div className="flex gap-2">
                            <input
                              type="email"
                              placeholder="Add participant email"
                              value={newParticipantEmail}
                              onChange={(e) => setNewParticipantEmail(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddParticipantEmail();
                                }
                              }}
                              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all placeholder-gray-400"
                            />
                            <button
                              type="button"
                              onClick={handleAddParticipantEmail}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md transition-colors"
                            >
                              Add Participant
                            </button>
                          </div>
                          {participantEmails.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {participantEmails.map(email => (
                                <div key={email} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full text-xs font-medium border border-emerald-100">
                                  {email}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveParticipantEmail(email)}
                                    className="text-emerald-400 hover:text-emerald-800 focus:outline-none"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-6 text-gray-600">
                      <div className="mt-2"><Calendar size={20} className="text-gray-400" /></div>
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Category</label>
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
                        >
                          <option value="personal">Personal</option>
                          <option value="meetings">Event (Meetings)</option>
                          <option value="reminders">Task (Reminders)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-start gap-6 text-gray-600">
                      <div className="mt-2"><AlignLeft size={20} className="text-gray-400" /></div>
                      <div className="flex-1 space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Description</label>
                        <textarea
                          placeholder="Add description"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none min-h-[100px] resize-none transition-all placeholder-gray-400"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {validationMessage && (
                  <div className="mx-2 p-3 bg-red-50 border border-red-100 rounded-lg text-xs font-medium text-red-600">
                    {validationMessage}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 p-4 border-t border-gray-50 bg-white">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-8 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-lg shadow-blue-100 transition-all transform hover:scale-105 active:scale-95"
                >
                  Save
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
