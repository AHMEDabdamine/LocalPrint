import React, { useState, useRef, useEffect } from "react";
import { Language, PrintJob, PrintStatus, ShopSettings, DiscountRule, DiscountResult } from "../types";
import { TRANSLATIONS, ALLOWED_TYPES } from "../constants";
import { storageService } from "../services/storageService";
import {
  calculatePrintPrice,
  getActualPageCount,
  formatPrice,
  calculateJobDiscount,
} from "../utils/pricingUtils";
import QRCode from "qrcode";
import ToastContainer, { useToast } from "../components/ToastContainer";
import ConfirmDialog from "../components/ConfirmDialog";

interface UploadViewProps {
  lang: Language;
  shopSettings?: ShopSettings;
}

interface FileStatus {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  id: string;
}

// Custom ID generator that works in non-secure contexts (HTTP over Local IP)
const generateSafeId = () => {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
};

const UploadView: React.FC<UploadViewProps> = ({ lang, shopSettings: propSettings }) => {
  const t = (key: string) => TRANSLATIONS[key][lang] || key;
  const isRtl = lang === "ar";
  const { toasts, success, error: showError, removeToast } = useToast();

  // Confirm dialog state for canceling jobs
  const [cancelConfirm, setCancelConfirm] = useState<{
    isOpen: boolean;
    jobId: string | null;
  }>({ isOpen: false, jobId: null });

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    notes: "",
  });
  const [printPreferences, setPrintPreferences] = useState<{
    colorMode: "color" | "blackWhite";
    copies: number;
    paperType: string;
  }>({
    colorMode: "color",
    copies: 1,
    paperType: "normal",
  });
  const [selectedFiles, setSelectedFiles] = useState<FileStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [overallSuccess, setOverallSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<PrintJob[]>([]);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [showQrCode, setShowQrCode] = useState(false);

  // Preview States
  const [previewJobUrl, setPreviewJobUrl] = useState<string | null>(null);
  const [previewFileType, setPreviewFileType] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pricing & Pages States
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(propSettings || null);
  const [jobPageCounts, setJobPageCounts] = useState<{
    [jobId: string]: number;
  }>({});
  const [discountRules, setDiscountRules] = useState<DiscountRule[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const [jobs, settings, rules] = await Promise.all([
        storageService.getMyRecentJobs(),
        propSettings ? Promise.resolve(propSettings) : storageService.getSettings(),
        storageService.getActiveDiscountRules(),
      ]);
      setRecentJobs(jobs);
      if (!propSettings) setShopSettings(settings);
      setDiscountRules(rules);

      // Async page counting for pricing display
      if (settings?.pricing || (settings?.paperTypes && settings.paperTypes.length > 0)) {
        const counts: { [jobId: string]: number } = {};
        for (const job of jobs) {
          if (job.pageCount && job.pageCount > 0) {
            counts[job.id] = job.pageCount;
            continue;
          }
          try {
            const url = await storageService.getFileUrl(job.id);
            if (url) {
              const response = await fetch(url);
              const blob = await response.blob();
              const file = new File([blob], job.fileName, { type: job.fileType });
              counts[job.id] = await getActualPageCount(file);
            } else {
              counts[job.id] = 1;
            }
          } catch (e) {
            counts[job.id] = 1;
          }
        }
        setJobPageCounts(counts);
      }
    };
    fetchData();
  }, [overallSuccess]);

  const handleCancelJob = (id: string) => {
    setCancelConfirm({ isOpen: true, jobId: id });
  };

  const confirmCancelJob = async () => {
    if (cancelConfirm.jobId) {
      try {
        await storageService.deleteJob(cancelConfirm.jobId);
        setRecentJobs((prev) => prev.filter((job) => job.id !== cancelConfirm.jobId));
        success(isRtl ? "تم إلغاء الطباعة بنجاح" : "Print job cancelled successfully");
      } catch (err) {
        console.error("Failed to cancel job", err);
        showError(isRtl ? "فشل إلغاء الطباعة" : "Failed to cancel print job");
      }
    }
    setCancelConfirm({ isOpen: false, jobId: null });
  };

  // Helper to calculate price with discount for a file
  const getFilePriceWithDiscount = (file: File) => {
    if (!shopSettings) return null;

    const allPaperTypes = shopSettings.paperTypes && shopSettings.paperTypes.length > 0
      ? shopSettings.paperTypes
      : [
          { id: "normal", name: "Normal", nameAr: "عادي", colorPerPage: shopSettings.pricing?.colorPerPage ?? 30.0, blackWhitePerPage: shopSettings.pricing?.blackWhitePerPage ?? 15.0 },
          { id: "glossy", name: "Glossy", nameAr: "لامع", colorPerPage: shopSettings.pricing?.glossyPerPage ?? 50.0, blackWhitePerPage: shopSettings.pricing?.glossyPerPage ?? 50.0 },
          { id: "cardboard", name: "Cardboard", nameAr: "ورق مقوى", colorPerPage: shopSettings.pricing?.cardboardPerPage ?? 40.0, blackWhitePerPage: shopSettings.pricing?.cardboardPerPage ?? 40.0 },
        ];

    const paperType = allPaperTypes.find(pt => pt.id === (printPreferences.paperType || "normal"));
    const pricePerPage = paperType
      ? (printPreferences.colorMode === "blackWhite" ? paperType.blackWhitePerPage : paperType.colorPerPage)
      : (printPreferences.colorMode === "blackWhite" ? (shopSettings.pricing?.blackWhitePerPage ?? 15.0) : (shopSettings.pricing?.colorPerPage ?? 30.0));

    // Estimate page count
    const estimatedPages = file.type.includes("pdf")
      ? Math.max(1, Math.ceil(file.size / 75000))
      : file.type.includes("image")
      ? 1
      : Math.max(1, Math.ceil(file.size / 50000));

    const totalPages = estimatedPages * printPreferences.copies;
    const originalPrice = pricePerPage * totalPages;

    // Debug logging
    console.log("Calculating discount for file:", file.name, {
      totalPages,
      originalPrice,
      discountRulesCount: discountRules?.length || 0,
      discountRules: discountRules,
    });

    // Calculate discount
    const discountResult = calculateJobDiscount(
      {} as PrintJob,
      originalPrice,
      totalPages,
      discountRules
    );

    console.log("Discount result:", discountResult);

    return {
      original: originalPrice,
      discount: discountResult.discountAmount,
      final: discountResult.finalAmount,
      hasDiscount: discountResult.discountAmount > 0,
      ruleName: discountResult.rule?.name,
    };
  };

  const handlePreviewJob = async (job: PrintJob) => {
    try {
      const url = await storageService.getFileUrl(job.id);
      if (url) {
        setPreviewJobUrl(url);
        setPreviewFileType(job.fileType);
        setShowPreviewModal(true);
      }
    } catch (err) {
      console.error("Failed to fetch preview", err);
    }
  };

  const generateQRCode = async () => {
    try {
      // Get local IP address for network access
      const localIP = await getLocalIP();
      const currentPort = window.location.port;
      const qrData = `http://${localIP}:${currentPort}?ref=upload&lang=${lang}&shop=${encodeURIComponent(localIP)}`;

      const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
        width: 256,
        margin: 2,
        color: {
          dark: "#1f2937",
          light: "#ffffff",
        },
      });

      setQrCodeUrl(qrCodeDataUrl);
      setShowQrCode(true);
    } catch (err) {
      console.error("Error generating QR code:", err);
      setError(isRtl ? "فشل إنشاء رمز QR" : "Failed to generate QR code");
    }
  };

  const getLocalIP = async (): Promise<string> => {
    try {
      const response = await fetch("/api/local-ip");
      if (!response.ok) {
        throw new Error("Failed to fetch local IP");
      }
      const data = await response.json();
      return data.ip;
    } catch (err) {
      console.error(
        "Failed to get local IP from API, falling back to hostname:",
        err,
      );
      return window.location.hostname;
    }
  };

  const downloadQRCode = () => {
    if (qrCodeUrl) {
      const link = document.createElement("a");
      link.download = `qrcode-${Date.now()}.png`;
      link.href = qrCodeUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length > 0) {
      const newFileStatuses: FileStatus[] = [];
      let hasError = false;

      for (const file of files) {
        if (!ALLOWED_TYPES.includes(file.type)) {
          setError(t("fileLimit"));
          hasError = true;
          break;
        }
        newFileStatuses.push({
          file,
          progress: 0,
          status: "pending",
          id: generateSafeId(),
        });
      }

      if (!hasError) {
        setSelectedFiles((prev) => [...prev, ...newFileStatuses]);
        setError(null);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = (id: string) => {
    if (isUploading) return;
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const performUpload = async (
    fileStatus: FileStatus,
    name: string,
    phone: string,
    notes: string,
  ) => {
    const job: PrintJob = {
      id: generateSafeId(),
      customerName: name.trim(),
      phoneNumber: phone.trim(),
      notes: notes.trim(),
      fileName: fileStatus.file.name,
      fileType: fileStatus.file.type,
      fileSize: fileStatus.file.size,
      uploadDate: new Date().toISOString(),
      status: PrintStatus.PENDING,
      printPreferences: {
        colorMode: printPreferences.colorMode,
        copies: printPreferences.copies,
        paperType: printPreferences.paperType,
      },
    };

    setSelectedFiles((prev) =>
      prev.map((f) =>
        f.id === fileStatus.id ? { ...f, status: "uploading" } : f,
      ),
    );

    try {
      await storageService.saveJob(job, fileStatus.file, (progress) => {
        setSelectedFiles((prev) =>
          prev.map((f) => (f.id === fileStatus.id ? { ...f, progress } : f)),
        );
      });
      setSelectedFiles((prev) =>
        prev.map((f) =>
          f.id === fileStatus.id
            ? { ...f, status: "success", progress: 100 }
            : f,
        ),
      );
    } catch (err) {
      console.error("Upload error for file:", fileStatus.file.name, err);
      setSelectedFiles((prev) =>
        prev.map((f) =>
          f.id === fileStatus.id ? { ...f, status: "error" } : f,
        ),
      );
      throw err;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      setError(t("selectFile"));
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      for (const fileStatus of selectedFiles) {
        if (fileStatus.status === "success") continue;
        await performUpload(
          fileStatus,
          formData.name,
          formData.phone,
          formData.notes,
        );
      }
      setOverallSuccess(true);
    } catch (err) {
      setError(t("errorMsg"));
    } finally {
      setIsUploading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const overallProgress = selectedFiles.length > 0
    ? Math.round(selectedFiles.reduce((sum, f) => sum + (f.status === "success" ? 100 : f.progress), 0) / selectedFiles.length)
    : 0;

  const confettiItems = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    color: ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#f97316"][i % 8],
    x: `${(Math.random() * 200 - 100).toFixed(0)}px`,
    y: `${-(Math.random() * 180 + 80).toFixed(0)}px`,
    delay: `${(Math.random() * 0.5).toFixed(2)}s`,
    size: `${(Math.random() * 8 + 6).toFixed(0)}px`,
    shape: i % 3 === 0 ? "50%" : i % 3 === 1 ? "2px" : "0%",
  }));

  if (overallSuccess) {
    return (
      <>
        <style>{`
          @keyframes successPop {
            0% { transform: scale(0) rotate(-180deg); opacity: 0; }
            60% { transform: scale(1.25) rotate(15deg); opacity: 1; }
            80% { transform: scale(0.9) rotate(-5deg); }
            100% { transform: scale(1) rotate(0deg); opacity: 1; }
          }
          @keyframes confettiBurst {
            0% { transform: translate(0,0) rotate(0deg) scale(1); opacity: 1; }
            100% { transform: translate(var(--cx), var(--cy)) rotate(720deg) scale(0); opacity: 0; }
          }
          @keyframes fadeSlideUp {
            0% { opacity: 0; transform: translateY(20px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          .success-pop { animation: successPop 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards; }
          .fade-slide-up { animation: fadeSlideUp 0.5s ease forwards; }
          .confetti-piece { animation: confettiBurst 1s ease-out var(--delay) forwards; opacity: 0; animation-delay: var(--delay); }
        `}</style>
        <div className="max-w-md mx-auto mt-12 relative">
          {/* Confetti burst */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden" style={{ top: "60px" }}>
            {confettiItems.map(c => (
              <div
                key={c.id}
                className="confetti-piece absolute"
                style={{
                  "--cx": c.x,
                  "--cy": c.y,
                  "--delay": c.delay,
                  width: c.size,
                  height: c.size,
                  backgroundColor: c.color,
                  borderRadius: c.shape,
                } as React.CSSProperties}
              />
            ))}
          </div>

          <div className="bg-white p-10 rounded-3xl shadow-2xl shadow-indigo-100/60 text-center border border-gray-100 relative z-10">
            {/* Animated checkmark */}
            <div className="success-pop w-24 h-24 mx-auto mb-6 relative">
              <div className="absolute inset-0 rounded-full bg-green-100 animate-ping opacity-30" style={{ animationDuration: "1.5s" }} />
              <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-green-200">
                <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            <div className="fade-slide-up" style={{ animationDelay: "0.2s", opacity: 0 }}>
              <h2 className="text-3xl font-black text-gray-900 mb-2">
                {isRtl ? "تم الإرسال!" : "Files Sent!"}
              </h2>
              <p className="text-gray-500 mb-2 text-base">
                {isRtl ? "وصلت ملفاتك إلى الطابعة بنجاح" : "Your files are on their way to the printer"}
              </p>
              <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-full text-sm font-semibold mb-8 border border-indigo-100">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                {isRtl ? "في انتظار الطباعة" : "Queued for printing"}
              </div>
            </div>

            <button
              onClick={() => {
                setOverallSuccess(false);
                setSelectedFiles([]);
                setFormData({ name: "", phone: "", notes: "" });
                setPrintPreferences({ colorMode: "color", copies: 1, paperType: shopSettings?.paperTypes?.[0]?.id || "normal" });
              }}
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold px-8 py-3.5 rounded-2xl hover:from-indigo-700 hover:to-violet-700 transition-all shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 active:scale-95 text-base"
            >
              {isRtl ? "إرسال ملفات أخرى" : "Send more files"}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className={`max-w-xl mx-auto ${isRtl ? "rtl" : ""}`}>
      <div className="text-center mb-5">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          {t("uploadTitle")}
        </h1>
        <p className="text-gray-600">{t("uploadSub")}</p>
        <div className="mt-4 flex justify-center gap-3">
          <button
            onClick={generateQRCode}
            className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 transition"
          >
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
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
              ></path>
            </svg>
            {isRtl ? "إنشاء رمز QR" : "Generate QR Code"}
          </button>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white p-5 sm:p-7 rounded-2xl shadow-xl shadow-indigo-100/40 border border-white space-y-5 mb-8"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              {t("customerName")}{" "}
              <span className="text-gray-400 font-normal">
                ({isRtl ? "اختياري" : "Optional"})
              </span>
            </label>
            <input
              type="text"
              disabled={isUploading}
              className="w-full px-5 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all disabled:opacity-50"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder={isRtl ? "مثال: محمد علي" : "e.g. John Doe"}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              {t("phoneNumber")}{" "}
              <span className="text-gray-400 font-normal">
                ({isRtl ? "اختياري" : "Optional"})
              </span>
            </label>
            <input
              type="tel"
              disabled={isUploading}
              className="w-full px-5 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all disabled:opacity-50"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              placeholder={isRtl ? "05xxxxxxxx" : "05xxxxxxxx"}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            {t("notes")}
          </label>
          <textarea
            disabled={isUploading}
            className="w-full px-5 py-4 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all h-24 resize-none disabled:opacity-50"
            value={formData.notes}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
            placeholder={
              isRtl
                ? "أدخل تعليمات الطباعة الإضافية هنا..."
                : "Enter additional printing instructions here..."
            }
          />
        </div>

        {/* Print Preferences Section */}
        <div className="bg-gray-50/50 p-6 rounded-2xl border border-gray-100">
          <label className="block text-sm font-semibold text-gray-800 mb-4">
            {isRtl ? "تفضيلات الطباعة" : "Print Preferences"}
          </label>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Color Mode */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                {isRtl ? "وضع الألوان" : "Color Mode"}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      colorMode: "color",
                    })
                  }
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border transition ${printPreferences.colorMode === "color"
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isRtl ? "ملون" : "Color"}
                </button>
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      colorMode: "blackWhite",
                    })
                  }
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border transition ${printPreferences.colorMode === "blackWhite"
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isRtl ? "أبيض وأسود" : "B&W"}
                </button>
              </div>
            </div>

            {/* Number of Copies */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                {isRtl ? "عدد النسخ" : "Number of Copies"}
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isUploading || printPreferences.copies <= 1}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      copies: Math.max(1, printPreferences.copies - 1),
                    })
                  }
                  className="w-8 h-8 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
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
                      d="M20 12H4"
                    ></path>
                  </svg>
                </button>
                <input
                  type="number"
                  min="1"
                  max="100"
                  disabled={isUploading}
                  value={printPreferences.copies}
                  onChange={(e) => {
                    const value = parseInt(e.target.value) || 1;
                    setPrintPreferences({
                      ...printPreferences,
                      copies: Math.max(1, Math.min(100, value)),
                    });
                  }}
                  className="flex-1 px-3 py-2 text-center border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50"
                />
                <button
                  type="button"
                  disabled={isUploading || printPreferences.copies >= 100}
                  onClick={() =>
                    setPrintPreferences({
                      ...printPreferences,
                      copies: Math.min(100, printPreferences.copies + 1),
                    })
                  }
                  className="w-8 h-8 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
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
                      d="M12 4v16m8-8H4"
                    ></path>
                  </svg>
                </button>
              </div>
            </div>
            </div>

            {/* Paper Type */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                {isRtl ? "نوع الورق" : "Paper Type"}
              </label>
              <div className="flex flex-wrap gap-2">
                {(shopSettings?.paperTypes && shopSettings.paperTypes.length > 0
                  ? shopSettings.paperTypes
                  : [
                      { id: "normal", name: "Normal", nameAr: "عادي" },
                      { id: "glossy", name: "Glossy", nameAr: "لامع" },
                      { id: "cardboard", name: "Cardboard", nameAr: "ورق مقوى" },
                    ]
                ).map((pt) => (
                  <button
                    key={pt.id}
                    type="button"
                    disabled={isUploading}
                    onClick={() => setPrintPreferences({ ...printPreferences, paperType: pt.id })}
                    className={`flex-1 min-w-[5rem] px-3 py-2 text-sm font-medium rounded-md border transition ${printPreferences.paperType === pt.id ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isRtl ? pt.nameAr : pt.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="relative">
          <label className="block text-sm font-semibold text-gray-800 mb-2">
            {t("selectFile")}
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length > 0) {
                const newFileStatuses: FileStatus[] = [];
                let hasError = false;
                for (const file of files) {
                  if (!ALLOWED_TYPES.includes(file.type)) {
                    setError(t("fileLimit"));
                    hasError = true;
                    break;
                  }
                  newFileStatuses.push({
                    file,
                    progress: 0,
                    status: "pending",
                    id: generateSafeId(),
                  });
                }
                if (!hasError) {
                  setSelectedFiles((prev) => [...prev, ...newFileStatuses]);
                  setError(null);
                }
              }
            }}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              isDragging
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 hover:border-gray-400"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
              accept=".pdf,.docx,.xlsx,.xls,.ppt,.pptx,.jpg,.png,image/jpeg,image/png"
            />
            <div className="flex flex-col items-center">
              <svg
                className="w-10 h-10 text-gray-400 mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                ></path>
              </svg>
              <p className="text-sm text-gray-600 font-medium">
                {t("dragDrop")}
              </p>
              <p className="text-xs text-gray-500 mt-1">{t("fileLimit")}</p>
            </div>
          </div>
        </div>

        {selectedFiles.length > 0 && (
          <div className="space-y-3 mt-4">
            <h3 className="text-sm font-bold text-gray-900">
              {isRtl ? "الملفات المختارة" : "Selected Files"} (
              {selectedFiles.length})
            </h3>
            {selectedFiles.map((fileStatus) => (
              <div
                key={fileStatus.id}
                className="bg-gray-50 border border-gray-200 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <svg
                      className="w-5 h-5 text-gray-400 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      ></path>
                    </svg>
                    <div className="truncate">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {fileStatus.file.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatSize(fileStatus.file.size)}
                        {(() => {
                          const priceInfo = getFilePriceWithDiscount(fileStatus.file);
                          if (!priceInfo) return null;
                          return (
                            <span className="ml-2">
                              {priceInfo.hasDiscount ? (
                                <span className="text-green-600 font-medium">
                                  <span className="line-through text-gray-400 mr-1">{priceInfo.original.toFixed(0)} DZD</span>
                                  {priceInfo.final.toFixed(0)} DZD
                                  <span className="text-xs ml-1">(-{priceInfo.discount.toFixed(0)})</span>
                                </span>
                              ) : (
                                <span>{priceInfo.original.toFixed(0)} DZD</span>
                              )}
                            </span>
                          );
                        })()}
                      </p>
                    </div>
                  </div>
                  {!isUploading && fileStatus.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => removeFile(fileStatus.id)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <svg
                        className="w-5 h-5"
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
                    </button>
                  )}
                  {fileStatus.status === "success" && (
                    <svg
                      className="w-5 h-5 text-green-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M5 13l4 4L19 7"
                      ></path>
                    </svg>
                  )}
                  {fileStatus.status === "error" && (
                    <svg
                      className="w-5 h-5 text-red-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      ></path>
                    </svg>
                  )}
                </div>
                {fileStatus.status === "uploading" && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-1.5 transition-all duration-300"
                      style={{ width: `${fileStatus.progress}%` }}
                    />
                  </div>
                )}
              </div>
            ))}

            {/* Total Price Summary with Discounts */}
            {selectedFiles.length > 0 && shopSettings?.pricing && (
              <div className="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                {(() => {
                  let totalOriginal = 0;
                  let totalDiscount = 0;
                  let totalFinal = 0;

                  selectedFiles.forEach((fileStatus) => {
                    const priceInfo = getFilePriceWithDiscount(fileStatus.file);
                    if (priceInfo) {
                      totalOriginal += priceInfo.original;
                      totalDiscount += priceInfo.discount;
                      totalFinal += priceInfo.final;
                    }
                  });

                  const hasDiscount = totalDiscount > 0;

                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">
                          {isRtl ? "المجموع الفرعي" : "Subtotal"}
                        </span>
                        <span className="font-semibold text-gray-900">
                          {totalOriginal.toFixed(0)} DZD
                        </span>
                      </div>
                      {hasDiscount && (
                        <div className="flex justify-between items-center text-green-600">
                          <span className="text-sm">
                            {isRtl ? "الخصم" : "Discount"}
                          </span>
                          <span className="font-semibold">
                            -{totalDiscount.toFixed(0)} DZD
                          </span>
                        </div>
                      )}
                      <div className="border-t border-indigo-200 pt-2 flex justify-between items-center">
                        <span className="text-base font-bold text-gray-900">
                          {isRtl ? "الإجمالي" : "Total"}
                        </span>
                        <span className="text-lg font-bold text-indigo-600">
                          {totalFinal.toFixed(0)} DZD
                        </span>
                      </div>
                      {hasDiscount && (
                        <p className="text-xs text-green-600 text-center mt-2">
                          {isRtl
                            ? `وفرت ${totalDiscount.toFixed(0)} DZD!`
                            : `You saved ${totalDiscount.toFixed(0)} DZD!`}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isUploading || selectedFiles.length === 0}
          className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 transition-all shadow-xl shadow-indigo-600/20 active:scale-[0.98] flex items-center justify-center gap-2 text-lg"
        >
          {isUploading ? (
            <svg
              className="animate-spin h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                ></path>
              </svg>
              {t("uploadBtn")}
            </>
          )}
        </button>
      </form>

      {/* Recent Uploads Section */}
      {recentJobs.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {t("recentUploads")}
            </h2>
          </div>
          <div className="grid gap-3">
            {recentJobs.map((job) => (
              <div
                key={job.id}
                className="bg-white border border-gray-100 rounded-xl p-4 flex items-center justify-between shadow-sm"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${job.status === PrintStatus.PRINTED
                      ? "bg-green-100 text-green-600"
                      : "bg-yellow-100 text-yellow-600"
                      }`}
                  >
                    {job.status === PrintStatus.PRINTED ? (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M5 13l4 4L19 7"
                        ></path>
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        ></path>
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate max-w-[150px] sm:max-w-xs">
                      {job.fileName}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                      <p>
                        {new Date(job.uploadDate).toLocaleDateString(
                          isRtl ? "ar-EG" : "en-US",
                          { numberingSystem: "latn" },
                        )}
                      </p>
                      {jobPageCounts[job.id] ? (
                        <>
                          <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                          <p className="flex items-center gap-1 font-medium bg-gray-100/80 text-gray-500 px-1.5 py-0.5 rounded">
                            <svg
                              className="w-3 h-3 text-gray-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                              ></path>
                            </svg>
                            {jobPageCounts[job.id]} {isRtl ? "صفحات" : "Pages"}
                          </p>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <div className="flex items-center gap-3">
                    {(shopSettings?.pricing || (shopSettings?.paperTypes && shopSettings.paperTypes.length > 0)) && (
                      <span className="text-sm font-bold text-green-600 bg-green-50 px-2.5 py-0.5 rounded-md border border-green-100 whitespace-nowrap">
                        {formatPrice(
                          calculatePrintPrice(
                            job,
                            shopSettings,
                            jobPageCounts[job.id] || 1,
                          ).totalPrice,
                        )}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${job.status === PrintStatus.PRINTED
                        ? "bg-green-100 text-green-700"
                        : "bg-yellow-100 text-yellow-700"
                        }`}
                    >
                      {job.status === PrintStatus.PRINTED
                        ? t("printed")
                        : t("pending")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePreviewJob(job)}
                      title={isRtl ? "معاينة" : "Preview"}
                      className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition tooltip-container shadow-sm"
                    >
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
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </button>
                    {job.status === PrintStatus.PENDING && (
                      <button
                        type="button"
                        onClick={() => handleCancelJob(job.id)}
                        title={isRtl ? "إلغاء طباعة" : "Cancel print"}
                        className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition shadow-sm"
                      >
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
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {shopSettings?.pricing && (
            <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-start gap-3 mt-4">
              <svg
                className="w-5 h-5 text-blue-500 mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-xs text-blue-700 font-medium">
                {isRtl
                  ? "ملاحظة: السعر المعروض تقريبي. قد يتغير السعر النهائي حسب إعدادات المتجر الفعلية وحجم وألوان المستند النهائية التي يتم طباعتها."
                  : "Note: The estimated price is approximate. The final price may change slightly depending on the exact dimensions, color ink coverage, and store verification."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* QR Code Modal */}
      {showQrCode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                {isRtl ? "رمز QR للموقع" : "QR Code for Upload Page"}
              </h3>
              <button
                onClick={() => setShowQrCode(false)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg
                  className="w-6 h-6"
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
              </button>
            </div>

            <div className="text-center mb-4">
              <p className="text-sm text-gray-600 mb-2">
                {isRtl
                  ? "امسح هذا الرمز للوصول السريع إلى صفحة الرفع"
                  : "Scan this code for quick access to the upload page"}
              </p>
              <p className="text-xs text-gray-500 mb-4">
                {isRtl
                  ? "يعمل على نفس الشبكة المحلية فقط"
                  : "Works on the same local network only"}
              </p>

              {qrCodeUrl && (
                <div className="flex justify-center mb-4">
                  <img
                    src={qrCodeUrl}
                    alt="QR Code"
                    className="border-2 border-gray-200 rounded-lg"
                  />
                </div>
              )}

              <button
                onClick={downloadQRCode}
                className="w-full bg-indigo-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-indigo-700 transition flex items-center justify-center gap-2"
              >
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  ></path>
                </svg>
                {isRtl ? "تحميل رمز QR" : "Download QR Code"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Preview Modal */}
      {showPreviewModal && previewJobUrl && (
        <div className="fixed inset-0 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 sm:p-8 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden relative border border-gray-100">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900">
                {isRtl ? "معاينة الملف" : "File Preview"}
              </h3>
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewJobUrl(null);
                  setPreviewFileType(null);
                }}
                className="text-gray-400 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 transition-colors rounded-full p-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Modal Body / Viewer */}
            <div className="flex-1 bg-gray-100 overflow-hidden relative flex items-center justify-center">
              {previewFileType?.startsWith("image/") ? (
                <img
                  src={previewJobUrl}
                  alt="Preview"
                  className="max-w-full max-h-full object-contain p-4 drop-shadow-xl"
                />
              ) : previewFileType === "application/pdf" ? (
                <iframe
                  src={`${previewJobUrl}#view=FitH`}
                  className="w-full h-full border-0 bg-transparent"
                  title="PDF Preview"
                />
              ) : (
                <div className="text-center p-8 bg-white m-8 rounded-xl shadow-sm border border-gray-100 max-w-sm">
                  <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-8 h-8"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>
                  <h4 className="text-lg font-bold text-gray-900 mb-2">
                    {isRtl ? "المعاينة غير مدعومة" : "Preview Not Supported"}
                  </h4>
                  <p className="text-sm text-gray-500">
                    {isRtl
                      ? "لا يمكن معاينة مستندات Office مباشرة على الشبكة المحلية المحمية. سيتم طباعتها بشكل صحيح."
                      : "Office documents cannot be previewed natively over protected local networks. They will print correctly."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload Animation Overlay */}
      {isUploading && (
        <>
          <style>{`
            @keyframes floatToPrinter {
              0%   { transform: translateY(40px) scale(0.85) rotate(-4deg); opacity: 0; }
              15%  { opacity: 1; }
              75%  { opacity: 0.9; }
              100% { transform: translateY(-90px) scale(0.25) rotate(10deg); opacity: 0; }
            }
            @keyframes printerBounce {
              0%, 100% { transform: translateY(0) scale(1); }
              50%       { transform: translateY(-7px) scale(1.04); }
            }
            @keyframes glowPulse {
              0%, 100% { box-shadow: 0 0 24px rgba(99,102,241,0.4), 0 0 48px rgba(99,102,241,0.15); }
              50%       { box-shadow: 0 0 48px rgba(99,102,241,0.8), 0 0 96px rgba(99,102,241,0.35), 0 0 140px rgba(139,92,246,0.15); }
            }
            @keyframes shimmerBar {
              0%   { background-position: -200% center; }
              100% { background-position: 200% center; }
            }
            @keyframes dotPulse {
              0%, 80%, 100% { transform: scale(0.55); opacity: 0.25; }
              40%            { transform: scale(1);    opacity: 1; }
            }
            @keyframes overlayFadeIn {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            @keyframes cardSlideUp {
              from { opacity: 0; transform: translateY(30px) scale(0.95); }
              to   { opacity: 1; transform: translateY(0)    scale(1); }
            }
            .upl-float-1 { animation: floatToPrinter 2.4s ease-in-out infinite 0s; }
            .upl-float-2 { animation: floatToPrinter 2.4s ease-in-out infinite 0.8s; }
            .upl-float-3 { animation: floatToPrinter 2.4s ease-in-out infinite 1.6s; }
            .upl-printer { animation: printerBounce 1.3s ease-in-out infinite, glowPulse 2s ease-in-out infinite; }
            .upl-shimmer {
              background: linear-gradient(90deg,#6366f1 0%,#8b5cf6 40%,#c4b5fd 50%,#8b5cf6 60%,#6366f1 100%);
              background-size: 200% auto;
              animation: shimmerBar 1.5s linear infinite;
            }
            .upl-dot-1 { animation: dotPulse 1.4s ease-in-out infinite 0s; }
            .upl-dot-2 { animation: dotPulse 1.4s ease-in-out infinite 0.22s; }
            .upl-dot-3 { animation: dotPulse 1.4s ease-in-out infinite 0.44s; }
            .upl-overlay { animation: overlayFadeIn 0.25s ease forwards; }
            .upl-card    { animation: cardSlideUp  0.35s cubic-bezier(0.34,1.3,0.64,1) forwards; }
          `}</style>

          <div className="upl-overlay fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: "rgba(10,10,25,0.65)", backdropFilter: "blur(14px)" }}>
            <div className="upl-card bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm text-center relative overflow-hidden">
              {/* BG gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/80 pointer-events-none" />

              <div className="relative z-10">
                {/* Printer + floating docs */}
                <div className="relative flex items-end justify-center h-40 mb-5">
                  {/* Floating paper 1 */}
                  <div className="upl-float-1 absolute" style={{ bottom: 10, left: "50%", marginLeft: -60 }}>
                    <div className="w-10 h-12 bg-white border-2 border-indigo-200 rounded-lg shadow-md flex flex-col items-center justify-center gap-1 p-1.5">
                      <div className="w-6 h-0.5 bg-indigo-200 rounded" />
                      <div className="w-5 h-0.5 bg-indigo-100 rounded" />
                      <div className="w-6 h-0.5 bg-indigo-100 rounded" />
                    </div>
                  </div>
                  {/* Floating paper 2 */}
                  <div className="upl-float-2 absolute" style={{ bottom: 10, left: "50%", marginLeft: -20 }}>
                    <div className="w-10 h-12 bg-white border-2 border-violet-200 rounded-lg shadow-md flex items-center justify-center">
                      <svg className="w-5 h-5 text-violet-300" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z"/>
                      </svg>
                    </div>
                  </div>
                  {/* Floating paper 3 */}
                  <div className="upl-float-3 absolute" style={{ bottom: 10, left: "50%", marginLeft: 20 }}>
                    <div className="w-10 h-12 bg-white border-2 border-pink-200 rounded-lg shadow-md flex flex-col items-center justify-center gap-1 p-1.5">
                      <div className="w-6 h-0.5 bg-pink-200 rounded" />
                      <div className="w-4 h-0.5 bg-pink-100 rounded" />
                    </div>
                  </div>

                  {/* Printer */}
                  <div className="upl-printer absolute top-0 left-1/2 -translate-x-1/2 w-20 h-20 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-300/60">
                    <div className="absolute inset-0 rounded-2xl bg-indigo-400 animate-ping opacity-15" style={{ animationDuration: "1.8s" }} />
                    <svg className="w-10 h-10 text-white relative z-10" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm-1 9H8v2h4v-2z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>

                {/* Progress ring */}
                <div className="relative mx-auto mb-4 w-20 h-20">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="#e0e7ff" strokeWidth="7" />
                    <circle
                      cx="40" cy="40" r="34"
                      fill="none"
                      stroke="url(#pg)"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray="214"
                      strokeDashoffset={Math.max(4, 214 - (214 * overallProgress / 100))}
                      style={{ transition: "stroke-dashoffset 0.4s ease" }}
                    />
                    <defs>
                      <linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#6366f1" />
                        <stop offset="100%" stopColor="#8b5cf6" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-black text-indigo-700">{overallProgress}%</span>
                  </div>
                </div>

                {/* Animated label */}
                <div className="flex items-center justify-center gap-1.5 mb-4">
                  <span className="text-base font-bold text-gray-800">
                    {isRtl ? "جاري الإرسال" : "Uploading"}
                  </span>
                  <span className="upl-dot-1 w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
                  <span className="upl-dot-2 w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
                  <span className="upl-dot-3 w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
                </div>

                {/* Shimmer progress bar */}
                <div className="w-full bg-indigo-100 rounded-full h-2.5 overflow-hidden mb-5">
                  <div
                    className="upl-shimmer h-full rounded-full"
                    style={{ width: `${Math.max(overallProgress, 6)}%`, transition: "width 0.4s ease" }}
                  />
                </div>

                {/* Per-file list */}
                <div className="space-y-2.5 text-left max-h-40 overflow-y-auto">
                  {selectedFiles.map(f => (
                    <div key={f.id} className="flex items-center gap-2.5">
                      {f.status === "success" ? (
                        <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : f.status === "uploading" ? (
                        <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin flex-shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-gray-200 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-gray-700 font-medium truncate">{f.file.name}</span>
                          <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                            {f.status === "success" ? "100%" : `${f.progress}%`}
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${f.status === "success" ? "bg-green-400" : "bg-indigo-500"}`}
                            style={{ width: `${f.status === "success" ? 100 : f.progress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} isRtl={isRtl} />

      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        isOpen={cancelConfirm.isOpen}
        title={isRtl ? "إلغاء الطباعة" : "Cancel Print Job"}
        message={
          isRtl
            ? "هل أنت متأكد من إلغاء هذه الطباعة؟"
            : "Are you sure you want to cancel this print job?"
        }
        confirmText={isRtl ? "إلغاء" : "Cancel"}
        cancelText={isRtl ? "تراجع" : "Keep"}
        onConfirm={confirmCancelJob}
        onCancel={() => setCancelConfirm({ isOpen: false, jobId: null })}
        isDanger={true}
        isRtl={isRtl}
      />
    </div>
  );
};

export default UploadView;
