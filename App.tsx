
import React, { useState, useEffect } from 'react';
import { Language, ShopSettings } from './types';
import { TRANSLATIONS } from './constants';
import { storageService } from './services/storageService';
import UploadView from './views/UploadView';
import AdminView from './views/AdminView';
import LanguageToggle from './components/LanguageToggle';

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>('en');
  
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    return localStorage.getItem('ps_is_admin') === 'true';
  });

  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [settings, setSettings] = useState<ShopSettings>({ shopName: 'PrintShop Hub', logoUrl: null });
  
  const [currentHash, setCurrentHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    storageService.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (isAdmin && currentHash !== '#admin') {
      window.location.hash = 'admin';
    } else if (!isAdmin && currentHash === '#admin') {
      setShowAdminLogin(true);
    } else if (!isAdmin && !showAdminLogin && currentHash !== '') {
      window.location.hash = '';
    }
  }, [isAdmin, currentHash, showAdminLogin]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'admin123') {
      setIsAdmin(true);
      localStorage.setItem('ps_is_admin', 'true');
      setShowAdminLogin(false);
      setLoginError(false);
      setPassword('');
      window.location.hash = 'admin';
    } else {
      setLoginError(true);
    }
  };

  const handleLogout = () => {
    setIsAdmin(false);
    localStorage.removeItem('ps_is_admin');
    window.location.hash = '';
  };

  const handleToggleMode = () => {
    if (isAdmin) {
      handleLogout();
    } else {
      setShowAdminLogin(!showAdminLogin);
      if (showAdminLogin) window.location.hash = '';
    }
  };

  const renderContent = () => {
    if (showAdminLogin && !isAdmin) {
      return (
        <div className="max-w-md mx-auto">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
            <h2 className="text-2xl font-bold mb-6 text-center">{TRANSLATIONS.adminLogin[lang]}</h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{TRANSLATIONS.password[lang]}</label>
                <input 
                  type="password" 
                  autoFocus 
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder="••••••••" 
                />
              </div>
              {loginError && <p className="text-sm text-red-600 font-medium">{lang === 'ar' ? 'كلمة المرور خاطئة' : 'Incorrect password'}</p>}
              <button type="submit" className="w-full bg-gray-900 text-white font-bold py-2 rounded-lg hover:bg-black transition">{TRANSLATIONS.loginBtn[lang]}</button>
            </form>
          </div>
        </div>
      );
    }

    if (isAdmin || currentHash === '#admin') {
      if (!isAdmin) {
        setShowAdminLogin(true);
        return null;
      }
      return <AdminView lang={lang} onLogout={handleLogout} currentSettings={settings} onSettingsUpdate={setSettings} />;
    }

    return <UploadView lang={lang} />;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white overflow-hidden shadow-sm">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm-1 9H8v2h4v-2z" clipRule="evenodd"></path></svg>
            )}
          </div>
          <span className="text-xl font-bold tracking-tight text-gray-900 truncate max-w-[150px] sm:max-w-[300px]">
            {settings.shopName || TRANSLATIONS.appTitle[lang]}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <LanguageToggle currentLang={lang} onToggle={setLang} />
          <button onClick={handleToggleMode} className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition">
            {isAdmin ? (lang === 'ar' ? 'صفحة الرفع' : 'Back to Upload') : (showAdminLogin ? (lang === 'ar' ? 'إلغاء' : 'Cancel') : TRANSLATIONS.adminLogin[lang])}
          </button>
        </div>
      </nav>

      <main className="container mx-auto py-12 px-4 flex-grow">
        {renderContent()}
      </main>

      <footer className="py-8 text-center text-gray-400 text-sm border-t border-gray-100 bg-white">
        <p>&copy; {new Date().getFullYear()} {settings.shopName}. {lang === 'ar' ? 'نظام إدارة طباعة محلي.' : 'Local Print Management System.'}</p>
      </footer>
    </div>
  );
};

export default App;
