'use client';

import { useState } from 'react';
import { locationApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import dayjs from 'dayjs';

interface HistoryModalProps {
  tripId: string;
  onClose: () => void;
}

export default function HistoryModal({ tripId, onClose }: HistoryModalProps) {
  const token = useStore(s => s.token);
  const [startDate, setStartDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [historyData, setHistoryData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const data = await locationApi.getHistory(token!, tripId, {
        startDate: `${startDate}T00:00:00Z`,
        endDate: `${endDate}T23:59:59Z`,
      });
      setHistoryData(data);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch history');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (format: string) => {
    try {
      const data = await locationApi.export(token!, tripId, format, {
        startDate: `${startDate}T00:00:00Z`,
        endDate: `${endDate}T23:59:59Z`,
      });

      const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data)], {
        type: format === 'csv' ? 'text/csv' : format === 'gpx' ? 'application/gpx+xml' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trip-${tripId}-${startDate}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'Export failed');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" style={{ zIndex: 9999 }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-xl font-bold text-gray-900 mb-4">Location History</h3>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={fetchHistory}
            disabled={loading}
            className="flex-1 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load History'}
          </button>
        </div>

        {historyData && (
          <>
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => handleExport('csv')}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                Export CSV
              </button>
              <button
                onClick={() => handleExport('gpx')}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                Export GPX
              </button>
              <button
                onClick={() => handleExport('json')}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                Export JSON
              </button>
            </div>

            <div className="text-sm text-gray-500 mb-2">
              {historyData.length} location points found
            </div>

            {historyData.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Time</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Device</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Lat</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Lng</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Speed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {historyData.slice(0, 100).map((point, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2">{dayjs(point.timestamp).format('HH:mm:ss')}</td>
                        <td className="px-3 py-2">{point.deviceName || point.deviceType}</td>
                        <td className="px-3 py-2 text-right font-mono">{point.lat.toFixed(5)}</td>
                        <td className="px-3 py-2 text-right font-mono">{point.lng.toFixed(5)}</td>
                        <td className="px-3 py-2 text-right">{point.speed ? `${(point.speed * 3.6).toFixed(0)} km/h` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {historyData.length > 100 && (
                  <div className="px-3 py-2 text-center text-sm text-gray-500 bg-gray-50">
                    Showing 100 of {historyData.length} points. Export for full data.
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <button
          onClick={onClose}
          className="w-full mt-4 py-3 bg-gray-100 rounded-lg text-gray-700 font-medium hover:bg-gray-200"
        >
          Close
        </button>
      </div>
    </div>
  );
}
