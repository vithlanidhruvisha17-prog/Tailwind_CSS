require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios"); // News fetch karne ke liye zaroori hai
const Groq = require("groq-sdk");
const fileUpload = require("express-fileupload");
const Tesseract = require("tesseract.js");

const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Middleware
app.use(express.json());
app.use(cors());

/* ---------------- DATABASE ---------------- */
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB connected... ✅"))
.catch(err => console.log("DB Error:", err));

/* ---------------- DATABASE SCHEMA UPDATE ---------------- */
const ReportSchema = new mongoose.Schema({
    text: String,
    image: String,
    result: String,   // AI ka result
    label: String,    // Kaggle wala label (Phishing, Fraud, etc.)
    likes: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    comments: [
        { username: String, text: String, date: { type: Date, default: Date.now } }
    ]
});
// 'Reports' wahi naam hai jo tune Colab mein collection ka rakha tha
const Report = mongoose.model("Report", ReportSchema, "Reports");

app.use(fileUpload()); // Middleware enable karo

/* ---------------- USER SCHEMA ---------------- */
const UserSchema = new mongoose.Schema({
    fullname: String,
    email: { type: String, unique: true },
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

/* ---------------- OCR IMAGE UPLOAD ROUTE ---------------- */
app.post("/api/analyze-image", async (req, res) => {
    if (!req.files || !req.files.image) return res.status(400).json({ error: "No image" });

    const imageFile = req.files.image;
    // Image ko string mein convert kar rahe hain taaki DB mein store ho sake
    const base64Image = `data:${imageFile.mimetype};base64,${imageFile.data.toString('base64')}`;

    try {
        console.log("System: Extracting text from image... 🖼️🔍");
        const { data: { text } } = await Tesseract.recognize(imageFile.data, 'eng');

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "You are a Cyber Security Expert. Analyze for threats, Risk Rating (0-10), and 3 safety tips." },
                { role: "user", content: text },
            ],
            model: "llama-3.3-70b-versatile",
        });

        const aiText = chatCompletion.choices[0]?.message?.content || "Analysis Failed";
        
        // 🔥 IMAGE KE SAATH SAVE KARO
        await Report.create({ 
            text: text, 
            image: base64Image, 
            result: aiText 
        });

        res.json({ success: true, result: aiText });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});``

// Kaggle Master Data Fetch karne ke liye
app.get('/api/reports', async (req, res) => {
    try {
        const allReports = await Report.find({ label: { $exists: true } })
                                       .sort({ _id: -1 })
                                       .limit(100); 
        res.json(allReports);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- 1. LIVE CYBER NEWS ROUTE (Wapas Fixed!) 📰 ---------------- */
app.get("/api/cyber-news", async (req, res) => {
    try {
        // Aapka wahi purana logic: rss2json use karke bleepingcomputer se news
        const rssUrl = "https://api.rss2json.com/v1/api.json?rss_url=https://www.bleepingcomputer.com/feed/";
        const response = await axios.get(rssUrl);
        
        const newsItems = response.data.items.slice(0, 12).map(item => item.title);
        
        console.log("Real-time News Fetched! 📰");
        res.json({ success: true, news: newsItems });
    } catch (err) {
        console.error("News API Error:", err.message);
        // Fallback agar API fail ho jaye
        res.json({ 
            success: true, 
            news: [
                "CRITICAL: New zero-day vulnerability found in major browsers.",
                "ALERT: Ransomware attacks rising in healthcare sector.",
                "SECURITY: Update your 2FA settings for all social accounts."
            ] 
        });
    }
});

/* ---------------- 2. GROQ ANALYZE ROUTE ⚡ ---------------- */
app.post("/analyze", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text required" });

    console.log("System: Starting Groq Analysis... ⚡");

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "You are a Cyber Security Expert. Analyze the text for threats, give a Risk Rating (0-10), and provide 3 safety tips."
                },
                {
                    role: "user",
                    content: text,
                },
            ],
            model: "llama-3.3-70b-versatile",
        });

        const aiText = chatCompletion.choices[0]?.message?.content || "No response from AI.";
        
        // Database mein save karna mat bhoolna
        await Report.create({ text, result: aiText });
        
        console.log("Status: Groq Response Success! 🚀");
        res.json({ success: true, result: aiText });

    } catch (error) {
        console.error("Groq Error:", error.message);
        res.status(500).json({ success: false, message: "AI Busy" });
    }
});

/* ---------------- 3. HISTORY ROUTES ---------------- */
app.get("/reports", async (req, res) => {
    try {
        const data = await Report.find({ result: { $exists: true } }).sort({ createdAt: -1 });
        console.log(`Frontend calling: Sending ${data.length} AI reports`); // Check if this prints in terminal
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/reports/clear", async (req, res) => {
    try {
        await Report.deleteMany({});
        console.log("History Cleared! 🧹");
        res.json({ success: true, message: "History Cleared! 🧹" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- AUTH ROUTES (SIGNUP & LOGIN) ---------------- */

// 1. SIGNUP ROUTE
app.post("/api/signup", async (req, res) => {
    try {
        const { fullname, email, username, password } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.json({ success: false, message: "Username already taken!" });

        const newUser = new User({ fullname, email, username, password });
        await newUser.save();
        
        res.json({ success: true, user: { username: newUser.username } });
        console.log(`New user registered: ${username} ✅`);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. LOGIN ROUTE
app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password }); // Direct check (Hashing recommended for real apps)

        if (user) {
            console.log(`User logged in: ${username} 🔓`);
            res.json({ success: true, user: { username: user.username } });
        } else {
            res.json({ success: false, message: "Invalid credentials" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Like update karne ka route
app.post("/api/reports/:id/like", async (req, res) => {
    try {
        // Hum database mein likes ka field increment (+1) kar rahe hain
        const report = await Report.findByIdAndUpdate(
            req.params.id, 
            { $inc: { likes: 1 } }, 
            { new: true }
        );
        if (!report) return res.status(404).json({ success: false, message: "Report not found" });
        res.json({ success: true, likes: report.likes });
    } catch (err) {
        res.status(500).json({ error: "Invalid ID format or Server Error" });
    }
});

app.post("/api/reports/:id/comment", async (req, res) => {
    try {
        const { username, text } = req.body;
        const report = await Report.findByIdAndUpdate(
            req.params.id,
            { $push: { comments: { username, text } } }, // Array mein naya comment push karo
            { new: true }
        );
        res.json({ success: true, report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const Follow = require('./models/Follow'); // Pehle model import karo

// 1. Follower Count nikalne ki API
app.get('/api/followers/:username', async (req, res) => {
    try {
        const user = req.params.username;
        // Database mein gino ki is user ko kitne log follow kar rahe hain
        const followers = await Follow.countDocuments({ following: user });
        const following = await Follow.countDocuments({ follower: user });
        
        res.json({ followersCount: followers, followingCount: following });
    } catch (err) {
        res.status(500).json({ error: "DB error" });
    }
});

// 2. Naya Follower add karne ki API (Testing ke liye)
app.post('/api/follow', async (req, res) => {
    const { follower, following } = req.body;
    const newFollow = new Follow({ follower, following });
    await newFollow.save();
    res.json({ success: true });
});
/* ---------------- SERVER ---------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT} 🚀`));