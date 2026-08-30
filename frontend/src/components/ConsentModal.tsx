'use client';

import { useState } from 'react';

interface ConsentModalProps {
  tripName: string;
  isSharing: boolean;
  onConfirm: (consentLevel?: string) => void;
  onClose: () => void;
}

export default function ConsentModal({ tripName, isSharing, onConfirm, onClose }: ConsentModalProps) {
  const [consentLevel, setConsentLevel] = useState('while_using');

  if (isSharing) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" style={{ zIndex: 9999 }} onClick={onClose}>
        <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Stop Sharing Location?</h3>
            <p className="text-gray-500">
              Members of <strong>{tripName}</strong> will no longer see your live location.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm()}
              className="flex-1 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
            >
              Stop Sharing
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" style={{ zIndex: 9999 }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Share Live Location?</h3>
          <p className="text-gray-500">
            Share your location with <strong>{tripName}</strong>?
          </p>
        </div>

        <div className="space-y-2 mb-6">
          {[
            { value: 'once', label: 'Allow Once', desc: 'This session only' },
            { value: 'while_using', label: 'Allow While Using', desc: 'While app is open (Recommended)' },
            { value: 'always', label: 'Allow Always', desc: 'Even in background' },
          ].map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                consentLevel === opt.value
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="consent"
                value={opt.value}
                checked={consentLevel === opt.value}
                onChange={e => setConsentLevel(e.target.value)}
                className="mt-0.5"
              />
              <div>
                <div className="font-medium text-gray-900">{opt.label}</div>
                <div className="text-sm text-gray-500">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(consentLevel)}
            className="flex-1 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700"
          >
            Share Location
          </button>
        </div>
      </div>
    </div>
  );
}
