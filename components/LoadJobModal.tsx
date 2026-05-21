import React, { useState, useEffect } from "react";
import { PrintJob } from "../types";

interface LoadJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (job: PrintJob, file: File) => void;
  acceptType?: string;
}

const LoadJobModal: React.FC<LoadJobModalProps> = ({ isOpen, onClose, onSelect, acceptType }) => {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const fetchJobs = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/jobs");
        const data = await res.json();
        const list = Array.isArray(data) ? data.filter((j: any) => j.serverFileName) : [];
        setJobs(list);
      } catch {
        setError("Failed to load jobs");
      } finally {
        setLoading(false);
      }
    };
    fetchJobs();
  }, [isOpen]);

  const handleSelect = async (job: any) => {
    if (!job.serverFileName) return;
    setDownloading(job.id);
    setError("");
    try {
      const res = await fetch(`/api/files/${job.serverFileName}`);
      if (!res.ok) throw new Error("File not found");
      const blob = await res.blob();
      const file = new File([blob], job.fileName, { type: job.fileType });
      onSelect(job as PrintJob, file);
      onClose();
    } catch {
      setError("Failed to download file");
    } finally {
      setDownloading(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-2xl max-h-[80vh] flex flex-col mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-800">Load from Print Jobs</h2>
          <button className="text-gray-400 hover:text-gray-600 text-xl leading-none" onClick={onClose}>&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="text-center text-gray-400 py-8 text-sm">Loading jobs...</div>
          ) : error ? (
            <div className="text-center text-red-500 py-8 text-sm">{error}</div>
          ) : jobs.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">No print jobs with files found</div>
          ) : (
            jobs.map((job) => (
              <button
                key={job.id}
                disabled={downloading === job.id}
                className="w-full flex items-center gap-4 p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition disabled:opacity-50 text-left"
                onClick={() => handleSelect(job)}
              >
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{job.fileName}</div>
                  <div className="text-xs text-gray-500">
                    {job.customerName || "Anonymous"} &middot; {new Date(job.uploadDate).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                    job.status === "PENDING" ? "bg-yellow-100 text-yellow-700" :
                    job.status === "READY" ? "bg-green-100 text-green-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>
                    {job.status}
                  </span>
                  <div className="text-xs text-gray-400 mt-0.5">{job.pageCount ? `${job.pageCount} pages` : ""}</div>
                </div>
              </button>
            ))
          )}
        </div>
        {error && <div className="px-4 pb-4 text-sm text-red-500">{error}</div>}
      </div>
    </div>
  );
};

export default LoadJobModal;
