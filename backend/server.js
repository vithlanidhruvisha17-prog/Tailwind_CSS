require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const Groq = require("groq-sdk");
const fileUpload = require("express-fileupload");
const Tesseract = require("tesseract.js");
const path = require('path');

const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Middleware
app.use(express.json());
app.use(cors());
app.use(fileUpload());

/* ---------------- DATABASE CONNECTION ---------------- */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB connected... ✅"))
    .catch(err => console.log("DB Error:", err));

/* ---------------- SCHEMAS & MODELS ---------------- */
const ReportSchema = new mongoose.Schema({
    text: String,
    image: String,
    result: String,
    label: String, 
    likes: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    comments: [{ username: String, text: String, date: { type: Date, default: Date.now } }]
});
const Report = mongoose.model("Report", ReportSchema, "Reports");

const UserSchema = new mongoose.Schema({
    fullname: String,
    email: { type: String, unique: true },
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

// Follow Model Import (Fixed Path)
const Follow = require(path.join(__dirname, 'models', 'Follow'));

/* ---------------- AI ANALYSIS ROUTES ---------------- */

// 1. Text Analysis
app.post("/analyze", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text required" });

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "You are a Cyber Security Expert. Analyze for threats, Risk Rating (0-10), and 3 safety tips." },
                { role: "user", content: text },
            ],
            model: "llama-3.3-70b-versatile",
        });

        const aiText = chatCompletion.choices[0]?.message?.content || "Analysis Failed";
        await Report.create({ text, result: aiText });
        res.json({ success: true, result: aiText });
    } catch (error) {
        res.status(500).json({ success: false, message: "AI Busy" });
    }
});

// 2. Image OCR Analysis
app.post("/api/analyze-image", async (req, res) => {
    if (!req.files || !req.files.image) return res.status(400).json({ error: "No image" });

    const imageFile = req.files.image;
    const base64Image = `data:${imageFile.mimetype};base64,${imageFile.data.toString('base64')}`;

    try {
        const { data: { text } } = await Tesseract.recognize(imageFile.data, 'eng');
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "You are a Cyber Security Expert. Analyze for threats, Risk Rating (0-10), and 3 safety tips." },
                { role: "user", content: text },
            ],
            model: "llama-3.3-70b-versatile",
        });

        const aiText = chatCompletion.choices[0]?.message?.content || "Analysis Failed";
        await Report.create({ text, image: base64Image, result: aiText });
        res.json({ success: true, result: aiText });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- FEED & SOCIAL ROUTES ---------------- */

app.get('/api/reports', async (req, res) => {
    try {
        // Fetching both Kaggle data and AI Reports
        const reports = await Report.find().sort({ createdAt: -1 }).limit(100);
        res.json(reports);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/reports/:id/like", async (req, res) => {
    try {
        const report = await Report.findByIdAndUpdate(req.params.id, { $inc: { likes: 1 } }, { new: true });
        res.json({ success: true, likes: report.likes });
    } catch (err) { res.status(500).json({ error: "Like failed" }); }
});

app.post("/api/reports/:id/comment", async (req, res) => {
    try {
        const { username, text } = req.body;
        const report = await Report.findByIdAndUpdate(req.params.id, { $push: { comments: { username, text } } }, { new: true });
        res.json({ success: true, report });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ---------------- FOLLOW SYSTEM ---------------- */

app.post('/api/follow', async (req, res) => {
    try {
        const { follower, following } = req.body;
        if (follower === following) return res.status(400).json({ error: "Self-follow not allowed" });

        const existing = await Follow.findOne({ follower, following });
        if (existing) {
            await Follow.deleteOne({ follower, following });
            return res.json({ success: true, status: 'unfollowed' });
        } 
        await new Follow({ follower, following }).save();
        res.json({ success: true, status: 'followed' });
    } catch (err) { res.status(500).json({ error: "Follow error" }); }
});

app.get('/api/is-following/:follower/:following', async (req, res) => {
    try {
        const connection = await Follow.findOne({ follower: req.params.follower, following: req.params.following });
        res.json({ following: !!connection });
    } catch (err) { res.status(500).json({ error: "DB Error" }); }
});

app.get('/api/followers/:username', async (req, res) => {
    try {
        const followers = await Follow.countDocuments({ following: req.params.username });
        const following = await Follow.countDocuments({ follower: req.params.username });
        res.json({ followersCount: followers, followingCount: following });
    } catch (err) { res.status(500).json({ error: "DB error" }); }
});

/* ---------------- AUTH & NEWS ---------------- */

app.post("/api/signup", async (req, res) => {
    try {
        const { username } = req.body;
        if (await User.findOne({ username })) return res.json({ success: false, message: "Taken!" });
        const newUser = await new User(req.body).save();
        res.json({ success: true, user: { username: newUser.username } });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (user) res.json({ success: true, user: { username: user.username } });
    else res.json({ success: false, message: "Invalid credentials" });
});

app.get("/api/cyber-news", async (req, res) => {
    try {
        const response = await axios.get("https://api.rss2json.com/v1/api.json?rss_url=https://www.bleepingcomputer.com/feed/");
        res.json({ success: true, news: response.data.items.slice(0, 12).map(i => i.title) });
    } catch (err) { res.json({ success: true, news: ["Update your security settings!"] }); }
});

/* ---------------- SERVER START ---------------- */
app.get("/", (req, res) => res.send("CyberShield Backend Live 🚀"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));