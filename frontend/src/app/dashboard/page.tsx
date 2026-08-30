'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import TripList from '@/components/TripList';
import CreateTripModal from '@/components/CreateTripModal';
import JoinTripModal from '@/components/JoinTripModal';

export default function DashboardPage() {
  const router = useRouter();
  const { user, token, trips, fetchMe, fetchTrips, logout } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }
    Promise.all([fetchMe(), fetchTrips()]).finally(() => setLoading(false));
  }, [token, fetchMe, fetchTrips, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-8 h-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h1 className="text-xl font-bold text-gray-900">Trip Tracker</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user.displayName}</span>
            <button
              onClick={logout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Your Trips</h2>
            <p className="text-gray-500 mt-1">Manage and join group trips</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowJoin(true)}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Join Trip
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
            >
              Create Trip
            </button>
          </div>
        </div>

        <TripList
          trips={trips}
          onSelect={(tripId) => router.push(`/trip/${tripId}`)}
        />
      </main>

      {showCreate && <CreateTripModal onClose={() => setShowCreate(false)} />}
      {showJoin && <JoinTripModal onClose={() => setShowJoin(false)} />}
    </div>
  );
}
