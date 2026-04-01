import React, { useState, useRef, useEffect } from "react";
import { Language, PrintJob, PrintStatus, ShopSettings } from "../types";
import { TRANSLATIONS, ALLOWED_TYPES } from "../constants";
import { storageService } from "../services/storageService";
import { calculatePrintPrice, getActualPageCount, formatPrice } from "../utils/pricingUtils";
import QRCode from "qrcode";

interface UploadViewProps {
  lang: Language;
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

const UploadView: React.FC<UploadViewProps> = ({ lang }) => {
  const t = (key: string) => TRANSLATIONS[key][lang] || key;
  const isRtl = lang === "ar";

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    notes: "",
  });
  const [printPreferences, setPrintPreferences] = useState({
    colorMode: "color" as "color" | "blackWhite",
    copies: 1,
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
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [jobPageCounts, setJobPageCounts] = useState<{[jobId: string]: number}>({});

  useEffect(() => {
    const fetchData = async () => {
      const [jobs, settings] = await Promise.all([
        storageService.getMyRecentJobs(),
        storageService.getSettings()
      ]);
      setRecentJobs(jobs);
      setShopSettings(settings);

      // Async page counting for pricing display
      if (settings?.pricing) {
        const counts: {[jobId: string]: number} = {};
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

  const handleCancelJob = async (id: string) => {
    if (window.confirm(isRtl ? "هل أنت متأكد من إلغاء هذه الطباعة؟" : "Are you sure you want to cancel this print job?")) {
      try {
        await storageService.deleteJob(id);
        setRecentJobs(prev => prev.filter(job => job.id !== id));
      } catch (err) {
        console.error("Failed to cancel job", err);
      }
    }
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

  if (overallSuccess) {
    return (
      <div className="max-w-md mx-auto mt-12 p-8 bg-white rounded-2xl shadow-xl text-center border border-gray-100">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
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
              d="M5 13l4 4L19 7"
            ></path>
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">{t("successMsg")}</h2>
        <p className="text-gray-600 mb-6">{t("uploadSub")}</p>
        <button
          onClick={() => {
            setOverallSuccess(false);
            setSelectedFiles([]);
            setFormData({ name: "", phone: "", notes: "" });
            setPrintPreferences({ colorMode: "color", copies: 1 });
          }}
          className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition"
        >
          {isRtl ? "إرسال ملفات أخرى" : "Send more files"}
        </button>
      </div>
    );
  }

  return (
    <div className={`max-w-xl mx-auto ${isRtl ? "rtl" : ""}`}>
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
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
        className="bg-white p-6 sm:p-10 rounded-[2rem] shadow-2xl shadow-indigo-100/40 border border-white space-y-8 mb-12"
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

        </div>

        <div className="relative">
          <label className="block text-sm font-semibold text-gray-800 mb-2">
            {t("selectFile")}
          </label>
          <div
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200 ${isUploading ? "opacity-50 cursor-not-allowed border-gray-200" : "border-indigo-200 bg-indigo-50/30 hover:bg-indigo-50 hover:border-indigo-400 hover:shadow-md"
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
                            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
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
                    {shopSettings?.pricing && (
                      <span className="text-sm font-bold text-green-600 bg-green-50 px-2.5 py-0.5 rounded-md border border-green-100 whitespace-nowrap">
                        {formatPrice(calculatePrintPrice(job, shopSettings, jobPageCounts[job.id] || 1).totalPrice)}
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
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                    {job.status === PrintStatus.PENDING && (
                      <button
                        type="button"
                        onClick={() => handleCancelJob(job.id)}
                        title={isRtl ? "إلغاء طباعة" : "Cancel print"}
                        className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition shadow-sm"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
              <svg className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
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
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
    </div>
  );
};

export default UploadView;
