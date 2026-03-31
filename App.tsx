import React, { useState, useEffect } from "react";
import { Language, ShopSettings } from "./types";
import { TRANSLATIONS } from "./constants";
import { storageService } from "./services/storageService";
import UploadView from "./views/UploadView";
import AdminView from "./views/AdminView";
import LanguageToggle from "./components/LanguageToggle";

const App: React.FC = () => {
  const [lang, setLang] = useState<Language>(() => {
    const savedLang = localStorage.getItem("ps_language") as Language;
    return savedLang || "ar";
  });

  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    return localStorage.getItem("ps_is_admin") === "true";
  });

  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [settings, setSettings] = useState<ShopSettings>({
    shopName: "PrintShop Hub",
    logoUrl: null,
  });

  const [currentHash, setCurrentHash] = useState(window.location.hash);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    localStorage.setItem("ps_language", lang);
  }, [lang]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K for quick admin access
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (!isAdmin) {
          setShowAdminLogin(true);
        } else {
          navigateToPage("admin");
        }
      }
      // Ctrl/Cmd + U for upload page
      if ((e.ctrlKey || e.metaKey) && e.key === "u") {
        e.preventDefault();
        navigateToPage("upload");
      }
      // Escape to cancel login or go to upload
      if (e.key === "Escape") {
        if (showAdminLogin && !isAdmin) {
          setShowAdminLogin(false);
          window.location.hash = "";
        } else if (isAdmin) {
          navigateToPage("upload");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAdmin, showAdminLogin]);

  useEffect(() => {
    if (isAdmin && currentHash !== "#admin") {
      window.location.hash = "admin";
    } else if (!isAdmin && currentHash === "#admin") {
      setShowAdminLogin(true);
    } else if (!isAdmin && !showAdminLogin && currentHash !== "") {
      window.location.hash = "";
    }
  }, [isAdmin, currentHash, showAdminLogin]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "admin123") {
      setIsAdmin(true);
      localStorage.setItem("ps_is_admin", "true");
      setShowAdminLogin(false);
      setLoginError(false);
      setPassword("");
      window.location.hash = "admin";
    } else {
      setLoginError(true);
    }
  };

  const handleLogout = () => {
    setIsAdmin(false);
    localStorage.removeItem("ps_is_admin");
    window.location.hash = "";
  };

  const handleToggleMode = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      if (isAdmin) {
        handleLogout();
      } else {
        setShowAdminLogin(!showAdminLogin);
        if (showAdminLogin) window.location.hash = "";
      }
      setIsTransitioning(false);
    }, 150);
  };

  const navigateToPage = (page: "upload" | "admin") => {
    setIsTransitioning(true);
    setTimeout(() => {
      if (page === "admin" && !isAdmin) {
        setShowAdminLogin(true);
      } else if (page === "admin") {
        window.location.hash = "admin";
      } else {
        window.location.hash = "";
      }
      setIsTransitioning(false);
    }, 150);
  };

  const renderContent = () => {
    if (showAdminLogin && !isAdmin) {
      return (
        <div className="max-w-md mx-auto">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
            <h2 className="text-2xl font-bold mb-6 text-center">
              {TRANSLATIONS.adminLogin[lang]}
            </h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {TRANSLATIONS.password[lang]}
                </label>
                <input
                  type="password"
                  autoFocus
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              {loginError && (
                <p className="text-sm text-red-600 font-medium">
                  {lang === "ar" ? "كلمة المرور خاطئة" : "Incorrect password"}
                </p>
              )}
              <button
                type="submit"
                className="w-full bg-gray-900 text-white font-bold py-2 rounded-lg hover:bg-black transition"
              >
                {TRANSLATIONS.loginBtn[lang]}
              </button>
            </form>
          </div>
        </div>
      );
    }

    if (isAdmin || currentHash === "#admin") {
      if (!isAdmin) {
        setShowAdminLogin(true);
        return null;
      }
      return (
        <AdminView
          lang={lang}
          onLogout={handleLogout}
          currentSettings={settings}
          onSettingsUpdate={setSettings}
        />
      );
    }

    return <UploadView lang={lang} />;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white overflow-hidden shadow-sm">
            {settings.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt="Logo"
                className="w-full h-full object-contain"
              />
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm-1 9H8v2h4v-2z"
                  clipRule="evenodd"
                ></path>
              </svg>
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-tight text-gray-900 truncate max-w-[150px] sm:max-w-[300px]">
              {settings.shopName || TRANSLATIONS.appTitle[lang]}
            </span>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                ></path>
              </svg>
              <span>
                {isAdmin || currentHash === "#admin"
                  ? lang === "ar"
                    ? "لوحة التحكم"
                    : "Admin Panel"
                  : lang === "ar"
                    ? "صفحة الرفع"
                    : "Upload Page"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg text-xs text-gray-600">
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <span>
              {isAdmin || currentHash === "#admin"
                ? lang === "ar"
                  ? "وضع المشرف"
                  : "Admin Mode"
                : lang === "ar"
                  ? "وضع العميل"
                  : "Client Mode"}
            </span>
          </div>
          <div className="hidden lg:flex items-center gap-1 px-2 py-1 bg-blue-50 rounded-md text-xs text-blue-600">
            <kbd className="px-1 py-0.5 bg-white rounded border border-blue-200 font-mono text-[10px]">
              Ctrl
            </kbd>
            <span>+</span>
            <kbd className="px-1 py-0.5 bg-white rounded border border-blue-200 font-mono text-[10px]">
              K
            </kbd>
            <span className="ml-1">{lang === "ar" ? "للوحة" : "Admin"}</span>
          </div>
          <LanguageToggle currentLang={lang} onToggle={setLang} />
          <button
            onClick={handleToggleMode}
            className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-indigo-50 border border-gray-200"
          >
            {isAdmin ? (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  ></path>
                </svg>
                {lang === "ar" ? "صفحة الرفع" : "Back to Upload"}
              </>
            ) : showAdminLogin ? (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  ></path>
                </svg>
                {lang === "ar" ? "إلغاء" : "Cancel"}
              </>
            ) : (
              <>
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  ></path>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  ></path>
                </svg>
                {TRANSLATIONS.adminLogin[lang]}
              </>
            )}
          </button>
        </div>
      </nav>

      <main
        className={`container mx-auto py-12 px-4 flex-grow transition-opacity duration-150 ${isTransitioning ? "opacity-0" : "opacity-100"}`}
      >
        {renderContent()}
      </main>

      <footer className="py-8 text-center text-gray-400 text-sm border-t border-gray-100 bg-white">
        <p>
          &copy; {new Date().getFullYear()} {settings.shopName}.{" "}
          {lang === "ar"
            ? "نظام إدارة طباعة محلي."
            : "Local Print Management System."}
        </p>
      </footer>
    </div>
  );
};

export default App;
