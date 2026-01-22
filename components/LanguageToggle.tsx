
import React from 'react';
import { Language } from '../types';

interface LanguageToggleProps {
  currentLang: Language;
  onToggle: (lang: Language) => void;
}

const LanguageToggle: React.FC<LanguageToggleProps> = ({ currentLang, onToggle }) => {
  return (
    <div className="flex items-center gap-2 bg-white rounded-full p-1 shadow-sm border border-gray-200">
      <button
        onClick={() => onToggle('en')}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          currentLang === 'en' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        EN
      </button>
      <button
        onClick={() => onToggle('ar')}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
          currentLang === 'ar' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        عربي
      </button>
    </div>
  );
};

export default LanguageToggle;
