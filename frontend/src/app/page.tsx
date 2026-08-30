'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();
  const { user, token, fetchMe } = useStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      fetchMe().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token, fetchMe]);

  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900">
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 rounded-2xl mb-6 backdrop-blur-sm">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-5xl font-bold text-white mb-4">Trip Tracker</h1>
          <p className="text-xl text-white/80 max-w-md mx-auto">
            Share your live location with friends & family when traveling together.
            Real-time, consensual, and secure.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/login"
            className="px-8 py-4 bg-white text-primary-700 font-semibold rounded-xl shadow-lg hover:bg-gray-100 transition-all text-lg"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-8 py-4 bg-white/20 text-white font-semibold rounded-xl border-2 border-white/40 hover:bg-white/30 transition-all backdrop-blur-sm text-lg"
          >
            Create Account
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto text-center">
          <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
            <div className="text-3xl font-bold text-white">Live</div>
            <div className="text-white/70 text-sm">Real-time map</div>
          </div>
          <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
            <div className="text-3xl font-bold text-white">Safe</div>
            <div className="text-white/70 text-sm">Consent-first</div>
          </div>
          <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
            <div className="text-3xl font-bold text-white">Group</div>
            <div className="text-white/70 text-sm">Travel together</div>
          </div>
        </div>
      </div>
    </div>
  );
}
