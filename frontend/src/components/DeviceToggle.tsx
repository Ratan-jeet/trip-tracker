'use client';

interface DeviceToggleProps {
  filter: 'all' | 'phone' | 'vehicle';
  onChange: (filter: 'all' | 'phone' | 'vehicle') => void;
}

export default function DeviceToggle({ filter, onChange }: DeviceToggleProps) {
  const options = [
    { value: 'all' as const, label: 'All', icon: '📍' },
    { value: 'phone' as const, label: 'Phone', icon: '📱' },
    { value: 'vehicle' as const, label: 'Vehicle', icon: '🚗' },
  ];

  return (
    <div className="bg-white rounded-lg shadow-lg p-1 flex gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
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
  );
}
