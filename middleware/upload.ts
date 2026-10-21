import multer from "multer";
import { RequestHandler } from "express";
import path from "path";
import fs from "fs";

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.memoryStorage();

// File filter
const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`), false);
  }
};

export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: fileFilter,
});

export const uploadSingle = upload.single("file");
const projectUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
});

export const uploadMultiple: RequestHandler = (req, res, next) => {
  projectUpload.array("files", 5)(req, res, (error) => {
    if (!error) { next(); return; }
    const message = error instanceof multer.MulterError
      ? error.code === "LIMIT_FILE_SIZE"
        ? "Each project file must be 10 MB or smaller"
        : "Choose up to 5 project files"
      : error.message || "Could not upload project files";
    res.status(400).json({ message });
  });
};