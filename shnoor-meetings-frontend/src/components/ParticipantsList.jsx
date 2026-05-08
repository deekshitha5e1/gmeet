import React from 'react';
import { X, Users, UserMinus } from 'lucide-react';
import ProfileAvatar from './ProfileAvatar';

const ParticipantsList = React.memo(({ 
  participants = {}, 
  joinRequests = [], 
  isHost, 
  localClientId,
  onAdmit, 
  onDeny, 
  onRemoveParticipant,
  onClose 
}) => {
  const waitingIds = new Set(joinRequests.map((request) => request.id));
  const inCallParticipants = Object.entries(participants).filter(([id]) => !waitingIds.has(id));

  return (
    <aside className="fixed inset-y-0 right-0 z-20 w-80 bg-gray-800 border-l border-gray-700 flex flex-col shadow-2xl md:relative md:rounded-xl md:my-2 md:mr-2">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Users size={20} /> People
        </h2>
        <button className="text-gray-400 hover:text-white" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {isHost && joinRequests.length > 0 && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
            <h3 className="text-[10px] font-bold text-blue-200 uppercase tracking-wider mb-3">
              Waiting to join ({joinRequests.length})
            </h3>
            <div className="space-y-2">
              {joinRequests.map((req) => (
                <div key={req.id} className="space-y-3 rounded-lg bg-gray-900/70 p-3">
                  <div className="flex items-center gap-3">
                    <ProfileAvatar name={req.name} picture={req.picture} className="w-8 h-8" textClass="text-[10px]" />
                    <div className="min-w-0">
                      <span className="block text-sm font-semibold truncate">{req.name}</span>
                      <span className="text-xs text-gray-400">wants to join</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => onAdmit(req.id)}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => onDeny(req.id)}
                      className="rounded-lg bg-gray-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">In Call</h3>
          <div className="space-y-3">
            {inCallParticipants.map(([id, meta]) => {
              const canRemove = isHost && id !== localClientId && meta.role !== 'host';

              return (
              <div key={id} className="flex items-center gap-3">
                <ProfileAvatar name={meta.name} picture={meta.picture} className="w-8 h-8" textClass="text-[10px]" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">
                    {meta.name}{(meta.role === 'host' || meta.hostAccess === true) && ' (Host)'}
                  </span>
                  <span className="text-[10px] text-gray-500">{meta.role === 'host' ? 'Host' : 'Participant'}</span>
                </div>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => onRemoveParticipant?.(id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 hover:text-red-100"
                    title={`Remove ${meta.name || 'participant'}`}
                  >
                    <UserMinus size={14} />
                    Remove
                  </button>
                )}
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
});

ParticipantsList.displayName = 'ParticipantsList';
export default ParticipantsList;
