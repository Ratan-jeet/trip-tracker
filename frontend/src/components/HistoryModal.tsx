'use client';

import { useState } from 'react';
import { ApiError, locationApi, type HistoryPoint } from '@/lib/api';
import { useStore } from '@/lib/store';
import { formatClock, formatDistance, formatSpeed, haversineKm } from '@/lib/format';
import { useToast } from './ui/Toast';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Modal from './ui/Modal';
import { Field, Input } from './ui/Field';

const today = () => new Date().toISOString().slice(0, 10);

export default function HistoryModal({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const token = useStore((s) => s.token);
  const toast = useToast();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      // Plain dates; the API expands them to whole days in UTC. The client used to send
      // `${date}T00:00:00Z`, which did not match how the timestamps were stored.
      const result = await locationApi.getHistory(token!, tripId, { startDate, endDate });
      setPoints(result.points);
      setTruncated(result.truncated);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not load history');
    } finally {
      setLoading(false);
    }
  };

  const download = async (format: 'csv' | 'gpx' | 'json') => {
    setExporting(format);
    try {
      const data = await locationApi.export(token!, tripId, format, { startDate, endDate });
      const mime = format === 'csv' ? 'text/csv' : format === 'gpx' ? 'application/gpx+xml' : 'application/json';
      const url = URL.createObjectURL(new Blob([data], { type: mime }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `trip-${tripId}-${startDate}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking synchronously can cancel the download in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const totalKm =
    points && points.length > 1
      ? points.reduce(
          (sum, point, i) =>
            i === 0 ? 0 : sum + haversineKm(points[i - 1].lat, points[i - 1].lng, point.lat, point.lng),
          0,
        )
      : 0;

  return (
    <Modal
      title="Trip history"
      description="Recorded positions for everyone currently sharing."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5">
            {(['csv', 'gpx', 'json'] as const).map((format) => (
              <Button
                key={format}
                variant="secondary"
                size="sm"
                loading={exporting === format}
                disabled={!points || points.length === 0}
                onClick={() => download(format)}
              >
                {format.toUpperCase()}
              </Button>
            ))}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px] flex-1">
            <Field label="From">
              {({ id }) => (
                <Input id={id} type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
              )}
            </Field>
          </div>
          <div className="min-w-[140px] flex-1">
            <Field label="To">
              {({ id }) => (
                <Input id={id} type="date" value={endDate} min={startDate} max={today()} onChange={(e) => setEndDate(e.target.value)} />
              )}
            </Field>
          </div>
          <Button onClick={load} loading={loading}>
            Load
          </Button>
        </div>

        {points && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{points.length} points</Badge>
              {totalKm > 0 && <Badge tone="neutral">{formatDistance(totalKm * 1000)} travelled</Badge>}
              {truncated && <Badge tone="warning">Showing the first page — narrow the dates for more detail</Badge>}
            </div>

            {points.length === 0 ? (
              <p className="rounded-xl bg-surface-inset px-4 py-8 text-center text-sm text-fg-subtle">
                No positions recorded in this range.
              </p>
            ) : (
              <div className="max-h-72 overflow-auto rounded-xl border border-border">
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-surface-subtle text-xs text-fg-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Time</th>
                      <th scope="col" className="px-3 py-2 font-medium">Who</th>
                      <th scope="col" className="px-3 py-2 font-medium">Position</th>
                      <th scope="col" className="px-3 py-2 font-medium">Speed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {points.slice(0, 300).map((point, index) => (
                      <tr key={`${point.deviceId}-${point.timestamp}-${index}`}>
                        <td className="tabular whitespace-nowrap px-3 py-1.5 text-fg-muted">
                          {formatClock(point.timestamp)}
                        </td>
                        <td className="truncate px-3 py-1.5 text-fg">{point.ownerName ?? point.deviceName}</td>
                        <td className="tabular whitespace-nowrap px-3 py-1.5 text-fg-muted">
                          {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
                        </td>
                        <td className="tabular px-3 py-1.5 text-fg-muted">{formatSpeed(point.speed) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {points.length > 300 && (
                  <p className="border-t border-border px-3 py-2 text-xs text-fg-subtle">
                    Showing the first 300 of {points.length}. Export for the full set.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
