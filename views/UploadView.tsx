import React, { useState, useRef, useEffect } from "react";
import { Language, PrintJob, PrintStatus } from "../types";
import { TRANSLATIONS, ALLOWED_TYPES } from "../constants";
import { storageService } from "../services/storageService";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    storageService.getMyRecentJobs().then(setRecentJobs);
  }, [overallSuccess]);

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
      // Method 1: Use WebRTC to get local IP
      const rtc = new RTCPeerConnection({ iceServers: [] });
      rtc.createDataChannel("", { reliable: false });
      const candidate = await new Promise<RTCIceCandidate>(
        (resolve, reject) => {
          rtc.onicecandidate = (event) => {
            if (event.candidate) {
              resolve(event.candidate);
            }
          };
          rtc
            .createOffer()
            .then((offer) => rtc.setLocalDescription(offer))
            .catch(reject);
        },
      );

      const ipMatch = candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch && ipMatch[1]) {
        return ipMatch[1];
      }
    } catch (err) {
      console.log("WebRTC method failed, trying fallback");
    }

    try {
      // Method 2: Fallback - try common network IP ranges
      const hostname = window.location.hostname;
      if (hostname !== "localhost" && hostname !== "127.0.0.1") {
        return hostname;
      }

      // Method 3: Try to detect from network interfaces (approximation)
      // This is a simplified approach - in production you might want a more robust solution
      const possibleIPs = [
        "192.168.1.90", // From the dev server output
        "192.168.137.1", // From the dev server output
        "192.168.0.1",
        "192.168.1.1",
      ];

      // Return the first likely candidate or fallback to localhost
      return possibleIPs[0] || "localhost";
    } catch (err) {
      console.error("All IP detection methods failed:", err);
      return "localhost";
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
        className="bg-white p-8 rounded-2xl shadow-lg border border-gray-100 space-y-6 mb-12"
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
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition disabled:bg-gray-50"
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
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition disabled:bg-gray-50"
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
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition h-20 resize-none disabled:bg-gray-50"
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
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <label className="block text-sm font-semibold text-gray-700 mb-3">
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
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border transition ${
                    printPreferences.colorMode === "color"
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
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-md border transition ${
                    printPreferences.colorMode === "blackWhite"
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

          {/* Quick Options */}
          <div className="mt-3 pt-3 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-2">
              {isRtl ? "خيارات سريعة:" : "Quick options:"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isUploading}
                onClick={() =>
                  setPrintPreferences({ colorMode: "blackWhite", copies: 1 })
                }
                className="px-2 py-1 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRtl ? "أبيض وأسود، نسخة واحدة" : "B&W, 1 copy"}
              </button>
              <button
                type="button"
                disabled={isUploading}
                onClick={() =>
                  setPrintPreferences({ colorMode: "color", copies: 1 })
                }
                className="px-2 py-1 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRtl ? "ملون، نسخة واحدة" : "Color, 1 copy"}
              </button>
              <button
                type="button"
                disabled={isUploading}
                onClick={() =>
                  setPrintPreferences({ colorMode: "blackWhite", copies: 2 })
                }
                className="px-2 py-1 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRtl ? "أبيض وأسود، نسختان" : "B&W, 2 copies"}
              </button>
              <button
                type="button"
                disabled={isUploading}
                onClick={() =>
                  setPrintPreferences({ colorMode: "color", copies: 2 })
                }
                className="px-2 py-1 text-xs bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRtl ? "ملون، نسختان" : "Color, 2 copies"}
              </button>
            </div>
          </div>
        </div>

        <div className="relative">
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            {t("selectFile")}
          </label>
          <div
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 transition ${
              isUploading ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              multiple
              accept=".pdf,.docx,.jpg,.png,image/jpeg,image/png"
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
          className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 disabled:bg-gray-300 transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-2"
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
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      job.status === PrintStatus.PRINTED
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
                    <p className="text-xs text-gray-400">
                      {new Date(job.uploadDate).toLocaleDateString(
                        isRtl ? "ar-EG" : "en-US",
                        { numberingSystem: "latn" },
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      job.status === PrintStatus.PRINTED
                        ? "bg-green-100 text-green-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {job.status === PrintStatus.PRINTED
                      ? t("printed")
                      : t("pending")}
                  </span>
                </div>
              </div>
            ))}
          </div>
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
    </div>
  );
};

export default UploadView;
