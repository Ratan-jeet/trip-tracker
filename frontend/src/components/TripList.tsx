'use client';

interface TripListProps {
  trips: any[];
  onSelect: (tripId: string) => void;
}

export default function TripList({ trips, onSelect }: TripListProps) {
  if (trips.length === 0) {
    return (
      <div className="text-center py-16">
        <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 mb-1">No trips yet</h3>
        <p className="text-gray-500">Create or join a trip to get started</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((trip) => (
        <button
          key={trip.id}
          onClick={() => onSelect(trip.id)}
          className="text-left bg-white rounded-xl border border-gray-200 p-5 hover:border-primary-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-start justify-between mb-3">
            <h3 className="font-bold text-gray-900 group-hover:text-primary-600 transition-colors">
              {trip.name}
            </h3>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              trip.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {trip.isActive ? 'Active' : 'Ended'}
            </span>
          </div>

          {trip.description && (
            <p className="text-sm text-gray-500 mb-3 line-clamp-2">{trip.description}</p>
          )}

          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {trip.memberCount} members
            </span>
            <span className={`flex items-center gap-1 ${trip.isSharing ? 'text-green-600' : ''}`}>
              <span className={`w-2 h-2 rounded-full ${trip.isSharing ? 'bg-green-500' : 'bg-gray-300'}`}></span>
              {trip.isSharing ? 'Sharing' : 'Not sharing'}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className={`px-2 py-0.5 text-xs rounded-full ${
              trip.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {trip.role}
            </span>
            <span className="text-xs text-gray-400">
              Code: {trip.inviteCode}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
