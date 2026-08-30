'use client';

interface MemberListProps {
  members: any[];
  devices: any[];
  liveLocations: any[];
  followDeviceId: string | null;
  onFollow: (deviceId: string | null) => void;
  currentUserId?: string;
  isPrimaryAdmin: boolean;
  isAdmin: boolean;
  onPromote: (userId: string, role: string) => void;
}

export default function MemberList({
  members, devices, liveLocations, followDeviceId, onFollow, currentUserId, isPrimaryAdmin, isAdmin, onPromote
}: MemberListProps) {
  return (
    <div className="bg-white border-t border-gray-200 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 text-sm">
          Members ({members.length})
        </h3>
        <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
          Sharing Active
        </span>
      </div>

      <div className="space-y-1 max-h-[160px] overflow-y-auto">
        {members.map((member) => {
          const memberDevices = devices.filter((d: any) => d.ownerName === member.displayName);
          const memberLocations = liveLocations.filter((l: any) =>
            memberDevices.some((d: any) => d.id === l.deviceId)
          );
          const hasLiveLocation = memberLocations.length > 0;
          const isCurrentUser = member.userId === currentUserId;
          const isThisAdmin = member.role === 'admin';

          return (
            <div key={member.userId} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50">
              <div className="relative shrink-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                  hasLiveLocation ? 'bg-blue-500' : 'bg-gray-400'
                }`}>
                  {member.displayName.charAt(0).toUpperCase()}
                </div>
                {hasLiveLocation && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white"></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {member.displayName}
                  </span>
                  {isCurrentUser && (
                    <span className="text-xs text-gray-400 font-normal">(You)</span>
                  )}
                  {isThisAdmin && (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">Admin</span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {hasLiveLocation ? (
                    <span className="text-green-600 font-medium">Live</span>
                  ) : (
                    <span className="text-gray-400">Connected</span>
                  )}
                  {memberLocations.length > 0 && memberLocations[0].speed > 0 && (
                    <span> &middot; {(memberLocations[0].speed * 3.6).toFixed(0)} km/h</span>
                  )}
                  {memberLocations.length > 0 && memberLocations[0].batteryLevel !== undefined && (
                    <span> &middot; {memberLocations[0].batteryLevel}%</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {hasLiveLocation && (
                  <button
                    onClick={() => onFollow(followDeviceId === memberLocations[0].deviceId ? null : memberLocations[0].deviceId)}
                    className={`p-2 rounded-lg transition-colors ${
                      followDeviceId === memberLocations[0].deviceId
                        ? 'bg-blue-100 text-blue-600'
                        : 'text-gray-400 hover:bg-gray-100'
                    }`}
                    title={followDeviceId === memberLocations[0].deviceId ? 'Unfollow' : 'Follow'}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                )}
                {isPrimaryAdmin && !isCurrentUser && (
                  <button
                    onClick={() => onPromote(member.userId, isThisAdmin ? 'member' : 'admin')}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                      isThisAdmin
                        ? 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                    title={isThisAdmin ? 'Remove admin' : 'Make admin'}
                  >
                    {isThisAdmin ? 'Demote' : 'Make Admin'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
