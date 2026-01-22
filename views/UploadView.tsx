import React, { useState, useRef, useEffect } from "react";
import { Language, PrintJob, PrintStatus } from "../types";
import { TRANSLATIONS, ALLOWED_TYPES } from "../constants";
import { storageService } from "../services/storageService";

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
  const [selectedFiles, setSelectedFiles] = useState<FileStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [overallSuccess, setOverallSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<PrintJob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    storageService.getMyRecentJobs().then(setRecentJobs);
  }, [overallSuccess]);

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
    notes: string
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
    };

    setSelectedFiles((prev) =>
      prev.map((f) =>
        f.id === fileStatus.id ? { ...f, status: "uploading" } : f
      )
    );

    try {
      await storageService.saveJob(job, fileStatus.file, (progress) => {
        setSelectedFiles((prev) =>
          prev.map((f) => (f.id === fileStatus.id ? { ...f, progress } : f))
        );
      });
      setSelectedFiles((prev) =>
        prev.map((f) =>
          f.id === fileStatus.id
            ? { ...f, status: "success", progress: 100 }
            : f
        )
      );
    } catch (err) {
      console.error("Upload error for file:", fileStatus.file.name, err);
      setSelectedFiles((prev) =>
        prev.map((f) =>
          f.id === fileStatus.id ? { ...f, status: "error" } : f
        )
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
          formData.notes
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
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition h-24 resize-none disabled:bg-gray-50"
            value={formData.notes}
            onChange={(e) =>
              setFormData({ ...formData, notes: e.target.value })
            }
            placeholder={
              isRtl
                ? "أدخل تعليمات الطباعة هنا (مثلاً: عدد النسخ)"
                : "Enter printing instructions here..."
            }
          />
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
            <span className="text-xs text-gray-400">
              {isRtl
                ? "محفوظ محلياً في متصفحك"
                : "Saved locally in your browser"}
            </span>
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
                        { numberingSystem: "latn" }
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
    </div>
  );
};

export default UploadView;
