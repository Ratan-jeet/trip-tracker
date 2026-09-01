'use client';

import { useState } from 'react';

interface DeviceToggleProps {
  filter: 'all' | 'phone' | 'vehicle';
  onChange: (filter: 'all' | 'phone' | 'vehicle') => void;
}

export default function DeviceToggle({ filter, onChange }: DeviceToggleProps) {
  const [expanded, setExpanded] = useState(false);

  const options = [
    { value: 'all' as const, label: 'All', icon: '📍' },
    { value: 'phone' as const, label: 'Phone', icon: '📱' },
    { value: 'vehicle' as const, label: 'Vehicle', icon: '🚗' },
  ];

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="bg-white rounded-lg shadow-lg p-2 flex items-center justify-center hover:bg-gray-50 transition-colors"
        title="Filter devices"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      </button>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500">Filter</span>
        <button
          onClick={() => setExpanded(false)}
          className="text-gray-400 hover:text-gray-600"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
      <div className="flex flex-col p-1 gap-0.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => { onChange(opt.value); setExpanded(false); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors text-left ${
              filter === opt.value
                ? 'bg-primary-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span className="mr-1">{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
