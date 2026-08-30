'use client';

import { useState, useCallback } from 'react';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [useSearch, setUseSearch] = useState(true);

  const searchLocation = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`);
      const data = await res.json();
      setSearchResults(data);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const selectResult = (result: any) => {
    setDestinationLat(result.lat);
    setDestinationLng(result.lon);
    setDestinationName(result.display_name.split(',').slice(0, 2).join(',').trim());
    setSearchResults([]);
    setSearchQuery('');
  };

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
      <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-xl font-bold text-gray-900 mb-4">Set Trip Route</h3>

        <div className="mb-4">
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setUseSearch(true)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${useSearch ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Search Place
            </button>
            <button
              onClick={() => setUseSearch(false)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${!useSearch ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              Enter Coordinates
            </button>
          </div>

          {useSearch ? (
            <div>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchLocation()}
                  placeholder="Search for a place..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <button
                  onClick={searchLocation}
                  disabled={searching}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {searching ? '...' : 'Search'}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="border border-gray-200 rounded-lg divide-y max-h-40 overflow-y-auto">
                  {searchResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => selectResult(r)}
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-blue-50"
                    >
                      {r.display_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
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
          )}

          {destinationLat && destinationLng && (
            <div className="mt-3 p-2 bg-green-50 rounded-lg text-xs text-green-700">
              Selected: {destinationName} ({parseFloat(destinationLat).toFixed(4)}, {parseFloat(destinationLng).toFixed(4)})
            </div>
          )}
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
            disabled={loading || !destinationLat || !destinationLng}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Setting...' : 'Set Route'}
          </button>
        </div>
      </div>
    </div>
  );
}
