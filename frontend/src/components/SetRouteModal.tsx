'use client';

import { useState } from 'react';
import { tripApi } from '@/lib/api';
import { useStore } from '@/lib/store';

interface SetRouteModalProps {
  tripId: string;
  onClose: () => void;
  onRouteSet: () => void;
}

export default function SetRouteModal({ tripId, onClose, onRouteSet }: SetRouteModalProps) {
  const token = useStore(s => s.token);
  const [destinationName, setDestinationName] = useState('');
  const [destinationLat, setDestinationLat] = useState('');
  const [destinationLng, setDestinationLng] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!destinationName || !destinationLat || !destinationLng) {
      setError('All fields are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await tripApi.setRoute(token!, tripId, {
        destinationName,
        destinationLat: parseFloat(destinationLat),
        destinationLng: parseFloat(destinationLng),
      });
      onRouteSet();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to set route');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" style={{ zIndex: 9999 }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-xl font-bold text-gray-900 mb-4">Set Trip Route</h3>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Destination Name</label>
            <input
              type="text"
              value={destinationName}
              onChange={e => setDestinationName(e.target.value)}
              placeholder="e.g. Goa Beach Resort"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Destination Lat</label>
              <input
                type="number"
                step="any"
                value={destinationLat}
                onChange={e => setDestinationLat(e.target.value)}
                placeholder="15.4909"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Destination Lng</label>
              <input
                type="number"
                step="any"
                value={destinationLng}
                onChange={e => setDestinationLng(e.target.value)}
                placeholder="73.8278"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Setting...' : 'Set Route'}
          </button>
        </div>
      </div>
    </div>
  );
}
