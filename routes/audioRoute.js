// routes/audioRoute.js
import express from 'express';
import multer from 'multer';
import { transcribeAndRespond } from '../controllers/audioController.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

router.post('/upload', upload.single('audio'), transcribeAndRespond);

export default router;